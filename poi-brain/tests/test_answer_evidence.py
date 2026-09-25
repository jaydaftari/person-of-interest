import unittest
from app.pipeline.answer_evidence import EvidenceLedger
from app.routers.assistant import direct_read_request


class EvidenceTests(unittest.TestCase):
    def test_supported_comparisons_always_invoke_evidence_tools(self):
        self.assertEqual(direct_read_request('Which route has more recorded collisions?'), ('compare_routes', {'metric':'collisions'}))
        self.assertEqual(direct_read_request('Which route is quickest?'), ('compare_routes', {'metric':'shortest_time'}))
        self.assertIsNone(direct_read_request('Which route is guaranteed safest tonight?'))
        self.assertIsNone(direct_read_request('Start monitoring this camera'))
    def test_no_tool_facts_cannot_support_a_claim(self):
        ledger = EvidenceLedger(['find_cameras'])
        result = ledger.render({'status':'supported','factIds':['E0'],'limitations':[]}, 'turn')
        self.assertEqual(result['answerStatus'], 'unsupported')
        self.assertIn("won't guess", result['content'])

    def test_unknown_citation_and_malformed_ids_fail_closed(self):
        ledger = EvidenceLedger(['find_cameras'])
        for ids in [['E99'], [{'id':'E0'}], []]:
            self.assertEqual(ledger.render({'status':'supported','factIds':ids,'limitations':[]},'turn')['answerStatus'], 'unsupported')

    def test_only_server_facts_and_urls_appear_not_model_prose(self):
        ledger = EvidenceLedger(['find_cameras'])
        ledger.record('find_cameras', {'cameras':[{'id':'a','name':'Canal Street','borough':'Manhattan'}]})
        result = ledger.render({'status':'supported','factIds':['E1'],'limitations':[],
            'content':'There are 999 accidents today! [source](https://made-up.example)'},'turn')
        self.assertNotIn('999', result['content'])
        self.assertNotIn('made-up', str(result))
        self.assertIn('Canal Street', result['content'])
        self.assertIn('[NYC DOT camera catalog](#evidence-turn-E1)', result['content'])
        self.assertTrue(result['evidence'][0]['why'])
        self.assertTrue(result['evidence'][0]['retrievedAt'])

    def test_unsupported_functionality_is_explicit_and_cited(self):
        ledger = EvidenceLedger(['find_cameras'])
        result = ledger.render({'status':'unsupported','factIds':['E0'],'limitations':['unsupported']},'turn')
        self.assertIn("don't currently have the functionality", result['content'])
        self.assertIn('[App coverage]',result['content'])

    def test_valid_tool_result_survives_a_broken_answer_selection(self):
        ledger = EvidenceLedger(['find_cameras'])
        ledger.record('find_cameras', {'cameras':[{'id':'a','name':'Canal Street','borough':'Manhattan'}]})
        result = ledger.render({'status':'supported','factIds':['made-up'],'limitations':[]},'turn')
        self.assertEqual(result['answerStatus'],'supported')
        self.assertIn('Canal Street',result['content'])
        self.assertNotIn('made-up',result['content'])
        self.assertTrue(result['evidence'])

    def test_successful_route_with_null_error_is_not_labeled_a_failure(self):
        ledger = EvidenceLedger(['compare_routes'])
        ledger.record('compare_routes', {'route':{
            'status':'ready','unitId':'unit-01','distanceMeters':1200,'durationSeconds':180,
            'error':None,'waypoints':[{'name':'Start'},{'name':'Stop'}]},
            'routeComparison':{'metric':'collisions','description':'Highest stop count',
                'rankedRoutes':[{'routeId':'unit-01','value':78}], 'selectedRouteId':'unit-01',
                'tiedBestRouteIds':['unit-01'],'interpretation':'Count at a stop, not the entire road.'}})
        result = ledger.recorded_answer('turn')
        self.assertEqual(result['answerStatus'],'supported')
        self.assertIn('78 collisions', result['content'])
        self.assertNotIn('did not return usable evidence', result['content'])

    def test_low_coverage_cannot_be_rendered_as_citywide_certainty(self):
        ledger = EvidenceLedger(['compare_camera_traffic'])
        ledger.record('compare_camera_traffic', {'comparison':{
            'results':[], 'coverage':'Only three cameras.',
            'conclusion':{'status':'insufficient_evidence','cameraIds':[],'reason':'Images unclear.'}}})
        result=ledger.render({'status':'supported','factIds':['E1'],'limitations':[]},'turn')
        self.assertEqual(result['answerStatus'],'partial')
        self.assertIn('not a citywide conclusion',result['content'])
        self.assertIn('insufficient',result['content'])

    def test_failed_tool_is_not_a_safe_scene_claim(self):
        ledger = EvidenceLedger(['analyze_camera'])
        ledger.record('analyze_camera', {'error':'Snapshot unavailable'}, True)
        result=ledger.render({'status':'partial','factIds':['E1'],'limitations':['tool_failed']},'turn')
        self.assertIn('Snapshot unavailable', result['content'])
        self.assertIn('not evidence of an empty or safe scene', result['evidence'][0]['why'])
