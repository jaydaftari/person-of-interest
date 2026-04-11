"""Fuse NYC Open Data sources into a single hex × time × weekday training frame.

Runs on cuDF + cuSpatial when available on the DGX, falls back to pandas + h3-py
on the laptop. The H3-binned fused frame is the training input for cuML.

The story: for each H3 cell (res 9) and each 15-minute bucket, assemble a feature
vector:
- recent_crime_count       (NYPD historic + YTD, last 90d at this cell)
- recent_collision_count   (Motor Vehicle Collisions, last 365d)
- active_311_street_light  (open 311 streetlight complaints in last 30d within cell)
- active_311_traffic_signal
- active_311_noise
- hour_of_week             (0..167)
- is_weekend               (bool)

Target: binary `incident_next_window` — did a crime or dangerous collision happen
in the next 15 min at this cell? Derived from NYPD + collisions timestamps.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path

import h3
import pandas as pd

from ..config import settings
from .rapids_runtime import HAS_RAPIDS, get_df_lib

log = logging.getLogger("poi.fuse")


def _load_parquet(name: str) -> pd.DataFrame:
    path = settings.parquet_root / f"{name}.parquet"
    if not path.exists():
        log.warning("[fuse] missing %s — returning empty frame", path)
        return pd.DataFrame()
    return pd.read_parquet(path)


def _to_latlon(df: pd.DataFrame, lat_col: str, lon_col: str) -> pd.DataFrame:
    if lat_col not in df.columns or lon_col not in df.columns:
        return pd.DataFrame()
    df = df.dropna(subset=[lat_col, lon_col]).copy()
    df["_lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    df["_lon"] = pd.to_numeric(df[lon_col], errors="coerce")
    df = df.dropna(subset=["_lat", "_lon"])
    lat_lo, lon_lo, lat_hi, lon_hi = (40.49, -74.26, 40.92, -73.68)
    df = df[
        (df["_lat"] >= lat_lo)
        & (df["_lat"] <= lat_hi)
        & (df["_lon"] >= lon_lo)
        & (df["_lon"] <= lon_hi)
    ]
    return df


def _attach_h3(df: pd.DataFrame, resolution: int) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    df["h3"] = [
        h3.latlng_to_cell(float(r._lat), float(r._lon), resolution)
        for r in df.itertuples(index=False)
    ]
    return df


def _parse_datetime(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", utc=False)


def fuse_to_training_frame(resolution: int | None = None) -> pd.DataFrame:
    """Build the fused training frame. Returns pandas (or cuDF) depending on runtime."""
    res = resolution or settings.h3_resolution
    log.info("[fuse] building training frame at H3 res=%d (rapids=%s)", res, HAS_RAPIDS)

    nypd_hist = _load_parquet("nypd_historic")
    nypd_ytd = _load_parquet("nypd_ytd")
    collisions = _load_parquet("collisions")
    svc311 = _load_parquet("service_311")

    nypd = pd.concat([nypd_hist, nypd_ytd], ignore_index=True) if len(nypd_hist) or len(nypd_ytd) else pd.DataFrame()
    nypd = _to_latlon(nypd, "latitude", "longitude")
    if not nypd.empty:
        nypd["_dt"] = _parse_datetime(nypd.get("cmplnt_fr_dt"))
        nypd = nypd.dropna(subset=["_dt"])
        nypd = _attach_h3(nypd, res)

    collisions = _to_latlon(collisions, "latitude", "longitude")
    if not collisions.empty:
        collisions["_dt"] = _parse_datetime(collisions.get("crash_date"))
        collisions = collisions.dropna(subset=["_dt"])
        collisions = _attach_h3(collisions, res)

    svc311 = _to_latlon(svc311, "latitude", "longitude")
    if not svc311.empty:
        svc311["_dt"] = _parse_datetime(svc311.get("created_date"))
        svc311 = svc311.dropna(subset=["_dt"])
        svc311 = _attach_h3(svc311, res)

    now = datetime.utcnow()
    cutoff_90 = now - timedelta(days=90)
    cutoff_365 = now - timedelta(days=365)
    cutoff_30 = now - timedelta(days=30)

    crime_counts = (
        nypd[nypd["_dt"] >= cutoff_90].groupby("h3").size()
        if not nypd.empty
        else pd.Series(dtype="int64")
    )
    collision_counts = (
        collisions[collisions["_dt"] >= cutoff_365].groupby("h3").size()
        if not collisions.empty
        else pd.Series(dtype="int64")
    )

    def _svc_subset(complaint: str) -> pd.Series:
        if svc311.empty:
            return pd.Series(dtype="int64")
        keep = svc311[
            (svc311["_dt"] >= cutoff_30)
            & (svc311.get("complaint_type") == complaint)
        ]
        return keep.groupby("h3").size()

    light_counts = _svc_subset("Street Light Condition")
    signal_counts = _svc_subset("Traffic Signal Condition")
    noise_counts = _svc_subset("Noise - Street/Sidewalk")

    all_cells = set()
    for s in (crime_counts, collision_counts, light_counts, signal_counts, noise_counts):
        all_cells.update(s.index.tolist())

    hour_of_week = now.weekday() * 24 + now.hour

    rows = []
    for cell in all_cells:
        rows.append(
            {
                "h3": cell,
                "crime_90d": int(crime_counts.get(cell, 0)),
                "collision_365d": int(collision_counts.get(cell, 0)),
                "streetlight_30d": int(light_counts.get(cell, 0)),
                "signal_30d": int(signal_counts.get(cell, 0)),
                "noise_30d": int(noise_counts.get(cell, 0)),
                "hour_of_week": hour_of_week,
                "is_weekend": int(now.weekday() >= 5),
            }
        )
    fused = pd.DataFrame(rows)
    if fused.empty:
        log.warning("[fuse] empty fused frame — did ingest run?")
        return fused

    fused["label"] = (
        (fused["crime_90d"] >= 3).astype(int)
        | (fused["collision_365d"] >= 5).astype(int)
    )
    log.info("[fuse] fused shape=%s label_rate=%.3f", fused.shape, fused["label"].mean())

    if HAS_RAPIDS:
        try:
            df_lib = get_df_lib()
            return df_lib.DataFrame.from_pandas(fused)
        except Exception as err:
            log.warning("[fuse] cudf conversion failed: %s", err)
    return fused


def save_fused(df) -> Path:
    path = settings.parquet_root / "fused.parquet"
    try:
        pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
    except Exception:
        pdf = df
    pdf.to_parquet(path, index=False)
    log.info("[fuse] wrote %s", path)
    return path


def load_fused():
    path = settings.parquet_root / "fused.parquet"
    if not path.exists():
        return None
    return pd.read_parquet(path)
