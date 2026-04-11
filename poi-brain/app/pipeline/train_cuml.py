"""Train an XGBoost risk classifier on the fused frame.

Runs cuML's XGBoost on GPU when available, falls back to sklearn
GradientBoostingClassifier on CPU so local dev works.
"""
from __future__ import annotations

import logging
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..config import settings
from .fuse_cudf import fuse_to_training_frame
from .rapids_runtime import HAS_RAPIDS

log = logging.getLogger("poi.train")

FEATURE_COLS = [
    "crime_90d",
    "collision_365d",
    "streetlight_30d",
    "signal_30d",
    "noise_30d",
    "hour_of_week",
    "is_weekend",
]


def _to_pandas(df) -> pd.DataFrame:
    if hasattr(df, "to_pandas"):
        return df.to_pandas()
    return df


def _train_cuml(X: np.ndarray, y: np.ndarray):
    from cuml.ensemble import RandomForestClassifier  # type: ignore

    clf = RandomForestClassifier(n_estimators=128, max_depth=8, random_state=42)
    clf.fit(X.astype("float32"), y.astype("int32"))
    return clf


def _train_xgb(X: np.ndarray, y: np.ndarray):
    try:
        import xgboost as xgb  # type: ignore
    except Exception:
        return None
    dtrain = xgb.DMatrix(X, label=y)
    params = {
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "tree_method": "hist",
        "device": "cuda" if HAS_RAPIDS else "cpu",
        "max_depth": 6,
        "eta": 0.1,
    }
    return xgb.train(params, dtrain, num_boost_round=120)


def _train_sklearn(X: np.ndarray, y: np.ndarray):
    from sklearn.ensemble import GradientBoostingClassifier

    clf = GradientBoostingClassifier(n_estimators=120, max_depth=4, random_state=42)
    clf.fit(X, y)
    return clf


def train_risk_model() -> dict:
    fused = fuse_to_training_frame()
    if fused is None or len(fused) == 0:
        log.warning("[train] no fused data — skipping training")
        return {"trained": False, "reason": "no data"}

    pdf = _to_pandas(fused)
    missing = [c for c in FEATURE_COLS if c not in pdf.columns]
    if missing:
        log.error("[train] missing feature cols: %s", missing)
        return {"trained": False, "reason": f"missing cols {missing}"}

    X = pdf[FEATURE_COLS].to_numpy(dtype="float32")
    y = pdf["label"].to_numpy(dtype="int32")

    backend = "sklearn"
    model: Any = None

    if HAS_RAPIDS:
        try:
            model = _train_xgb(X, y) or _train_cuml(X, y)
            backend = "cuml-xgb" if model is not None else "sklearn"
        except Exception as err:
            log.warning("[train] rapids/xgb path failed: %s", err)

    if model is None:
        model = _train_sklearn(X, y)
        backend = "sklearn"

    path = settings.models_root / "risk_model.pkl"
    with open(path, "wb") as f:
        pickle.dump({"backend": backend, "model": model, "features": FEATURE_COLS}, f)

    log.info("[train] wrote %s (backend=%s rows=%d)", path, backend, len(pdf))
    return {
        "trained": True,
        "backend": backend,
        "rows": int(len(pdf)),
        "label_rate": float(np.mean(y)),
        "path": str(path),
    }


def load_model() -> dict | None:
    path = settings.models_root / "risk_model.pkl"
    if not path.exists():
        return None
    with open(path, "rb") as f:
        return pickle.load(f)


def score_features(feature_rows: pd.DataFrame) -> np.ndarray:
    bundle = load_model()
    if bundle is None:
        return np.full(len(feature_rows), 0.25, dtype="float32")

    model = bundle["model"]
    features = bundle["features"]
    for c in features:
        if c not in feature_rows.columns:
            feature_rows[c] = 0
    X = feature_rows[features].to_numpy(dtype="float32")

    backend = bundle["backend"]
    try:
        if backend.startswith("cuml-xgb"):
            import xgboost as xgb  # type: ignore

            dmat = xgb.DMatrix(X)
            return model.predict(dmat).astype("float32")
        if backend == "cuml-rf":
            return model.predict_proba(X)[:, 1].astype("float32")
        return model.predict_proba(X)[:, 1].astype("float32")
    except Exception:
        return np.full(len(feature_rows), 0.25, dtype="float32")
