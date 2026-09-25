"""
Virtual Phone Simulation & Diagnostic Suite for Ion+ Battery Health Analyzer.
Tests 10 distinct virtual phone archetypes and edge cases across the entire stack:
1. Pixel 8 (Standard clean sysfs)
2. Nothing Phone 2a (High cycles, MediaTek gauge, calibrated)
3. Samsung Galaxy S24 (Static register, mAh vs uAh scale)
4. Realme / OnePlus (ColorOS/Oplus_chg non-standard nodes, OEM SoH register, missing cycles)
5. Xiaomi / Redmi (MediaTek mtk-battery, dumpsys batterystats)
6. Flaky Phone (Rapid disconnect/reconnect jitter)
7. Unauthorized Device (state='unauthorized')
8. Offline Device (state='offline')
9. Corrupted Sysfs Device (Negative values, extreme temperatures, empty/permission-denied strings)
10. Dual Concurrent Devices (Two phones simultaneously connected, switching active target)
"""

import sys
import os
import json
import traceback
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

# Ensure root directory is in sys.path
sys.path.insert(0, os.path.abspath("."))

from backend.adb_client import ADBClient
from backend.watcher import DeviceWatcher
from backend.db import Database
from backend.health import calculate_health, normalize_capacity_units
from backend.device_profiler import DeviceProfiler
from backend.main import app


client = TestClient(app)

results = []

def record(test_name, passed, details=""):
    results.append({
        "name": test_name,
        "passed": passed,
        "details": details
    })
    status = "[PASS]" if passed else "[FAIL]"
    print(f"{status} {test_name}: {details}")


