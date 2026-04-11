"""Forecast stats for the dashboard top strip."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter

from ..schemas import ForecastStats, Precinct
from ..state import STATE

router = APIRouter(prefix="/stats", tags=["stats"])


def _highest_risk_precinct() -> Optional[Precinct]:
    cells = STATE.hex_cells
    if not cells:
        return None
    hottest = max(cells, key=lambda c: c.score)
    return Precinct(
        id=hottest.h3Index[:6].upper(),
        name=f"HEX {hottest.h3Index[:6].upper()}",
        centroidLatLng=(40.7484, -73.9857),
        riskScore=hottest.score,
        tier=hottest.tier,
    )


@router.get("/forecast", response_model=ForecastStats)
async def forecast():
    cells = STATE.hex_cells
    hottest = sorted(cells, key=lambda c: c.score, reverse=True)[:10]
    total_forecast = sum(
        (c.incidentCountForecast or 0) for c in cells
    )
    return ForecastStats(
        predictedNext24h=int(round(total_forecast * 96)),
        highestRiskPrecinct=_highest_risk_precinct(),
        modelVersion=STATE.model_version,
        generatedAt=datetime.now(tz=timezone.utc).isoformat(),
        hottestHexes=hottest,
    )
