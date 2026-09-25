import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.schemas import Camera, FrameEvent, PatrolRoute, PatrolWaypoint, PatrolRouteSolverMeta
from app.state import STATE, FrameMemory
from app.pipeline.camera_analysis import camera_status, OPERATIONS_MEMORY, analyze_camera_frame
from app.pipeline import camera_analysis
from app.pipeline import route_planner
from app.mcp_server import find_cameras, get_camera_risk


def route():
    return PatrolRoute(unitId='test', totalRiskCovered=0,
        solverMetadata=PatrolRouteSolverMeta(solveMs=0, objective=0, solverBackend='greedy'),
        waypoints=[PatrolWaypoint(latLng=(40.75+i*.001,-73.98), etaSeconds=0, riskScore=.5) for i in range(3)])


def directions(points=3, seconds=100):
    return {'duration': seconds*(points-1), 'distance': 1200, 'legs':[{'duration':seconds} for _ in range(points-1)],
        'geometry':{'coordinates':[[-73.98,40.75],[-73.981,40.751],[-73.98,40.752]]}}


class OperationsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cameras = STATE.cameras
        STATE.cameras = {'a':Camera(id='a',name='Central Park West',location='NYC',address='86 St',latLng=(40.78,-73.97))}
        OPERATIONS_MEMORY.clear()

    def tearDown(self):
        STATE.cameras = self.cameras
        OPERATIONS_MEMORY.clear()

    async def test_road_geometry_and_leg_times(self):
        with patch.object(route_planner,'road_route',AsyncMock(return_value=directions())):
            result=await route_planner.enrich_route(route())
        self.assertEqual(result.status,'ready')
        self.assertEqual(result.geometry[1],[-73.981,40.751])
        self.assertEqual([w.etaSeconds for w in result.waypoints],[0,100,200])
        self.assertFalse(result.liveTraffic)

    async def test_failed_routing_has_no_fake_geometry_or_eta(self):
        with patch.object(route_planner,'road_route',AsyncMock(side_effect=ValueError('unreachable'))):
            result=await route_planner.enrich_route(route())
        self.assertEqual(result.status,'unavailable')
        self.assertEqual(result.geometry,[])
        self.assertIsNone(result.durationSeconds)
        self.assertTrue(all(w.etaSeconds is None for w in result.waypoints))

    async def test_budget_uses_road_time_and_prunes_stops(self):
        mock=AsyncMock(side_effect=[directions(seconds=1000),directions(points=2,seconds=1000)])
        with patch.object(route_planner,'road_route',mock):
            result=await route_planner.enrich_route(route(),1800)
        self.assertEqual(len(result.waypoints),2)
        self.assertEqual(result.durationSeconds,1000)
        self.assertEqual(len(mock.call_args_list[1].args[0]),2)

    async def test_search_and_unknown_camera(self):
        data=await find_cameras('Central Park')
        self.assertEqual(data['cameras'][0]['id'],'a')
        with self.assertRaises(ValueError): get_camera_risk('invented')
        with self.assertRaises(ValueError): await route_planner.plan_camera_route(['a','invented'])

    async def test_analysis_failure_does_not_refresh_previous_observations(self):
        STATE.cameras['a'].snapshotUrl = 'https://example.test/camera.jpg'
        previous = (datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()
        OPERATIONS_MEMORY['a'] = FrameMemory(last_analyzed_at=previous, analysis_status='fresh', latest_events=[{'description':'Previous scene'}])
        response = MagicMock()
        response.headers = {'content-type':'image/jpeg'}
        response.content = b'fixture-image'
        client = AsyncMock()
        client.get.return_value = response
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        with patch.object(camera_analysis.httpx, 'AsyncClient', return_value=manager), patch.object(camera_analysis, 'describe_frame', AsyncMock(side_effect=ValueError('invalid JSON'))):
            with self.assertRaisesRegex(ValueError, 'Vision analysis failed'):
                await analyze_camera_frame('a')
        status = camera_status(STATE.cameras['a'])
        self.assertEqual(status.analysisStatus, 'failed')
        self.assertEqual(status.lastAnalyzedAt, previous)
        self.assertIsNotNone(status.lastSnapshotAt)
        self.assertEqual(OPERATIONS_MEMORY['a'].latest_events[0]['description'], 'Previous scene')

    async def test_snapshot_failure_does_not_call_model(self):
        model = AsyncMock()
        with patch.object(camera_analysis, 'describe_frame', model):
            with self.assertRaisesRegex(ValueError, 'Snapshot unavailable'):
                await analyze_camera_frame('a')
        model.assert_not_called()
        self.assertEqual(camera_status(STATE.cameras['a']).analysisStatus, 'offline')
        self.assertIsNone(camera_status(STATE.cameras['a']).lastAnalyzedAt)

    async def test_monitor_can_capture_exact_flagged_frame_without_exposing_it_by_default(self):
        STATE.cameras['a'].snapshotUrl = 'https://example.test/camera.jpg'
        response = MagicMock()
        response.headers = {'content-type':'image/jpeg; charset=binary'}
        response.content = b'exact-source-image'
        client, manager = AsyncMock(), AsyncMock()
        client.get.return_value = response
        manager.__aenter__.return_value = client
        model = AsyncMock(return_value=([FrameEvent(timestamp='00:00',description='Test hazard',isDangerous=True)],'raw'))
        with patch.object(camera_analysis.httpx,'AsyncClient',return_value=manager), patch.object(camera_analysis,'describe_frame',model):
            captured = await analyze_camera_frame('a', include_snapshot=True)
            ordinary = await analyze_camera_frame('a')
        self.assertEqual(captured['_snapshot'], (b'exact-source-image','image/jpeg'))
        self.assertNotIn('_snapshot',ordinary)

    def test_freshness_is_independent_from_legacy_state(self):
        cam=STATE.cameras['a']
        self.assertEqual(camera_status(cam).analysisStatus,'never')
        OPERATIONS_MEMORY['a']=FrameMemory(analysis_status='fresh',last_analyzed_at=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat())
        self.assertEqual(camera_status(cam).analysisStatus,'stale')
        OPERATIONS_MEMORY['a'].analysis_status='failed'
        self.assertEqual(camera_status(cam).analysisStatus,'failed')
        self.assertEqual(cam.analysisStatus,'never')


if __name__=='__main__': unittest.main()
