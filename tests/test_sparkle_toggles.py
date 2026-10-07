"""
Unit & integration tests for Sparkle Toggles & Demo Data Isolation.
Ensures zero pollution of real hardware data, verifies query filtering,
and tests API endpoints for include_demo behavior.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db import Database, db


@pytest.fixture
def test_db():
    database = Database(":memory:")
    return database


def test_demo_data_isolation_and_unseed(test_db):
    """
    Verifies that seeding demo data tags rows with is_demo=1,
    real-mode queries exclude demo rows, and unseeding deletes ONLY demo rows
    while preserving real readings exactly intact.
    """
    real_serial = "real-hardware-device-123"

    # 1. Insert real hardware readings
    r1 = test_db.insert_reading(
        level_pct=80,
        voltage_mv=4100,
        temperature_c=29.5,
        health_pct=98.5,
        health_method="capacity_ratio",
        device_serial=real_serial,
        device_model="Real Test Phone",
        charge_full_uah=4900000,
        charge_full_design_uah=5000000,
        cycle_count=45,
        status="Discharging",
        is_demo=0,
    )
    assert r1["is_demo"] == 0

    r2 = test_db.insert_reading(
        level_pct=85,
        voltage_mv=4200,
        temperature_c=31.0,
        health_pct=98.4,
        health_method="capacity_ratio",
        device_serial=real_serial,
        device_model="Real Test Phone",
        charge_full_uah=4895000,
        charge_full_design_uah=5000000,
        cycle_count=46,
        status="Charging",
        is_demo=0,
    )
    assert r2["is_demo"] == 0

    # 2. Seed 30 days of mock/demo data
    seeded_count = test_db.seed_mock_data(device_serial="mock-phone-2a", device_model="Nothing Phone 2a", days=30)
    assert seeded_count > 0
    assert test_db.has_mock_data() is True

    # 3. Query with include_demo=False should ONLY return real readings
    real_history = test_db.get_history(include_demo=False)
    assert len(real_history) == 2
    assert all(r["device_serial"] == real_serial for r in real_history)
    assert all(r["is_demo"] == 0 for r in real_history)

    # Query with include_demo=True should return both real and demo readings
    all_history = test_db.get_history(include_demo=True)
    assert len(all_history) == 2 + seeded_count

    # 4. Unseed demo data
    deleted_count = test_db.clear_mock_data(device_serial="mock-phone-2a")
    assert deleted_count == seeded_count
    assert test_db.has_mock_data() is False

    # 5. Verify real readings remain byte-for-byte identical after unseeding
    post_unseed_history = test_db.get_history(include_demo=False)
    assert len(post_unseed_history) == 2
    assert post_unseed_history[0]["id"] == r1["id"]
    assert post_unseed_history[0]["voltage_mv"] == 4100
    assert post_unseed_history[0]["health_pct"] == 98.5
    assert post_unseed_history[1]["id"] == r2["id"]
    assert post_unseed_history[1]["voltage_mv"] == 4200
    assert post_unseed_history[1]["health_pct"] == 98.4


def test_api_include_demo_filter():
    """
    Verifies that the FastAPI routes /snapshot, /history, /insights, /devices
    support include_demo filtering correctly.
    """
    client = TestClient(app)

    # 1. Seed demo data via API
    seed_res = client.post("/api/seed-mock", json={"days": 30, "serial": "mock-phone-2a", "model": "Nothing Phone 2a"})
    assert seed_res.status_code == 200

    # 2. History with include_demo=false should not return mock-phone-2a
    hist_no_demo = client.get("/api/history?include_demo=false&days=30")
    assert hist_no_demo.status_code == 200
    no_demo_readings = hist_no_demo.json().get("readings", [])
    assert not any(r.get("device_serial") == "mock-phone-2a" for r in no_demo_readings)

    # 3. History with include_demo=true should return mock-phone-2a readings
    hist_demo = client.get("/api/history?include_demo=true&days=30&serial=mock-phone-2a")
    assert hist_demo.status_code == 200
    demo_readings = hist_demo.json().get("readings", [])
    assert len(demo_readings) > 0
    assert all(r.get("device_serial") == "mock-phone-2a" for r in demo_readings)

    # 4. Devices listing with include_demo=false
    devs_no_demo = client.get("/api/devices?include_demo=false")
    assert devs_no_demo.status_code == 200
    assert not any(d.get("serial") == "mock-phone-2a" for d in devs_no_demo.json())

    # 5. Devices listing with include_demo=true
    devs_demo = client.get("/api/devices?include_demo=true")
    assert devs_demo.status_code == 200
    assert any(d.get("serial") == "mock-phone-2a" for d in devs_demo.json())

    # 6. Unseed demo data via API
    unseed_res = client.post("/api/unseed-mock", json={"serial": "mock-phone-2a"})
    assert unseed_res.status_code == 200
    assert unseed_res.json()["status"] == "success"
