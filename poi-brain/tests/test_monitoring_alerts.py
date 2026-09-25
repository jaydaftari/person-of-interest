import asyncio
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.pipeline.monitoring import ZoneMonitor
from app.pipeline.monitoring_alerts import AlertStore
from app.pipeline import monitoring
from app.routers import operations
from app.schemas import Camera
from app.state import STATE


def sample(dangerous=True):
    return {'cameraId':'test-camera', 'cameraName':'Test intersection',
        'analyzedAt':'2026-09-25T21:00:02+00:00', 'snapshotAt':'2026-09-25T21:00:00+00:00',
        'source':'https://webcams.nyctmc.org/api/cameras/test/image',
        'events':[{'description':'Test-only possible obstruction', 'isDangerous':dangerous}],
        '_snapshot':(b'exact-test-frame', 'image/jpeg'), 'rawResponse':'not public'}


class AlertStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.path = Path(self.temp.name) / 'alerts.sqlite3'
        self.store = AlertStore(self.path, limit=3)

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        result = sample()
        return self.store.create(result, 'session-1', result['_snapshot'])

    def test_exact_image_and_acknowledgment_survive_restart(self):
        alert = self.create()
        self.assertNotIn('_snapshot', alert)
        self.assertNotIn('rawResponse', alert)
        self.assertEqual(self.store.snapshot(alert['id']), (b'exact-test-frame','image/jpeg'))
        reopened = AlertStore(self.path)
        self.assertEqual(reopened.list()[0]['id'], alert['id'])
        reopened.acknowledge(alert['id'])
        first_time = reopened.list()[0]['acknowledgedAt']
        self.assertIsNotNone(first_time)
        reopened.acknowledge(alert['id'])
        self.assertEqual(reopened.list()[0]['acknowledgedAt'], first_time)
        self.assertEqual(reopened.snapshot(alert['id'])[0], b'exact-test-frame')

    def test_bounded_history_and_invalid_ack(self):
        first = self.create()
        for _ in range(3): self.create()
        self.assertEqual(len(self.store.list()),3)
        self.assertIsNone(self.store.snapshot(first['id']))
        with self.assertRaises(ValueError): self.store.acknowledge('missing')
        with self.assertRaises(ValueError): self.store.create(sample(False), 'session', None)

    def test_snapshot_and_acknowledge_http_endpoints(self):
        alert = self.create()
        monitor = ZoneMonitor(self.store)
        app = FastAPI()
        app.include_router(operations.router)
        with patch.object(operations, 'MONITOR', monitor), TestClient(app) as client:
            image = client.get(f"/operations/alerts/{alert['id']}/snapshot")
            self.assertEqual(image.status_code,200)
            self.assertEqual(image.content,b'exact-test-frame')
            self.assertEqual(image.headers['content-type'],'image/jpeg')
            response=client.post('/operations/monitoring',json={'action':'acknowledge','alertId':alert['id']})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['unacknowledgedAlertCount'],0)
            self.assertIsNone(response.json()['monitoring'])
            self.assertEqual(client.get('/operations/alerts/unknown/snapshot').status_code,404)
            self.assertEqual(client.post('/operations/monitoring',json={'action':'acknowledge'}).status_code,400)


class AlertMonitoringTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = TemporaryDirectory()
        self.store = AlertStore(Path(self.temp.name) / 'alerts.sqlite3')
        self.monitor = ZoneMonitor(self.store)
        self.old_cameras = STATE.cameras
        STATE.cameras = {'test-camera':Camera(id='test-camera',name='Test intersection',location='NYC',address='NYC',snapshotUrl='https://example.test/image')}

    async def asyncTearDown(self):
        await self.monitor.stop()
        STATE.cameras = self.old_cameras
        self.temp.cleanup()

    async def run_one(self, result=None, error=None):
        called = asyncio.Event()
        async def analyze(camera_id, **kwargs):
            self.assertTrue(kwargs['include_snapshot'])
            called.set()
            if error: raise error
            return result
        with patch.object(monitoring, 'analyze_camera_frame', analyze):
            await self.monitor.start(['test-camera'])
            await asyncio.wait_for(called.wait(),1)
            return await self.monitor.stop()

    async def test_flag_creates_alert_normal_frame_and_stop_do_not_clear_it(self):
        flagged = await self.run_one(sample())
        self.assertEqual(flagged['unacknowledgedAlertCount'],1)
        observation = flagged['monitoring']['observations'][0]
        self.assertEqual(observation['outcome'],'potential_hazard')
        self.assertNotIn('_snapshot',observation)
        normal = await self.run_one(sample(False))
        self.assertEqual(normal['unacknowledgedAlertCount'],1)
        self.assertEqual(normal['monitoring']['observations'][0]['outcome'],'no_hazard_flagged')
        self.monitor.acknowledge_alert(flagged['alerts'][0]['id'])
        self.assertEqual(self.monitor.status()['unacknowledgedAlertCount'],0)
        self.assertEqual(len(self.monitor.status()['alerts']),1)

    async def test_failure_is_unknown_and_does_not_create_alert(self):
        failed = await self.run_one(error=ValueError('Snapshot unavailable'))
        self.assertEqual(failed['monitoring']['observations'][0]['outcome'],'analysis_failed')
        self.assertEqual(failed['monitoring']['failed'],1)
        self.assertEqual(failed['alerts'],[])

    async def test_acknowledgment_does_not_stop_active_monitoring(self):
        flagged = await self.run_one(sample())
        async def pending(camera_id, **kwargs): await asyncio.Event().wait()
        with patch.object(monitoring,'analyze_camera_frame',pending):
            await self.monitor.start(['test-camera'])
            acknowledged = self.monitor.acknowledge_alert(flagged['alerts'][0]['id'])
            self.assertEqual(acknowledged['monitoring']['status'],'running')
            self.assertEqual(acknowledged['unacknowledgedAlertCount'],0)
            await self.monitor.stop()

    async def test_alert_storage_failure_does_not_hide_hazard(self):
        with patch.object(self.store,'create',side_effect=OSError('Disk full')):
            result = await self.run_one(sample())
        record = result['monitoring']['observations'][0]
        self.assertEqual(record['outcome'],'potential_hazard')
        self.assertIn('could not be saved', record['alertError'])
        self.assertEqual(result['monitoring']['completed'],1)
