import json
import tempfile
from pathlib import Path
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from spatial_analyzer import analyze

app = FastAPI(title="Rebar Planner Python Analyzer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health():
    return {"ok": True, "service": "rebar-planner-python-analyzer"}

@app.get("/health")
def health2():
    return {"ok": True}

@app.post("/analyze")
async def analyze_plan(blueprint: UploadFile = File(...)):
    suffix = Path(blueprint.filename or "upload.pdf").suffix or ".pdf"
    with tempfile.TemporaryDirectory(prefix="rebar_analyzer_") as tmp:
        target = Path(tmp) / ("upload" + suffix)
        target.write_bytes(await blueprint.read())
        try:
            result = analyze(str(target))
            result["backend"] = "fastapi-python"
            result["uploadedFile"] = {
                "name": blueprint.filename,
                "contentType": blueprint.content_type,
            }
            return JSONResponse(result)
        except Exception as exc:
            return JSONResponse({"success": False, "error": str(exc), "backend": "fastapi-python"}, status_code=500)
