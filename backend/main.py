"""
FastAPI Application Entrypoint
Serves static frontend assets, REST endpoints, and manages the background ADB watcher.
"""

from __future__ import annotations
from contextlib import asynccontextmanager
import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api_routes import router as api_router
from backend.watcher import watcher

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: trigger watcher background thread
    try:
        watcher.start()
    except Exception as e:
        print(f"[WATCHER ERROR] Could not start watcher: {e}")

    # Rule 3: Fire HF model warm-up ping in background
    try:
        import asyncio
        from backend.device_profiler import warmup_hf_model
        asyncio.create_task(warmup_hf_model())
    except Exception as e:
        print(f"[WARMUP NOTE] Could not launch warm-up task: {e}")

    yield
    # Shutdown
    try:
        watcher.stop()
    except Exception as e:
        print(f"[WATCHER ERROR] Could not stop watcher: {e}")


app = FastAPI(
    title="Ion+",
    description="Ion+ Local, ADB-powered battery health and degradation analysis",
    version="2.4.0",
    lifespan=lifespan,
)

# Enable CORS for local API access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API
app.include_router(api_router)

# Mount Static Assets
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def read_root():
    """Serves the primary dashboard."""
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return {"message": "Frontend index.html not yet built"}


@app.get("/history")
def read_history():
    """Serves the dedicated history view."""
    history_file = os.path.join(FRONTEND_DIR, "history.html")
    if os.path.isfile(history_file):
        return FileResponse(history_file)
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    return FileResponse(index_file)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
