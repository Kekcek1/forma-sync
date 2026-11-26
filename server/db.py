"""SQLite layer for Forma sync server."""
import os
import sqlite3
import time
import json
from contextlib import contextmanager

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
DB_PATH = os.path.join(DATA, "forma.db")

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workouts (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT DEFAULT '',
  duration INTEGER DEFAULT 0,
  intensity INTEGER DEFAULT 3,
  distance REAL DEFAULT 0,
  avg_hr INTEGER DEFAULT 0,
  calories INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS ix_w_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS sets (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  reps INTEGER DEFAULT 0,
  count INTEGER DEFAULT 1,
  rest INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS ix_s_workout ON sets(user_id, workout_id);

CREATE TABLE IF NOT EXISTS recovery (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  sleep REAL DEFAULT 0,
  quality INTEGER DEFAULT 3,
  hr INTEGER DEFAULT 0,
  fatigue INTEGER DEFAULT 3,
  soreness INTEGER DEFAULT 3,
  mood INTEGER DEFAULT 3,
  stress INTEGER DEFAULT 3,
  note TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS ix_r_date ON recovery(user_id, date);

CREATE TABLE IF NOT EXISTS goals (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  weekly_workouts INTEGER DEFAULT 4,
  weekly_minutes INTEGER DEFAULT 240,
  updated_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
"""

FIELDS = {
    "workouts": ["date", "type", "title", "duration", "intensity", "distance", "avg_hr", "calories", "note"],
    "sets": ["workout_id", "name", "weight", "reps", "count", "rest"],
    "recovery": ["date", "sleep", "quality", "hr", "fatigue", "soreness", "mood", "stress", "note"],
    "goals": ["weekly_workouts", "weekly_minutes"],
}


def init():
    os.makedirs(DATA, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def upsert(con, table: str, user_id: str, items: list) -> int:
    if not items:
        return 0
    cols = ["user_id", "id"] + FIELDS[table] + ["updated_at", "deleted"]
    place = ",".join("?" * len(cols))
    updates = ",".join(f"{c}=excluded.{c}" for c in cols[2:])
    sql = (
        f"INSERT INTO {table} ({','.join(cols)}) VALUES ({place}) "
        f"ON CONFLICT(user_id,id) DO UPDATE SET {updates} "
        f"WHERE excluded.updated_at > {table}.updated_at"
    )
    n = 0
    for it in items:
        if not it.get("id"):
            continue
        row = [user_id, str(it["id"])]
        for f in FIELDS[table]:
            row.append(it.get(f, 0 if f not in ("date", "type", "title", "note", "name", "workout_id") else ""))
        row += [int(it.get("updated_at") or 0), int(it.get("deleted") or 0)]
        con.execute(sql, row)
        n += 1
    return n


def since(con, table: str, user_id: str, ts: int, limit: int = 5000) -> list:
    cur = con.execute(
        f"SELECT * FROM {table} WHERE user_id=? AND updated_at>? ORDER BY updated_at LIMIT ?",
        (user_id, ts, limit),
    )
    out = []
    for r in cur.fetchall():
        d = {k: r[k] for k in r.keys() if k != "user_id"}
        if table == "workouts":
            d["avgHr"] = d.pop("avg_hr")
        out.append(d)
    if table == "goals":
        for d in out:
            d["weeklyWorkouts"] = d.pop("weekly_workouts")
            d["weeklyMinutes"] = d.pop("weekly_minutes")
    if table == "recovery":
        pass
    return out


def now_ms() -> int:
    return int(time.time() * 1000)
