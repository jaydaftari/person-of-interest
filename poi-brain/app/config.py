"""Runtime configuration loaded from env."""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "info"
    cors_allow_origins: List[str] = ["*"]

    # NIM (primary VLM)
    nim_base_url: str = "http://localhost:8000/v1"
    nim_model: str = "meta/llama-3.2-11b-vision-instruct"
    nim_api_key: str = "nim"
    nim_warmup_on_startup: bool = True

    # LM Studio fallback
    lmstudio_base_url: str = "http://localhost:1234/v1"
    lmstudio_model: str = "google/gemma-4-26b-a4b"
    vlm_backend: str = "nim"

    # NYC Open Data (SODA)
    soda_app_token: Optional[str] = None
    soda_timeout_s: float = 60.0

    # Dataset resource IDs — hard-pinned to avoid confusion.
    nypd_historic_resource: str = "qgea-i56i"
    nypd_ytd_resource: str = "5uac-w243"
    collisions_resource: str = "h9gi-nx95"
    service_req_311_resource: str = "erm2-nwe9"
    nyc_dot_cameras_resource: str = "9knp-kupa"

    # Storage
    data_root: Path = Path("/data/poi")
    parquet_root: Path = Path("/data/poi/parquet")
    models_root: Path = Path("/data/poi/models")
    cache_root: Path = Path("/data/poi/cache")

    # Camera ingestion
    webcams_base: str = "https://webcams.nyctmc.org"
    camera_poll_interval_s: float = 3.0
    camera_subset_size: int = 12
    camera_manual_subset: List[str] = []

    # Risk model
    h3_resolution: int = 9
    prediction_window_minutes: int = 15
    nyc_bbox: List[float] = [-74.26, 40.49, -73.68, 40.92]
    model_version: str = "cuml-xgb-v0"

    # RAPIDS
    enable_rapids: bool = True
    enable_cuspatial: bool = True
    enable_cugraph: bool = False
    enable_cuopt: bool = False

    # Retrieval
    retrieval_backend: str = "faiss"
    retrieval_top_k: int = 5
    retrieval_radius_m: float = 500.0
    retrieval_max_days_ago: int = 30


settings = Settings()

for p in (
    settings.data_root,
    settings.parquet_root,
    settings.models_root,
    settings.cache_root,
):
    p.mkdir(parents=True, exist_ok=True)
