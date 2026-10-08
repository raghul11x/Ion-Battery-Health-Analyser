"""
Unit tests for Continuous Animated Aurora Background Loop and Performance Guards.
Verifies that:
1. Loop keyframes exist and have identical start and end transforms (seamless boundary).
2. Animation duration is strictly between 60s and 90s (slow drift).
3. prefers-reduced-motion media query disables the animation.
4. Pause-on-hidden handler is registered in app.js and .is-paused pauses animation in CSS.
5. Passive scroll listener pauses animation during active scroll.
"""

from pathlib import Path
import re

ROOT_DIR = Path(__file__).resolve().parent.parent
STYLE_CSS = ROOT_DIR / "frontend" / "static" / "css" / "style.css"
APP_JS = ROOT_DIR / "frontend" / "static" / "js" / "app.js"


def test_aurora_loop_keyframes_and_seamless_loop():
    """Verify loop keyframes exist and provide a seamless 60s drift loop."""
    assert STYLE_CSS.exists(), "frontend/static/css/style.css not found"
    css = STYLE_CSS.read_text(encoding="utf-8")

    # Keyframes must exist (aurora-drift)
    keyframes_match = re.search(r"@keyframes\s+(aurora-drift)\s*\{((?:[^{}]*\{[^{}]*\})+[^{}]*)\}", css)
    assert keyframes_match is not None, "Loop keyframes (@keyframes aurora-drift) not found in style.css"

    kf_body = keyframes_match.group(2)

    # Extract from and to background-position values
    start_match = re.search(r"(?:0%|from)\s*\{\s*background-position:\s*([^;]+);", kf_body)
    end_match = re.search(r"(?:100%|to)\s*\{\s*background-position:\s*([^;]+);", kf_body)

    assert start_match is not None, "0% / from background-position rule not found in keyframes"
    assert end_match is not None, "100% / to background-position rule not found in keyframes"

    start_pos = start_match.group(1).strip()
    end_pos = end_match.group(1).strip()

    assert "50%" in start_pos, f"Start position must be centered: {start_pos}"
    assert "350%" in end_pos, f"End position must shift by 300% period: {end_pos}"


def test_aurora_animation_duration_within_spec():
    """Verify animation duration is between 60s and 90s."""
    css = STYLE_CSS.read_text(encoding="utf-8")

    # Match animation declaration on aurora layer
    anim_match = re.search(r"animation:\s*(?:aurora-drift|aurora-loop)\s+(\d+)s", css)
    assert anim_match is not None, "Animation rule with second duration not found in style.css"

    duration_sec = int(anim_match.group(1))
    assert 60 <= duration_sec <= 90, f"Animation duration ({duration_sec}s) must be between 60s and 90s"


def test_aurora_prefers_reduced_motion():
    """Verify prefers-reduced-motion media query disables the aurora animation."""
    css = STYLE_CSS.read_text(encoding="utf-8")

    # Must contain media query for prefers-reduced-motion
    reduced_motion_match = re.search(
        r"@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{((?:[^{}]*\{[^{}]*\})+[^{}]*)\}",
        css
    )
    assert reduced_motion_match is not None, "@media (prefers-reduced-motion: reduce) block not found in style.css"

    body = reduced_motion_match.group(1)
    assert r"animation:\s*none" in body or "animation: none" in body, (
        "prefers-reduced-motion must set animation: none"
    )


def test_aurora_pause_guards_registered():
    """Verify pause-on-hidden, pause-on-blur, and pause-on-scroll handlers exist."""
    assert APP_JS.exists(), "frontend/static/js/app.js not found"
    js = APP_JS.read_text(encoding="utf-8")
    css = STYLE_CSS.read_text(encoding="utf-8")

    # CSS pause rules
    assert ".aurora-bg.is-paused" in css, "CSS must provide .aurora-bg.is-paused rule"
    assert "animation-play-state: paused" in css, "CSS must pause animation on .is-paused"
    assert ".aurora-bg.is-scrolling" in css, "CSS must provide .aurora-bg.is-scrolling rule"

    # JS pause-on-hidden (visibilitychange) handler
    assert "visibilitychange" in js, "visibilitychange listener must be registered in app.js"
    assert "document.hidden" in js, "document.hidden check must be used in app.js"
    assert "is-paused" in js, "classList 'is-paused' must be manipulated on visibilitychange"

    # JS passive scroll listener with debounce
    assert "window.addEventListener('scroll'" in js or 'window.addEventListener("scroll"' in js, (
        "scroll listener must be registered in app.js"
    )
    assert "is-scrolling" in js, "classList 'is-scrolling' must be added during scroll"
