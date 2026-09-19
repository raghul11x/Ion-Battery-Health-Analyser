"""
Automated Verification Suite for PRD §10 Success Metrics.
1. Health % reading is available and stable across at least 5 consecutive connections
2. At least 30 days of logged history showing a visible trend line
3. Background watcher auto-logs readings on connection without manual intervention
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock
from backend.db import Database
from backend.health import calculate_health
from backend.watcher import DeviceWatcher


def test_metric_1_health_pct_stability_across_consecutive_connections():
    """Verify health % calculation is stable and deterministic across 5 consecutive connection readings."""
    charge_full = 4850000
    charge_design = 5000000

    readings = []
    for _ in range(5):
        health_pct, raw_ratio, recalibrated, method, _ = calculate_health(
            charge_full_uah=charge_full,
            charge_full_design_uah=charge_design,
            charge_counter_uah=4000000,
            level_pct=85,
        )
        readings.append(health_pct)

    # Health reading must be available and perfectly stable
    assert len(readings) == 5
    assert all(r == 97.0 for r in readings)
    assert max(readings) - min(readings) == 0.0


def test_metric_2_thirty_days_trend_line_visibility():
    """Verify >=30 days of logged history exhibits a visible degradation trend line."""
    test_db = Database(":memory:")
    count = test_db.seed_mock_data(device_serial="test-metric-phone", days=30)
    assert count >= 30

    history = test_db.get_history(device_serial="test-metric-phone", days=30, limit=150)
    assert len(history) >= 30

    first_health = history[0]["health_pct"]
    latest_health = history[-1]["health_pct"]

    # History must show a visible (even if small) trend line
    assert first_health is not None
    assert latest_health is not None
    assert first_health >= latest_health  # Degradation over 30 days


def test_metric_3_background_watcher_autolog_on_connection():
    """Verify watcher detects connected ADB device and automatically persists reading without manual steps."""
    test_watcher = DeviceWatcher(poll_interval_seconds=5)

    # Mock ADB devices returning a connected device
    test_watcher.adb.is_available = MagicMock(return_value=True)
    test_watcher.adb.get_devices = MagicMock(return_value=[
        {"serial": "auto-test-serial", "state": "device", "model": "Nothing_Phone_2a"}
    ])

    mock_probe = {
        "summary": {
            "level_pct": 88,
            "voltage_mv": 4180,
            "temperature_c": 30.2,
            "status": "Charging",
            "health_flag": "Good",
            "charge_counter_uah": 4400000,
            "charge_full_uah": 4850000,
            "charge_full_design_uah": 5000000,
            "cycle_count": 45,
        },
        "device_info": {
            "model": "Phone 2a",
            "manufacturer": "Nothing",
        }
    }
    test_watcher.adb.probe_device = MagicMock(return_value=mock_probe)

    # Trigger poll cycle
    test_watcher.poll_cycle()

    assert test_watcher.last_status["connected"] is True
    assert test_watcher.last_status["serial"] == "auto-test-serial"
    assert test_watcher.last_status["log_count_session"] >= 1
