import io
import logging
import os
import re
import secrets
import json
import urllib.request
import urllib.error
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
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "santossilvac992@gmail.com").strip().lower()
password_hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=80)


class PaymentChoice(BaseModel):
    method: str = Field(pattern="^(pix|sumup_card)$")
    proof_reference: Optional[str] = Field(default=None, max_length=1000)


class AdminDecision(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    action: str = Field(pattern="^(approve|reject|confirm_pix|mark_unpaid)$")
    note: Optional[str] = Field(default=None, max_length=300)


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    return email


def require_auth_config():
    if not JWT_SECRET:
        raise HTTPException(status_code=503, detail="Autenticação ainda não configurada no servidor (JWT_SECRET).")


def require_approved(user):
    if user.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="Seu acesso está aguardando liberação.")


def admin_authorized(x_admin_key):
    admin_key = os.getenv("ADMIN_API_KEY", "").strip()
    if not admin_key or not x_admin_key or not secrets.compare_digest(admin_key, x_admin_key):
        raise HTTPException(status_code=403, detail="Ação administrativa não autorizada.")


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
                "SELECT id::text AS id, email, display_name, role, created_at, approval_status, payment_status, payment_method FROM users WHERE id = %s",
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
        "approval_required": True,
        "payment_methods": ["pix", "sumup_card"],
        "face_swap_engine": "fazeswap_api_configured" if os.getenv("FAZESWAP_API_KEY", "").strip() else ("ready" if engine_status.configured else "not_configured"),
        "fazeswap_api_configured": bool(os.getenv("FAZESWAP_API_KEY", "").strip()),
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
        "image_face_swap": bool(os.getenv("FAZESWAP_API_KEY", "").strip()) or engine_status.configured,
        "recorded_video_upload": True,
        "video_processing": bool(os.getenv("FAZESWAP_API_KEY", "").strip()),
        "in_platform_calls": True,
        "call_signaling": "websocket_ephemeral_single_instance",
        "live_camera_preview": True,
        "live_face_swap": bool(os.getenv("FAZESWAP_API_KEY", "").strip()),
        "fazeswap_api_configured": bool(os.getenv("FAZESWAP_API_KEY", "").strip()),
        "virtual_camera": False,
        "accounts": database and auth_ready,
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
            is_admin = email == ADMIN_EMAIL
            row = conn.execute(
                """INSERT INTO users (email, password_hash, display_name, role, approval_status, payment_status, approved_at, approved_by)
                   VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() ELSE NULL END, CASE WHEN %s THEN 'system_admin_email' ELSE NULL END)
                   RETURNING id::text AS id, email, display_name, role, created_at, approval_status, payment_status""",
                (email, password_hasher.hash(data.password), (data.display_name or "").strip() or None,
                 "admin" if is_admin else "user", "approved" if is_admin else "pending",
                 "manual_comped" if is_admin else "unpaid", is_admin, is_admin),
            ).fetchone()
        return {"ok": True, "status": "approved" if is_admin else "pending_approval", "access_token": create_token(row["id"], row["email"]), "token_type": "bearer", "user": row, "message": "Conta administrativa liberada." if is_admin else "Cadastro recebido. Escolha a forma de pagamento e aguarde a aprovação do acesso."}
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
                "SELECT id::text AS id, email, display_name, role, password_hash, created_at, approval_status, payment_status, payment_method FROM users WHERE email = %s",
                (email,),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
        try:
            password_hasher.verify(row["password_hash"], data.password)
        except (VerifyMismatchError, InvalidHashError):
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
        if row["email"].lower() == ADMIN_EMAIL and row["role"] != "admin":
            with get_connection() as conn:
                conn.execute("""UPDATE users SET role='admin', approval_status='approved',
                    payment_status='manual_comped', approved_at=COALESCE(approved_at, now()),
                    approved_by='system_admin_email', updated_at=now() WHERE id=%s""", (row["id"],))
            row["role"], row["approval_status"], row["payment_status"] = "admin", "approved", "manual_comped"
        if row["approval_status"] == "rejected":
            raise HTTPException(status_code=403, detail="Seu cadastro não foi aprovado. Entre em contato com o suporte.")
        user = {k: row[k] for k in ("id", "email", "display_name", "role", "created_at", "approval_status", "payment_status", "payment_method")}
        return {"access_token": create_token(row["id"], row["email"]), "token_type": "bearer", "user": user}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha no login")
        raise HTTPException(status_code=503, detail="Serviço de autenticação indisponível.")


