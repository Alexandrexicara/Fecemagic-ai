import io
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from db import db_ready, get_connection, initialize_database
from engine import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facemagic")
app = FastAPI(title="FaceMagic AI API", version="0.4.0")
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "12")) * 1024 * 1024
MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
JWT_HOURS = max(1, int(os.getenv("JWT_EXPIRE_HOURS", "24")))
password_hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=80)


class CreditAdjustment(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    amount: int = Field(gt=0, le=100000)
    reason: str = Field(min_length=3, max_length=160)


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    return email


def require_auth_config():
    if not JWT_SECRET:
        raise HTTPException(status_code=503, detail="Autenticação ainda não configurada no servidor (JWT_SECRET).")


def create_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "email": email, "iat": now, "exp": now + timedelta(hours=JWT_HOURS)},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    require_auth_config()
    if not credentials:
        raise HTTPException(status_code=401, detail="Faça login para continuar.")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("missing subject")
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada. Entre novamente.")
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT id::text AS id, email, display_name, created_at FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
    except Exception:
        logger.exception("Falha ao consultar usuário autenticado")
        raise HTTPException(status_code=503, detail="Banco de dados indisponível.")
    if not row:
        raise HTTPException(status_code=401, detail="Conta não encontrada.")
    return row


@app.on_event("startup")
def startup():
    if os.getenv("DATABASE_URL", "").strip():
        try:
            initialize_database()
            logger.info("Schema PostgreSQL verificado.")
        except Exception:
            logger.exception("Banco configurado, mas não foi possível inicializar o schema.")


@app.get("/")
def root():
    return {"name": "FaceMagic AI API", "status": "online", "version": "0.4.0"}


@app.get("/api/health")
def health():
    database_ready = db_ready()
    engine_status = engine.status()
    auth_ready = bool(JWT_SECRET)
    return {
        "ok": True,
        "service": "facemagic-api",
        "version": "0.4.0",
        "database": "connected" if database_ready else (
            "not_configured" if not os.getenv("DATABASE_URL", "").strip() else "unavailable"
        ),
        "database_configured": bool(os.getenv("DATABASE_URL", "").strip()),
        "auth_configured": auth_ready,
        "registration_enabled": database_ready and auth_ready,
        "face_swap_engine": "ready" if engine_status.configured else "not_configured",
        "nvidia_api_configured": bool(os.getenv("NVIDIA_API_KEY", "").strip()),
    }


@app.get("/api/capabilities")
def capabilities():
    database = db_ready()
    auth_ready = bool(JWT_SECRET)
    engine_status = engine.status()
    return {
        "image_upload": True,
        "image_validation": True,
        "image_face_swap": engine_status.configured,
        "recorded_video_upload": True,
        "video_processing": False,
        "in_platform_calls": True,
        "call_signaling": "websocket_ephemeral_single_instance",
        "live_camera_preview": True,
        "live_face_swap": False,
        "virtual_camera": False,
        "accounts": database and auth_ready,
        "credits": database and auth_ready,
        "database": database,
        "auth_configured": auth_ready,
        "nvidia_api_configured": bool(os.getenv("NVIDIA_API_KEY", "").strip()),
        "video_backgrounds": "preview_only_until_video_pipeline_is_enabled",
        "message": engine_status.reason,
    }


@app.post("/api/auth/register")
def register(data: Credentials):
    require_auth_config()
    email = normalize_email(data.email)
    try:
        with get_connection() as conn:
            exists = conn.execute("SELECT 1 FROM users WHERE email = %s", (email,)).fetchone()
            if exists:
                raise HTTPException(status_code=409, detail="Este e-mail já possui cadastro.")
            row = conn.execute(
                """INSERT INTO users (email, password_hash, display_name)
                   VALUES (%s, %s, %s)
                   RETURNING id::text AS id, email, display_name, created_at""",
                (email, password_hasher.hash(data.password), (data.display_name or "").strip() or None),
            ).fetchone()
            conn.execute("INSERT INTO credit_accounts (user_id, balance) VALUES (%s, 0)", (row["id"],))
        return {"access_token": create_token(row["id"], row["email"]), "token_type": "bearer", "user": row}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao cadastrar usuário")
        raise HTTPException(status_code=503, detail="Não foi possível concluir o cadastro. Verifique a conexão do banco.")


@app.post("/api/auth/login")
def login(data: Credentials):
    require_auth_config()
    email = normalize_email(data.email)
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT id::text AS id, email, display_name, password_hash, created_at FROM users WHERE email = %s",
                (email,),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
        try:
            password_hasher.verify(row["password_hash"], data.password)
        except (VerifyMismatchError, InvalidHashError):
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
        user = {k: row[k] for k in ("id", "email", "display_name", "created_at")}
        return {"access_token": create_token(row["id"], row["email"]), "token_type": "bearer", "user": user}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha no login")
        raise HTTPException(status_code=503, detail="Serviço de autenticação indisponível.")


@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"user": user}


