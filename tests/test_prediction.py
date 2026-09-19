"""
Unit tests for Predictive Replacement Timeline Engine.
"""

from backend.prediction import calculate_replacement_forecast


def test_prediction_for_user_phone():
    # 706 cycles, ~82.5% health, 2 years old
    res = calculate_replacement_forecast(
        current_health_pct=82.5,
        cycle_count=706,
        device_age_days=730,
        rated_cycles=1000,
        target_threshold_pct=80.0,
    )
    # Remaining margin: 2.5% -> ~100 to 150 days
    assert 80 <= res["days_remaining"] <= 180
    assert 2.5 <= res["months_remaining"] <= 6.0
    assert res["urgency"] == "Upcoming"
    assert res["urgency_color"] == "#F59E0B"
    assert "projected_date_iso" in res
    assert "projected_date_formatted" in res
    assert res["simulation_80_cap"]["extra_months"] > 1.0


def test_prediction_already_at_threshold():
    # Battery already at 79% (below 80% boundary)
    res = calculate_replacement_forecast(
        current_health_pct=79.0,
        cycle_count=850,
        target_threshold_pct=80.0,
    )
    assert res["days_remaining"] == 0
    assert res["months_remaining"] == 0.0
    assert res["cycles_remaining"] == 0
    assert res["urgency"] == "Service Recommended"
    assert res["urgency_color"] == "#EF4444"


def test_prediction_brand_new_battery():
    # Brand new battery: 100% health, 5 cycles
    res = calculate_replacement_forecast(
        current_health_pct=100.0,
        cycle_count=5,
        device_age_days=10,
        rated_cycles=1000,
        target_threshold_pct=80.0,
    )
    assert res["days_remaining"] > 500
    assert res["months_remaining"] > 18.0
    assert res["urgency"] == "Healthy"
    assert res["urgency_color"] == "#22C55E"
