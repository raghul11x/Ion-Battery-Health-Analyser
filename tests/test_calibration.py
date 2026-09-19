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
