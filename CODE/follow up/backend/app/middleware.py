"""
SovereignAudit v2.0 — Global Exception Middleware
Intercepts all unhandled exceptions, logs full traceback internally,
and returns a generic sanitized response to the client.
This prevents schema/codebase disclosure.
"""

from __future__ import annotations

import traceback

import structlog
from fastapi import Request
from fastapi.responses import JSONResponse

log = structlog.get_logger(__name__)

GENERIC_ERROR_RESPONSE = {
    "status": "error",
    "message": "An internal service error occurred. Please try again or contact support.",
}


async def global_exception_handler(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        # Log full traceback internally — NEVER expose to client
        log.error(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            traceback=traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500,
            content=GENERIC_ERROR_RESPONSE,
        )
