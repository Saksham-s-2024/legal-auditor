from __future__ import annotations

vimport huggingface_hub.file_download
huggingface_hub.file_download.are_symlinks_supported = lambda *args, **kwargs: False


import hashlib
import os
import uuid
import json
import asyncio
import tempfile
from typing import AsyncGenerator

import structlog
import google.generativeai as genai
from fastapi import FastAPI, UploadFile, HTTPException, Request, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings, Settings
from app.services import (
    embed_texts,
    scrub_pii,
    restore_pii,
    get_supabase,
    split_by_tokens,
    split_markdown_by_headers,
)
from app.middleware import global_exception_handler

log = structlog.get_logger(__name__)

app = FastAPI(
    title="Legal-Auditor v2.0",
    version="2.0.0",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your Vercel domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(global_exception_handler)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Legal-Auditor v2.0"}

class QueryRequest(BaseModel):
    query: str
    workspace_id: str

    @field_validator("query")
    @classmethod
    def validate_query_length(cls, v: str) -> str:
        """Security: hard cap on user query length to prevent abuse."""
        v = v.strip()
        if len(v) == 0:
            raise ValueError("Query cannot be empty.")
        if len(v) > 500:
            raise ValueError("Query exceeds maximum allowed length of 500 characters.")
        return v

    @field_validator("workspace_id")
    @classmethod
    def validate_workspace_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("workspace_id must be a valid UUID.")
        return v


# ── Ingestion Pipeline ─────────────────────────────────────────────────────────
@app.post("/api/v1/upload")
async def process_contract_upload(
    file: UploadFile,
    workspace_id: str = Form(...),
    settings: Settings = Depends(get_settings),
):
    """
    Phase 1 → Layout parsing (Docling)
    Phase 2 → OCR fallback if text yield is too low
    Phase 3 → PII scrubbing (Microsoft Presidio)
    Phase 4 → Hierarchical chunking + local CPU embedding + Supabase insert
    """
    # ── Validate workspace UUID ───────────────────────────────────────────────
    try:
        ws_uuid = uuid.UUID(workspace_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid workspace_id format.")

    # ── 1. Read bytes & SHA-256 deduplication hash ────────────────────────────
    file_bytes = await file.read()
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    log.info("upload_received", filename=file.filename, hash=file_hash[:16])

    supabase = get_supabase()

    # Check duplicate
    existing = (
        supabase.table("contracts")
        .select("id")
        .eq("sha256_hash", file_hash)
        .execute()
    )
    if existing.data:
        return {
            "status": "duplicate",
            "message": "This document has already been ingested.",
            "hash": file_hash,
            "contract_id": existing.data[0]["id"],
        }

    # Write temp file for Docling
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=os.path.splitext(file.filename or "doc.pdf")[1]
    ) as tmp:
        tmp.write(file_bytes)
        temp_path = tmp.name

    try:
        # ── 2. Layout-aware parsing via Docling ───────────────────────────────
        extracted_text = _run_docling(temp_path)

        # ── 3. OCR Fallback if text density too low ────────────────────────────
        if len(extracted_text.strip()) < settings.ocr_density_threshold:
            log.warning("ocr_fallback_triggered", path=temp_path)
            extracted_text = _run_ocr(temp_path)

        # ── 4. PII Scrubbing ──────────────────────────────────────────────────
        scrubbed_text, _pii_map = scrub_pii(extracted_text)
        # NOTE: _pii_map is stored in-process only; not persisted to DB for privacy.

        # ── 5. Hierarchical chunking + embedding + DB insert ──────────────────
        contract_id = await _ingest_chunks(
            scrubbed_text=scrubbed_text,
            workspace_id=ws_uuid,
            file_name=file.filename or "unknown.pdf",
            file_hash=file_hash,
            settings=settings,
        )

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    log.info("ingestion_complete", contract_id=str(contract_id))
    return {
        "status": "success",
        "contract_id": str(contract_id),
        "hash": file_hash,
    }


def _run_docling(path: str) -> str:
    """Run IBM Docling layout parser and export to Markdown."""
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(path)
    return result.document.export_to_markdown()


def _run_ocr(path: str) -> str:
    """OCR fallback using pytesseract for scanned/image-heavy PDFs."""
    import pytesseract
    from pdf2image import convert_from_path

    images = convert_from_path(path, dpi=200)
    return "\n".join(pytesseract.image_to_string(img) for img in images)


async def _ingest_chunks(
    *,
    scrubbed_text: str,
    workspace_id: uuid.UUID,
    file_name: str,
    file_hash: str,
    settings: Settings,
) -> uuid.UUID:
    """Insert contract, parent chunks, child embeddings into Supabase in batches."""
    supabase = get_supabase()

    # Insert contract record
    contract_row = (
        supabase.table("contracts")
        .insert(
            {
                "workspace_id": str(workspace_id),
                "file_name": file_name,
                "sha256_hash": file_hash,
            }
        )
        .execute()
    )
    contract_id = uuid.UUID(contract_row.data[0]["id"])

    # Split into parent blocks by Markdown headers
    parent_blocks = split_markdown_by_headers(scrubbed_text)

    # Prepare parent rows
    parent_rows = []
    parent_child_mapping = []  # keeps track of parent_id, order, and body
    
    for order, (header, body) in enumerate(parent_blocks):
        if not body.strip():
            continue
        
        parent_id = uuid.uuid4()
        parent_rows.append({
            "id": str(parent_id),
            "contract_id": str(contract_id),
            "workspace_id": str(workspace_id),
            "header_title": header[:500],  # enforce field length
            "text_content": body,
            "chunk_order": order,
        })
        parent_child_mapping.append((parent_id, body))

    if not parent_rows:
        return contract_id

    # Batch insert all parent chunks (1 database call)
    supabase.table("parent_chunks").insert(parent_rows).execute()

    # Generate all child chunks
    all_child_texts = []
    child_meta = []  # lists keeping track of parent_id and metadata

    for parent_id, body in parent_child_mapping:
        child_texts = split_by_tokens(body, settings.child_chunk_tokens)
        for idx, text in enumerate(child_texts):
            all_child_texts.append(text)
            child_meta.append({
                "parent_id": str(parent_id),
                "workspace_id": str(workspace_id),
                "text_content": text,
                "chunk_order": idx
            })

    if not all_child_texts:
        return contract_id

    # Embed all child chunks across the entire document in a single CPU vectorized batch
    vectors = embed_texts(all_child_texts)

    # Build child rows for insertion
    child_rows = []
    for meta, vector in zip(child_meta, vectors):
        row = meta.copy()
        row["semantic_embedding"] = vector
        child_rows.append(row)

    # Insert children in chunks of 200 to prevent request size limits while maintaining high performance
    batch_size = 200
    for i in range(0, len(child_rows), batch_size):
        supabase.table("child_chunks").insert(child_rows[i : i + batch_size]).execute()

    log.info(
        "ingestion_complete",
        parents=len(parent_rows),
        children=len(child_rows),
    )

    return contract_id


# ── Query & SSE Streaming ──────────────────────────────────────────────────────
@app.post("/api/v1/query")
async def query_contracts(
    request: QueryRequest,
    settings: Settings = Depends(get_settings),
):
    """
    1. Embed user query locally (CPU)
    2. KNN search child_chunks in Supabase
    3. Context-swap: pull full parent sections
    4. Stream Gemini response via SSE
    """
    return StreamingResponse(
        _stream_rag_response(request, settings),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_rag_response(
    request: QueryRequest,
    settings: Settings,
) -> AsyncGenerator[str, None]:
    try:
        supabase = get_supabase()
        workspace_uuid = uuid.UUID(request.workspace_id)

        # ── 1. Embed query ────────────────────────────────────────────────────
        [query_vector] = embed_texts([request.query])

        # ── 2. KNN search via Supabase RPC ────────────────────────────────────
        rpc_result = supabase.rpc(
            "search_child_chunks",
            {
                "query_embedding": query_vector,
                "target_workspace": str(workspace_uuid),
                "top_k": settings.top_k_children,
            },
        ).execute()

        if not rpc_result.data:
            yield _sse("No relevant contract sections found for your query.")
            return

        # ── 3. Context-swap: collect unique parent IDs ─────────────────────────
        parent_ids = list({row["parent_id"] for row in rpc_result.data})

        parent_rows = (
            supabase.table("parent_chunks")
            .select("header_title, text_content")
            .in_("id", parent_ids)
            .execute()
        )

        context_sections = "\n\n---\n\n".join(
            f"## {row['header_title']}\n{row['text_content']}"
            for row in parent_rows.data
        )

        # ── 4. Build Gemini prompt ─────────────────────────────────────────────
        system_prompt = (
            "You are Legal-Auditor, an expert legal compliance auditor who is direct and speaks their mind. "
            "You operate STRICTLY on legal contracts, documents, and compliance audits. "
            "If the user's query is not directly related to legal agreements, contracts, regulations, compliance, or the uploaded document text, "
            "politely refuse to answer and state that you are a dedicated legal contract compliance engine. "
            "Using ONLY the contract sections provided below, answer the user's query and provide your sharp, "
            "independent analytical opinion on the terms. Be blunt: offer harsh opinions if a clause is highly one-sided, "
            "risky, or unfair, and straightforward/bland opinions if it is standard industry boilerplate. "
            "Always reference the specific clause headers or sections. "
            "If the answer cannot be determined from the provided sections, "
            "state that clearly. Never hallucinate contract terms.\n\n"
            f"CONTRACT SECTIONS:\n{context_sections}"
        )

        user_prompt = f"QUERY: {request.query}"

        # ── 5. Gemini streaming ────────────────────────────────────────────────
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=system_prompt,
        )

        response_stream = await asyncio.to_thread(
            lambda: model.generate_content(user_prompt, stream=True)
        )

        for chunk in response_stream:
            if chunk.text:
                yield _sse(chunk.text)
                await asyncio.sleep(0)  # yield control to event loop

        yield _sse("[DONE]")

    except Exception as exc:
        log.error("rag_stream_error", error=str(exc))
        yield _sse("[ERROR] An internal error occurred. Please try again.")


def _sse(data: str) -> str:
    """Format a string as a Server-Sent Event."""
    return f"data: {json.dumps({'token': data})}\n\n"
