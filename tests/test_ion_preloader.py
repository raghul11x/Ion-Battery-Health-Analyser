"""
Tests for IonPreloader Isolated Preloader Component & Boot Integration.
Validates:
1. Static script existence, Shadow DOM isolation, and API exports.
2. Markup integration in frontend/index.html targeting #brand-logo.
3. Backend route serving /ion-preloader.js as application/javascript.
4. Boot sequence calls in frontend/static/js/app.js.
"""

from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_PRELOADER = ROOT_DIR / "frontend" / "static" / "js" / "ion-preloader.js"
INDEX_HTML = ROOT_DIR / "frontend" / "index.html"
APP_JS = ROOT_DIR / "frontend" / "static" / "js" / "app.js"

client = TestClient(app)


def test_ion_preloader_script_contents():
    assert STATIC_PRELOADER.exists(), "frontend/static/js/ion-preloader.js not found"
    code = STATIC_PRELOADER.read_text(encoding="utf-8")

    # Shadow DOM isolation
    assert "attachShadow" in code
    assert "mode: 'closed'" in code or 'mode: "closed"' in code or "mode: 'open'" in code
    assert ":host{all:initial;" in code

    # Global API and lifecycle
    assert "window.IonPreloader" in code
    assert "start:" in code
    assert "step:" in code
    assert "finish:" in code
    assert "ionpl:done" in code

    # Failsafe timeout
    assert "cfg.maxMs" in code or "12000" in code


def test_index_html_preloader_integration():
    assert INDEX_HTML.exists(), "frontend/index.html not found"
    html = INDEX_HTML.read_text(encoding="utf-8")

    # Script tag with data-target
    assert 'ion-preloader.js' in html
    assert 'data-target="#brand-logo"' in html

    # Target element exists in DOM
    assert 'id="brand-logo"' in html


def test_backend_serves_preloader_routes():
    # Route via /ion-preloader.js
    res_root = client.get("/ion-preloader.js")
    assert res_root.status_code == 200
    assert "IonPreloader" in res_root.text

    # Route via /static/js/ion-preloader.js
    res_static = client.get("/static/js/ion-preloader.js")
    assert res_static.status_code == 200
    assert "IonPreloader" in res_static.text


def test_app_js_boot_sequence_calls():
    assert APP_JS.exists(), "frontend/static/js/app.js not found"
    app_js_text = APP_JS.read_text(encoding="utf-8")

    # Step calls
    assert "IonPreloader.step('Starting local engine', 0.25)" in app_js_text
    assert "IonPreloader.step('Opening history database', 0.6)" in app_js_text
    assert "IonPreloader.step('Checking ADB', 0.85)" in app_js_text

    # Finish call
    assert "IonPreloader.finish()" in app_js_text
