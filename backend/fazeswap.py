"""FazeSwap API adapter for FaceMagic AI. API credentials stay on the backend."""
import http.client
import json
import os
import re
import secrets
import urllib.error
import urllib.request
from urllib.parse import quote
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

BASE = "https://api.fazeswap.com/api/v1"
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "application/octet-stream"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIDEO_BYTES = 500 * 1024 * 1024

def _api_key():
    key = os.getenv("FAZESWAP_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="O mecanismo de transformação ainda não está configurado no servidor.")
    return key

def _provider_error(status, body):
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        data = {}
    error_value = data.get("error")
    nested_code = error_value.get("code") if isinstance(error_value, dict) else (error_value if isinstance(error_value, str) else "")
    code = str(data.get("code") or nested_code or "")
    if status == 401 or code == "unauthorized":
        return HTTPException(status_code=502, detail="A credencial do mecanismo de IA não foi aceita. Verifique a configuração privada do servidor.")
    if status == 402 or code == "insufficient_balance":
        return HTTPException(status_code=402, detail="Saldo de processamento insuficiente. Consulte o painel administrativo antes de continuar.")
    if status == 429:
        return HTTPException(status_code=429, detail="Muitas solicitações em pouco tempo. Aguarde e tente novamente.")
    return HTTPException(status_code=502, detail=str(data.get("message") or data.get("detail") or "O mecanismo de transformação não conseguiu concluir a solicitação.")[:300])

def _request(method, path, payload=None, auth=True):
    headers = {"Accept": "application/json"}
    data = None
    if auth:
        headers["Authorization"] = "Bearer " + _api_key()
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        raise _provider_error(exc.code, exc.read())
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Não foi possível conectar ao mecanismo de transformação.")

def _upload(upload: UploadFile, allowed_types, max_bytes):
    content_type = (upload.content_type or "application/octet-stream").split(";")[0].lower()
    if content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Formato de arquivo não aceito para esta operação.")
    file_obj = upload.file
    file_obj.seek(0, 2)
    size = file_obj.tell()
    file_obj.seek(0)
    if size <= 0 or size > max_bytes:
        raise HTTPException(status_code=413, detail="O arquivo está vazio ou ultrapassa o limite permitido.")
    filename = re.sub(r'[^A-Za-z0-9._-]', '_', upload.filename or "upload.bin")[:120]
    boundary = "----FaceMagic" + secrets.token_hex(16)
    prefix = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n").encode("utf-8")
    suffix = f"\r\n--{boundary}--\r\n".encode("utf-8")
    conn = http.client.HTTPSConnection("api.fazeswap.com", timeout=240)
    try:
        conn.putrequest("POST", "/api/v1/uploads")
        conn.putheader("Authorization", "Bearer " + _api_key())
        conn.putheader("Accept", "application/json")
        conn.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
        conn.putheader("Content-Length", str(len(prefix) + size + len(suffix)))
        conn.endheaders()
        conn.send(prefix)
        while True:
            chunk = file_obj.read(1024 * 1024)
            if not chunk:
                break
            conn.send(chunk)
        conn.send(suffix)
        response = conn.getresponse()
        raw = response.read()
        if response.status < 200 or response.status >= 300:
            raise _provider_error(response.status, raw)
        result = json.loads(raw.decode("utf-8"))
        if not result.get("file_key"):
            raise HTTPException(status_code=502, detail="O mecanismo não retornou a referência do arquivo enviado.")
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Falha ao enviar o arquivo para processamento.")
    finally:
        conn.close()
        file_obj.seek(0)

def create_fazeswap_router(current_user, require_approved):
    router = APIRouter(prefix="/api/engine", tags=["FaceMagic AI Engine"])

    @router.get("/account")
    def account(user=Depends(current_user)):
        require_approved(user)
        return {"ok": True, "balance": _request("GET", "/balance"), "pricing": _request("GET", "/pricing", auth=False)}

    @router.post("/image")
    def swap_image(source_image: UploadFile = File(...), target_image: UploadFile = File(...), user=Depends(current_user)):
        require_approved(user)
        face = _upload(source_image, IMAGE_TYPES, MAX_IMAGE_BYTES)
        base = _upload(target_image, IMAGE_TYPES, MAX_IMAGE_BYTES)
        job = _request("POST", "/face-swap-image", {"image_key": base["file_key"], "face_key": face["file_key"]})
        return {"ok": True, "job_id": job.get("id"), "status": job.get("status", "queued")}

    @router.post("/video")
    def swap_video(recorded_video: UploadFile = File(...), face_image: UploadFile = File(...), user=Depends(current_user)):
        require_approved(user)
        face = _upload(face_image, IMAGE_TYPES, MAX_IMAGE_BYTES)
        video = _upload(recorded_video, VIDEO_TYPES, MAX_VIDEO_BYTES)
        job = _request("POST", "/face-swap", {"video_key": video["file_key"], "face_key": face["file_key"], "output_resolution_p": 720})
        return {"ok": True, "job_id": job.get("id"), "status": job.get("status", "queued")}

    @router.get("/jobs/{job_id}")
    def job_status(job_id: str, user=Depends(current_user)):
        require_approved(user)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id):
            raise HTTPException(status_code=400, detail="Identificador de processamento inválido.")
        result = _request("GET", "/jobs/" + quote(job_id, safe=""))
        return {"ok": True, "id": result.get("id"), "status": result.get("status"), "output_url": result.get("output_url"), "charged_usd": result.get("charged_usd"), "error": result.get("error")}

    @router.post("/live-session")
    def create_live_session(face_image: UploadFile = File(...), duration_minutes: int = Form(1, ge=1, le=10), user=Depends(current_user)):
        require_approved(user)
        face = _upload(face_image, IMAGE_TYPES, MAX_IMAGE_BYTES)
        session = _request("POST", "/full-live-swap/session", {"duration_minutes": duration_minutes})
        if not session.get("session") or not session.get("session_id") or not session.get("sdk_url"):
            raise HTTPException(status_code=502, detail="O mecanismo não retornou os dados necessários para iniciar a transformação ao vivo.")
        image_url = face.get("url")
        if not image_url or not str(image_url).startswith("https://"):
            raise HTTPException(status_code=502, detail="O mecanismo não retornou uma imagem de referência válida.")
        return {"ok": True, "session_id": session["session_id"], "session": session["session"], "sdk_url": session["sdk_url"], "prompt": session.get("prompt", ""), "reference_image_url": image_url, "max_duration_sec": session.get("max_duration_sec"), "max_cost_usd": session.get("max_cost_usd")}

    @router.post("/live-session/{session_id}/stop")
    def stop_live_session(session_id: str, user=Depends(current_user)):
        require_approved(user)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id):
            raise HTTPException(status_code=400, detail="Identificador de sessão inválido.")
        result = _request("POST", "/full-live-swap/" + quote(session_id, safe="") + "/stop")
        return {"ok": True, "result": result}

    return router
