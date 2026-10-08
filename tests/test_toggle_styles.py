"""
Unit tests for Glass Toggle styles and legacy CSS regression prevention.
Verifies that:
1. Legacy Uiverse rules are completely purged from style.css.
2. Glass toggle rules in toggle.css follow the exact specification.
3. Knob (.cont-icon) is absolutely positioned with dynamic --k sizing and no legacy background/border.
4. HTML contains no legacy .toggle-compact classes.
"""

import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_style_css_free_of_legacy_toggle_rules():
    """Verify frontend/static/css/style.css contains NO legacy toggle rules."""
    style_path = os.path.join(BASE_DIR, "frontend", "static", "css", "style.css")
    with open(style_path, "r", encoding="utf-8") as f:
        content = f.read()

    # None of these legacy selectors should exist in style.css
    banned_selectors = [
        r"\.toggle-cont\s*\{",
        r"\.toggle-cont\.toggle-compact",
        r"\.toggle-cont\s+\.toggle-input",
        r"\.toggle-cont\s+\.toggle-label",
        r"\.toggle-label::before",
        r"\.toggle-label::after",
        r"\.toggle-cont\s+\.toggle-label\s+\.cont-icon",
        r"\.cont-icon\s*\{",
        r"\.cont-icon\s+\.sparkle",
        r"\.cont-icon\s+\.icon",
        r"@container\s+style\(--checked:\s*true\)",
        r"--width:\s*50px",
    ]

    for pattern in banned_selectors:
        match = re.search(pattern, content)
        assert match is None, f"Found legacy rule matching '{pattern}' in style.css: {match.group(0) if match else ''}"


def test_toggle_css_specification_invariants():
    """Verify toggle.css provides the exact liquid-glass sizing tokens and knob rules."""
    toggle_path = os.path.join(BASE_DIR, "frontend", "static", "css", "toggle.css")
    with open(toggle_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Track heights
    assert "--h: 34px;" in content
    assert ".toggle-cont--sm { --h: 28px; --pad: 2.5px; }" in content
    assert ".toggle-cont--xs { --h: 24px; --pad: 2px; }" in content

    # Knob sizing
    assert "--k: calc(var(--h) - 2px - var(--pad) * 2);" in content
    assert "width: var(--k);" in content
    assert "height: var(--k);" in content
    assert "position: absolute;" in content

    # ON state transforms
    assert "transform: translateX(var(--h));" in content
    assert "rotate(-225deg) scale(1.08)" in content
    assert "opacity: 0.9; animation-play-state: running;" in content


def test_html_free_of_toggle_compact():
    """Verify frontend/index.html does not use the legacy toggle-compact class."""
    html_path = os.path.join(BASE_DIR, "frontend", "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "toggle-compact" not in content