@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"user": user}


@app.post("/api/payments/select")
def select_payment(data: PaymentChoice, user=Depends(current_user)):
    """Registra escolha de Pix ou cartão. O Pix aguarda comprovante e validação manual."""
    try:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO payment_requests (user_id, method, status, proof_reference) VALUES (%s, %s, 'pending', %s)",
                (user["id"], data.method, data.proof_reference),
            )
            conn.execute(
                "UPDATE users SET payment_status='pending', payment_method=%s, updated_at=now() WHERE id=%s",
                (data.method, user["id"]),
            )
        if data.method == "sumup_card":
            return {"ok": True, "method": "sumup_card", "status": "pending", "message": "Cartão SumUp selecionado. Toque em continuar para abrir o checkout seguro."}
        return {"ok": True, "method": "pix", "status": "pending", "pix_key": os.getenv("FACEMAGIC_PIX_KEY", "").strip() or None, "amount": payment_amount(), "message": "Pix selecionado. Envie o comprovante ao responsável e aguarde a confirmação manual."}
    except Exception:
        logger.exception("Falha ao registrar forma de pagamento")
        raise HTTPException(status_code=503, detail="Não foi possível registrar a forma de pagamento.")





def payment_amount():
    raw = (os.getenv("FACEMAGIC_PRICE_BRL") or os.getenv("SUMUP_AMOUNT_BRL") or "4000.00").strip()
    try:
        amount = float(raw.replace(",", "."))
        return amount if amount > 0 else None
    except (TypeError, ValueError):
        return None


SUMUP_MERCHANT_CACHE = ""


def sumup_credentials():
    token = (os.getenv("SUMUP_API_KEY") or os.getenv("SUMUP_ACCESS_TOKEN") or "").strip()
    merchant = (os.getenv("SUMUP_MERCHANT_CODE") or os.getenv("SUMUP_MERCHANT_ID") or "").strip()
    return token, merchant


