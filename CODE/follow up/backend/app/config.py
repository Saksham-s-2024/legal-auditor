"""
SovereignAudit v2.0 — Application Configuration
All secrets are sourced from environment variables; never hardcoded.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Supabase ──────────────────────────────────────────────────────────────
    supabase_url: str
    supabase_service_key: str

    # ── Gemini ────────────────────────────────────────────────────────────────
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    gemini_rpm_limit: int = 15

    # ── Application ───────────────────────────────────────────────────────────
    app_secret_key: str
    app_name: str = "SovereignAudit v2.0"
    debug: bool = False

    # ── Embedding Model ───────────────────────────────────────────────────────
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384

    # ── Chunking Parameters ───────────────────────────────────────────────────
    parent_chunk_tokens: int = 2000
    child_chunk_tokens: int = 100
    ocr_density_threshold: int = 100     # chars — below this triggers OCR fallback
    max_input_length: int = 500          # security: max query string length

    # ── Retrieval ─────────────────────────────────────────────────────────────
    top_k_children: int = 20

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
