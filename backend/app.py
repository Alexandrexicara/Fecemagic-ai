import io
import os
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from engine import engine

app = FastAPI(title="FaceMagic AI API", version="0.2.0")
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "12")) * 1024 * 1024
MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

@app.get("/")
def root():
    return {"name": "FaceMagic AI API", "status": "online", "version": "0.2.0"}

@app.get("/api/health")
def health():
    status = engine.status()
    return {"ok": True, "service": "facemagic-api", "version": "0.2.0",
            "face_swap_engine": "ready" if status.configured else "not_configured"}

@app.get("/api/capabilities")
def capabilities():
    status = engine.status()
    return {
        "image_upload": True,
        "image_validation": True,
        "image_face_swap": status.configured,
        "video_processing": False,
        "virtual_camera": False,
        "accounts": False,
        "credits": False,
        "message": status.reason
    }

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
        "source": {k:v for k,v in source.items() if k != "content"},
        "target": {k:v for k,v in target.items() if k != "content"},
        "message": "As duas imagens passaram na validação. O motor de face swap ainda não está configurado."
    }

@app.post("/api/transform")
async def transform_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...)):
    status = engine.status()
    if not status.configured:
        raise HTTPException(status_code=503, detail="O motor de transformação ainda não foi aprovado e configurado.")
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    try:
        result = await engine.transform(source["content"], target["content"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    # A entrega de resultados será ativada junto com armazenamento privado e URLs temporárias.
    raise HTTPException(status_code=501, detail="Motor respondeu, mas a entrega segura do resultado ainda não está habilitada.")
