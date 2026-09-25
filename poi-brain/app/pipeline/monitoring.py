"""One explicitly started Operations zone, with serial, rate-limited sampling."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from ..config import settings
from ..state import STATE
from .camera_analysis import analyze_camera_frame, now_iso
from .monitoring_alerts import AlertStore


class ZoneMonitor:
    def __init__(self, alert_store: AlertStore | None = None):
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._session: dict | None = None
        self.alert_store = alert_store or AlertStore(settings.data_root / 'operations-alerts.sqlite3')

    def status(self) -> dict:
        try:
            alerts = self.alert_store.list()
            alert_error = None
        except Exception:
            alerts, alert_error = [], 'Alert history is unavailable; monitoring controls remain available.'
        return {
            'monitoring': deepcopy(self._session),
            'alerts': alerts,
            'unacknowledgedAlertCount': sum(a['acknowledgedAt'] is None for a in alerts),
            'alertHistoryError': alert_error,
            'alertRetentionLimit': self.alert_store.limit,
            'limits': {'maxCameras': 3, 'concurrency': 1, 'minIntervalSeconds': 30},
            'legacyBackgroundPolling': settings.camera_background_polling_enabled,
            'interpretation': 'Opt-in snapshot sampling, not continuous video or a crime detector. Historical ranks guide selection, not live conclusions.',
        }

    def acknowledge_alert(self, alert_id: str) -> dict:
        self.alert_store.acknowledge(alert_id)
        return {**self.status(), 'acknowledgedAlertId': alert_id}

    async def start(self, camera_ids: list[str], interval_seconds: int = 30, label: str = '') -> dict:
        if not 1 <= len(camera_ids) <= 3 or len(set(camera_ids)) != len(camera_ids):
            raise ValueError('Select 1–3 distinct cameras for one monitoring zone.')
        if not 30 <= interval_seconds <= 300:
            raise ValueError('The pause between camera analyses must be 30–300 seconds.')
        if any(i not in STATE.cameras or not STATE.cameras[i].snapshotUrl for i in camera_ids):
            raise ValueError('Unknown camera or missing snapshot URL; find cameras first.')
        async with self._lock:
            if self._task and not self._task.done():
                if self._session['cameraIds'] == camera_ids and self._session['intervalSeconds'] == interval_seconds:
                    return self.status()
                raise ValueError('A zone is already monitored. Stop it before starting a different selection.')
            self._session = {
                'id': str(uuid4()), 'label': label.strip()[:120] or 'Selected camera zone',
                'status': 'running', 'phase': 'queued', 'cameraIds': list(camera_ids),
                'cameras': [{'id': i, 'name': STATE.cameras[i].name} for i in camera_ids],
                'intervalSeconds': interval_seconds, 'startedAt': now_iso(), 'stoppedAt': None,
                'currentCameraId': None, 'nextAnalysisAt': None, 'completed': 0, 'failed': 0,
                'observations': [],
            }
            self._task = asyncio.create_task(self._run(self._session), name='operations-zone-monitor')
            return self.status()

    async def stop(self, session_id: str | None = None) -> dict:
        async with self._lock:
            if session_id and (not self._session or self._session['id'] != session_id):
                raise ValueError('Monitoring session changed. Refresh its status before stopping.')
            if self._task and not self._task.done():
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            if self._session:
                self._session.update(status='stopped', phase='idle', currentCameraId=None, nextAnalysisAt=None)
                self._session['stoppedAt'] = self._session['stoppedAt'] or now_iso()
            self._task = None
            return self.status()

    async def _run(self, session: dict):
        index = 0
        try:
            while True:
                camera_id = session['cameraIds'][index % len(session['cameraIds'])]
                session.update(phase='analyzing', currentCameraId=camera_id, nextAnalysisAt=None)
                try:
                    result = await analyze_camera_frame(camera_id, include_snapshot=True)
                    result.pop('rawResponse', None)
                    snapshot = result.pop('_snapshot', None)
                    hazardous = any(e.get('isDangerous') is True for e in result.get('events', []))
                    session['completed'] += 1
                    record = {**result, 'status': 'complete', 'outcome':'potential_hazard' if hazardous else 'no_hazard_flagged'}
                    if hazardous:
                        try:
                            alert = self.alert_store.create(result, session['id'], snapshot)
                            record['alertId'] = alert['id']
                        except Exception:
                            record['alertError'] = 'Potential hazard flagged, but its alert could not be saved. Review this observation now.'
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    session['failed'] += 1
                    record = {'cameraId': camera_id, 'cameraName': STATE.cameras[camera_id].name,
                              'status': 'failed', 'outcome':'analysis_failed', 'error': str(error)[:250], 'attemptedAt': now_iso()}
                session['observations'] = [record, *session['observations']][:24]
                session.update(phase='waiting', currentCameraId=None,
                    nextAnalysisAt=(datetime.now(timezone.utc) + timedelta(seconds=session['intervalSeconds'])).isoformat())
                # Pause AFTER each completed/failed analysis, not after a whole zone.
                await asyncio.sleep(session['intervalSeconds'])
                index += 1
        finally:
            session.update(status='stopped', phase='idle', currentCameraId=None, nextAnalysisAt=None, stoppedAt=now_iso())


MONITOR = ZoneMonitor()
