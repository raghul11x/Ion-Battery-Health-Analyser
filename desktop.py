"""
Desktop Application Launcher (PyWebview + FastAPI)
Spins up the FastAPI backend in a daemon thread and presents the native desktop window.
"""

from __future__ import annotations
import argparse
import os
import sys
import threading
import time
import urllib.request
import uvicorn
import webview

from backend.main import app

# Ensure streams exist even in windowless execution (pythonw.exe)
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

PORT = 8765
HOST = "127.0.0.1"
BASE_URL = f"http://{HOST}:{PORT}"

# Dynamic asset path discovery for frozen executable
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))

ICON_PATH = os.path.join(BASE_DIR, "frontend", "static", "assets", "favicon.ico")


def run_server():
    """Runs uvicorn in-process."""
    try:
        config = uvicorn.Config(
            app=app,
            host=HOST,
            port=PORT,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception:
        pass


def is_server_ready() -> bool:
    """Checks if FastAPI local server is answering HTTP requests."""
    try:
        with urllib.request.urlopen(f"{BASE_URL}/api/status", timeout=0.5) as response:
            return response.status == 200
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Ion+ Battery Health Analyzer Desktop")
    parser.add_argument("--browser", action="store_true", help="Launch in default web browser instead of PyWebview window")
    parser.add_argument("--port", type=int, default=PORT, help="Port to bind FastAPI server")
    parser.add_argument("--no-splash", action="store_true", help="Disable startup splash screen")
    args = parser.parse_args()

    # 1. Initialize Adobe-Style Loading Splash Screen
    splash = None
    if not args.no_splash and not args.browser:
        try:
            from splash import AdobeSplashScreen
            splash = AdobeSplashScreen()
            splash.update_progress(10, "Initializing application environment...")
        except Exception as e:
            splash = None

    # 2. Start FastAPI in background daemon thread
    if splash:
        splash.update_progress(25, "Loading IEC 61960 battery degradation models...")

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 3. Poll for server readiness while animating splash
    start_wait = time.time()
    ready = False
    step = 0
    statuses = [
        (35, "Connecting local SQLite telemetry archive..."),
        (55, "Scanning ADB USB hardware interfaces..."),
        (75, "Starting local REST API services..."),
        (88, "Initializing EURA user interface..."),
    ]

    while time.time() - start_wait < 12.0:
        if is_server_ready():
            ready = True
            break
        if splash and step < len(statuses):
            pct, msg = statuses[step]
            splash.update_progress(pct, msg)
            step += 1
        time.sleep(0.18)

    if not ready:
        if splash:
            splash.close()
        print("[ERROR] Timed out waiting for FastAPI to boot.")
        sys.exit(1)

    # 4. Finalize Splash Screen Transition
    if splash:
        splash.update_progress(100, "Ready.")
        time.sleep(0.15)
        splash.close()
        splash = None

    # 5. Launch UI (Browser or Native EdgeChromium Window)
    if args.browser:
        import webbrowser
        webbrowser.open(BASE_URL)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)
    else:
        # Launch native PyWebview window
        window = webview.create_window(
            title="Ion+",
            url=BASE_URL,
            width=1220,
            height=820,
            min_size=(980, 660),
            background_color="#0B0B10",
            text_select=False,
        )

        # Start native desktop window loop
        webview.start(
            gui="edgechromium",
            debug=False,
            icon=ICON_PATH if os.path.isfile(ICON_PATH) else None,
        )
        # Cleanly terminate all background threads and watcher
        os._exit(0)


if __name__ == "__main__":
    main()
