"""英語リズム学習支援ツール - MVPバックエンド

匿名ID・例文ID・音量カーブ(RMS)データ・音声認識結果・タイムスタンプを
SQLiteに保存する。音声データそのものは保存しない(倫理面の配慮、要件定義4節参照)。
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "prosody.db"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="Prosody Learning Tool API")


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT NOT NULL,
                sentence_id TEXT NOT NULL,
                sample_interval_ms INTEGER NOT NULL,
                amplitude TEXT NOT NULL,
                recognized_text TEXT NOT NULL DEFAULT '',
                client_timestamp TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


class SubmissionIn(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=64)
    sentence_id: str = Field(..., min_length=1, max_length=64)
    sample_interval_ms: int = Field(..., ge=1, le=1000)
    amplitude: list[float]
    recognized_text: str = ""
    timestamp: str


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.post("/api/submissions")
def create_submission(payload: SubmissionIn):
    if len(payload.amplitude) == 0:
        raise HTTPException(status_code=400, detail="amplitude must not be empty")
    if len(payload.amplitude) > 20000:
        raise HTTPException(status_code=400, detail="amplitude too large")

    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO submissions
                (student_id, sentence_id, sample_interval_ms, amplitude,
                 recognized_text, client_timestamp, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.student_id.strip(),
                payload.sentence_id.strip(),
                payload.sample_interval_ms,
                json.dumps(payload.amplitude),
                payload.recognized_text.strip(),
                payload.timestamp,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        submission_id = cur.lastrowid

    return {"status": "ok", "id": submission_id}


@app.get("/api/submissions")
def list_submissions(student_id: str | None = None, sentence_id: str | None = None):
    """教員が保存状況を確認するための簡易一覧(MVP用途、認証なし)。"""
    query = "SELECT id, student_id, sentence_id, sample_interval_ms, recognized_text, client_timestamp, created_at FROM submissions"
    conditions = []
    params: list[str] = []
    if student_id:
        conditions.append("student_id = ?")
        params.append(student_id)
    if sentence_id:
        conditions.append("sentence_id = ?")
        params.append(sentence_id)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY id DESC"

    with get_conn() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()

    return [dict(row) for row in rows]


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