@app.get("/api/credits")
def credits(user=Depends(current_user)):
    try:
        with get_connection() as conn:
            account = conn.execute(
                "SELECT balance FROM credit_accounts WHERE user_id = %s", (user["id"],)
            ).fetchone()
            ledger = conn.execute(
                """SELECT amount, reason, created_at FROM credit_ledger
                   WHERE user_id = %s ORDER BY created_at DESC LIMIT 20""",
                (user["id"],),
            ).fetchall()
        return {"balance": account["balance"] if account else 0, "history": ledger}
    except Exception:
        logger.exception("Falha ao consultar créditos")
        raise HTTPException(status_code=503, detail="Não foi possível consultar seus créditos.")


@app.post("/api/admin/credits")
def admin_add_credits(data: CreditAdjustment, x_admin_key: Optional[str] = Header(default=None)):
    admin_key = os.getenv("ADMIN_API_KEY", "")
    if not admin_key or not x_admin_key or not secrets.compare_digest(admin_key, x_admin_key):
        raise HTTPException(status_code=403, detail="Ação administrativa não autorizada.")
    email = normalize_email(data.email)
    try:
        with get_connection() as conn:
            user = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Usuário não encontrado.")
            conn.execute(
                """INSERT INTO credit_accounts (user_id, balance) VALUES (%s, %s)
                   ON CONFLICT (user_id) DO UPDATE
                   SET balance = credit_accounts.balance + EXCLUDED.balance,
                       updated_at = now()""",
                (user["id"], data.amount),
            )
            conn.execute(
                "INSERT INTO credit_ledger (user_id, amount, reason) VALUES (%s, %s, %s)",
                (user["id"], data.amount, data.reason),
            )
        return {"ok": True, "email": email, "credits_added": data.amount}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao adicionar créditos")
        raise HTTPException(status_code=503, detail="Não foi possível atualizar os créditos.")


async def inspect_image(upload: UploadFile):
    if upload.content_type not in MIME_TYPES:
        raise HTTPException(status_code=415, detail="Formato não permitido. Use JPG, PNG ou WebP.")
    raw = await upload.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Imagem excede o limite de {MAX_BYTES // (1024*1024)} MB.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        return {"filename": upload.filename, "format": image.format, "bytes": len(raw), "content": raw}
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="O arquivo enviado não é uma imagem válida.")


@app.post("/api/validate")
async def validate_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...)):
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    return {
        "ok": True,
        "source": {k: v for k, v in source.items() if k != "content"},
        "target": {k: v for k, v in target.items() if k != "content"},
        "message": "As duas imagens foram validadas. O motor de face swap ainda não está configurado.",
    }


@app.post("/api/transform")
async def transform_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...)):
    engine_status = engine.status()
    if not engine_status.configured:
        raise HTTPException(status_code=503, detail="O motor de transformação ainda não foi aprovado e configurado.")
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    try:
        await engine.transform(source["content"], target["content"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=501, detail="A entrega segura do resultado ainda não está habilitada.")


# Sinalização WebRTC para chamadas dentro da plataforma.
# As salas são temporárias e ficam na memória do processo; nenhum áudio/vídeo é gravado.
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from uuid import uuid4

_call_rooms = {}
_call_rooms_lock = asyncio.Lock()
_CALL_ROOM_TTL_SECONDS = 6 * 60 * 60

@app.post("/api/calls/rooms")
async def create_call_room():
    now = datetime.now(timezone.utc).timestamp()
    async with _call_rooms_lock:
        expired = [key for key, room in _call_rooms.items() if now - room["created_at"] > _CALL_ROOM_TTL_SECONDS and not room["clients"]]
        for key in expired:
            _call_rooms.pop(key, None)
        room_id = secrets.token_urlsafe(18)
        _call_rooms[room_id] = {"created_at": now, "clients": {}}
    return {"room_id": room_id, "join_url": None, "expires_in_seconds": _CALL_ROOM_TTL_SECONDS}

@app.websocket("/ws/calls/{room_id}")
async def call_signaling(websocket: WebSocket, room_id: str):
    await websocket.accept()
    client_id = str(uuid4())
    async with _call_rooms_lock:
        room = _call_rooms.get(room_id)
        if room is None or len(room["clients"]) >= 2:
            await websocket.send_json({"type": "room-error", "message": "Sala inexistente ou cheia. Crie uma nova sala."})
            await websocket.close(code=1008)
            return
        peers = list(room["clients"].keys())
        room["clients"][client_id] = websocket
    await websocket.send_json({"type": "joined", "client_id": client_id, "peers": peers})
    for peer_id in peers:
        try:
            await room["clients"][peer_id].send_json({"type": "peer-joined", "peer_id": client_id})
        except Exception:
            pass
    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            if kind not in {"offer", "answer", "ice-candidate", "hangup"}:
                continue
            target = message.get("to")
            async with _call_rooms_lock:
                current = _call_rooms.get(room_id, {}).get("clients", {})
                destinations = [current[target]] if target in current else [ws for pid, ws in current.items() if pid != client_id]
            payload = {"type": kind, "from": client_id, "payload": message.get("payload")}
            for destination in destinations:
                try:
                    await destination.send_json(payload)
                except Exception:
                    pass
            if kind == "hangup":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Erro na sinalização da chamada")
    finally:
        async with _call_rooms_lock:
            room = _call_rooms.get(room_id)
            if room:
                room["clients"].pop(client_id, None)
                remaining = list(room["clients"].values())
            else:
                remaining = []
        for peer in remaining:
            try:
                await peer.send_json({"type": "peer-left", "peer_id": client_id})
            except Exception:
                pass
