"""SQLite for local use, PostgreSQL when DATABASE_URL is set. Never fall back on failure."""
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
DATA = Path(os.environ.get('CLASS_BOARD_DATA', str(ROOT / '.data')))
DB = DATA / 'board.sqlite3'
if os.environ.get('RENDER') and not DATABASE_URL:
    raise RuntimeError('Render에서는 Neon DATABASE_URL 환경 변수가 필요합니다. 임시 SQLite로 시작하지 않습니다.')

class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def executemany(self, query, params):
        with self.connection.cursor() as cursor:
            cursor.executemany(query.replace('?', '%s'), params)

    def execute(self, query, params=()):
        # Application queries use SQLite placeholders; values remain bound parameters.
        return self.connection.execute(query.replace('?', '%s'), params)

@contextmanager
def connect():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=30) as db:
            yield PostgresConnection(db)
    else:
        DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
        db = sqlite3.connect(DB, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

def initialize_schema(db):
    # Serialize first-start schema/seed changes across Render deployments.
    if DATABASE_URL:
        db.execute('SELECT pg_advisory_xact_lock(20400204)')
    db.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, password TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL, birthday TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '')")
    if DATABASE_URL:
        db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''")
    elif 'name' not in [row['name'] for row in db.execute('PRAGMA table_info(users)')]:
        db.execute("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''")
    identity = 'BIGSERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'
    binary = 'BYTEA' if DATABASE_URL else 'BLOB'
    db.execute(f'CREATE TABLE IF NOT EXISTS assignments (id {identity}, title TEXT NOT NULL, subject TEXT NOT NULL, scheduled_date TEXT NOT NULL, content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL)')
    db.execute(f'CREATE TABLE IF NOT EXISTS photos (id {identity}, caption TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, original {binary} NOT NULL, preview {binary} NOT NULL, mime TEXT NOT NULL, extension TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at DOUBLE PRECISION NOT NULL)')
    db.execute('CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)')
    db.execute('CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at)')
    # Add final-board columns without replacing accounts, sessions, or posts.
    def add_column(table, column, declaration):
        if DATABASE_URL:
            db.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {declaration}')
        elif column not in [row['name'] for row in db.execute(f'PRAGMA table_info({table})')]:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
    add_column('users', 'avatar', binary)
    add_column('users', 'avatar_mime', "TEXT NOT NULL DEFAULT ''")
    add_column('assignments', 'image', binary)
    add_column('assignments', 'image_mime', "TEXT NOT NULL DEFAULT ''")
    db.execute(f"CREATE TABLE IF NOT EXISTS notices (id {identity}, title TEXT NOT NULL, subject TEXT NOT NULL, scheduled_date TEXT NOT NULL, content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, image {binary}, image_mime TEXT NOT NULL DEFAULT '')")
    db.execute(f"CREATE TABLE IF NOT EXISTS post_attachments (id {identity}, board TEXT NOT NULL, post_id BIGINT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, content {binary} NOT NULL)")
    db.execute('CREATE INDEX IF NOT EXISTS post_attachments_board_post ON post_attachments(board,post_id)')
    db.execute('CREATE TABLE IF NOT EXISTS seat_layout (slot TEXT PRIMARY KEY, student_id TEXT NOT NULL)')

    # Persist menu revisions and per-account acknowledgements across sessions/devices.
    db.execute('CREATE TABLE IF NOT EXISTS board_updates (kind TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0)')
    db.execute('CREATE TABLE IF NOT EXISTS board_reads (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(user_id,kind))')
    for kind in ('assignments', 'notices', 'photos', 'class24'):
        db.execute('INSERT INTO board_updates(kind) VALUES(?) ON CONFLICT(kind) DO NOTHING', (kind,))
