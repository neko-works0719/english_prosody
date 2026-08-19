"""英語リズム学習支援ツール - MVPバックエンド

匿名ID・例文ID・音量カーブ(RMS)データ・音声認識結果・タイムスタンプを
SQLiteに保存する。音声データそのものは保存しない(倫理面の配慮、要件定義4節参照)。

例文セットもSQLiteで管理し、管理者(教員)が例文の追加・編集・削除、
および例文ごとのモデル音声(録音)のアップロードを行えるようにする。
"""
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "prosody.db"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
MEDIA_DIR = BASE_DIR / "media" / "audio"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme-admin")

ALLOWED_AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}

app = FastAPI(title="Prosody Learning Tool API")
security = HTTPBasic()


def require_admin(credentials: HTTPBasicCredentials = Depends(security)) -> None:
    valid_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    valid_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    if not (valid_username and valid_password):
        raise HTTPException(
            status_code=401,
            detail="管理者認証に失敗しました",
            headers={"WWW-Authenticate": "Basic"},
        )


DEFAULT_SENTENCES = [
    {
        "id": "s01",
        "text": "I can speak English.",
        "words": [
            {"text": "I", "type": "function"},
            {"text": "can", "type": "function", "ipaStrong": "kæn", "ipaWeak": "kən", "note": "強調しない限り弱形/kən/が標準"},
            {"text": "speak", "type": "content"},
            {"text": "English.", "type": "content"},
        ],
    },
    {
        "id": "s02",
        "text": "She was reading a book.",
        "words": [
            {"text": "She", "type": "function"},
            {"text": "was", "type": "function", "ipaStrong": "wɒz", "ipaWeak": "wəz"},
            {"text": "reading", "type": "content"},
            {"text": "a", "type": "function", "ipaStrong": "eɪ", "ipaWeak": "ə"},
            {"text": "book.", "type": "content"},
        ],
    },
    {
        "id": "s03",
        "text": "This is for you.",
        "words": [
            {"text": "This", "type": "content", "note": "指示代名詞として強く読まれる"},
            {"text": "is", "type": "function", "ipaStrong": "ɪz", "ipaWeak": "z"},
            {"text": "for", "type": "function", "ipaStrong": "fɔːr", "ipaWeak": "fər"},
            {"text": "you.", "type": "function", "ipaStrong": "juː", "ipaWeak": "jə"},
        ],
    },
    {
        "id": "s04",
        "text": "We are waiting for the bus.",
        "words": [
            {"text": "We", "type": "function"},
            {"text": "are", "type": "function", "ipaStrong": "ɑːr", "ipaWeak": "ər"},
            {"text": "waiting", "type": "content"},
            {"text": "for", "type": "function", "ipaStrong": "fɔːr", "ipaWeak": "fər"},
            {"text": "the", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "bus.", "type": "content"},
        ],
    },
    {
        "id": "s05",
        "text": "He has finished his homework.",
        "words": [
            {"text": "He", "type": "function"},
            {"text": "has", "type": "function", "ipaStrong": "hæz", "ipaWeak": "həz"},
            {"text": "finished", "type": "content"},
            {"text": "his", "type": "function", "ipaStrong": "hɪz", "ipaWeak": "ɪz"},
            {"text": "homework.", "type": "content"},
        ],
    },
    {
        "id": "s06",
        "text": "They will arrive at seven.",
        "words": [
            {"text": "They", "type": "function"},
            {"text": "will", "type": "function", "ipaStrong": "wɪl", "ipaWeak": "əl"},
            {"text": "arrive", "type": "content"},
            {"text": "at", "type": "function", "ipaStrong": "æt", "ipaWeak": "ət"},
            {"text": "seven.", "type": "content"},
        ],
    },
    {
        "id": "s07",
        "text": "You should call your teacher.",
        "words": [
            {"text": "You", "type": "function", "ipaStrong": "juː", "ipaWeak": "jə"},
            {"text": "should", "type": "function", "ipaStrong": "ʃʊd", "ipaWeak": "ʃəd"},
            {"text": "call", "type": "content"},
            {"text": "your", "type": "function", "ipaStrong": "jʊər", "ipaWeak": "jər"},
            {"text": "teacher.", "type": "content"},
        ],
    },
    {
        "id": "s08",
        "text": "We must finish the project.",
        "words": [
            {"text": "We", "type": "function"},
            {"text": "must", "type": "function", "ipaStrong": "mʌst", "ipaWeak": "məst"},
            {"text": "finish", "type": "content"},
            {"text": "the", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "project.", "type": "content"},
        ],
    },
    {
        "id": "s09",
        "text": "I would like some coffee.",
        "words": [
            {"text": "I", "type": "function"},
            {"text": "would", "type": "function", "ipaStrong": "wʊd", "ipaWeak": "wəd"},
            {"text": "like", "type": "content"},
            {"text": "some", "type": "function", "ipaStrong": "sʌm", "ipaWeak": "səm"},
            {"text": "coffee.", "type": "content"},
        ],
    },
    {
        "id": "s10",
        "text": "She can play the piano.",
        "words": [
            {"text": "She", "type": "function"},
            {"text": "can", "type": "function", "ipaStrong": "kæn", "ipaWeak": "kən"},
            {"text": "play", "type": "content"},
            {"text": "the", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "piano.", "type": "content"},
        ],
    },
    {
        "id": "s11",
        "text": "He gave the book to Mary.",
        "words": [
            {"text": "He", "type": "function"},
            {"text": "gave", "type": "content"},
            {"text": "the", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "book", "type": "content"},
            {"text": "to", "type": "function", "ipaStrong": "tuː", "ipaWeak": "tə"},
            {"text": "Mary.", "type": "content"},
        ],
    },
    {
        "id": "s12",
        "text": "There were many students in the room.",
        "words": [
            {"text": "There", "type": "function", "ipaStrong": "ðɛər", "ipaWeak": "ðər", "note": "存在のthereは弱形になりやすい"},
            {"text": "were", "type": "function", "ipaStrong": "wɜːr", "ipaWeak": "wər"},
            {"text": "many", "type": "content"},
            {"text": "students", "type": "content"},
            {"text": "in", "type": "function"},
            {"text": "the", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "room.", "type": "content"},
        ],
    },
    {
        "id": "s13",
        "text": "I have to go now.",
        "words": [
            {"text": "I", "type": "function"},
            {"text": "have", "type": "function", "ipaStrong": "hæv", "ipaWeak": "həv"},
            {"text": "to", "type": "function", "ipaStrong": "tuː", "ipaWeak": "tə"},
            {"text": "go", "type": "content"},
            {"text": "now.", "type": "content"},
        ],
    },
    {
        "id": "s14",
        "text": "Can you help me for a minute?",
        "words": [
            {"text": "Can", "type": "function", "ipaStrong": "kæn", "ipaWeak": "kən"},
            {"text": "you", "type": "function", "ipaStrong": "juː", "ipaWeak": "jə"},
            {"text": "help", "type": "content"},
            {"text": "me", "type": "function", "ipaStrong": "miː", "ipaWeak": "mi"},
            {"text": "for", "type": "function", "ipaStrong": "fɔːr", "ipaWeak": "fər"},
            {"text": "a", "type": "function", "ipaStrong": "eɪ", "ipaWeak": "ə"},
            {"text": "minute?", "type": "content"},
        ],
    },
    {
        "id": "s15",
        "text": "The students were waiting for their results.",
        "words": [
            {"text": "The", "type": "function", "ipaStrong": "ðiː", "ipaWeak": "ðə"},
            {"text": "students", "type": "content"},
            {"text": "were", "type": "function", "ipaStrong": "wɜːr", "ipaWeak": "wər"},
            {"text": "waiting", "type": "content"},
            {"text": "for", "type": "function", "ipaStrong": "fɔːr", "ipaWeak": "fər"},
            {"text": "their", "type": "function", "ipaStrong": "ðɛər", "ipaWeak": "ðər"},
            {"text": "results.", "type": "content"},
        ],
    },
]


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sentences (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                words_json TEXT NOT NULL,
                audio_filename TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        row = conn.execute("SELECT COUNT(*) FROM sentences").fetchone()
        if row[0] == 0:
            now = datetime.now(timezone.utc).isoformat()
            conn.executemany(
                """
                INSERT INTO sentences (id, text, words_json, audio_filename, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?)
                """,
                [
                    (s["id"], s["text"], json.dumps(s["words"], ensure_ascii=False), now, now)
                    for s in DEFAULT_SENTENCES
                ],
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


class WordIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=64)
    type: str = Field(..., pattern="^(content|function)$")
    ipaStrong: str | None = Field(default=None, max_length=64)
    ipaWeak: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=200)


class SentenceIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=64, pattern="^[a-zA-Z0-9_-]+$")
    text: str = Field(..., min_length=1, max_length=500)
    words: list[WordIn] = Field(..., min_length=1, max_length=50)


class SentenceUpdateIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    words: list[WordIn] = Field(..., min_length=1, max_length=50)


def row_to_sentence(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "text": row["text"],
        "words": json.loads(row["words_json"]),
        "audio_url": f"/media/audio/{row['audio_filename']}" if row["audio_filename"] else None,
        "updated_at": row["updated_at"],
    }


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# ---- 例文管理 API ----


@app.get("/api/sentences")
def list_sentences():
    with get_conn() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM sentences ORDER BY id ASC").fetchall()
    return [row_to_sentence(r) for r in rows]


@app.post("/api/sentences", dependencies=[Depends(require_admin)])
def create_sentence(payload: SentenceIn):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM sentences WHERE id = ?", (payload.id,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="この例文IDは既に使われています")
        conn.execute(
            """
            INSERT INTO sentences (id, text, words_json, audio_filename, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?)
            """,
            (
                payload.id,
                payload.text.strip(),
                json.dumps([w.model_dump(exclude_none=True) for w in payload.words], ensure_ascii=False),
                now,
                now,
            ),
        )
    return {"status": "ok", "id": payload.id}


