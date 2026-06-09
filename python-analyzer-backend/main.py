import os
import tempfile
from pathlib import Path
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from spatial_analyzer import analyze, analyze_region

app = FastAPI(title="Rebar Planner Python Analyzer", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://rebar-planner.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health():
    return {"ok": True, "service": "rebar-planner-python-analyzer"}

@app.get("/health")
def health2():
    return {"ok": True}

async def save_upload(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "upload.pdf").suffix or ".pdf"
    fd, path = tempfile.mkstemp(prefix="rebar_upload_", suffix=suffix)
    os.close(fd)
    with open(path, "wb") as f:
        f.write(await upload.read())
    return path

@app.post("/analyze")
async def analyze_plan(blueprint: UploadFile = File(...)):
    path = ""
    try:
        path = await save_upload(blueprint)
        return analyze(path)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass

@app.post("/analyze-region")
async def analyze_selected_region(
    blueprint: UploadFile = File(...),
    page: int = Form(...),
    x0: float = Form(...),
    y0: float = Form(...),
    x1: float = Form(...),
    y1: float = Form(...),
):
    path = ""
    try:
        path = await save_upload(blueprint)
        return analyze_region(path, page=page, x0=x0, y0=y0, x1=x1, y1=y1)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass
