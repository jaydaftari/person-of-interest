"""Isolated APIs for the experimental Operations workspace."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Literal
from ..state import STATE
from ..pipeline.camera_analysis import camera_status
from ..pipeline.route_planner import patrol_routes
from ..schemas import Camera, PatrolRoute
from ..pipeline.monitoring import MONITOR

router = APIRouter(prefix='/operations', tags=['operations'])


@router.get('/cameras', response_model=list[Camera])
async def cameras():
    return [camera_status(c) for c in STATE.cameras.values()]


@router.get('/routes', response_model=list[PatrolRoute])
async def routes():
    return await patrol_routes()


class MonitoringCommand(BaseModel):
    action: Literal['start', 'stop', 'acknowledge']
    alertId: str | None = Field(default=None, max_length=64)
    cameraIds: list[str] = Field(default_factory=list, max_length=3)
    intervalSeconds: int = Field(default=30, ge=30, le=300)
    label: str = Field(default='', max_length=120)
    sessionId: str | None = None


@router.get('/monitoring')
async def monitoring_status():
    return MONITOR.status()


@router.post('/monitoring')
async def monitoring_command(command: MonitoringCommand):
    try:
        if command.action == 'acknowledge':
            if not command.alertId:
                raise ValueError('Choose an alert to acknowledge.')
            return MONITOR.acknowledge_alert(command.alertId)
        if command.action == 'stop':
            return await MONITOR.stop(command.sessionId)
        return await MONITOR.start(command.cameraIds, command.intervalSeconds, command.label)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get('/alerts/{alert_id}/snapshot')
async def alert_snapshot(alert_id: str):
    snapshot = MONITOR.alert_store.snapshot(alert_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail='Captured alert image not available.')
    return Response(content=snapshot[0], media_type=snapshot[1], headers={
        'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; sandbox",
    })
