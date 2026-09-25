import asyncio
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch

from app.pipeline.monitoring import ZoneMonitor
from app.pipeline import monitoring
from app.schemas import Camera
from app.state import STATE
from app.pipeline.monitoring_alerts import AlertStore


class MonitoringTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.old_cameras = STATE.cameras
        STATE.cameras = {key: Camera(id=key, name=key, location='NYC', address='NYC', snapshotUrl='https://example.test/image') for key in 'abcd'}
        self.temp = TemporaryDirectory()
        self.monitor = ZoneMonitor(AlertStore(Path(self.temp.name) / 'alerts.sqlite3'))

    async def asyncTearDown(self):
        await self.monitor.stop()
        STATE.cameras = self.old_cameras
        self.temp.cleanup()

    async def test_start_is_explicit_idempotent_and_bounded(self):
        self.assertIsNone(self.monitor.status()['monitoring'])
        for ids in [[], ['a']*2, list('abcd'), ['missing']]:
            with self.assertRaises(ValueError): await self.monitor.start(ids)
        with self.assertRaises(ValueError): await self.monitor.start(['a'], 1)
        first = await self.monitor.start(['a'])
        again = await self.monitor.start(['a'])
        self.assertEqual(first['monitoring']['id'], again['monitoring']['id'])
        with self.assertRaisesRegex(ValueError, 'already monitored'):
            await self.monitor.start(['b'])
        with self.assertRaisesRegex(ValueError, 'session changed'):
            await self.monitor.stop('old-session')

    async def test_stop_cancels_inflight_work_and_schedules_nothing_more(self):
        started, cancelled = asyncio.Event(), asyncio.Event()
        calls = []
        async def analyze(camera_id, **kwargs):
            calls.append(camera_id)
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        with patch.object(monitoring, 'analyze_camera_frame', analyze):
            await self.monitor.start(['a', 'b'])
            await asyncio.wait_for(started.wait(), 1)
            stopped = await self.monitor.stop()
            await asyncio.sleep(0)
            self.assertTrue(cancelled.is_set())
            self.assertEqual(calls, ['a'])
            self.assertEqual(stopped['monitoring']['status'], 'stopped')
            self.assertEqual(stopped['monitoring']['completed'], 0)
            self.assertEqual(stopped['monitoring']['observations'], [])
            self.assertEqual((await self.monitor.stop())['monitoring']['stoppedAt'], stopped['monitoring']['stoppedAt'])

    async def test_failures_continue_serially_and_results_survive_stop(self):
        completed = asyncio.Event()
        calls = []
        async def analyze(camera_id, **kwargs):
            calls.append(camera_id)
            if camera_id == 'a': raise ValueError('Snapshot unavailable')
            completed.set()
            return {'cameraId':camera_id, 'events':[{'description':'Visible vehicles'}], 'rawResponse':'private model text'}
        with patch.object(monitoring, 'analyze_camera_frame', analyze):
            await self.monitor.start(['a', 'b'])
            self.monitor._session['intervalSeconds'] = 0  # deterministic test only
            await asyncio.wait_for(completed.wait(), 1)
            result = await self.monitor.stop()
        self.assertEqual(calls[:2], ['a', 'b'])
        self.assertGreaterEqual(result['monitoring']['completed'], 1)
        self.assertGreaterEqual(result['monitoring']['failed'], 1)
        self.assertTrue(result['monitoring']['observations'])
        self.assertTrue(all('rawResponse' not in r for r in result['monitoring']['observations']))
        copy = self.monitor.status()
        copy['monitoring']['cameraIds'].clear()
        self.assertEqual(self.monitor.status()['monitoring']['cameraIds'], ['a','b'])
