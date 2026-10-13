"""
Unit tests for Active Coulomb Charge Test Calibration Engine.
"""

import time
from backend.calibration import ActiveCalibrationManager


def test_calibration_manager_lifecycle():
    mgr = ActiveCalibrationManager()
    status = mgr.get_status()
    assert status["status"] == "idle"
    assert status["is_running"] is False

    # Start simulated session
    res = mgr.start_session(
        device_serial="test-phone",
        initial_level_pct=30,
        design_capacity_mah=5000.0,
        simulate=True,
    )
    assert res["is_running"] is True
    assert res["status"] == "recording"
    assert res["device_serial"] == "test-phone"

    # Wait briefly for a simulation tick
    time.sleep(0.15)
    status_mid = mgr.get_status()
    assert status_mid["accumulated_mah"] > 0
    assert status_mid["current_ma"] > 0

    # Stop session
    final_status = mgr.stop_session()
    assert final_status["is_running"] is False
    assert final_status["status"] == "completed"
    assert final_status["accumulated_mah"] > 0

    # Reset
    idle_status = mgr.reset()
    assert idle_status["status"] == "idle"
    assert idle_status["accumulated_mah"] == 0.0
    assert mgr.current_now_path is None


def test_adb_get_current_now_path_battery_priority():
    from unittest.mock import patch
    from backend.adb_client import ADBClient

    adb = ADBClient()
    mock_probe = {
        "power_supplies": {
            "battery": {
                "current_now": {
                    "path": "/sys/class/power_supply/battery/current_now",
                    "readable": True,
                }
            },
            "fg": {
                "current_now": {
                    "path": "/sys/class/power_supply/fg/current_now",
                    "readable": True,
                }
            },
        }
    }
    with patch.object(adb, "probe_device", return_value=mock_probe):
        path = adb.get_current_now_path("test-serial")
        assert path == "/sys/class/power_supply/battery/current_now"


def test_adb_get_current_now_path_deterministic_alternate():
    from unittest.mock import patch
    from backend.adb_client import ADBClient

    adb = ADBClient()
    mock_probe = {
        "power_supplies": {
            "battery": {
                "current_now": {
                    "path": "/sys/class/power_supply/battery/current_now",
                    "readable": False,
                }
            },
            "qcom_bms": {
                "current_now": {
                    "path": "/sys/class/power_supply/qcom_bms/current_now",
                    "readable": True,
                }
            },
            "fg": {
                "current_now": {
                    "path": "/sys/class/power_supply/fg/current_now",
                    "readable": True,
                }
            },
        }
    }
    with patch.object(adb, "probe_device", return_value=mock_probe):
        path = adb.get_current_now_path("test-serial")
        # 'fg' sorts before 'qcom_bms'
        assert path == "/sys/class/power_supply/fg/current_now"


def test_adb_get_current_now_path_no_readable_current():
    from unittest.mock import patch
    from backend.adb_client import ADBClient

    adb = ADBClient()
    mock_probe = {
        "power_supplies": {
            "battery": {
                "current_now": {
                    "path": "/sys/class/power_supply/battery/current_now",
                    "readable": False,
                }
            },
            "usb": {
                "voltage_now": {
                    "path": "/sys/class/power_supply/usb/voltage_now",
                    "readable": True,
                }
            },
        }
    }
    with patch.object(adb, "probe_device", return_value=mock_probe):
        path = adb.get_current_now_path("test-serial")
        assert path is None


def test_adb_get_current_now_path_rejects_unsafe_paths():
    from unittest.mock import patch
    from backend.adb_client import ADBClient

    adb = ADBClient()
    mock_probe = {
        "power_supplies": {
            "battery": {
                "current_now": {
                    "path": "/sys/class/power_supply/battery/current_now; rm -rf /",
                    "readable": True,
                }
            },
            "bad_node": {
                "current_now": {
                    "path": "/sys/class/power_supply/../../etc/shadow",
                    "readable": True,
                }
            },
        }
    }
    with patch.object(adb, "probe_device", return_value=mock_probe):
        path = adb.get_current_now_path("test-serial")
        assert path is None


