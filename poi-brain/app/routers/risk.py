"""Risk heatmap, per-camera risk, and SSE stream."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, List

from fastapi import APIRouter, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..pipeline.categories import ALL_CATEGORY_IDS, CATEGORIES, NON_ALL_IDS
from ..schemas import Heatmap, HexCell, RiskScore
from ..state import STATE, subscribe_risk, unsubscribe_risk

router = APIRouter(prefix="/risk", tags=["risk"])


def _project_cell_for_category(cell: HexCell, category: str) -> HexCell:
    """Return a copy of the hex cell whose score/tier reflect the given
    category. category='all' returns the aggregate (unchanged)."""
    if category == "all":
        return cell
    cat_info = cell.categories.get(category)
    if cat_info is None:
        return cell.model_copy(
            update={
                "score": 0.0,
                "tier": "low",
            }
        )
    return cell.model_copy(
        update={
            "score": cat_info.score,
            "tier": cat_info.tier,
        }
    )


@router.get("/categories")
async def list_categories():
    return [
        {
            "id": c.id,
            "label": c.label,
            "description": c.description,
        }
        for c in CATEGORIES
    ]


@router.get("/hex", response_model=List[HexCell])
async def list_hex_cells(
    resolution: int | None = Query(None),
    category: str = Query(default="all"),
):
    if category not in ALL_CATEGORY_IDS:
        raise HTTPException(status_code=400, detail=f"unknown category {category}")
    return [_project_cell_for_category(c, category) for c in STATE.hex_cells]


@router.get("/heatmap", response_model=Heatmap)
async def get_heatmap(
    resolution: int = Query(default=None),
    top: int = Query(default=600, ge=1, le=50000),
    category: str = Query(default="all"),
):
    if category not in ALL_CATEGORY_IDS:
        raise HTTPException(status_code=400, detail=f"unknown category {category}")
    res = resolution or settings.h3_resolution
    projected = [_project_cell_for_category(c, category) for c in STATE.hex_cells]
    cells = sorted(projected, key=lambda c: c.score, reverse=True)[:top]
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
