"""
Unit tests for Battery Health Calculation Engine.
"""

from backend.health import (
    calculate_health,
    normalize_capacity_units,
    get_health_band,
    get_temperature_band,
)


def test_capacity_ratio_standard():
    # 4750 mAh current / 5000 mAh design = 95.0%
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4750000,
        charge_full_design_uah=5000000,
        charge_counter_uah=None,
        level_pct=100,
    )
    assert method == "capacity_ratio"
    assert pct == 95.0
    assert raw_ratio == 95.0
    assert recalibrated is False
    assert details["raw_capacity_ratio"] == 95.0


def test_capacity_ratio_strict_100_cap():
    # Factory fresh or calibration quirk returning 106% clamped to strictly 100.0%
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=5300000,
        charge_full_design_uah=5000000,
        charge_counter_uah=None,
        level_pct=100,
    )
    assert method == "capacity_ratio"
    # Displayed health % must NEVER exceed 100.0%
    assert pct == 100.0
    # But uncapped raw ratio must preserve the actual 106.0%
    assert raw_ratio == 106.0
    assert recalibrated is True
    assert details["raw_capacity_ratio"] == 106.0


def test_normalize_units_nothing_phone_2a_10x():
    """
    Tests Nothing Phone 2a (MediaTek) quirk:
    charge_full = 4,998,000 uAh
    charge_full_design = 499,000 (10 uAh units, representing 4,990 mAh)
    """
    norm_full, norm_design, raw_ratio_before, explanation = normalize_capacity_units(
        charge_full_raw=4998000,
        charge_full_design_raw=499000,
    )
    assert norm_full == 4998000
    assert norm_design == 4990000
    assert round(raw_ratio_before, 2) == 10.02
    assert "10x scale mismatch" in explanation

    # Verify through calculate_health
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4998000,
        charge_full_design_uah=499000,
        charge_counter_uah=None,
        level_pct=100,
    )
    assert method == "capacity_ratio"
    assert pct == 100.0  # capped at 100%
    assert raw_ratio == 100.16  # actual uncapped ratio
    assert recalibrated is True
    assert details["charge_full_design_uah"] == 4990000


def test_normalize_units_1000x_mismatch():
    """Tests device reporting design capacity in mAh (5000) and charge_full in uAh (4750000)."""
    norm_full, norm_design, raw_ratio_before, explanation = normalize_capacity_units(
        charge_full_raw=4750000,
        charge_full_design_raw=5000,
    )
    assert norm_full == 4750000
    assert norm_design == 5000000
    assert "1000x scale mismatch" in explanation


def test_trend_estimate_fallback_with_baseline():
    # Baseline was 5000000 uAh at 100%, now at 4600000 uAh at 100% -> 92.0%
    baseline = {
        "charge_full_uah": 5000000,
        "charge_counter_uah": 5000000,
        "level_pct": 100,
        "timestamp": "2026-08-01T12:00:00",
    }
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=None,
        charge_full_design_uah=None,
        charge_counter_uah=4600000,
        level_pct=100,
        baseline_record=baseline,
    )
    assert method == "trend_estimate"
    assert pct == 92.0
    assert raw_ratio == 92.0
    assert recalibrated is False
    assert "baseline_timestamp" in details


def test_trend_estimate_first_connection_default():
    # First connection with no design capacity and no prior baseline establishes 100.0%
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=None,
        charge_full_design_uah=None,
        charge_counter_uah=4500000,
        level_pct=90,
        baseline_record=None,
    )
    assert method == "trend_estimate"
    assert pct == 100.0
    assert raw_ratio == 100.0
    assert recalibrated is False
    assert "Initial baseline" in details["note"]


def test_health_bands():
    good = get_health_band(92.0)
    assert good["band"] == "Good"
    assert good["color_hex"] == "#22C55E"

    fair = get_health_band(76.5)
    assert fair["band"] == "Fair"
    assert fair["color_hex"] == "#F59E0B"

    poor = get_health_band(64.0)
    assert poor["band"] == "Poor"
    assert poor["color_hex"] == "#EF4444"

    unknown = get_health_band(None)
    assert unknown["band"] == "Unknown"
    assert unknown["color_hex"] == "#64748B"


def test_thermal_bands():
    cool = get_temperature_band(28.5)
    assert cool["status"] == "Cool"

    warm = get_temperature_band(38.2)
    assert warm["status"] == "Warm"

    hot = get_temperature_band(44.0)
    assert hot["status"] == "Hot"


def test_calculate_apple_standard_health_direct():
    from backend.health import calculate_apple_standard_health

    # 706 cycles over 730 days (~2 years), 4990 mAh battery
    res = calculate_apple_standard_health(
        cycle_count=706,
        charge_full_design_uah=4990000,
        device_age_days=730,
        temperature_c=33.0,
        voltage_mv=4205,
        rated_cycles=1000,
    )
    # Cycle wear: ~14.4%, Calendar wear: ~2.8%
    assert 81.0 <= res["apple_health_pct"] <= 83.5
    assert 13.5 <= res["cycle_wear_pct"] <= 15.5
    assert 2.5 <= res["calendar_wear_pct"] <= 3.2
    assert 4050000 <= res["effective_capacity_uah"] <= 4150000


def test_apple_standard_calibration_for_user_phone():
    """
    Simulates user's Nothing Phone 2a:
    - 706 hardware cycles
    - 2 years old
    - OEM register static at 4,998,000 uAh (reporting ~100.16% ratio)
    """
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4998000,
        charge_full_design_uah=499000,  # 10 uAh units
        charge_counter_uah=4448220,
        level_pct=89,
        cycle_count=706,
        voltage_mv=4263,
        temperature_c=34.0,
    )
    assert method == "apple_standard_calibrated"
    assert 81.0 <= pct <= 83.5  # Realistic 2-year Fair condition health
    assert raw_ratio == 100.16  # Preserves raw ratio for audit
    assert recalibrated is True
    assert details["is_uncalibrated_static_register"] is True
    assert details["charge_full_uah"] == 4998000
    assert 4050000 <= details["effective_capacity_uah"] <= 4150000
    assert "apple_standard" in details


def test_brand_new_phone_does_not_trigger_static_override():
    """New phone with 5 cycles should report true 100% capacity ratio."""
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=5000000,
        charge_full_design_uah=5000000,
        charge_counter_uah=5000000,
        level_pct=100,
        cycle_count=5,
        device_age_days=7,
    )
    assert method == "capacity_ratio"
    assert pct == 100.0
    assert details["is_uncalibrated_static_register"] is False


def test_real_dynamic_degradation_does_not_override():
    """If OEM fuel gauge already measures dynamic degradation (e.g. 83%), use real reading."""
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4150000,
        charge_full_design_uah=5000000,
        charge_counter_uah=3500000,
        level_pct=85,
        cycle_count=600,
    )
    assert method == "capacity_ratio"
    assert pct == 83.0
    assert raw_ratio == 83.0
    assert details["is_uncalibrated_static_register"] is False
    assert details["effective_capacity_uah"] == 4150000

