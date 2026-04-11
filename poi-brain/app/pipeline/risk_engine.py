"""Risk scoring engine — turns fused features + trained model into per-camera
and per-hex risk scores, then publishes them to the SSE queue.

Runs on a loop. Every cycle:
1. Reload the fused frame if newer than cached copy.
2. Score every H3 cell in the fused frame.
3. For each camera, look up its H3 cell's score and reasons, build a RiskScore,
   and publish.
4. Populate STATE.hex_cells for the /risk/heatmap endpoint.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import pandas as pd

from ..config import settings
from ..schemas import HexCell, RiskScore
from ..state import STATE, publish_risk
from .fuse_cudf import fuse_to_training_frame
from .train_cuml import score_features

log = logging.getLogger("poi.risk")


def _score_to_tier(score: float) -> str:
    if score >= 0.8:
        return "critical"
    if score >= 0.6:
        return "high"
    if score >= 0.35:
        return "med"
    return "low"


def _reasons_for_row(row) -> List[str]:
    reasons: List[str] = []
    if row.get("crime_90d", 0) >= 3:
        reasons.append(f"{int(row['crime_90d'])} NYPD incidents last 90 days")
    if row.get("collision_365d", 0) >= 5:
        reasons.append(
            f"Vision Zero hotspot ({int(row['collision_365d'])} collisions/yr)"
        )
    if row.get("streetlight_30d", 0) >= 1:
        reasons.append(
            f"{int(row['streetlight_30d'])} 311 streetlight outage(s) within 150m"
        )
    if row.get("signal_30d", 0) >= 1:
        reasons.append("Traffic signal complaint nearby")
    if row.get("noise_30d", 0) >= 3:
        reasons.append("Elevated 311 noise complaints")
    if not reasons:
        reasons.append("baseline neighborhood risk")
    return reasons


def _compute_hex_scores() -> Dict[str, dict]:
    fused = fuse_to_training_frame()
    if fused is None or len(fused) == 0:
        return {}
    pdf = fused.to_pandas() if hasattr(fused, "to_pandas") else fused
    if pdf.empty:
        return {}

    scores = score_features(pdf)
    pdf = pdf.copy()
    pdf["score"] = scores

    out: Dict[str, dict] = {}
    for row in pdf.itertuples(index=False):
        rowdict = row._asdict()
        out[row.h3] = {
            "score": float(row.score),
            "tier": _score_to_tier(float(row.score)),
            "reasons": _reasons_for_row(rowdict),
            "features": {
                "crime_90d": float(row.crime_90d),
                "collision_365d": float(row.collision_365d),
                "streetlight_30d": float(row.streetlight_30d),
                "signal_30d": float(row.signal_30d),
                "noise_30d": float(row.noise_30d),
            },
        }
    return out


def _now_window():
    now = datetime.now(tz=timezone.utc)
    end = now + timedelta(minutes=settings.prediction_window_minutes)
    return now.isoformat(), end.isoformat()


async def recompute_once() -> None:
    hex_scores = await asyncio.to_thread(_compute_hex_scores)
    if not hex_scores:
        log.warning("[risk] no hex scores computed")
        return

    start_iso, end_iso = _now_window()

    STATE.hex_cells = [
        HexCell(
            h3Index=h3_idx,
            score=info["score"],
            tier=info["tier"],
            contributingFactors=info["features"],
            incidentCountForecast=info["features"].get("crime_90d", 0) / 90.0,
        )
        for h3_idx, info in hex_scores.items()
    ]
    log.info("[risk] hex_cells=%d", len(STATE.hex_cells))

    for cam in STATE.cameras.values():
        info = hex_scores.get(cam.h3Cell or "") if cam.h3Cell else None
        if info is None:
            score = 0.2
            tier = "low"
            reasons = ["no feature coverage for this cell"]
        else:
            score = info["score"]
            tier = info["tier"]
            reasons = info["reasons"]

        risk = RiskScore(
            cameraId=cam.id,
            score=round(float(score), 3),
            tier=tier,  # type: ignore[arg-type]
            reasons=reasons,
            windowStart=start_iso,
            windowEnd=end_iso,
            modelVersion=STATE.model_version,
        )
        await publish_risk(risk)


async def run_risk_engine_forever(interval_s: float = 60.0) -> None:
    while True:
        try:
            await recompute_once()
        except Exception as err:
            log.exception("[risk] cycle failed: %s", err)
        await asyncio.sleep(interval_s)
