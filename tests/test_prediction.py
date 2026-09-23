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


# ---------------------------------------------------------------------------
# Tests for new subsystem prediction functions
# ---------------------------------------------------------------------------
from backend.prediction import (
    calculate_capacity_trend,
    calculate_cycle_accumulation_rate,
    calculate_thermal_trend,
    calculate_charge_runtime_estimate,
)
from datetime import datetime, timedelta


def _make_history(n: int, start_health: float = 90.0, slope: float = -0.02,
                  start_cycles: int = 100, cycles_per_day: float = 0.7,
                  base_temp: float = 28.0, start_days_ago: int = 90) -> list:
    """Generates synthetic history dicts for testing."""
    now = datetime.utcnow()
    rows = []
    for i in range(n):
        days_ago = start_days_ago - (start_days_ago / max(n - 1, 1)) * i
        ts = now - timedelta(days=days_ago)
        hp = max(0.0, min(100.0, start_health + slope * (start_days_ago - days_ago)))
        cc = start_cycles + int(cycles_per_day * (start_days_ago - days_ago))
        temp = base_temp + (0.05 * i)
        rows.append({
            "timestamp": ts.isoformat(),
            "health_pct": hp,
            "cycle_count": cc,
            "temperature_c": temp,
        })
    return rows


# --- calculate_capacity_trend ---

def test_capacity_trend_insufficient_data():
    """Fewer than 3 points → insufficient_data flag, no projected values."""
    history = _make_history(2)
    res = calculate_capacity_trend(history)
    assert res["insufficient_data"] is True
    assert res["data_points"] == 2
    assert res["slope_pct_per_day"] is None
    assert res["projected_health_30d"] is None


def test_capacity_trend_declining():
    """10 readings with a clear negative slope → Degrading label."""
    # slope = -0.02 %/day → -0.02 per day should produce trend_label "Degrading"
    history = _make_history(10, start_health=90.0, slope=-0.02)
    res = calculate_capacity_trend(history)
    assert res["insufficient_data"] is False
    assert res["data_points"] == 10
    assert res["slope_pct_per_day"] < 0
    assert res["trend_label"] == "Degrading"
    assert res["projected_health_30d"] is not None
    assert 0.0 <= res["projected_health_30d"] <= 100.0


def test_capacity_trend_stable():
    """Flat health readings → Stable label, slope ≈ 0."""
    history = _make_history(5, start_health=88.0, slope=0.0)
    res = calculate_capacity_trend(history)
    assert res["insufficient_data"] is False
    assert res["trend_label"] == "Stable"
    assert abs(res["slope_pct_per_day"]) < 0.01


# --- calculate_cycle_accumulation_rate ---

def test_cycle_accumulation_insufficient_data():
    """Fewer than 3 readings with cycle_count → insufficient_data."""
    # Only 1 row has cycle_count
    history = [
        {"timestamp": datetime.utcnow().isoformat(), "health_pct": 90.0, "cycle_count": 50, "temperature_c": 28.0},
        {"timestamp": (datetime.utcnow() - timedelta(days=10)).isoformat(), "health_pct": 90.0, "cycle_count": None, "temperature_c": 28.0},
    ]
    res = calculate_cycle_accumulation_rate(history)
    assert res["insufficient_data"] is True


def test_cycle_accumulation_rate_correct():
    """5 readings spanning 60 days with 0.7 cycles/day → correct rate."""
    history = _make_history(5, start_cycles=200, cycles_per_day=0.7, start_days_ago=60)
    res = calculate_cycle_accumulation_rate(history)
    assert res["insufficient_data"] is False
    assert res["data_points"] == 5
    # Allow ±0.15 cycles/day tolerance due to rounding in synthetic history generation
    assert abs(res["cycles_per_day"] - 0.7) < 0.15
    assert res["projected_cycles_30d"] > res["total_cycles_recorded"]
    assert res["projected_cycles_90d"] > res["projected_cycles_30d"]


# --- calculate_thermal_trend ---

def test_thermal_trend_normal():
    """All temps below 36°C → thermal_risk_level 'Normal'."""
    history = _make_history(5, base_temp=28.0)
    res = calculate_thermal_trend(history)
    assert res["insufficient_data"] is False
    assert res["thermal_risk_level"] == "Normal"
    assert res["avg_temp_c"] < 36.0


def test_thermal_trend_high():
    """Peak temp ≥ 42°C → thermal_risk_level 'High'."""
    history = [
        {"timestamp": (datetime.utcnow() - timedelta(days=d)).isoformat(),
         "health_pct": 88.0, "cycle_count": 300, "temperature_c": 42.5 if d == 5 else 30.0}
        for d in range(10, 0, -1)
    ]
    res = calculate_thermal_trend(history)
    assert res["insufficient_data"] is False
    assert res["peak_temp_c"] >= 42.0
    assert res["thermal_risk_level"] == "High"


# --- calculate_charge_runtime_estimate ---

def test_charge_runtime_estimate():
    """4500 mAh design, 85% health, 250 mA draw → ~15.3h runtime."""
    res = calculate_charge_runtime_estimate(
        design_capacity_mah=4500.0,
        health_pct=85.0,
        typical_draw_ma=250.0,
    )
    assert res["insufficient_data"] is False
    effective = 4500.0 * 0.85  # = 3825 mAh
    expected_hours = effective / 250.0  # = 15.3 h
    assert res["effective_capacity_mah"] == round(effective, 0)


# --- calculate_coulomb_confidence ---

def test_coulomb_confidence_metrics():
    """Validates Coulomb integration confidence scaling and error margins."""
    from backend.prediction import calculate_coulomb_confidence

    # Insufficient delta (< 2% or 0 samples)
    res_zero = calculate_coulomb_confidence(0, 0, 0.0)
    assert res_zero["confidence_pct"] == 0.0
    assert res_zero["is_statistically_sound"] is False

    # Low delta (Δ3%)
    res_low = calculate_coulomb_confidence(3, 8, 120.0)
    assert res_low["confidence_pct"] > 0.0
    assert res_low["is_statistically_sound"] is False  # Delta < 5%

    # High delta (Δ20%, 35 samples)
    res_high = calculate_coulomb_confidence(20, 35, 850.0)
    assert res_high["confidence_pct"] >= 80.0
    assert res_high["error_margin_pct"] <= 5.0
    assert res_high["is_statistically_sound"] is True
    assert res_high["confidence_grade"] == "High Confidence"