def test_live_polling_uses_dynamic_discovered_current_node():
    from unittest.mock import MagicMock, patch

    mgr = ActiveCalibrationManager()
    mgr.device_serial = "test-serial"
    mgr.start_level_pct = 50
    mgr.current_level_pct = 50
    mgr.is_running = True

    mock_adb = MagicMock()
    mock_adb.get_current_now_path.return_value = "/sys/class/power_supply/fg/current_now"
    mock_adb.probe_dumpsys_battery.return_value = {"level": 51, "voltage": 4180, "temperature_c": 32.0}
    mock_adb.run_shell.return_value = ("2400000", "", 0)

    def single_tick_wait(timeout):
        mgr._stop_event.set()
        return False

    with patch("backend.adb_client.ADBClient", return_value=mock_adb):
        with patch.object(mgr._stop_event, "wait", side_effect=single_tick_wait):
            mgr._run_live_polling()

    assert mgr.current_now_path == "/sys/class/power_supply/fg/current_now"
    assert mgr.last_current_ma == 2400.0
    mock_adb.run_shell.assert_called_with("test-serial", "cat /sys/class/power_supply/fg/current_now")
    assert len(mgr.samples) == 1
    assert mgr.samples[0]["current_ma"] == 2400.0


def test_live_polling_falls_back_to_battery_path_when_discovery_returns_none():
    from unittest.mock import MagicMock, patch

    mgr = ActiveCalibrationManager()
    mgr.device_serial = "test-serial"
    mgr.start_level_pct = 40
    mgr.current_level_pct = 40
    mgr.is_running = True

    mock_adb = MagicMock()
    mock_adb.get_current_now_path.return_value = None
    mock_adb.probe_dumpsys_battery.return_value = {"level": 40, "voltage": 4100, "temperature_c": 31.0}
    mock_adb.run_shell.return_value = ("1850", "", 0)

    def single_tick_wait(timeout):
        mgr._stop_event.set()
        return False

    with patch("backend.adb_client.ADBClient", return_value=mock_adb):
        with patch.object(mgr._stop_event, "wait", side_effect=single_tick_wait):
            mgr._run_live_polling()

    assert mgr.current_now_path == "/sys/class/power_supply/battery/current_now"
    assert mgr.last_current_ma == 1850.0
    mock_adb.run_shell.assert_called_with("test-serial", "cat /sys/class/power_supply/battery/current_now")


def test_live_polling_falls_back_to_1500ma_on_read_failure():
    from unittest.mock import MagicMock, patch

    mgr = ActiveCalibrationManager()
    mgr.device_serial = "test-serial"
    mgr.start_level_pct = 60
    mgr.current_level_pct = 60
    mgr.is_running = True

    mock_adb = MagicMock()
    mock_adb.get_current_now_path.return_value = "/sys/class/power_supply/fg/current_now"
    mock_adb.probe_dumpsys_battery.return_value = {"level": 60, "voltage": 4200, "temperature_c": 30.0}
    mock_adb.run_shell.return_value = ("error: could not read sysfs", "Permission denied", 1)

    def single_tick_wait(timeout):
        mgr._stop_event.set()
        return False

    with patch("backend.adb_client.ADBClient", return_value=mock_adb):
        with patch.object(mgr._stop_event, "wait", side_effect=single_tick_wait):
            mgr._run_live_polling()

    assert mgr.current_now_path == "/sys/class/power_supply/fg/current_now"
    # Fallback nominal current rate
    assert mgr.last_current_ma == 1500.0


def test_live_polling_rejects_unsafe_resolved_path():
    from unittest.mock import MagicMock, patch

    mgr = ActiveCalibrationManager()
    mgr.device_serial = "test-serial"
    mgr.start_level_pct = 50
    mgr.current_level_pct = 50
    mgr.is_running = True

    mock_adb = MagicMock()
    # Malicious injection attempt returned from dynamic resolution
    mock_adb.get_current_now_path.return_value = "/sys/class/power_supply/battery/current_now; rm -rf /"
    mock_adb.probe_dumpsys_battery.return_value = {"level": 50, "voltage": 4100, "temperature_c": 30.0}
    mock_adb.run_shell.return_value = ("1700", "", 0)

    def single_tick_wait(timeout):
        mgr._stop_event.set()
        return False

    with patch("backend.adb_client.ADBClient", return_value=mock_adb):
        with patch.object(mgr._stop_event, "wait", side_effect=single_tick_wait):
            mgr._run_live_polling()

    # Must safely fall back to canonical safe battery path
    assert mgr.current_now_path == "/sys/class/power_supply/battery/current_now"
    mock_adb.run_shell.assert_called_with("test-serial", "cat /sys/class/power_supply/battery/current_now")

