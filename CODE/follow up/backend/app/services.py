"""
SovereignAudit v2.0 — Shared Backend Services
Lazy-loaded singletons for embedding model, Presidio engines, and Supabase client.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import structlog
from functools import lru_cache

log = structlog.get_logger(__name__)

# ── Embedding Singleton ────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def get_embed_model():
    from sentence_transformers import SentenceTransformer
    from app.config import get_settings
    cfg = get_settings()
    log.info("loading_embedding_model", model=cfg.embedding_model)
    return SentenceTransformer(cfg.embedding_model)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed a list of strings. Returns list of 384-dim vectors."""
    model = get_embed_model()
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vectors.tolist()


# ── PII Scrubbing Singletons ──────────────────────────────────────────────────
@lru_cache(maxsize=1)
def get_presidio_engines():
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
    log.info("loading_presidio_engines")
    analyzer = AnalyzerEngine()
    anonymizer = AnonymizerEngine()
    return analyzer, anonymizer


def scrub_pii(text: str) -> tuple[str, dict[str, str]]:
    """
    Mask PII tokens in *text*.
    Returns (scrubbed_text, reverse_map) where reverse_map maps token → original value.
    """
    analyzer, anonymizer = get_presidio_engines()
    results = analyzer.analyze(text=text, language="en")
    anonymized = anonymizer.anonymize(text=text, analyzer_results=results)
    scrubbed = anonymized.text

    # Build a reverse map from the anonymizer items
    reverse_map: dict[str, str] = {}
    for item in anonymized.items:
        reverse_map[item.text] = text[item.start:item.end]  # type: ignore[attr-defined]

    return scrubbed, reverse_map


def restore_pii(text: str, reverse_map: dict[str, str]) -> str:
    """Replace anonymized tokens with original PII values for final output."""
    for token, original in reverse_map.items():
        text = text.replace(token, original)
    return text


# ── Supabase Client Singleton ─────────────────────────────────────────────────
@lru_cache(maxsize=1)
def get_supabase():
    from supabase import create_client
    from app.config import get_settings
    cfg = get_settings()
    log.info("connecting_to_supabase", url=cfg.supabase_url[:30])
    return create_client(cfg.supabase_url, cfg.supabase_service_key)


# ── Token-based Text Splitting ────────────────────────────────────────────────
def split_by_tokens(text: str, max_tokens: int) -> list[str]:
    """
    Naive whitespace-token splitter.
    Splits *text* into chunks of at most *max_tokens* words.
    """
    words = text.split()
    chunks: list[str] = []
    for i in range(0, len(words), max_tokens):
        chunk = " ".join(words[i : i + max_tokens])
        if chunk.strip():
            chunks.append(chunk.strip())
    return chunks


def split_markdown_by_headers(text: str) -> list[tuple[str, str]]:
    """
    Split markdown text into (header_title, body) tuples using H1/H2 headers.
    Falls back to a single block when no headers are found.
    """
    pattern = re.compile(r"^(#{1,2} .+)$", re.MULTILINE)
    positions = [(m.start(), m.group()) for m in pattern.finditer(text)]

    if not positions:
        return [("Document", text)]

    blocks: list[tuple[str, str]] = []
    for idx, (start, header) in enumerate(positions):
        end = positions[idx + 1][0] if idx + 1 < len(positions) else len(text)
        body = text[start + len(header) : end].strip()
        blocks.append((header.lstrip("#").strip(), body))

    return blocks
