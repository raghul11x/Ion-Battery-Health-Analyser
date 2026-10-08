"""
Codebase Quality & Regressions Test Suite.
Validates:
1. Deterministic timestamp parsing across UTC 'Z' and naive timestamps.
2. Anomaly fixer idempotency (zero redundant commits on pre-calibrated database rows).
3. Active status mapping in /api/devices for connected hardware.
4. CLI argument handling in desktop.py.
"""

import sys
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.db import Database, BatteryReading
from backend.prediction import _parse_ts, calculate_capacity_trend
from backend.main import app

client = TestClient(app)


def test_parse_ts_utc_and_naive_consistency():
    """Ensure _parse_ts correctly parses and normalizes both UTC 'Z' and naive datetimes without TypeError."""
    ts_z = "2026-10-08T08:00:00Z"
    ts_naive = "2026-10-08T08:00:00"
    ts_offset = "2026-10-08T13:30:00+05:30"

    dt_z = _parse_ts(ts_z)
    dt_naive = _parse_ts(ts_naive)
    dt_offset = _parse_ts(ts_offset)

    assert dt_z is not None
    assert dt_naive is not None
    assert dt_offset is not None

    # All returned datetimes must be offset-naive UTC to avoid mixed-offset TypeError during subtraction
    assert dt_z.tzinfo is None
    assert dt_naive.tzinfo is None
    assert dt_offset.tzinfo is None

    # Subtraction between mixed parsed inputs should succeed cleanly
    diff = dt_z - dt_naive
    assert diff.total_seconds() == 0.0

    diff_offset = dt_z - dt_offset
    assert diff_offset.total_seconds() == 0.0


def test_capacity_trend_with_mixed_timestamps():
    """Verifies calculate_capacity_trend handles history with both naive and UTC 'Z' timestamps."""
    history = [
        {"timestamp": "2026-09-01T10:00:00Z", "health_pct": 98.0},
        {"timestamp": "2026-09-15T10:00:00", "health_pct": 97.5},
        {"timestamp": "2026-10-01T10:00:00+00:00", "health_pct": 97.0},
    ]
    res = calculate_capacity_trend(history)
    assert res["insufficient_data"] is False
    assert res["data_points"] == 3
    assert res["slope_pct_per_day"] < 0


def test_fix_existing_anomalies_idempotency():
    """Verifies that fix_existing_anomalies does not re-modify already calibrated records."""
    db = Database(":memory:")
    # Insert a record that matches Apple-standard calibrated conditions
    r = db.insert_reading(
        level_pct=80,
        voltage_mv=4150,
        temperature_c=28.0,
        health_pct=98.5,
        health_method="apple_standard_calibrated",
        device_serial="test-phone-apple",
        charge_full_uah=5000000,
        charge_full_design_uah=5000000,
        cycle_count=120,
    )

    # Calling fix_existing_anomalies again should result in 0 updates
    session = db.get_session()
    try:
        row = session.query(BatteryReading).filter_by(id=r["id"]).first()
        assert row.health_method == "apple_standard_calibrated"
    finally:
        session.close()

    # Re-run fixer
    db.fix_existing_anomalies()

    session = db.get_session()
    try:
        row = session.query(BatteryReading).filter_by(id=r["id"]).first()
        assert row.health_method == "apple_standard_calibrated"
    finally:
        session.close()


def test_api_devices_active_flag_propagation():
    """Verifies /api/devices sets active: True for matching connected ADB devices."""
    with patch("backend.api_routes.adb") as mock_adb:
        mock_adb.is_available.return_value = True
        mock_adb.get_devices.return_value = [{"serial": "active-usb-dev", "state": "device", "model": "Pixel 8"}]
        mock_adb.get_device_props.return_value = {"model": "Pixel 8", "manufacturer": "Google"}

        res = client.get("/api/devices")
        assert res.status_code == 200
        devices = res.json()
        assert len(devices) > 0
        active_dev = next((d for d in devices if d["serial"] == "active-usb-dev"), None)
        assert active_dev is not None
        assert active_dev.get("active") is True


def test_desktop_port_cli_override():
    """Verifies desktop.py updates PORT and BASE_URL when passed --port."""
    import desktop
    with patch.object(sys, "argv", ["desktop.py", "--port", "9876", "--no-splash"]):
        with patch("desktop.check_webview2_available", return_value=True):
            with patch("desktop.run_server"):
                with patch("desktop.is_server_ready", return_value=True):
                    with patch("desktop.webview.start"):
                        with patch("desktop.webview.create_window"):
                            with patch("os._exit"):
                                desktop.main()
                                assert desktop.PORT == 9876
                                assert desktop.BASE_URL == "http://127.0.0.1:9876"


def test_find_available_port_fallback():
    """Verifies find_available_port automatically bypasses occupied ports."""
    import desktop

    with patch("desktop.is_ion_server", return_value=False):
        # Simulate 8765 occupied, 8766 free
        with patch("desktop.is_port_in_use", side_effect=lambda p, host="127.0.0.1": p == 8765):
            port, is_existing = desktop.find_available_port(preferred_port=8765)
            assert port == 8766
            assert is_existing is False


def test_find_available_port_reuse_existing_instance():
    """Verifies find_available_port detects and reuses an active Ion+ backend instance."""
    import desktop

    with patch("desktop.is_ion_server", side_effect=lambda p, host="127.0.0.1": p == 8765):
        port, is_existing = desktop.find_available_port(preferred_port=8765)
        assert port == 8765
        assert is_existing is True
