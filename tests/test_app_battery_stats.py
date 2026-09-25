"""
Unit and integration tests for App Battery Drain Attribution subsystem.
Verifies:
1. Resilient parsing of dumpsys batterystats --checkin (wakelocks, CPU, radio, GPS).
2. Secondary estimated power (mAh) parsing and transparency flagging from --charged.
3. Handling of malformed, corrupt, or truncated lines with StatusBus logging.
4. Deterministic fallback for uninstalled packages or system UIDs.
5. SQLite app_power_readings persistence and migration.
6. Sorting options: wakelock_ms, cpu_bg_ms, estimated_mah.
7. Thermal correlation with battery_readings operating temperatures.
8. REST API GET /api/app-drain endpoint schema and response contracts.
9. End-to-end Deep Scan cycle integration through DeviceWatcher.
"""

from datetime import datetime, timedelta
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from backend.adb_client import (
    ADBClient,
    SYNTHETIC_NOTHING_PHONE_2A_CHECKIN,
    SYNTHETIC_NOTHING_PHONE_2A_CHARGED,
    SYNTHETIC_NOTHING_PHONE_2A_PACKAGES,
)
from backend.app_battery_stats import (
    parse_batterystats_checkin,
    parse_charged_estimated_power,
    format_duration_ms,
    get_app_display_name,
)
from backend.db import Database, db, AppPowerReading, BatteryReading
from backend.main import app
from backend.status_bus import status_bus, get_recent_status
from backend.watcher import DeviceWatcher

client = TestClient(app)


SAMPLE_CHECKIN_DATA = """9,0,i,vers,16,180,com.test.os,TestDevice
9,0,i,uidac,1000,10123,10156,10999
9,1000,l,wl,sync,60000,f,2,25000,p,10,0,bp,0,-1,w,-1
9,1000,l,cpu,30000,10000,0,0
9,1000,l,m,50000,20000,200,100,8000,0,0,0
9,10123,l,wl,*alarm*,300000,f,15,140000,p,30,0,bp,0,-1,w,-1
9,10123,l,cpu,95000,25000,0,0
9,10123,l,m,300000,80000,500,200,22000,0,0,0
9,10123,l,gpr,35000,2
9,10156,l,wl,AudioMix,50000,f,5,45000,p,15,0,bp,0,-1,w,-1
9,10156,l,cpu,210000,30000,0,0
9,10156,l,m,600000,250000,800,400,45000,0,0,0
9,10999,l,wl,deleted_lock,20000,f,1,15000,p,4,0,bp,0,-1,w,-1
9,10999,l,cpu,10000,1000,0,0
"""

SAMPLE_CHARGED_DATA = """Estimated power use (mAh):
    Capacity: 4500, Computed drain: 500, actual drain: 480-520
    Uid 10156: 120.5 ( cpu=90.0 wake=10.5 data=20.0 )
    Uid 10123: 85.2 ( cpu=60.0 wake=15.2 data=10.0 )
    Uid 1000: 45.0 ( cpu=35.0 wake=10.0 )
    Uid 10999: 12.4 ( cpu=8.0 wake=4.4 )
"""


def test_parse_clean_batterystats_checkin():
    """Verifies that clean checkin and charged data parse into correct per-UID metrics."""
    uid_map = {
        1000: "android",
        10123: "com.instagram.android",
        10156: "com.google.android.youtube",
    }
    # 10999 is intentionally omitted from uid_map to test fallback naming

    res = parse_batterystats_checkin(
        checkin_text=SAMPLE_CHECKIN_DATA,
        charged_text=SAMPLE_CHARGED_DATA,
        uid_map=uid_map,
        serial="test-serial-1",
    )

    assert len(res) == 4

    # Top app sorted by wakelock should be 10123 (140,000 ms)
    top_app = res[0]
    assert top_app["uid"] == 10123
    assert top_app["package_name"] == "com.instagram.android"
    assert top_app["display_name"] == "Instagram"
    assert top_app["wakelock_ms"] == 140000
    assert top_app["wakelock_count"] == 30
    assert top_app["wakelock_duration_display"] == "2m 20s"
    assert top_app["cpu_fg_ms"] == 95000
    assert top_app["cpu_bg_ms"] == 25000
    assert top_app["radio_active_ms"] == 22000
    assert top_app["gps_active_ms"] == 35000
    assert top_app["estimated_mah"] == 85.2
    assert top_app["is_estimated_power"] is True

    # Check uninstalled app UID 10999
    uninstalled = next(r for r in res if r["uid"] == 10999)
    assert uninstalled["package_name"] == "UID: 10999 (Uninstalled / System)"
    assert uninstalled["wakelock_ms"] == 15000
    assert uninstalled["estimated_mah"] == 12.4