@app.put("/api/sentences/{sentence_id}", dependencies=[Depends(require_admin)])
def update_sentence(sentence_id: str, payload: SentenceUpdateIn):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM sentences WHERE id = ?", (sentence_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="例文が見つかりません")
        conn.execute(
            "UPDATE sentences SET text = ?, words_json = ?, updated_at = ? WHERE id = ?",
            (
                payload.text.strip(),
                json.dumps([w.model_dump(exclude_none=True) for w in payload.words], ensure_ascii=False),
                now,
                sentence_id,
            ),
        )
    return {"status": "ok", "id": sentence_id}


@app.delete("/api/sentences/{sentence_id}", dependencies=[Depends(require_admin)])
def delete_sentence(sentence_id: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT audio_filename FROM sentences WHERE id = ?", (sentence_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="例文が見つかりません")
        audio_filename = row[0]
        conn.execute("DELETE FROM sentences WHERE id = ?", (sentence_id,))
    if audio_filename:
        _delete_audio_file(audio_filename)
    return {"status": "ok"}


# ---- モデル音声(録音)アップロード API ----


def _delete_audio_file(filename: str) -> None:
    path = MEDIA_DIR / filename
    if path.exists() and path.is_file():
        path.unlink()


@app.post("/api/sentences/{sentence_id}/audio", dependencies=[Depends(require_admin)])
async def upload_sentence_audio(sentence_id: str, file: UploadFile):
    ext = ALLOWED_AUDIO_TYPES.get(file.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="対応していない音声形式です")

    with get_conn() as conn:
        row = conn.execute(
            "SELECT audio_filename FROM sentences WHERE id = ?", (sentence_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="例文が見つかりません")
        old_filename = row[0]

        contents = await file.read()
        if len(contents) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="音声ファイルが大きすぎます(10MBまで)")

        new_filename = f"{sentence_id}-{uuid.uuid4().hex[:8]}.{ext}"
        (MEDIA_DIR / new_filename).write_bytes(contents)

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE sentences SET audio_filename = ?, updated_at = ? WHERE id = ?",
            (new_filename, now, sentence_id),
        )

    if old_filename:
        _delete_audio_file(old_filename)

    return {"status": "ok", "audio_url": f"/media/audio/{new_filename}"}


@app.delete("/api/sentences/{sentence_id}/audio", dependencies=[Depends(require_admin)])
def delete_sentence_audio(sentence_id: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT audio_filename FROM sentences WHERE id = ?", (sentence_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="例文が見つかりません")
        old_filename = row[0]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE sentences SET audio_filename = NULL, updated_at = ? WHERE id = ?",
            (now, sentence_id),
        )
    if old_filename:
        _delete_audio_file(old_filename)
    return {"status": "ok"}


# ---- 管理者確認用 ----


@app.get("/api/admin/whoami", dependencies=[Depends(require_admin)])
def admin_whoami():
    return {"status": "ok"}


# ---- 提出データ API ----


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


app.mount("/media", StaticFiles(directory=BASE_DIR / "media"), name="media")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
