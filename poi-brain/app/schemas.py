"""Pydantic schemas mirroring types/index.ts on the Next.js side."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

RiskTier = Literal["low", "med", "high", "critical"]
ModelCoverage = Literal["full", "partial", "none"]


class Camera(BaseModel):
    id: str
    name: str
    location: str
    address: str
    thumbnail: str = ""
    snapshotUrl: Optional[str] = None
    latLng: Optional[Tuple[float, float]] = None
    precinctId: Optional[str] = None
    h3Cell: Optional[str] = None
    borough: Optional[str] = None
    modelCoverage: ModelCoverage = "full"
    online: bool = True
    lastSnapshotAt: Optional[str] = None
    lastAnalyzedAt: Optional[str] = None
    lastAttemptAt: Optional[str] = None
    analysisStatus: Literal["never", "analyzing", "fresh", "stale", "failed", "offline"] = "never"
    analysisError: Optional[str] = None


class RiskScore(BaseModel):
    cameraId: str
    score: float = Field(ge=0.0, le=1.0)
    tier: RiskTier
    reasons: List[str] = []
    windowStart: str
    windowEnd: str
    modelVersion: str


class CategoryScore(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    tier: RiskTier
    count: int


class HexCell(BaseModel):
    h3Index: str
    score: float = Field(ge=0.0, le=1.0)
    tier: RiskTier
    contributingFactors: Dict[str, float] = {}
    incidentCountForecast: Optional[float] = None
    categories: Dict[str, CategoryScore] = {}


class Heatmap(BaseModel):
    resolution: int
    cells: List[HexCell]
    generatedAt: str
    windowStart: str
    windowEnd: str


class Precinct(BaseModel):
    id: str
    name: str
    centroidLatLng: Tuple[float, float]
    riskScore: Optional[float] = None
    tier: Optional[RiskTier] = None


class PredictionWindow(BaseModel):
    windowStart: str
    windowEnd: str
    granularityMinutes: int
    incidentCountForecast: float
    confidenceInterval: Tuple[float, float]


class ForecastStats(BaseModel):
    predictedNext24h: int
    highestRiskPrecinct: Optional[Precinct] = None
    modelVersion: str
    generatedAt: str
    hottestHexes: List[HexCell]


class PatrolWaypoint(BaseModel):
    latLng: Tuple[float, float]
    etaSeconds: Optional[float]
    name: Optional[str] = None
    h3Cell: Optional[str] = None
    riskScore: Optional[float] = None
    reasons: List[str] = []
    cameraId: Optional[str] = None


class PatrolRouteSolverMeta(BaseModel):
    solveMs: float
    objective: float
    solverBackend: Literal["cuopt", "greedy", "selected-order"]


class PatrolRoute(BaseModel):
    unitId: str
    waypoints: List[PatrolWaypoint]
    totalRiskCovered: float
    solverMetadata: PatrolRouteSolverMeta
    geometry: List[List[float]] = []  # GeoJSON longitude, latitude
    distanceMeters: Optional[float] = None
    durationSeconds: Optional[float] = None
    status: Literal["ready", "unavailable", "pending"] = "pending"
    error: Optional[str] = None
    generatedAt: Optional[str] = None
    routingSource: str = "OSRM · OpenStreetMap"
    liveTraffic: bool = False


class RetrievedIncident(BaseModel):
    incidentId: str
    summary: str
    distanceM: float
    daysAgo: int
    category: Optional[str] = None


class FrameAnalyzeRequest(BaseModel):
    cameraId: Optional[str] = None
    frameJpegB64: str
    transcript: str = ""


class FrameEvent(BaseModel):
    timestamp: str
    description: str
    isDangerous: bool


class FrameAnalyzeResponse(BaseModel):
    events: List[FrameEvent]
    riskScoreAtTime: Optional[float] = None
    retrievedContext: List[RetrievedIncident] = []
    rawResponse: str = ""