def test_parse_malformed_and_corrupt_lines():
    """Verifies that malformed, corrupted, or truncated records do not crash the parser and are logged."""
    corrupted_data = """9,0,i,vers,16,180
THIS IS A TOTALLY MALFORMED LINE WITH NO COMMAS
9,invalid_uid,l,wl,lock,not_a_number,f
9,10123,l,wl,valid_lock,10000,f,1,8000,p,2,0,bp,0,-1,w,-1
9,CORRUPT,cpu,100,200
9,10123,l,cpu,4000,1000,0,0
9,10123,l,gpr,CORRUPT_NUMBER,2
9,10123,l,m,100,200,10,20,5000,0,0,0
"""
    status_bus.clear()

    res = parse_batterystats_checkin(
        checkin_text=corrupted_data,
        charged_text="",
        uid_map={10123: "com.test.app"},
        serial="test-malformed",
    )

    assert len(res) == 1
    assert res[0]["uid"] == 10123
    assert res[0]["wakelock_ms"] == 8000
    assert res[0]["cpu_fg_ms"] == 4000
    assert res[0]["radio_active_ms"] == 5000

    # StatusBus should contain app_drain_scan events for the scan completion and malformed notes
    recent_events = get_recent_status(limit=20, device_serial="test-malformed")
    app_events = [e for e in recent_events if e["category"] == "app_drain_scan"]
    assert len(app_events) >= 1


def test_zero_activity_apps_filtered():
    """Verifies that apps with 0 across all counters are filtered out."""
    zero_data = """9,0,i,vers,16,180
9,10001,l,wl,idle,0,f,0,0,p,0,0,bp,0,-1,w,-1
9,10001,l,cpu,0,0,0,0
9,10002,l,wl,active,10000,f,1,5000,p,2,0,bp,0,-1,w,-1
"""
    res = parse_batterystats_checkin(checkin_text=zero_data, charged_text="", uid_map={})
    assert len(res) == 1
    assert res[0]["uid"] == 10002


def test_format_duration_ms():
    """Verifies millisecond duration formatting into clean human strings."""
    assert format_duration_ms(0) == "0s"
    assert format_duration_ms(-100) == "0s"
    assert format_duration_ms(4500) == "4.5s"
    assert format_duration_ms(15000) == "15s"
    assert format_duration_ms(142000) == "2m 22s"
    assert format_duration_ms(3600000) == "1h 0m"
    assert format_duration_ms(7325000) == "2h 2m"


def test_get_app_display_name():
    """Verifies friendly title extraction from package identifiers."""
    assert get_app_display_name("com.google.android.youtube") == "YouTube"
    assert get_app_display_name("com.whatsapp") == "WhatsApp"
    assert get_app_display_name("android") == "Android System"
    assert get_app_display_name("UID: 10999 (Uninstalled / System)") == "UID: 10999 (Uninstalled / System)"
    assert get_app_display_name("com.example.foobar") == "Foobar"


def test_db_app_power_readings_persistence():
    """Verifies inserting into app_power_readings and querying back with sorting."""
    test_db = Database()
    serial = "test-db-persist-phone"

    readings = [
        {
            "package_name": "com.app.alpha",
            "wakelock_ms": 50000,
            "wakelock_count": 10,
            "cpu_fg_ms": 10000,
            "cpu_bg_ms": 90000,
            "radio_active_ms": 2000,
            "gps_active_ms": 0,
            "estimated_mah": 15.5,
        },
        {
            "package_name": "com.app.beta",
            "wakelock_ms": 120000,
            "wakelock_count": 25,
            "cpu_fg_ms": 40000,
            "cpu_bg_ms": 20000,
            "radio_active_ms": 5000,
            "gps_active_ms": 1000,
            "estimated_mah": 45.0,
        },
        {
            "package_name": "com.app.gamma",
            "wakelock_ms": 10000,
            "wakelock_count": 2,
            "cpu_fg_ms": 5000,
            "cpu_bg_ms": 5000,
            "radio_active_ms": 0,
            "gps_active_ms": 0,
            "estimated_mah": 80.0,
        },
    ]

    inserted = test_db.insert_app_power_readings(serial, readings)
    assert inserted == 3

    # Default sort by wakelock_ms
    res_wake = test_db.get_app_drain_readings(serial=serial, window_hours=24, sort_by="wakelock_ms")
    assert len(res_wake) >= 3
    assert res_wake[0]["package_name"] == "com.app.beta"
    assert res_wake[0]["wakelock_ms"] == 120000

    # Sort by cpu_bg_ms
    res_cpu = test_db.get_app_drain_readings(serial=serial, window_hours=24, sort_by="cpu_bg_ms")
    assert res_cpu[0]["package_name"] == "com.app.alpha"
    assert res_cpu[0]["cpu_bg_ms"] == 90000

    # Sort by estimated_mah
    res_mah = test_db.get_app_drain_readings(serial=serial, window_hours=24, sort_by="estimated_mah")
    assert res_mah[0]["package_name"] == "com.app.gamma"
    assert res_mah[0]["estimated_mah"] == 80.0


