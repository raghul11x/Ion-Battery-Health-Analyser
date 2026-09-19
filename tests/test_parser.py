"""
Unit tests for ADB parser and temperature normalization.
"""

from unittest.mock import MagicMock
from backend.adb_client import ADBClient


def test_dumpsys_battery_parser():
    client = ADBClient()
    # Mock dumpsys battery output
    mock_dumpsys = """
Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  Max charging current: 1500000
  Max charging voltage: 5000000
  Charge counter: 3840000
  status: 2
  health: 2
  present: true
  level: 78
  scale: 100
  voltage: 4125
  temperature: 298
  technology: Li-ion
"""
    client.run_shell = MagicMock(return_value=(mock_dumpsys, "", 0))

    res = client.probe_dumpsys_battery("dummy-serial")
    assert res["level"] == 78
    assert res["voltage"] == 4125
    assert res["temperature_c"] == 29.8  # 298 tenths of C -> 29.8 C
    assert res["status"] == 2
    assert res["status_label"] == "Charging"
    assert res["health"] == 2
    assert res["health_label"] == "Good"
    assert res["charge_counter"] == 3840000


def test_sysfs_paths_parser():
    client = ADBClient()

    def mock_shell(serial, command, **kwargs):
        if "charge_full_design" in command:
            return ("5000000", "", 0)
        elif "charge_full" in command and "design" not in command:
            return ("4850000", "", 0)
        elif "cycle_count" in command:
            return ("84", "", 0)
        return ("", "No such file", 1)

    client.run_shell = MagicMock(side_effect=mock_shell)
    res = client.probe_sysfs_paths("dummy-serial")

    assert res["charge_full_design_uah"] == 5000000
    assert res["charge_full_uah"] == 4850000
    assert res["cycle_count"] == 84
