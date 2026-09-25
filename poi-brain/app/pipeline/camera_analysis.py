"""On-demand Operations analysis; isolated from the legacy camera poller."""
from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone

import httpx

from ..schemas import Camera, FrameEvent
from ..state import STATE, FrameMemory
from collections import defaultdict
from .operations_vision import describe_frame, assess_traffic

_analysis_lock = asyncio.Lock()
OPERATIONS_MEMORY: dict[str, FrameMemory] = defaultdict(FrameMemory)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def camera_status(cam: Camera) -> Camera:
    memory = OPERATIONS_MEMORY.get(cam.id)
    if not memory:
        return cam
    status = memory.analysis_status
    if status == 'fresh' and memory.last_analyzed_at:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(memory.last_analyzed_at)).total_seconds()
        if age > 120:
            status = 'stale'
    return cam.model_copy(update={
        "online": memory.analysis_status != "offline",
        'lastSnapshotAt': memory.last_snapshot_at,
        'lastAnalyzedAt': memory.last_analyzed_at,
        'lastAttemptAt': memory.last_attempt_at,
        'analysisStatus': status,
        'analysisError': memory.analysis_error,
    })


async def analyze_camera_frame(camera_id: str, notes: str = '', purpose: str = 'scene', include_snapshot: bool = False) -> dict:
    cam = STATE.cameras.get(camera_id)
    if not cam:
        raise ValueError('Camera not found')
    async with _analysis_lock:
        memory = OPERATIONS_MEMORY[camera_id]
        memory.last_attempt_at = now_iso()
        memory.analysis_status = 'analyzing'
        memory.analysis_error = None
        try:
            if not cam.snapshotUrl:
                raise ValueError('Camera has no snapshot URL')
            async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
                response = await client.get(cam.snapshotUrl)
                response.raise_for_status()
                if not response.headers.get('content-type', '').startswith('image/'):
                    raise ValueError('Camera returned no image')
                jpeg = base64.b64encode(response.content).decode()
            memory.last_snapshot_at = now_iso()
            memory.latest_thumb_b64 = jpeg
        except asyncio.CancelledError:
            memory.analysis_status = 'failed'
            memory.analysis_error = 'Snapshot request was stopped before completion.'
            raise
        except Exception:
            memory.analysis_status = 'offline'
            memory.analysis_error = 'Snapshot unavailable; no new analysis was performed.'
            raise ValueError(memory.analysis_error)
        try:
            # Historical risk must not bias descriptions of the visible frame.
            assessment = None
            if purpose == 'traffic':
                assessment, raw = await assess_traffic(jpeg)
                events = [FrameEvent(timestamp='00:00', description=assessment['evidence'], isDangerous=False)]
            else:
                events, raw = await describe_frame(jpeg, notes)
            if not events:
                raise ValueError('Model returned no usable observations')
            memory.latest_events = [e.model_dump() for e in events]
            memory.last_analyzed_at = now_iso()
            memory.analysis_status = 'fresh'
            memory.last_updated = datetime.now(timezone.utc).timestamp()
        except asyncio.CancelledError:
            memory.analysis_status = 'failed'
            memory.analysis_error = 'Analysis was stopped before completion.'
            raise
        except Exception:
            memory.analysis_status = 'failed'
            memory.analysis_error = 'Vision analysis failed; any previous observations are stale.'
            raise ValueError(memory.analysis_error)
        result = {
            'cameraId': cam.id, 'cameraName': cam.name, 'events': memory.latest_events,
            'analyzedAt': memory.last_analyzed_at, 'snapshotAt': memory.last_snapshot_at,
            'source': cam.snapshotUrl, 'rawResponse': raw,
        }
        if assessment is not None:
            result['trafficAssessment'] = assessment
        if include_snapshot and any(event.isDangerous for event in events):
            # Internal only: monitoring removes this field before publishing JSON.
            # Capture here, under the analysis lock, never from a later live frame.
            result['_snapshot'] = (response.content, response.headers['content-type'].split(';')[0])
        return result
