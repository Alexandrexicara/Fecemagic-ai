import io
import os
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

app = FastAPI(title="FaceMagic AI API", version="0.1.0")
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "12")) * 1024 * 1024
MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

@app.get("/")
def root():
    return {"name": "FaceMagic AI API", "status": "online", "version": "0.1.0"}

@app.get("/api/health")
def health():
    return {"ok": True, "service": "facemagic-api", "face_swap_engine": "not_configured"}

async def inspect_image(upload: UploadFile):
    if upload.content_type not in MIME_TYPES:
        raise HTTPException(status_code=415, detail="Formato não permitido. Use JPG, PNG ou WebP.")
    raw = await upload.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Imagem excede o limite de {MAX_BYTES // (1024*1024)} MB.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        return {"filename": upload.filename, "format": image.format, "bytes": len(raw)}
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="O arquivo enviado não é uma imagem válida.")

@app.post("/api/validate")
async def validate_images(source_image: UploadFile = File(...), target_image: UploadFile = File(...)):
    source = await inspect_image(source_image)
    target = await inspect_image(target_image)
    return {
        "ok": True,
        "source": source,
        "target": target,
        "message": "As duas imagens passaram na validação. O motor de face swap ainda não está configurado."
    }
