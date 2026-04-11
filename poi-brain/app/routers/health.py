"""Health + introspection endpoints."""
from __future__ import annotations

import time

from fastapi import APIRouter

from ..config import settings
from ..pipeline.rapids_runtime import HAS_RAPIDS
from ..state import STATE

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "uptimeSeconds": round(time.time() - STATE.started_at, 1),
        "rapids": HAS_RAPIDS,
        "cameras": len(STATE.cameras),
        "hexCells": len(STATE.hex_cells),
        "modelVersion": STATE.model_version,
        "vlmBackend": settings.vlm_backend,
        "nimBaseUrl": settings.nim_base_url,
        "nimModel": settings.nim_model,
    }