def resolve_sumup_merchant(token):
    global SUMUP_MERCHANT_CACHE
    if SUMUP_MERCHANT_CACHE:
        return SUMUP_MERCHANT_CACHE
    if not token:
        return ""

    def get_json(path):
        request = urllib.request.Request(
            "https://api.sumup.com" + path,
            method="GET",
            headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            logger.info("SumUp merchant discovery returned HTTP %s", exc.code)
            return {}
        except Exception:
            logger.info("SumUp merchant discovery request failed")
            return {}

    # Older API profile endpoint can return the merchant code directly.
    profile = get_json("/v0.1/me")
    merchant = str(profile.get("merchant_code") or profile.get("merchantCode") or "").strip()
    if merchant:
        SUMUP_MERCHANT_CACHE = merchant
        return merchant

    # Current API supports listing accepted merchant memberships for API keys.
    memberships = get_json("/v0.1/memberships?kind=merchant&status=accepted&limit=25")
    items = memberships.get("items") or []
    codes = []
    for item in items:
        resource = item.get("resource") or {}
        code = str(resource.get("id") or "").strip()
        if code and code not in codes:
            codes.append(code)
    if len(codes) == 1:
        SUMUP_MERCHANT_CACHE = codes[0]
        return codes[0]
    if len(codes) > 1:
        logger.warning("SumUp API key has multiple merchant memberships; explicit merchant code required.")
    return ""


def sumup_request(method, path, body=None):
    token, _ = sumup_credentials()
    if not token:
        raise HTTPException(status_code=503, detail="Credencial do SumUp não configurada no Render.")
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        "https://api.sumup.com" + path,
        data=payload,
        method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.error("SumUp HTTP %s ao processar checkout", exc.code)
        raise HTTPException(status_code=502, detail="O SumUp não aceitou a solicitação. Verifique a configuração da conta de pagamentos.")
    except Exception:
        logger.exception("Falha de comunicação com SumUp")
        raise HTTPException(status_code=502, detail="Não foi possível conectar ao SumUp.")


@app.post("/api/payments/sumup/create")
def create_sumup_checkout(user=Depends(current_user)):
    amount = payment_amount()
    token, merchant = sumup_credentials()
    merchant = merchant or resolve_sumup_merchant(token)
    if not amount:
        raise HTTPException(status_code=503, detail="Defina FACEMAGIC_PRICE_BRL no Render antes de iniciar o checkout.")
    if not token or not merchant:
        raise HTTPException(status_code=503, detail="Configure SUMUP_API_KEY e SUMUP_MERCHANT_CODE no Render.")
    try:
        with get_connection() as conn:
            payment = conn.execute(
                """INSERT INTO payment_requests (user_id, method, status)
                   VALUES (%s, 'sumup_card', 'pending') RETURNING id::text AS id""",
                (user["id"],),
            ).fetchone()
            conn.execute("UPDATE users SET payment_status='pending', payment_method='sumup_card', updated_at=now() WHERE id=%s", (user["id"],))
        reference = "facemagic-" + payment["id"]
        frontend = (os.getenv("FRONTEND_URL") or "https://fecemagic-ai.netlify.app").rstrip("/")
        checkout = sumup_request("POST", "/v0.1/checkouts", {
            "checkout_reference": reference,
            "amount": amount,
            "currency": "BRL",
            "merchant_code": merchant,
            "description": "FaceMagic AI - acesso",
            "hosted_checkout": {"enabled": True},
            "redirect_url": frontend + "/?payment=return",
            "return_url": (os.getenv("PUBLIC_API_URL") or "https://fecemagic-ai.onrender.com").rstrip("/") + "/api/payments/sumup/webhook",
        })
        checkout_id = checkout.get("id")
        checkout_url = checkout.get("hosted_checkout_url")
        if not checkout_id or not checkout_url:
            raise HTTPException(status_code=502, detail="SumUp não retornou o link seguro de pagamento.")
        with get_connection() as conn:
            conn.execute("UPDATE payment_requests SET provider_reference=%s, updated_at=now() WHERE id=%s", (checkout_id, payment["id"]))
        return {"ok": True, "checkout_url": checkout_url, "checkout_id": checkout_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao criar checkout SumUp")
        raise HTTPException(status_code=503, detail="Não foi possível iniciar o pagamento.")


@app.post("/api/payments/sumup/webhook")
async def sumup_webhook(payload: dict):
    checkout_id = str(payload.get("id") or payload.get("checkout_id") or "").strip()
    if not checkout_id:
        raise HTTPException(status_code=400, detail="Checkout id ausente.")
    checkout = sumup_request("GET", "/v0.1/checkouts/" + checkout_id)
    transactions = checkout.get("transactions") or []
    paid = str(checkout.get("status", "")).upper() == "PAID" or any(
        str(tx.get("status", "")).upper() == "SUCCESSFUL" for tx in transactions
    )
    if not paid:
        return {"ok": True, "verified": True, "status": checkout.get("status", "PENDING")}
    with get_connection() as conn:
        payment = conn.execute(
            "SELECT user_id FROM payment_requests WHERE provider_reference=%s AND method='sumup_card'",
            (checkout_id,),
        ).fetchone()
        if not payment:
            return {"ok": True, "verified": True, "matched": False}
        conn.execute("UPDATE payment_requests SET status='paid', updated_at=now() WHERE provider_reference=%s", (checkout_id,))
        conn.execute(
            """UPDATE users SET payment_status='paid', approval_status='approved',
               approved_at=COALESCE(approved_at, now()), approved_by='sumup_verified',
               updated_at=now() WHERE id=%s""", (payment["user_id"],)
        )
    return {"ok": True, "verified": True, "status": "PAID"}


@app.get("/api/payments/config")
def payment_config():
    token, merchant = sumup_credentials()
    merchant = merchant or resolve_sumup_merchant(token)
    amount = payment_amount()
    return {
        "amount": amount,
        "currency": "BRL",
        "pix_key": os.getenv("FACEMAGIC_PIX_KEY", "").strip() or None,
        "sumup_token_configured": bool(token),
        "sumup_merchant_configured": bool(merchant),
        "sumup_amount_configured": bool(amount),
        "sumup_ready": bool(token and merchant and amount),
        "sumup_merchant_code": merchant or None,
    }


@app.get("/api/admin/registrations")
def admin_registrations(x_admin_key: Optional[str] = Header(default=None)):
    admin_authorized(x_admin_key)
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT email, display_name, approval_status, payment_status, payment_method,
                          created_at, approved_at, approved_by
                   FROM users ORDER BY created_at DESC LIMIT 500"""
            ).fetchall()
            counts = conn.execute(
                """SELECT count(*) AS total,
                          count(*) FILTER (WHERE approval_status='pending') AS pending_approval,
                          count(*) FILTER (WHERE payment_status='pending') AS pending_payment,
                          count(*) FILTER (WHERE payment_status='paid') AS paid
                   FROM users"""
            ).fetchone()
        return {"registrations": rows, "counts": counts}
    except Exception:
        logger.exception("Falha ao consultar cadastros")
        raise HTTPException(status_code=503, detail="Não foi possível consultar os cadastros.")


@app.post("/api/admin/registration-decision")
def admin_registration_decision(data: AdminDecision, x_admin_key: Optional[str] = Header(default=None)):
    admin_authorized(x_admin_key)
    email = normalize_email(data.email)
    try:
        with get_connection() as conn:
            user = conn.execute("SELECT id, approval_status, payment_status FROM users WHERE email=%s", (email,)).fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
            if data.action == "approve":
                conn.execute(
                    """UPDATE users SET approval_status='approved', approved_at=now(), approved_by=%s,
                       updated_at=now() WHERE id=%s""",
                    (os.getenv("ADMIN_DISPLAY_NAME", "admin"), user["id"]),
                )
            elif data.action == "reject":
                conn.execute("UPDATE users SET approval_status='rejected', updated_at=now() WHERE id=%s", (user["id"],))
            elif data.action == "confirm_pix":
                conn.execute(
                    """UPDATE users SET payment_status='paid', payment_method='pix', updated_at=now()
                       WHERE id=%s""", (user["id"],)
                )
                conn.execute(
                    """UPDATE payment_requests SET status='paid', updated_at=now()
                       WHERE user_id=%s AND method='pix' AND status='pending'""", (user["id"],)
                )
            elif data.action == "mark_unpaid":
                conn.execute("UPDATE users SET payment_status='unpaid', updated_at=now() WHERE id=%s", (user["id"],))
        return {"ok": True, "email": email, "action": data.action, "approval_status": "approved" if data.action == "approve" else ("rejected" if data.action == "reject" else user["approval_status"]), "payment_status": "paid" if data.action == "confirm_pix" else ("unpaid" if data.action == "mark_unpaid" else user["payment_status"])}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao atualizar cadastro")
        raise HTTPException(status_code=503, detail="Não foi possível atualizar o cadastro.")


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
async def validate_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...), user=Depends(current_user)):
    require_approved(user)
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    return {
        "ok": True,
        "source": {k: v for k, v in source.items() if k != "content"},
        "target": {k: v for k, v in target.items() if k != "content"},
        "message": "As duas imagens foram validadas. O motor de face swap ainda não está configurado.",
    }


@app.post("/api/transform")
async def transform_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...), user=Depends(current_user)):
    require_approved(user)
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
async def create_call_room(user=Depends(current_user)):
    require_approved(user)
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
    require_auth_config()
    token = websocket.query_params.get("token", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        with get_connection() as conn:
            authorized = conn.execute(
                "SELECT approval_status FROM users WHERE id=%s", (user_id,)
            ).fetchone()
        if not authorized or authorized["approval_status"] != "approved":
            raise ValueError("account not approved")
    except Exception:
        await websocket.close(code=1008)
        return
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


# Integração FazeSwap: a chave da API permanece exclusivamente no backend.
from fazeswap import create_fazeswap_router
app.include_router(create_fazeswap_router(current_user, require_approved))
