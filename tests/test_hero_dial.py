"""
Tests for Hero Dial Zero-Hallucination and Layout Invariants.
Validates that:
1. Health values are never defaulted to 100% when null/unavailable.
2. Dial knob marker is hidden when health is null/offline/standby.
3. Accessibility attributes (role="meter", aria-valuetext) are correctly set.
4. Single outer glass surface + inset hero card without nested blur.
5. Baseline-aligned tabular numbers with min-width to avoid layout shifts.
"""

from pathlib import Path
import re

ROOT_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML = ROOT_DIR / "frontend" / "index.html"
STYLE_CSS = ROOT_DIR / "frontend" / "static" / "css" / "style.css"
APP_JS = ROOT_DIR / "frontend" / "static" / "js" / "app.js"


def test_index_html_hero_dial_markup():
    assert INDEX_HTML.exists(), "frontend/index.html not found"
    content = INDEX_HTML.read_text(encoding="utf-8")

    # Meter role and initial accessible state
    assert 'id="hero-health-dial"' in content
    assert 'role="meter"' in content
    assert 'aria-label="Battery Health Indicator"' in content
    assert 'aria-valuetext="Health unavailable"' in content

    # Dial pin hidden initially in standby
    assert 'id="range-dial-marker"' in content
    assert 'class="range-dial-pin hidden"' in content
    assert 'aria-hidden="true"' in content

    # Hero number and unit baseline wrapper
    assert 'hero-number-wrap' in content
    assert 'hero-number-val' in content
    assert 'hero-number-unit' in content

    # Connection guide accordion accessibility
    assert 'id="toggle-connection-guide-btn"' in content
    assert 'aria-expanded="false"' in content
    assert 'aria-controls="connection-guide-steps"' in content


def test_style_css_hero_and_dial_invariants():
    assert STYLE_CSS.exists(), "frontend/static/css/style.css not found"
    content = STYLE_CSS.read_text(encoding="utf-8")

    # Range dial hidden class
    assert ".range-dial-pin.hidden" in content
    assert "display: none !important;" in content

    # Hero card inset panel without nested blur
    assert ".hero-card" in content
    assert "backdrop-filter: none !important;" in content

    # Baseline-aligned tabular numbers
    assert ".hero-number-wrap" in content
    assert ".hero-number-val" in content
    assert "min-width: 2.2ch;" in content
    assert "tabular-nums" in content

    # Outer cinematic-backdrop single glass surface
    assert ".cinematic-backdrop" in content
    assert "border-radius: 32px;" in content


def test_app_js_zero_hallucination_and_dial_logic():
    assert APP_JS.exists(), "frontend/static/js/app.js not found"
    content = APP_JS.read_text(encoding="utf-8")

    # setRangeDialPosition handles null strictly
    assert "function setRangeDialPosition(pct)" in content
    assert "pct === null || pct === undefined || isNaN(pct)" in content
    assert "Health unavailable" in content

    # Idle / Standby state calls setRangeDialPosition(null)
    assert "setRangeDialPosition(null);" in content

    # Check for forbidden fallbacks: no || 83 or || 100 for health
    assert not re.search(r"forecast\.current_health_pct\s*\|\|\s*83", content), "Found legacy || 83 fallback"
    assert not re.search(r"health_pct\s*!==\s*null\s*\?\s*s\.health_pct\s*:\s*100", content), "Found legacy : 100 fallback"

    # Guide toggle updates aria-expanded
    assert "guideToggle.setAttribute('aria-expanded', String(isHidden));" in content