def test_thermal_correlation_detection():
    """Verifies thermal correlation detection when temperatures in battery_readings are elevated."""
    test_db = Database()
    serial_hot = "test-phone-hot"
    serial_cool = "test-phone-cool"

    # Insert hot readings (peak >= 35°C)
    now = datetime.utcnow()
    test_db.insert_reading(
        level_pct=80, voltage_mv=4100, temperature_c=38.5, health_pct=90.0,
        device_serial=serial_hot, health_method="capacity_ratio"
    )
    test_db.insert_reading(
        level_pct=78, voltage_mv=4050, temperature_c=36.0, health_pct=90.0,
        device_serial=serial_hot, health_method="capacity_ratio"
    )

    hot_summary = test_db.get_thermal_correlation_summary(serial=serial_hot, window_hours=24)
    assert hot_summary["has_thermal_stress"] is True
    assert hot_summary["max_temp_c"] == 38.5
    assert hot_summary["elevated_readings_count"] >= 2
    assert "Elevated device temperature" in hot_summary["thermal_summary"]

    # Insert cool readings (temperatures normal ~26°C)
    test_db.insert_reading(
        level_pct=85, voltage_mv=4200, temperature_c=26.5, health_pct=92.0,
        device_serial=serial_cool, health_method="capacity_ratio"
    )
    cool_summary = test_db.get_thermal_correlation_summary(serial=serial_cool, window_hours=24)
    assert cool_summary["has_thermal_stress"] is False
    assert cool_summary["max_temp_c"] == 26.5


def test_api_app_drain_endpoint():
    """Verifies REST API endpoint GET /api/app-drain returns valid structure."""
    # Seed mock-phone-2a readings into DB
    res = client.get("/api/app-drain?window=24h&sort_by=wakelock_ms&serial=mock-phone-2a")
    assert res.status_code == 200
    data = res.json()

    assert data["status"] == "ok"
    assert data["device_serial"] == "mock-phone-2a"
    assert "items" in data
    assert len(data["items"]) > 0

    first_app = data["items"][0]
    assert "package_name" in first_app
    assert "display_name" in first_app
    assert "wakelock_ms" in first_app
    assert "wakelock_duration_display" in first_app
    assert "is_estimated_power" in first_app
    assert "disclaimer" in data


def test_watcher_deep_scan_run():
    """Verifies that DeviceWatcher runs app drain scan during deep scan cadence."""
    watcher = DeviceWatcher()
    mock_adb = ADBClient()
    mock_adb.is_available = MagicMock(return_value=True)

    def mock_shell(s, cmd, timeout=None):
        if "dumpsys batterystats --checkin" in cmd:
            return (SYNTHETIC_NOTHING_PHONE_2A_CHECKIN, "", 0)
        elif "dumpsys batterystats --charged" in cmd:
            return (SYNTHETIC_NOTHING_PHONE_2A_CHARGED, "", 0)
        elif "pm list packages -U" in cmd:
            return (SYNTHETIC_NOTHING_PHONE_2A_PACKAGES, "", 0)
        return ("", "", 0)

    mock_adb.run_shell = MagicMock(side_effect=mock_shell)
    watcher.adb = mock_adb

    serial = "virtual-deepscan-phone"
    res = watcher.run_app_drain_scan(serial)

    assert len(res) >= 5
    # Confirm records were persisted to DB
    db_items = db.get_app_drain_readings(serial=serial, window_hours=24)
    assert len(db_items) >= 5
