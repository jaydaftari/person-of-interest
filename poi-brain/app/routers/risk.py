"""Risk heatmap, per-camera risk, and SSE stream."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, List

from fastapi import APIRouter, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..schemas import Heatmap, HexCell, RiskScore
from ..state import STATE, subscribe_risk, unsubscribe_risk

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/hex", response_model=List[HexCell])
async def list_hex_cells(resolution: int | None = Query(None)):
    return STATE.hex_cells


@router.get("/heatmap", response_model=Heatmap)
async def get_heatmap(
    resolution: int = Query(default=None),
    top: int = Query(default=400, ge=1, le=5000),
):
    res = resolution or settings.h3_resolution
    cells = sorted(STATE.hex_cells, key=lambda c: c.score, reverse=True)[:top]
    now = datetime.now(tz=timezone.utc)
    end = now + timedelta(minutes=settings.prediction_window_minutes)
    return Heatmap(
        resolution=res,
        cells=cells,
        generatedAt=now.isoformat(),
        windowStart=now.isoformat(),
        windowEnd=end.isoformat(),
    )


@router.get("/camera/{camera_id}", response_model=RiskScore)
async def get_camera_risk(camera_id: str):
    risk = STATE.risk_by_camera.get(camera_id)
    if risk is None:
        raise HTTPException(status_code=404, detail="no risk for camera")
    return risk


async def _risk_event_stream() -> AsyncIterator[dict]:
    q = subscribe_risk()
    try:
        for risk in list(STATE.risk_by_camera.values()):
            yield {"event": "message", "data": risk.model_dump_json()}
        while True:
            try:
                risk = await asyncio.wait_for(q.get(), timeout=20.0)
                yield {"event": "message", "data": risk.model_dump_json()}
            except asyncio.TimeoutError:
                yield {"event": "heartbeat", "data": "{}"}
    finally:
        unsubscribe_risk(q)


@router.get("/stream")
async def stream_risk():
    return EventSourceResponse(_risk_event_stream())
