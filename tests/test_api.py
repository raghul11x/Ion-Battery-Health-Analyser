"""
Integration tests for FastAPI endpoints.
"""

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_api_status_endpoint():
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert "adb_available" in data
    assert "connected_devices" in data
    assert "watcher_status" in data


def test_api_snapshot_endpoint():
    res = client.get("/api/snapshot")
    assert res.status_code == 200
    data = res.json()
    assert "health_band" in data
    assert "temperature_band" in data
    assert data["cycle_count"] is None
    assert data["cycle_count_type"] == "unavailable"
    assert data["cycle_count_display"] == "Unavailable"


def test_api_seed_and_history():
    # Seed mock data
    res_seed = client.post("/api/seed-mock", json={"days": 30, "serial": "api-test-device", "model": "Test Phone"})
    assert res_seed.status_code == 200
    assert res_seed.json()["status"] == "success"

    # Query history
    res_hist = client.get("/api/history?days=30&limit=50")
    assert res_hist.status_code == 200
    data = res_hist.json()
    assert "readings" in data
    assert len(data["readings"]) > 0

    # Query insights
    res_ins = client.get("/api/insights")
    assert res_ins.status_code == 200
    ins = res_ins.json()
    assert "time_above_80_pct" in ins
    assert "insights_list" in ins


def test_api_device_profile_endpoint():
    # Query device-profile
    res = client.get("/api/device-profile?serial=api-test-device")
    assert res.status_code == 200
    data = res.json()
    assert "device_serial" in data
    assert "profile" in data


def test_api_prediction_endpoint():
    # 1. Standalone default preview call
    res = client.get("/api/prediction")
    assert res.status_code == 200
    data = res.json()
    assert "forecast" in data
    fc = data["forecast"]
    assert "days_remaining" in fc
    assert "projected_date_iso" in fc
    assert "urgency" in fc
    assert "simulation_80_cap" in fc
    assert fc["simulation_80_cap"]["extra_months"] >= 0

    # 2. Standalone call with explicit parameter overrides
    res_param = client.get("/api/prediction?target=80.0&health=75.0&cycles=550")
    assert res_param.status_code == 200
    data_param = res_param.json()
    assert data_param["insufficient_data"] is False
    assert data_param["forecast"]["current_health_pct"] == 75.0
    assert data_param["forecast"]["urgency"] == "Service Recommended"
    assert data_param["forecast"]["months_remaining"] == 0.0

    # 3. Standalone call with unknown serial (insufficient data path)
    res_unknown = client.get("/api/prediction?serial=unknown-phone-no-data")
    assert res_unknown.status_code == 200
    data_unknown = res_unknown.json()
    assert data_unknown["insufficient_data"] is True
    assert data_unknown["forecast"] is None
    assert "Not enough data yet" in data_unknown["message"]


def test_api_calibration_endpoints():
    # Start simulated calibration session
    start_res = client.post("/api/calibration/start", json={"simulate": True, "serial": "api-test-device"})
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert start_data["is_running"] is True or start_data["status"] in ("recording", "already_running")

    # Get status
    status_res = client.get("/api/calibration/status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert "accumulated_mah" in status_data
    assert "status" in status_data

    # Stop session
    stop_res = client.post("/api/calibration/stop")
    assert stop_res.status_code == 200
    stop_data = stop_res.json()
    assert stop_data["is_running"] is False

    # Check history
    hist_res = client.get("/api/calibration/history?serial=api-test-device")
    assert hist_res.status_code == 200
    hist_data = hist_res.json()
    assert isinstance(hist_data, list)

    # Reset
    reset_res = client.post("/api/calibration/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["status"] == "idle"


def test_api_reconnect_and_unauthorized_state():
    from unittest.mock import MagicMock, patch
    from backend import api_routes

    # Test /api/reconnect endpoint
    res = client.post("/api/reconnect")
    assert res.status_code == 200
    assert "adb_available" in res.json()

    # Test unauthorized device reporting
    mock_adb = MagicMock()
    mock_adb.is_available.return_value = True
    mock_adb.get_devices.return_value = [{"serial": "unauth-device-999", "state": "unauthorized"}]

    with patch.object(api_routes, "adb", mock_adb):
        status_res = client.get("/api/status")
        assert status_res.status_code == 200
        data = status_res.json()
        assert data["unauthorized_count"] == 1
        assert data["device_state"] == "unauthorized"

        snap_res = client.get("/api/snapshot")
        assert snap_res.status_code == 200
        snap = snap_res.json()
        assert snap["health_status"] == "unauthorized"
        assert "connection_guidance" in snap


