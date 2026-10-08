"""
Desktop Application Launcher (PyWebview + FastAPI)
Spins up the FastAPI backend in a daemon thread and presents the native desktop window.
"""

from __future__ import annotations
import argparse
import ctypes
import json
import os
import socket
import sys
import threading
import time
import urllib.request
import uvicorn
import webview

from backend.main import app

# Ensure streams exist even in windowless execution (pythonw.exe / PyInstaller)
if sys.stdin is None:
    sys.stdin = open(os.devnull, "r", encoding="utf-8")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

DEFAULT_PORT = 8765
HOST = "127.0.0.1"
PORT = DEFAULT_PORT
BASE_URL = f"http://{HOST}:{PORT}"


def is_port_in_use(port: int, host: str = HOST) -> bool:
    """Returns True if the port is currently bound by another socket."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True


def is_ion_server(port: int, host: str = HOST) -> bool:
    """Checks if the port is actively serving the Ion+ FastAPI backend."""
    try:
        req = urllib.request.Request(
            f"http://{host}:{port}/api/status",
            headers={"User-Agent": "Ion-Desktop-Client"},
        )
        with urllib.request.urlopen(req, timeout=0.6) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                return isinstance(data, dict) and "watcher_status" in data and "adb_available" in data
    except Exception:
        pass
    return False


def find_available_port(preferred_port: int = DEFAULT_PORT, host: str = HOST, max_scan: int = 50) -> tuple[int, bool]:
    """
    Finds a TCP port for FastAPI.
    Returns (port, is_existing_ion_instance).
    
    1. If preferred_port already hosts Ion+, reuse it directly.
    2. If preferred_port is completely free, allocate it.
    3. If preferred_port is occupied by another application, scan consecutive ports.
    4. Falls back to OS-assigned ephemeral port if range is exhausted.
    """
    # 1. Check if preferred port is already running an active Ion+ backend
    if is_ion_server(preferred_port, host):
        return preferred_port, True

    # 2. If preferred port is available, use it
    if not is_port_in_use(preferred_port, host):
        return preferred_port, False

    # 3. Port conflict with third-party service: scan sequential candidates
    for offset in range(1, max_scan + 1):
        candidate = preferred_port + offset
        if is_ion_server(candidate, host):
            return candidate, True
        if not is_port_in_use(candidate, host):
            return candidate, False

    # 4. Fallback: OS ephemeral allocation
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1], False

# Dynamic asset path discovery for frozen executable
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))

ICON_PATH = os.path.join(BASE_DIR, "frontend", "static", "assets", "favicon.ico")

# Explicitly prevent PyWebview from delegating navigation/new windows to external OS browser
webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False


def check_webview2_available() -> bool:
    """Verifies that Microsoft Edge WebView2 runtime is installed on Windows."""
    if sys.platform != "win32":
        return True
    try:
        import webview.platforms.winforms as wf
        return bool(wf._is_chromium())
    except Exception:
        pass

    # Direct registry inspection as fallback
    try:
        import winreg
        keys = [
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ]
        for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for k in keys:
                try:
                    with winreg.OpenKey(root, k) as h:
                        val, _ = winreg.QueryValueEx(h, "pv")
                        if val and val != "0.0.0.0":
                            return True
                except Exception:
                    pass
    except Exception:
        pass
    return False


def show_webview2_missing_dialog(detail: str = ""):
    """Displays a native Windows error dialog instructing the user to install WebView2."""
    if sys.platform == "win32":
        msg = (
            "Microsoft Edge WebView2 Runtime is required to run Ion+.\n\n"
            "The application could not find or initialize the WebView2 Runtime engine.\n\n"
            "Please download and install the Evergreen WebView2 Runtime from Microsoft:\n"
            "https://developer.microsoft.com/en-us/microsoft-edge/webview2/\n\n"
        )
        if detail:
            msg += f"Details: {detail}\n\n"
        msg += "The application will now exit."
        try:
            ctypes.windll.user32.MessageBoxW(
                0,
                msg,
                "Ion+ — Microsoft Edge WebView2 Required",
                0x10 | 0x0,  # MB_ICONERROR | MB_OK
            )
        except Exception:
            print(f"[FATAL ERROR] Microsoft Edge WebView2 Runtime is required. {detail}")
    else:
        print(f"[FATAL ERROR] Microsoft Edge WebView2 Runtime is required. {detail}")


def run_server(port: int = PORT):
    """Runs uvicorn in-process on the designated port."""
    try:
        config = uvicorn.Config(
            app=app,
            host=HOST,
            port=port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        print(f"[ERROR] Uvicorn server failed on port {port}: {e}", file=sys.stderr)


def is_server_ready(port: int | None = None) -> bool:
    """Checks if FastAPI local server is answering HTTP requests."""
    target_port = port if port is not None else PORT
    try:
        with urllib.request.urlopen(f"http://{HOST}:{target_port}/api/status", timeout=0.6) as response:
            return response.status == 200
    except Exception:
        return False


def main():
    global PORT, BASE_URL

    parser = argparse.ArgumentParser(description="Ion+ Battery Health Analyzer Desktop")
    parser.add_argument("--port", type=int, default=None, help="Port to bind FastAPI server")
    parser.add_argument("--no-splash", action="store_true", help="Disable startup splash screen")
    args = parser.parse_args()

    # Pre-flight check: ensure WebView2 runtime is present before initializing UI
    if not check_webview2_available():
        show_webview2_missing_dialog("Microsoft Edge WebView2 Runtime was not detected.")
        sys.exit(1)

    # Automatically resolve port and detect existing running instances
    preferred = args.port if args.port is not None else DEFAULT_PORT
    resolved_port, already_running = find_available_port(preferred_port=preferred, host=HOST)

    if args.port is not None and resolved_port != args.port:
        print(f"[PORT CONFLICT] Requested port {args.port} is unavailable. Using port {resolved_port}.")
    elif args.port is None and resolved_port != DEFAULT_PORT and not already_running:
        print(f"[PORT NOTICE] Default port {DEFAULT_PORT} is in use by another service. Starting Ion+ on port {resolved_port}.")
    elif already_running:
        print(f"[INSTANCE] Connected to existing Ion+ instance running on port {resolved_port}.")

    PORT = resolved_port
    BASE_URL = f"http://{HOST}:{PORT}"

    # 1. Initialize Adobe-Style Loading Splash Screen
    splash = None
    if not args.no_splash:
        try:
            from splash import AdobeSplashScreen
            splash = AdobeSplashScreen()
            splash.update_progress(10, "Initializing application environment...")
        except Exception:
            splash = None

    # 2. Start FastAPI in background daemon thread (skip if instance already active)
    if not already_running:
        if splash:
            splash.update_progress(25, "Loading IEC 61960 battery degradation models...")

        server_thread = threading.Thread(target=lambda: run_server(PORT), daemon=True)
        server_thread.start()
    else:
        if splash:
            splash.update_progress(35, "Connecting to active Ion+ background instance...")

    # 3. Poll for server readiness with backoff while animating splash
    start_wait = time.time()
    ready = False
    step = 0
    poll_delay = 0.05
    statuses = [
        (35, "Connecting local SQLite telemetry archive..."),
        (55, "Scanning ADB USB hardware interfaces..."),
        (75, "Starting local REST API services..."),
        (88, "Initializing EURA user interface..."),
    ]

    while time.time() - start_wait < 14.0:
        if is_server_ready(PORT):
            ready = True
            break
        if splash and step < len(statuses):
            pct, msg = statuses[step]
            splash.update_progress(pct, msg)
            step += 1
        time.sleep(poll_delay)
        poll_delay = min(poll_delay * 1.25, 0.25)

    if not ready:
        if splash:
            splash.close()
        err_msg = (
            f"Failed to connect to Ion+ backend server on port {PORT}.\n\n"
            "Please check that local loopback connections (127.0.0.1) are permitted and try restarting the application."
        )
        if sys.platform == "win32":
            try:
                ctypes.windll.user32.MessageBoxW(0, err_msg, "Ion+ — Startup Error", 0x10 | 0x0)
            except Exception:
                pass
        print(f"[ERROR] {err_msg}", file=sys.stderr)
        sys.exit(1)

    # 4. Finalize Splash Screen Transition
    if splash:
        splash.update_progress(100, "Ready.")
        time.sleep(0.15)
        splash.close()
        splash = None

    # 5. Launch native PyWebview window (Strictly native window, zero browser fallback)
    try:
        window = webview.create_window(
            title="Ion+",
            url=BASE_URL,
            width=1220,
            height=820,
            min_size=(980, 660),
            background_color="#020710",
            text_select=False,
            maximized=True,
            focus=True,
            hidden=True,
        )

        def on_window_loaded():
            try:
                window.show()
            except Exception:
                pass

        window.events.loaded += on_window_loaded

        def on_window_minimized():
            try:
                window.evaluate_js("document.querySelector('.aurora-bg')?.classList.add('is-paused')")
            except Exception:
                pass

        def on_window_restored():
            try:
                window.evaluate_js("document.querySelector('.aurora-bg')?.classList.remove('is-paused')")
            except Exception:
                pass

        window.events.minimized += on_window_minimized
        window.events.restored += on_window_restored

        def on_started(w):
            """Ensures window always opens un-minimized in active foreground maximized state without flickering."""
            try:
                if sys.platform == "win32":
                    user32 = ctypes.windll.user32
                    kernel32 = ctypes.windll.kernel32

                    # Poll briefly until native window handle is found
                    for attempt in range(25):
                        time.sleep(0.12)
                        hwnd = user32.FindWindowW(None, "Ion+")
                        if not hwnd:
                            continue

                        # 1. If iconic (minimized in taskbar), restore directly to maximized
                        if user32.IsIconic(hwnd):
                            user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
                        elif not user32.IsZoomed(hwnd):
                            user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE

                        # 2. Seamlessly bring to foreground without Z-order thrashing or window resize
                        fore_hwnd = user32.GetForegroundWindow()
                        if fore_hwnd != hwnd:
                            fore_thread = user32.GetWindowThreadProcessId(fore_hwnd, None)
                            cur_thread = kernel32.GetCurrentThreadId()
                            if fore_thread and fore_thread != cur_thread:
                                user32.AttachThreadInput(cur_thread, fore_thread, True)
                                user32.SetForegroundWindow(hwnd)
                                user32.BringWindowToTop(hwnd)
                                user32.AttachThreadInput(cur_thread, fore_thread, False)
                            else:
                                user32.SetForegroundWindow(hwnd)
                                user32.BringWindowToTop(hwnd)
                        else:
                            user32.SetForegroundWindow(hwnd)

                        # Window is confirmed maximized and foreground — exit loop immediately
                        break
                else:
                    time.sleep(0.2)
                    if hasattr(w, "maximize"):
                        w.maximize()
            except Exception:
                pass

        # Start native desktop window loop
        webview.start(
            on_started,
            window,
            gui="edgechromium",
            debug=False,
            icon=ICON_PATH if os.path.isfile(ICON_PATH) else None,
        )
    except Exception as e:
        if splash:
            splash.close()
            splash = None
        show_webview2_missing_dialog(str(e))
        sys.exit(1)
    finally:
        # Cleanly terminate all background threads and watcher
        os._exit(0)


if __name__ == "__main__":
    main()

