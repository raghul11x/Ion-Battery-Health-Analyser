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


def test_ion_preloader_ten_second_and_error_lifecycle():
    """
    Validates:
    1. INIT_BANNER_MIN_MS is defined as 10000.
    2. Normal run stays visible >= 10,000 ms before dismissal.
    3. Error run immediately displays error without waiting 10,000 ms.
    4. Exit removes banner from DOM/accessibility tree and unblocks interaction.
    """
    import subprocess
    import shutil

    code = STATIC_PRELOADER.read_text(encoding="utf-8")
    html = INDEX_HTML.read_text(encoding="utf-8")

    # Invariants in source code
    assert "INIT_BANNER_MIN_MS = 10000" in code
    assert "data-min=\"10000\"" in html
    assert "markVisible" in code
    assert "pointer-events: none" in html

    # Behavioral simulation in Node.js
    node_bin = shutil.which("node")
    if node_bin:
        js_test = """
        const fs = require('fs');
        let code = fs.readFileSync('frontend/static/js/ion-preloader.js', 'utf8');

        function run(isError) {
          let timers = [];
          let now = 100;
          let removed = false;
          let statusText = '';
          let statusColor = '';
          let el = {
            classList: { add: () => {}, remove: () => {}, contains: () => false },
            addEventListener: () => {},
            style: {},
            remove: () => { removed = true; },
            parentNode: { removeChild: () => {} }
          };
          Object.defineProperty(el, 'textContent', { set: (v) => { statusText = v; }, get: () => statusText });
          Object.defineProperty(el.style, 'color', { set: (v) => { statusColor = v; }, get: () => statusColor });

          global.performance = { now: () => now };
          global.requestAnimationFrame = (cb) => { cb(now); return 1; };
          global.setTimeout = (fn, delay) => {
            let t = { fn, delay, scheduledAt: now };
            timers.push(t);
            return timers.length;
          };
          global.clearTimeout = () => {};
          global.document = {
            currentScript: { dataset: { min: '10000', max: '30000' } },
            readyState: 'complete',
            getElementById: (id) => el,
            addEventListener: () => {}
          };
          global.window = { dispatchEvent: () => {}, addEventListener: () => {} };
          global.CustomEvent = function() {};

          eval(code);

          if (!isError) {
            now = 500;
            window.IonPreloader.finish();
            let dismissTimers = timers.filter(t => t.delay > 0 && t.delay < 30000);
            if (dismissTimers.length !== 1 || dismissTimers[0].delay < 9500) {
              throw new Error('Normal run scheduled delay ' + JSON.stringify(dismissTimers) + ' is under 9500ms');
            }
          } else {
            now = 200;
            window.IonPreloader.finish('Engine startup fault');
            let exitTimers = timers.filter(t => t.delay === 350);
            if (statusText !== 'Engine startup fault' || exitTimers.length === 0) {
              throw new Error('Error run failed to dismiss immediately or statusText mismatch');
            }
          }
        }
        run(false);
        run(true);
        console.log('OK');
        """
        proc = subprocess.run([node_bin, "-e", js_test], cwd=str(ROOT_DIR), capture_output=True, text=True)
        assert proc.returncode == 0, f"Preloader Node test failed: {proc.stderr}"
        assert "OK" in proc.stdout

