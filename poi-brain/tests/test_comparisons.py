import unittest
from unittest.mock import AsyncMock, patch

from app.pipeline import route_planner, traffic_comparison
from app.schemas import Camera, HexCell, PatrolRoute, PatrolWaypoint, PatrolRouteSolverMeta
from app.state import STATE


class ComparisonTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.old_cells, self.old_cameras = STATE.hex_cells, STATE.cameras
        STATE.cameras = {key: Camera(id=key, name=name, location='NYC', address='NYC', borough='Manhattan') for key,name in [('a','7 AVE @ 44 St'),('b','Canal Street @ Chrystie Street')]}

    def tearDown(self):
        STATE.hex_cells, STATE.cameras = self.old_cells, self.old_cameras

    def test_traffic_ties_and_unreadable_images(self):
        rows = [{'cameraId':key,'trafficAssessment':{'roadOccupancy':level,'confidence':confidence}}
                for key,level,confidence in [('a','dense','high'),('b','moderate','high'),('c','dense','low')]]
        self.assertEqual(traffic_comparison.comparison_conclusion(rows)['cameraIds'], ['a'])
        rows[1]['trafficAssessment']['roadOccupancy'] = 'dense'
        self.assertEqual(traffic_comparison.comparison_conclusion(rows)['status'], 'tie')
        rows[1]['trafficAssessment']['roadOccupancy'] = 'unreadable'
        self.assertEqual(traffic_comparison.comparison_conclusion(rows)['status'], 'insufficient_evidence')

    async def test_actual_volume_data_is_dated_and_not_collision_data(self):
        mock = AsyncMock(return_value=[{'street':'7 AVENUE','yr':'2022','samples':'100','mean_volume':'75.4','peak_volume':'123'}])
        with patch.object(traffic_comparison, 'cached_get', mock):
            data = await traffic_comparison.historical_traffic('a')
        self.assertEqual(data['year'], 2022)
        self.assertEqual(data['meanVehiclesPer15Minutes'], 75.4)
        self.assertIn("'7 AVENUE'", mock.call_args.args[2]['$where'])
        self.assertIn('Not necessarily this camera intersection', data['scope'])

    async def test_comparison_preserves_visual_success_when_counts_unavailable(self):
        sample = {'trafficAssessment':{'roadOccupancy':'moderate','confidence':'high','evidence':'Several visible vehicles'},'rawResponse':'hidden'}
        with patch.object(traffic_comparison,'analyze_camera_frame',AsyncMock(side_effect=[dict(sample),dict(sample)])), patch.object(traffic_comparison,'historical_traffic',AsyncMock(side_effect=ValueError('offline'))):
            result = await traffic_comparison.compare_traffic(['a','b'])
        self.assertEqual(result['comparison']['conclusion']['status'], 'tie')
        self.assertTrue(all(r['historicalTraffic']['status']=='unavailable' and 'rawResponse' not in r for r in result['comparison']['results']))

    async def test_route_comparison_uses_peak_stop_count_not_sum_and_preserves_ties(self):
        STATE.hex_cells = [HexCell(h3Index=key,resolution=9,center=(40.7,-73.9),score=.5,tier='med',contributingFactors={'collision_365d':count}) for key,count in [('x',40),('y',30),('z',40)]]
        def route(name, cells, duration):
            return PatrolRoute(unitId=name, status='ready', durationSeconds=duration, distanceMeters=1000,
                totalRiskCovered=0, solverMetadata=PatrolRouteSolverMeta(solveMs=0,objective=0,solverBackend='greedy'),
                waypoints=[PatrolWaypoint(latLng=(40.7,-73.9),etaSeconds=0), *[PatrolWaypoint(latLng=(40.7,-73.9),h3Cell=c,etaSeconds=0) for c in cells]])
        routes = [route('unit-01',['x','y'],100),route('unit-02',['z'],50)]
        with patch.object(route_planner,'patrol_routes',AsyncMock(return_value=routes)):
            result = await route_planner.compare_suggested_routes()
            self.assertEqual(result['routeComparison']['rankedRoutes'][0]['value'],40)
            self.assertEqual(result['routeComparison']['tiedBestRouteIds'],['unit-01','unit-02'])
            fastest = await route_planner.compare_suggested_routes('shortest_time')
            self.assertEqual(fastest['route']['unitId'],'unit-02')
            with self.assertRaises(ValueError): await route_planner.compare_suggested_routes(route_id='unknown')
