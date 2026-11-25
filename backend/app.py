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
app = FastAPI(title="FaceMagic AI API", version="0.3.0")
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
JWT_SECRET = os.getenv("JWT_SECRET", "")
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
    if os.getenv("DATABASE_URL"):
        try:
            initialize_database()
            logger.info("Schema PostgreSQL verificado.")
        except Exception:
            logger.exception("Banco configurado, mas não foi possível inicializar o schema.")


@app.get("/")
def root():
    return {"name": "FaceMagic AI API", "status": "online", "version": "0.3.0"}


@app.get("/api/health")
def health():
    status = engine.status()
    return {
        "ok": True,
        "service": "facemagic-api",
        "version": "0.3.0",
        "database": "connected" if db_ready() else "not_configured_or_unavailable",
        "face_swap_engine": "ready" if status.configured else "not_configured",
    }


@app.get("/api/capabilities")
def capabilities():
    status = engine.status()
    database = db_ready()
    return {
        "image_upload": True,
        "image_validation": True,
        "image_face_swap": status.configured,
        "video_processing": False,
        "virtual_camera": False,
        "accounts": database and bool(JWT_SECRET),
        "credits": database and bool(JWT_SECRET),
        "database": database,
        "message": status.reason,
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
        "message": "As duas imagens passaram na validação. O motor de face swap ainda não está configurado.",
    }


@app.post("/api/transform")
async def transform_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...)):
    status = engine.status()
    if not status.configured:
        raise HTTPException(status_code=503, detail="O motor de transformação ainda não foi aprovado e configurado.")
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    try:
        await engine.transform(source["content"], target["content"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=501, detail="A entrega segura do resultado ainda não está habilitada.")