# ---------------------------------------------------------------------------
# Virtual Phone 1: Google Pixel 8 (Standard sysfs, good health)
# ---------------------------------------------------------------------------
def test_virtual_pixel_8():
    try:
        serial = "virtual-pixel-8"
        mock_adb = ADBClient()
        mock_adb.is_available = MagicMock(return_value=True)
        mock_adb.get_devices = MagicMock(return_value=[
            {"serial": serial, "state": "device", "model": "Pixel_8"}
        ])

        # Sysfs tree
        def mock_shell(s, cmd, timeout=None):
            if "getprop ro.product.model" in cmd:
                return ("Pixel 8", "", 0)
            if "getprop ro.product.manufacturer" in cmd:
                return ("Google", "", 0)
            if "dumpsys battery" in cmd:
                return ("Current Battery Service state:\n  level: 85\n  voltage: 4200\n  temperature: 285\n  status: 3\n  health: 2\n  Charge counter: 3850000", "", 0)
            if "ls /sys/class/power_supply" in cmd and "battery" not in cmd:
                return ("battery usb", "", 0)
            if "ls /sys/class/power_supply/battery" in cmd:
                return ("charge_full charge_full_design cycle_count current_now temp voltage_now", "", 0)
            if "cat /sys/class/power_supply/battery/charge_full_design" in cmd:
                return ("4575000", "", 0)
            if "cat /sys/class/power_supply/battery/charge_full" in cmd:
                return ("4250000", "", 0)
            if "cat /sys/class/power_supply/battery/cycle_count" in cmd:
                return ("180", "", 0)
            if "cat /sys/class/power_supply/battery/temp" in cmd:
                return ("285", "", 0)
            if "cat /sys/class/power_supply/battery/voltage_now" in cmd:
                return ("4200000", "", 0)
            return ("", "", 0)

        mock_adb.run_shell = MagicMock(side_effect=mock_shell)
        
        probe_res = mock_adb.probe_device(serial)
        summary = probe_res["summary"]
        assert summary["charge_full_design_uah"] == 4575000
        assert summary["charge_full_uah"] == 4250000
        assert summary["cycle_count"] == 180

        # Health computation
        h, raw, recal, method, det = calculate_health(
            charge_full_uah=4250000,
            charge_full_design_uah=4575000,
            cycle_count=180,
            level_pct=85,
            voltage_mv=4200,
            temperature_c=28.5
        )
        assert h is not None and 80.0 <= h <= 100.0
        assert det["breakdown"]["maximum_battery_capacity"] == 4575000
        assert det["breakdown"]["maximum_chargeable_capacity_now"] == 4250000

        record("Virtual Pixel 8 (Standard Sysfs)", True, f"Health: {h}%, Method: {method}")
    except Exception as e:
        record("Virtual Pixel 8 (Standard Sysfs)", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 2: Samsung Galaxy S24 (Static register + mAh scaling)
# ---------------------------------------------------------------------------
def test_virtual_samsung_s24_static_register():
    try:
        serial = "virtual-samsung-s24"
        # Samsung phone reporting in mAh (4000 instead of 4000000) and charge_full == charge_full_design
        norm_full, norm_design, ratio, note = normalize_capacity_units(4000, 4000)
        assert norm_full == 4000000
        assert norm_design == 4000000
        assert "Converted from mAh to µAh" in note

        # Health calculation should detect uncalibrated static register
        h, raw, recal, method, det = calculate_health(
            charge_full_uah=norm_full,
            charge_full_design_uah=norm_design,
            cycle_count=350,
            level_pct=90,
            voltage_mv=4300,
            temperature_c=31.0
        )
        assert det.get("is_uncalibrated_static_register") is True
        assert h is not None and h < 100.0 # Must apply Apple-standard cycle wear despite static register!
        record("Virtual Samsung S24 (Static Register & mAh)", True, f"Detected static: {det.get('is_uncalibrated_static_register')}, Calibrated health: {h}% (cycles: 350)")
    except Exception as e:
        record("Virtual Samsung S24 (Static Register & mAh)", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 3: Realme / OnePlus (oplus_chg, missing cycle count, OEM SoH)
# ---------------------------------------------------------------------------
def test_virtual_realme_oplus_chg():
    try:
        serial = "virtual-realme-gt"
        mock_adb = ADBClient()
        mock_adb.is_available = MagicMock(return_value=True)

        def mock_shell(s, cmd, timeout=None):
            if "ls /sys/class/power_supply" in cmd and "oplus_chg" not in cmd:
                return ("battery oplus_chg usb", "", 0)
            if "ls /sys/class/power_supply/oplus_chg" in cmd:
                return ("battery_soh charge_full fast_chg", "", 0)
            if "cat /sys/class/power_supply/oplus_chg/charge_full" in cmd:
                return ("5000000", "", 0)
            if "cat /sys/class/power_supply/oplus_chg/battery_soh" in cmd:
                return ("94", "", 0)
            if "cat /sys/class/power_supply/oplus_chg/cycle_count" in cmd:
                return ("", "No such file", 1)
            if "dumpsys battery" in cmd:
                return ("level: 70\nvoltage: 4100\ntemperature: 300\nstatus: 2", "", 0)
            return ("", "", 0)

        mock_adb.run_shell = MagicMock(side_effect=mock_shell)
        deep = mock_adb.deep_scan(serial)
        assert "oplus_chg" in deep["subdirectories"]
        assert deep["sysfs"]["oplus_chg"]["battery_soh"]["int_val"] == 94

        # 1. Health without cycle count, without OEM SoH, and <7 history days -> Insufficient data
        h_insuf, _, _, method_insuf, det_insuf = calculate_health(
            charge_full_uah=5000000,
            charge_full_design_uah=5000000,
            cycle_count=None,
            history_days=2.0,
            oem_reported_soh=None
        )
        assert h_insuf is None
        assert det_insuf["health_status"] == "insufficient_data"

        # 2. When OEM SoH (94%) is verified from oplus_chg -> Resolves directly to 94.0%
        h_oem, _, _, method_oem, det_oem = calculate_health(
            charge_full_uah=5000000,
            charge_full_design_uah=5000000,
            cycle_count=None,
            history_days=2.0,
            oem_reported_soh=94.0
        )
        assert h_oem == 94.0
        assert method_oem == "oem_reported_soh"
        assert det_oem["oem_reported_soh"] == 94.0

        # 3. With 8 days history and estimated cycles -> trend estimation
        h8, _, _, m8, det8 = calculate_health(
            charge_full_uah=5000000,
            charge_full_design_uah=5000000,
            cycle_count=15, # estimated cycles from db
            history_days=8.0,
            oem_reported_soh=None
        )
        assert h8 is not None
        record("Virtual Realme / OnePlus (Oplus_chg & OEM SoH)", True, f"Insufficient (<7d): {h_insuf}, OEM SoH resolved: {h_oem}%, Trend (8d): {h8}%")
    except Exception as e:
        record("Virtual Realme / OnePlus (Oplus_chg & OEM SoH)", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 4: Xiaomi / Redmi (MediaTek mtk-battery & fg_cycle)
# ---------------------------------------------------------------------------
def test_virtual_xiaomi_mtk():
    try:
        serial = "virtual-redmi-note13"
        mock_adb = ADBClient()
        mock_adb.is_available = MagicMock(return_value=True)

        def mock_shell(s, cmd, timeout=None):
            if "ls /sys/class/power_supply" in cmd and "mtk-battery" not in cmd and "fg" not in cmd:
                return ("mtk-battery fg usb", "", 0)
            if "ls /sys/class/power_supply/mtk-battery" in cmd:
                return ("temp voltage_now capacity", "", 0)
            if "ls /sys/class/power_supply/fg" in cmd:
                return ("charge_full charge_full_design fg_cycle", "", 0)
            if "cat /sys/class/power_supply/fg/charge_full" in cmd:
                return ("4900000", "", 0)
            if "cat /sys/class/power_supply/fg/charge_full_design" in cmd:
                return ("5000000", "", 0)
            if "cat /sys/class/power_supply/fg/fg_cycle" in cmd:
                return ("120", "", 0)
            if "dumpsys battery" in cmd:
                return ("level: 65\nvoltage: 3950\ntemperature: 270\nstatus: 3", "", 0)
            return ("", "", 0)

        mock_adb.run_shell = MagicMock(side_effect=mock_shell)
        tree = mock_adb.scan_all_power_supplies(serial)
        assert "fg" in tree
        assert "mtk-battery" in tree
        assert tree["fg"]["charge_full"]["int_val"] == 4900000

        probe = mock_adb.probe_device(serial)
        assert probe["summary"]["cycle_count"] == 120
        assert probe["summary"]["charge_full_uah"] == 4900000

        record("Virtual Xiaomi / Redmi (MediaTek Nodes)", True, f"Discovered nodes: {list(tree.keys())}, Cycle count: {probe['summary']['cycle_count']}")
    except Exception as e:
        record("Virtual Xiaomi / Redmi (MediaTek Nodes)", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 5: Unauthorized Phone (state='unauthorized')
# ---------------------------------------------------------------------------
def test_virtual_unauthorized_phone():
    try:
        with patch("backend.api_routes.adb.is_available", return_value=True), \
             patch("backend.api_routes.adb.get_devices", return_value=[
                 {"serial": "unauth-phone-1234", "state": "unauthorized", "model": "Pixel_7"}
             ]):
            res = client.get("/api/status")
            assert res.status_code == 200
            data = res.json()
            assert data["device_state"] == "unauthorized"
            assert data["unauthorized_count"] == 1
            assert data["active_device_count"] == 0

            # /api/snapshot should return unauthorized guidance
            snap_res = client.get("/api/snapshot")
            assert snap_res.status_code == 200
            snap = snap_res.json()
            assert snap["connected"] is False
            assert snap["connection_state"] == "unauthorized"
            assert snap["health_status"] == "unauthorized"
            assert "connection_guidance" in snap
            record("Virtual Unauthorized Phone", True, f"Guidance returned: {snap['connection_guidance']}")
    except Exception as e:
        record("Virtual Unauthorized Phone", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 6: Offline Phone (state='offline')
# ---------------------------------------------------------------------------
def test_virtual_offline_phone():
    try:
        with patch("backend.api_routes.adb.is_available", return_value=True), \
             patch("backend.api_routes.adb.get_devices", return_value=[
                 {"serial": "offline-phone-9999", "state": "offline", "model": "Galaxy_A54"}
             ]):
            res = client.get("/api/status")
            assert res.status_code == 200
            data = res.json()
            assert data["device_state"] == "offline"
            assert data["offline_count"] == 1

            snap_res = client.get("/api/snapshot")
            assert snap_res.status_code == 200
            snap = snap_res.json()
            assert snap["connected"] is False
            assert snap["connection_state"] == "offline"
            record("Virtual Offline Phone", True, "Correctly reported offline state without crashing")
    except Exception as e:
        record("Virtual Offline Phone", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 7: Disconnected / Standby State (Zero devices)
# ---------------------------------------------------------------------------
def test_virtual_disconnected_idle_state():
    try:
        with patch("backend.api_routes.adb.is_available", return_value=True), \
             patch("backend.api_routes.adb.get_devices", return_value=[]):
            res = client.get("/api/status")
            assert res.status_code == 200
            data = res.json()
            assert data["device_state"] == "none"
            assert data["active_device_count"] == 0

            snap_res = client.get("/api/snapshot")
            assert snap_res.status_code == 200
            snap = snap_res.json()
            assert snap["connected"] is False
            assert snap["connection_state"] == "disconnected"
            assert snap["status"] == "Disconnected"
            assert snap["health_pct"] is None
            record("Virtual Disconnected Idle State", True, f"Idle state verified: status={snap['status']}, health_pct={snap['health_pct']}")
    except Exception as e:
        record("Virtual Disconnected Idle State", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 8: Corrupted / Malformed Sysfs Values
# ---------------------------------------------------------------------------
def test_virtual_corrupted_sysfs():
    try:
        serial = "corrupted-phone"
        mock_adb = ADBClient()
        mock_adb.is_available = MagicMock(return_value=True)

        def mock_shell(s, cmd, timeout=None):
            if "dumpsys battery" in cmd:
                # Malformed strings, negative temp, missing fields
                return ("level: NaN\nvoltage: -1000\ntemperature: 6000\nstatus: Corrupt", "", 0)
            if "ls /sys/class/power_supply" in cmd:
                return ("battery", "", 0)
            if "cat /sys/class/power_supply/battery/charge_full" in cmd:
                return ("-999999", "", 0)
            if "cat /sys/class/power_supply/battery/charge_full_design" in cmd:
                return ("0", "", 0)
            if "cat /sys/class/power_supply/battery/cycle_count" in cmd:
                return ("Permission denied", "", 1)
            return ("", "", 0)

        mock_adb.run_shell = MagicMock(side_effect=mock_shell)
        probe = mock_adb.probe_device(serial)
        summary = probe["summary"]

        # charge_full <= 0 must be ignored / treated as None
        assert summary["charge_full_uah"] is None
        assert summary["charge_full_design_uah"] is None

        # calculate_health with corrupted values
        h, raw, recal, method, det = calculate_health(
            charge_full_uah=None,
            charge_full_design_uah=None,
            cycle_count=None,
            voltage_mv=-1000,
            temperature_c=600.0,
            history_days=0.5
        )
        assert h is None
        assert det["health_status"] == "insufficient_data"
        record("Virtual Corrupted Sysfs Phone", True, "Successfully handled negative, zero, and permission-denied values safely")
    except Exception as e:
        record("Virtual Corrupted Sysfs Phone", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 9: Flaky Phone (Rapid Disconnect/Reconnect Simulation)
# ---------------------------------------------------------------------------
def test_virtual_flaky_reconnection():
    try:
        test_watcher = DeviceWatcher(poll_interval_seconds=1)
        test_watcher.adb.is_available = MagicMock(return_value=True)

        # 1. Connect
        test_watcher.adb.get_devices = MagicMock(return_value=[
            {"serial": "flaky-phone-001", "state": "device", "model": "Flaky_One"}
        ])
        test_watcher.poll_cycle()
        assert test_watcher.last_status["connected"] is True
        assert test_watcher.last_connected_serial == "flaky-phone-001"

        # 2. Immediate Disconnect (within same second)
        test_watcher.adb.get_devices = MagicMock(return_value=[])
        test_watcher.poll_cycle()
        assert test_watcher.last_status["connected"] is False
        assert test_watcher.last_connected_serial is None

        # 3. Reconnect same device
        test_watcher.adb.get_devices = MagicMock(return_value=[
            {"serial": "flaky-phone-001", "state": "device", "model": "Flaky_One"}
        ])
        test_watcher.poll_cycle()
        assert test_watcher.last_status["connected"] is True
        assert test_watcher.last_connected_serial == "flaky-phone-001"

        record("Virtual Flaky Phone (Rapid Jitter)", True, "Handled connect -> disconnect -> connect sequence without stale locks")
    except Exception as e:
        record("Virtual Flaky Phone (Rapid Jitter)", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 10: Dual Concurrent Phones Connected
# ---------------------------------------------------------------------------
def test_virtual_dual_phones_concurrent():
    try:
        phone_a = {"serial": "dual-phone-A", "state": "device", "model": "Phone_A"}
        phone_b = {"serial": "dual-phone-B", "state": "device", "model": "Phone_B"}

        with patch("backend.api_routes.adb.is_available", return_value=True), \
             patch("backend.api_routes.adb.get_devices", return_value=[phone_a, phone_b]):
            
            res = client.get("/api/status")
            assert res.status_code == 200
            data = res.json()
            assert data["active_device_count"] == 2
            assert len(data["connected_devices"]) == 2

            # Seed data for both
            db = Database()
            db.seed_mock_data("dual-phone-A", days=10)
            db.seed_mock_data("dual-phone-B", days=10)

            # Query snapshot with explicit serial
            snap_a = client.get("/api/snapshot?serial=dual-phone-A").json()
            snap_b = client.get("/api/snapshot?serial=dual-phone-B").json()

            assert snap_a["device_serial"] == "dual-phone-A"
            assert snap_b["device_serial"] == "dual-phone-B"

            # Verify history query per device
            hist_a = client.get("/api/history?serial=dual-phone-A&days=10").json()
            hist_b = client.get("/api/history?serial=dual-phone-B&days=10").json()
            assert len(hist_a["readings"]) > 0
            assert len(hist_b["readings"]) > 0

            record("Virtual Dual Phones Concurrent", True, "Successfully isolated sessions, profiles, and history between 2 concurrent devices")
    except Exception as e:
        record("Virtual Dual Phones Concurrent", False, f"Exception: {e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Virtual Phone 11: Nothing Phone 2a (Batterystats Checkin & App Drain)
# ---------------------------------------------------------------------------
def test_virtual_nothing_phone_2a_app_drain():
    try:
        from backend.adb_client import (
            SYNTHETIC_NOTHING_PHONE_2A_CHECKIN,
            SYNTHETIC_NOTHING_PHONE_2A_CHARGED,
            SYNTHETIC_NOTHING_PHONE_2A_PACKAGES,
        )
        from backend.app_battery_stats import parse_batterystats_checkin

        serial = "virtual-nothing-phone-2a"
        mock_adb = ADBClient()
        mock_adb.is_available = MagicMock(return_value=True)

        def mock_shell(s, cmd, timeout=None):
            if "dumpsys batterystats --checkin" in cmd:
                return (SYNTHETIC_NOTHING_PHONE_2A_CHECKIN, "", 0)
            if "dumpsys batterystats --charged" in cmd:
                return (SYNTHETIC_NOTHING_PHONE_2A_CHARGED, "", 0)
            if "pm list packages -U" in cmd:
                return (SYNTHETIC_NOTHING_PHONE_2A_PACKAGES, "", 0)
            return ("", "", 0)

        mock_adb.run_shell = MagicMock(side_effect=mock_shell)

        checkin = mock_adb.pull_batterystats_checkin(serial)
        assert len(checkin) > 0
        assert "Nothing Phone 2a" in checkin

        charged = mock_adb.pull_batterystats_charged(serial)
        assert "Estimated power use (mAh):" in charged

        pkg_map = mock_adb.resolve_package_names([1000, 10123, 10156, 10199, 10045, 10999], serial=serial)
        assert pkg_map[10156] == "com.google.android.youtube"
        assert pkg_map[10123] == "com.instagram.android"
        assert "Uninstalled" in pkg_map[10999]

        parsed = parse_batterystats_checkin(checkin, charged, pkg_map, serial=serial)
        assert len(parsed) >= 5
        top = parsed[0]
        assert top["wakelock_ms"] > 0
        assert top["display_name"] is not None

        record("Virtual Nothing Phone 2a (App Drain Attribution)", True, f"Parsed {len(parsed)} apps, Top: {top['display_name']} ({top['wakelock_duration_display']})")
    except Exception as e:
        record("Virtual Nothing Phone 2a (App Drain Attribution)", False, f"Exception: {e}\n{traceback.format_exc()}")


if __name__ == "__main__":
    print("\n" + "="*70)
    print("RUNNING VIRTUAL PHONE DIAGNOSTIC & STRESS SUITE")
    print("="*70)
    test_virtual_pixel_8()
    test_virtual_samsung_s24_static_register()
    test_virtual_realme_oplus_chg()
    test_virtual_xiaomi_mtk()
    test_virtual_unauthorized_phone()
    test_virtual_offline_phone()
    test_virtual_disconnected_idle_state()
    test_virtual_corrupted_sysfs()
    test_virtual_flaky_reconnection()
    test_virtual_dual_phones_concurrent()
    test_virtual_nothing_phone_2a_app_drain()
    print("="*70)
    passed_count = sum(1 for r in results if r["passed"])
    total_count = len(results)
    print(f"RESULTS: {passed_count}/{total_count} virtual phone scenarios PASSED")
    print("="*70 + "\n")
    if passed_count < total_count:
        sys.exit(1)
    sys.exit(0)
