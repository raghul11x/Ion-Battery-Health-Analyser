"""
Unit tests for SQLite Data Layer.
"""

from backend.db import Database


def test_database_crud_and_history():
    db = Database(":memory:")

    # Insert test readings
    r1 = db.insert_reading(
        level_pct=50,
        voltage_mv=3850,
        temperature_c=27.4,
        health_pct=98.0,
        health_method="capacity_ratio",
        device_serial="phone-a",
        device_model="Nothing Phone 2a",
        charge_full_uah=4900000,
        charge_full_design_uah=5000000,
        cycle_count=10,
        status="Discharging",
    )
    assert r1["id"] == 1
    assert r1["health_pct"] == 98.0

    r2 = db.insert_reading(
        level_pct=85,
        voltage_mv=4200,
        temperature_c=31.0,
        health_pct=97.8,
        health_method="capacity_ratio",
        device_serial="phone-a",
        device_model="Nothing Phone 2a",
        charge_full_uah=4890000,
        charge_full_design_uah=5000000,
        cycle_count=11,
        status="Charging",
    )
    assert r2["id"] == 2

    # Latest reading
    latest = db.get_latest_reading("phone-a")
    assert latest is not None
    assert latest["id"] == 2
    assert latest["level_pct"] == 85

    # First baseline
    base = db.get_first_baseline("phone-a")
    assert base is not None
    assert base["id"] == 1
    assert base["charge_full_uah"] == 4900000

    # History chronological
    history = db.get_history("phone-a")
    assert len(history) == 2
    assert history[0]["id"] == 1
    assert history[1]["id"] == 2


def test_insights_aggregation():
    db = Database(":memory:")

    # Insert 4 readings
    db.insert_reading(level_pct=90, voltage_mv=4250, temperature_c=32.0, health_pct=98.0, health_method="capacity_ratio", status="Charging")
    db.insert_reading(level_pct=85, voltage_mv=4210, temperature_c=37.5, health_pct=97.5, health_method="capacity_ratio", status="Charging")
    db.insert_reading(level_pct=40, voltage_mv=3750, temperature_c=26.0, health_pct=97.0, health_method="capacity_ratio", status="Discharging")
    db.insert_reading(level_pct=20, voltage_mv=3600, temperature_c=25.0, health_pct=96.5, health_method="capacity_ratio", status="Discharging")

    insights = db.get_insights()
    assert insights["total_readings"] == 4
    # 2 out of 4 readings >= 80% -> 50%
    assert insights["time_above_80_pct"] == 50.0
    assert len(insights["insights_list"]) >= 2
    assert insights["health_delta_pct"] == -1.5


def test_seed_mock_data():
    db = Database(":memory:")
    count = db.seed_mock_data(device_serial="test-mock", days=30)
    assert count == 90

    history = db.get_history("test-mock", limit=100)
    assert len(history) == 90
    assert history[0]["health_pct"] >= history[-1]["health_pct"]
