"""Forma sync server: FastAPI + SQLite."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db

BASE = os.path.dirname(os.path.abspath(__file__))
SECRET_FILE = os.path.join(db.DATA, "secret.key")
TOKEN_TTL = 60 * 60 * 24 * 30
ENTITIES = ["workouts", "sets", "recovery", "goals"]
ALIASES = {"avgHr": "avg_hr", "weeklyWorkouts": "weekly_workouts", "weeklyMinutes": "weekly_minutes"}
BACK = {v: k for k, v in ALIASES.items()}

app = FastAPI(title="Forma Sync API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

db.init()

if not os.path.exists(SECRET_FILE):
    with open(SECRET_FILE, "w", encoding="utf-8") as f:
        f.write(secrets.token_hex(32))
with open(SECRET_FILE, "r", encoding="utf-8") as f:
    SECRET = f.read().strip().encode()


# ---------------- auth helpers ----------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    it = 210_000
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, it)
    return f"pbkdf2${it}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, it, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(it))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(user) -> str:
    payload = {"sub": user["id"], "email": user["email"], "exp": int(time.time()) + TOKEN_TTL}
    body = b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = b64e(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".")
        expect = b64e(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return None
        data = json.loads(b64d(body))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется авторизация")
    data = read_token(authorization.split(" ", 1)[1].strip())
    if not data:
        raise HTTPException(401, "Сессия истекла, войдите заново")
    with db.connect() as con:
        row = con.execute("SELECT id,email,name FROM users WHERE id=?", (data["sub"],)).fetchone()
        if not row:
            raise HTTPException(401, "Пользователь не найден")
        return dict(row)


# ---------------- rate limit ----------------
_attempts: Dict[str, List[float]] = {}


def throttle(ip: str, limit: int = 12, window: int = 60):
    t = time.time()
    arr = [x for x in _attempts.get(ip, []) if t - x < window]
    if len(arr) >= limit:
        raise HTTPException(429, "Слишком много попыток, подождите минуту")
    arr.append(t)
    _attempts[ip] = arr


# ---------------- models ----------------
class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=60)


class LoginIn(BaseModel):
    email: str
    password: str


class SyncIn(BaseModel):
    since: int = 0
    changes: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)


# ---------------- routes ----------------
@app.get("/api/health")
def health():
    return {"ok": True, "time": db.now_ms(), "service": "forma-sync"}


@app.post("/api/auth/register")
def register(data: RegisterIn, request: Request):
    throttle(request.client.host if request.client else "?")
    email = data.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Некорректный email")
    with db.connect() as con:
        exists = con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if exists:
            raise HTTPException(409, "Такой email уже зарегистрирован")
        uid = secrets.token_hex(16)
        name = (data.name or email.split("@")[0]).strip()
        con.execute(
            "INSERT INTO users (id,email,name,pass_hash,created_at) VALUES (?,?,?,?,?)",
            (uid, email, name, hash_password(data.password), db.now_ms()),
        )
        user = {"id": uid, "email": email, "name": name}
    return {"token": make_token(user), "user": user}


@app.post("/api/auth/login")
def login(data: LoginIn, request: Request):
    throttle(request.client.host if request.client else "?")
    email = data.email.strip().lower()
    with db.connect() as con:
        row = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not verify_password(data.password, row["pass_hash"]):
        raise HTTPException(401, "Неверный email или пароль")
    user = {"id": row["id"], "email": row["email"], "name": row["name"]}
    return {"token": make_token(user), "user": user}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"user": user}


@app.post("/api/sync")
def sync(data: SyncIn, user=Depends(current_user)):
    changes = {}
    for entity in ENTITIES:
        items = data.changes.get(entity) or []
        norm = []
        for it in items:
            if not isinstance(it, dict):
                continue
            item = dict(it)
            for camel, snake in ALIASES.items():
                if camel in item:
                    item[snake] = item.pop(camel)
            norm.append(item)
        with db.connect() as con:
            db.upsert(con, entity, user["id"], norm[:2000])

    ts = db.now_ms()
    out = {}
    with db.connect() as con:
        for entity in ENTITIES:
            rows = db.since(con, entity, user["id"], data.since)
            for r in rows:
                for snake, camel in BACK.items():
                    if snake in r:
                        r[camel] = r.pop(snake)
            out[entity] = rows
    return {"now": ts, "changes": out}


# ---------------- static ----------------
WEB = os.environ.get("FORMA_WEB") or os.path.abspath(os.path.join(BASE, "..", "build", "sync"))
if os.path.isdir(WEB):
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".html", "/")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    import socket
    import uvicorn

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan = s.getsockname()[0]
        s.close()
    except Exception:
        lan = "127.0.0.1"
    print(f"\n  Форма · сервер синхронизации\n  ПК:    http://127.0.0.1:8000\n  Сеть:  http://{lan}:8000\n")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), log_level="info")
