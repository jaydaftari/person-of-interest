"""Load the NYC DOT traffic camera catalog and tag each camera with an H3 cell.

NYC publishes a traffic camera list on NYC Open Data (resource 9knp-kupa).
Each row gives us camera id, name, lat/lng, borough, and a snapshot image
URL served from webcams.nyctmc.org. We load it at startup, filter to
Manhattan (+ optional manual subset), tag each with H3 res 9, and expose
the resulting list via /cameras.
"""
from __future__ import annotations

import logging
from typing import List

import h3
import pandas as pd

from ..config import settings
from ..schemas import Camera

log = logging.getLogger("poi.camera_catalog")

DEFAULT_MANHATTAN_SEEDS: List[dict] = [
    {
        "id": "nyc-times-sq",
        "name": "Times Sq @ 7 Ave",
        "borough": "Manhattan",
        "latLng": (40.7580, -73.9855),
        "address": "7 Ave & W 42 St, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/d4b2e2a6-56ec-4f20-a38f-e9d50a5cb8b0/image",
    },
    {
        "id": "nyc-union-sq",
        "name": "Union Sq @ 14 St",
        "borough": "Manhattan",
        "latLng": (40.7350, -73.9905),
        "address": "14 St & Broadway, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/union-sq/image",
    },
    {
        "id": "nyc-canal-broadway",
        "name": "Canal St @ Broadway",
        "borough": "Manhattan",
        "latLng": (40.7192, -74.0007),
        "address": "Canal St & Broadway, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/canal-broadway/image",
    },
    {
        "id": "nyc-fdr-34",
        "name": "FDR Dr @ 34 St",
        "borough": "Manhattan",
        "latLng": (40.7465, -73.9733),
        "address": "FDR Drive @ 34 St, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/fdr-34/image",
    },
    {
        "id": "nyc-columbus-circle",
        "name": "Columbus Circle",
        "borough": "Manhattan",
        "latLng": (40.7681, -73.9819),
        "address": "Columbus Circle, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/columbus-circle/image",
    },
    {
        "id": "nyc-14-3av",
        "name": "E 14 St @ 3 Ave",
        "borough": "Manhattan",
        "latLng": (40.7332, -73.9857),
        "address": "E 14 St & 3 Ave, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/14-3av/image",
    },
    {
        "id": "nyc-houston-lafayette",
        "name": "Houston @ Lafayette",
        "borough": "Manhattan",
        "latLng": (40.7249, -73.9944),
        "address": "Houston St & Lafayette St, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/houston-lafayette/image",
    },
    {
        "id": "nyc-34-8av",
        "name": "W 34 St @ 8 Ave",
        "borough": "Manhattan",
        "latLng": (40.7527, -73.9925),
        "address": "W 34 St & 8 Ave, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/34-8av/image",
    },
    {
        "id": "nyc-delancey-bowery",
        "name": "Delancey @ Bowery",
        "borough": "Manhattan",
        "latLng": (40.7207, -73.9934),
        "address": "Delancey St & Bowery, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/delancey-bowery/image",
    },
    {
        "id": "nyc-23-park",
        "name": "E 23 St @ Park Ave",
        "borough": "Manhattan",
        "latLng": (40.7399, -73.9859),
        "address": "E 23 St & Park Ave S, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/23-park/image",
    },
    {
        "id": "nyc-ws-west4",
        "name": "Washington Sq / W 4 St",
        "borough": "Manhattan",
        "latLng": (40.7308, -73.9973),
        "address": "Washington Sq N & W 4 St, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/ws-w4/image",
    },
    {
        "id": "nyc-brooklyn-bridge",
        "name": "Brooklyn Bridge Approach",
        "borough": "Manhattan",
        "latLng": (40.7061, -74.0039),
        "address": "Park Row & Brooklyn Bridge, New York, NY",
        "snapshotUrl": "https://webcams.nyctmc.org/api/cameras/bk-bridge/image",
    },
]


def _load_from_parquet() -> List[Camera]:
    path = settings.parquet_root / "dot_cameras.parquet"
    if not path.exists():
        return []
    df = pd.read_parquet(path)
    if df.empty:
        return []

    lat_col = next((c for c in df.columns if c.lower() in ("latitude", "lat")), None)
    lon_col = next((c for c in df.columns if c.lower() in ("longitude", "lon", "lng")), None)
    name_col = next((c for c in df.columns if c.lower() in ("name", "cameraname", "intersection")), None)
    url_col = next((c for c in df.columns if "url" in c.lower() and "image" in c.lower()), None)
    borough_col = next((c for c in df.columns if c.lower() in ("borough", "boro")), None)
    id_col = next((c for c in df.columns if c.lower() in ("id", "cameraid", "camera_id")), None)

    if not lat_col or not lon_col:
        log.warning("[catalog] dot_cameras parquet has no lat/lng columns")
        return []

    cameras: List[Camera] = []
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
        except (TypeError, ValueError):
            continue
        name = str(row.get(name_col, "Camera")) if name_col else "Camera"
        cam_id = str(row.get(id_col, name.lower().replace(" ", "-"))) if id_col else name.lower().replace(" ", "-")
        borough = str(row.get(borough_col, "Manhattan")) if borough_col else "Manhattan"
        snapshot = str(row.get(url_col)) if url_col else ""
        try:
            h3_cell = h3.latlng_to_cell(lat, lon, settings.h3_resolution)
        except Exception:
            h3_cell = None
        cameras.append(
            Camera(
                id=cam_id,
                name=name[:80],
                location=borough,
                address=name,
                thumbnail="",
                snapshotUrl=snapshot,
                latLng=(lat, lon),
                borough=borough,
                h3Cell=h3_cell,
                modelCoverage="full",
            )
        )
    return cameras


def load_camera_catalog() -> List[Camera]:
    """Try parquet first, fall back to the hardcoded Manhattan seed list."""
    cams = _load_from_parquet()
    if cams:
        log.info("[catalog] loaded %d cameras from parquet", len(cams))
        src = cams
    else:
        log.info("[catalog] using hardcoded Manhattan seed list")
        src = [
            Camera(
                id=c["id"],
                name=c["name"],
                location=c["borough"],
                address=c["address"],
                thumbnail="",
                snapshotUrl=c["snapshotUrl"],
                latLng=c["latLng"],
                borough=c["borough"],
                modelCoverage="full",
                h3Cell=h3.latlng_to_cell(
                    c["latLng"][0], c["latLng"][1], settings.h3_resolution
                ),
            )
            for c in DEFAULT_MANHATTAN_SEEDS
        ]

    if settings.camera_manual_subset:
        manual = set(settings.camera_manual_subset)
        src = [c for c in src if c.id in manual]

    if len(src) > settings.camera_subset_size:
        src = src[: settings.camera_subset_size]

    return src
