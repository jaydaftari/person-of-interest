"""Local, bounded review history with the exact bytes of each flagged snapshot."""
import json
import sqlite3
from pathlib import Path
from uuid import uuid4

from .camera_analysis import now_iso


class AlertStore:
    def __init__(self, path: Path, limit: int = 100):
        self.path, self.limit = path, limit

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('''CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY, metadata TEXT NOT NULL, image BLOB,
            mime TEXT, acknowledged_at TEXT
        )''')
        return db

    def create(self, result: dict, session_id: str, snapshot: tuple[bytes, str] | None) -> dict:
        events = [e for e in result.get('events', []) if e.get('isDangerous') is True]
        if not events:
            raise ValueError('An alert requires a flagged model observation.')
        alert_id = uuid4().hex
        metadata = {
            'id': alert_id, 'sessionId': session_id,
            'cameraId': result['cameraId'], 'cameraName': result['cameraName'],
            'analyzedAt': result['analyzedAt'], 'snapshotAt': result.get('snapshotAt'),
            'createdAt': now_iso(), 'events': events, 'source': result.get('source'),
            'imageAvailable': snapshot is not None,
            'snapshotPath': f'/api/operations/alerts/{alert_id}/snapshot' if snapshot else None,
        }
        db = self.connect()
        try:
            with db:
                db.execute('INSERT INTO alerts VALUES (?, ?, ?, ?, NULL)',
                    (alert_id, json.dumps(metadata), snapshot[0] if snapshot else None, snapshot[1] if snapshot else None))
                db.execute('DELETE FROM alerts WHERE rowid NOT IN (SELECT rowid FROM alerts ORDER BY rowid DESC LIMIT ?)', (self.limit,))
        finally:
            db.close()
        return {**metadata, 'acknowledgedAt': None}

    def list(self) -> list[dict]:
        db = self.connect()
        try:
            return [{**json.loads(row['metadata']), 'acknowledgedAt':row['acknowledged_at']}
                    for row in db.execute('SELECT metadata, acknowledged_at FROM alerts ORDER BY rowid DESC')]
        finally:
            db.close()

    def acknowledge(self, alert_id: str):
        db = self.connect()
        try:
            with db:
                cursor = db.execute('UPDATE alerts SET acknowledged_at=COALESCE(acknowledged_at, ?) WHERE id=?', (now_iso(), alert_id))
                if not cursor.rowcount:
                    raise ValueError('Alert not found; it may have aged out of the retained history.')
        finally:
            db.close()

    def snapshot(self, alert_id: str) -> tuple[bytes, str] | None:
        db = self.connect()
        try:
            row = db.execute('SELECT image, mime FROM alerts WHERE id=?', (alert_id,)).fetchone()
            return (row['image'], row['mime']) if row and row['image'] else None
        finally:
            db.close()
