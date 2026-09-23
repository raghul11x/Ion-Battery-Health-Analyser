"""
Predictive Battery Replacement & Longevity Engine.
Calculates remaining lifespan, days, and cycles to reach industry & Apple replacement thresholds (80% and 75%).
Also simulates longevity extensions when capping daily charging at 80%.
Provides deterministic subsystem forecasts from historical readings:
  - Capacity retention trend (linear regression over health_pct history)
  - Cycle accumulation rate (cycles/day from logged cycle counts)
  - Thermal trend (rolling average + drift detection)
  - Charge/discharge runtime estimates at a given current draw
"""

from __future__ import annotations
from datetime import datetime, timedelta
import math
from typing import Any, Dict, List, Optional


def calculate_replacement_forecast(
    current_health_pct: float,
    cycle_count: Optional[int] = None,
    device_age_days: Optional[float] = None,
    rated_cycles: int = 1000,
    target_threshold_pct: float = 80.0,
) -> Dict[str, Any]:
    """
    Projects battery replacement timeline to reach target threshold (default 80.0%).
    
    Returns:
      - days_remaining: estimated calendar days until hitting threshold
      - months_remaining: estimated months
      - cycles_remaining: estimated charge cycles remaining
      - projected_date_iso: estimated calendar date string (YYYY-MM-DD)
      - daily_cycle_rate: user's calculated cycles per day
      - urgency: 'Healthy' | 'Upcoming' | 'Imminent' | 'Service Recommended'
      - urgency_color: Hex color code for UI
      - status_message: Human-readable diagnosis
      - simulation_80_cap: Lifespan extension if charging capped at 80%
      - recommendations: List of actionable preservation tips
    """
    cycles = max(0, cycle_count or 0)
    
    # Estimate device age if not explicitly provided
    if device_age_days is not None and device_age_days > 0:
        age_days = float(device_age_days)
    elif cycles > 0:
        age_days = max(30.0, cycles * 1.05)
    else:
        age_days = 60.0

    # Calculate daily cycle cadence (clamped to realistic smartphone range: 0.3 - 3.0 cycles/day)
    if cycles > 0:
        daily_cycle_rate = max(0.3, min(3.0, cycles / age_days))
    else:
        daily_cycle_rate = 1.0

    now = datetime.utcnow()

    # Case 1: Already at or below replacement threshold
    if current_health_pct <= target_threshold_pct:
        return {
            "current_health_pct": round(current_health_pct, 1),
            "target_threshold_pct": round(target_threshold_pct, 1),
            "days_remaining": 0,
            "months_remaining": 0.0,
            "cycles_remaining": 0,
            "projected_date_iso": now.strftime("%Y-%m-%d"),
            "projected_date_formatted": now.strftime("%B %Y"),
            "daily_cycle_rate": round(daily_cycle_rate, 2),
            "urgency": "Service Recommended",
            "urgency_color": "#EF4444",
            "status_message": (
                f"Battery health ({current_health_pct:.1f}%) has reached or passed the "
                f"industry replacement boundary ({target_threshold_pct:.0f}%). Service recommended."
            ),
            "simulation_80_cap": {
                "extended_days": 0,
                "extended_months": 0.0,
                "extra_months": 0.0,
                "lifespan_extension_pct": 0,
            },
            "recommendations": [
                "Schedule battery replacement at an authorized service center.",
                "Avoid letting battery drop below 10% to prevent sudden power shutdowns.",
                "Back up device data in case of sudden voltage dropouts under heavy CPU load.",
            ],
        }

    # Case 2: Above threshold -> calculate degradation trajectory
    health_margin = current_health_pct - target_threshold_pct  # e.g., 82.5 - 80.0 = 2.5%

    # Instantaneous degradation velocity:
    # At N cycles on a 1000-cycle cell: d(CycleWear)/dN ≈ 0.019% per cycle
    # Calendar wear velocity: d(CalWear)/dt ≈ 0.0019% per day at ~2 years
    # Operational stress multiplier ≈ 1.015x
    approx_n = max(50, cycles)
    cycle_wear_deriv = 0.95 * (1.0 / rated_cycles) * ((approx_n / float(rated_cycles)) ** -0.05) * 20.0
    cal_wear_deriv = 2.0 / (2.0 * math.sqrt(max(1.0, 365.0 * age_days)))

    daily_wear_rate = (daily_cycle_rate * cycle_wear_deriv + cal_wear_deriv) * 1.015
    daily_wear_rate = max(0.005, min(0.1, daily_wear_rate))  # Safe bounds: 0.005% - 0.1% per day

    days_remaining = int(round(health_margin / daily_wear_rate))
    cycles_remaining = int(round(days_remaining * daily_cycle_rate))
    months_remaining = round(days_remaining / 30.44, 1)

    projected_date = now + timedelta(days=days_remaining)
    projected_date_iso = projected_date.strftime("%Y-%m-%d")

    # Urgency categorization
    if days_remaining > 180:
        urgency = "Healthy"
        urgency_color = "#22C55E"
        status_message = f"Optimal retention. Estimated ~{months_remaining} months of service life remaining before 80% threshold."
    elif days_remaining >= 60:
        urgency = "Upcoming"
        urgency_color = "#F59E0B"
        status_message = f"Normal capacity progression. Estimated ~{months_remaining} months (~{days_remaining} days) until 80% service boundary."
    else:
        urgency = "Imminent"
        urgency_color = "#F97316"
        status_message = f"Service boundary approaching in ~{days_remaining} days (~{cycles_remaining} cycles)."

    # 80% Daily Charging Cap Simulation:
    # Capping daily charge to 80% eliminates high-voltage stress (>4.2V) and halves mechanical expansion strain.
    # Daily wear rate drops by approximately 45%.
    capped_daily_wear_rate = daily_wear_rate * 0.55
    extended_days = int(round(health_margin / capped_daily_wear_rate))
    extended_months = round(extended_days / 30.44, 1)
    extra_months = round(extended_months - months_remaining, 1)

    return {
        "current_health_pct": round(current_health_pct, 1),
        "target_threshold_pct": round(target_threshold_pct, 1),
        "days_remaining": days_remaining,
        "months_remaining": months_remaining,
        "cycles_remaining": cycles_remaining,
        "projected_date_iso": projected_date_iso,
        "projected_date_formatted": projected_date.strftime("%B %Y"),
        "daily_cycle_rate": round(daily_cycle_rate, 2),
        "urgency": urgency,
        "urgency_color": urgency_color,
        "status_message": status_message,
        "simulation_80_cap": {
            "extended_days": extended_days,
            "extended_months": extended_months,
            "extra_months": max(0.0, extra_months),
            "lifespan_extension_pct": 82,  # +82% time gain
        },
        "recommendations": [
            f"Cap daily charging to 80% to gain up to +{extra_months} months of extra battery lifespan.",
            "Avoid charging above 38°C (keep phone away from direct sunlight or heavy gaming while plugged in).",
            "Avoid deep discharges below 15% to protect internal electrode microstructure.",
        ],
    }


# ---------------------------------------------------------------------------
# Subsystem prediction helpers — all pure math, no AI, no DB imports.
# Caller is responsible for passing in db.get_history(serial, limit=150).
# Each function returns `insufficient_data: True` when fewer than 3 points.
# ---------------------------------------------------------------------------

def _linear_regression(xs: List[float], ys: List[float]):
    """
    Returns (slope, intercept, r_squared) via ordinary least squares.
    xs and ys must be equal-length lists with at least 2 elements.
    """
    n = len(xs)
    if n < 2:
        return 0.0, ys[0] if ys else 0.0, 0.0
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    if ss_xx == 0.0:
        return 0.0, mean_y, 0.0
    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    return slope, intercept, round(max(0.0, min(1.0, r_squared)), 4)


def _parse_ts(ts_str: str) -> Optional[datetime]:
    """Parses ISO 8601 timestamp string from db.get_history() rows."""
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str)
    except Exception:
        return None


def calculate_capacity_trend(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Projects capacity retention trajectory using linear regression on
    historical health_pct readings.

    Args:
        history: List of reading dicts from db.get_history() — must contain
                 'timestamp' (ISO str) and 'health_pct' (float).

    Returns dict with keys:
        insufficient_data  bool   — True when < 3 usable readings
        data_points        int    — Number of readings used
        slope_pct_per_day  float  — Health change per calendar day (negative = degrading)
        r_squared          float  — Regression fit quality (0–1)
        projected_health_30d  float | None
        projected_health_90d  float | None
        trend_label        str    — "Degrading" | "Stable" | "Improving"
        days_observed      float  — Calendar span of the history used
    """
    MIN_POINTS = 3

    # Extract usable rows
    points: List[tuple] = []
    for r in history:
        ts = _parse_ts(r.get("timestamp", ""))
        hp = r.get("health_pct")
        if ts is not None and isinstance(hp, (int, float)) and 0 <= hp <= 100:
            points.append((ts, float(hp)))

    if len(points) < MIN_POINTS:
        return {
            "insufficient_data": True,
            "data_points": len(points),
            "slope_pct_per_day": None,
            "r_squared": None,
            "projected_health_30d": None,
            "projected_health_90d": None,
            "trend_label": None,
            "days_observed": None,
        }

    points.sort(key=lambda p: p[0])
    t0 = points[0][0]
    xs = [(p[0] - t0).total_seconds() / 86400.0 for p in points]
    ys = [p[1] for p in points]

    slope, intercept, r_sq = _linear_regression(xs, ys)

    days_observed = xs[-1]
    current_x = days_observed
    projected_30 = round(min(100.0, max(0.0, slope * (current_x + 30) + intercept)), 1)
    projected_90 = round(min(100.0, max(0.0, slope * (current_x + 90) + intercept)), 1)

    if slope < -0.01:
        trend_label = "Degrading"
    elif slope > 0.005:
        trend_label = "Improving"
    else:
        trend_label = "Stable"

    return {
        "insufficient_data": False,
        "data_points": len(points),
        "slope_pct_per_day": round(slope, 5),
        "r_squared": r_sq,
        "projected_health_30d": projected_30,
        "projected_health_90d": projected_90,
        "trend_label": trend_label,
        "days_observed": round(days_observed, 1),
    }


def calculate_cycle_accumulation_rate(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Computes the device's actual cycles-per-day rate from hardware-logged
    cycle_count readings in history.

    Args:
        history: List of reading dicts from db.get_history() — must contain
                 'timestamp' (ISO str) and 'cycle_count' (int | None).

    Returns dict with keys:
        insufficient_data       bool
        data_points             int   — Readings with a non-None cycle_count
        days_observed           float
        total_cycles_recorded   int   — Max cycle_count seen in history
        first_cycle_count       int
        cycles_per_day          float | None
        projected_cycles_30d    int | None
        projected_cycles_90d    int | None
    """
    MIN_POINTS = 3

    points: List[tuple] = []
    for r in history:
        ts = _parse_ts(r.get("timestamp", ""))
        cc = r.get("cycle_count")
        if ts is not None and isinstance(cc, int) and cc >= 0:
            points.append((ts, cc))

    if len(points) < MIN_POINTS:
        return {
            "insufficient_data": True,
            "data_points": len(points),
            "days_observed": None,
            "total_cycles_recorded": None,
            "first_cycle_count": None,
            "cycles_per_day": None,
            "projected_cycles_30d": None,
            "projected_cycles_90d": None,
        }

    points.sort(key=lambda p: p[0])
    t0 = points[0][0]
    days_observed = (points[-1][0] - t0).total_seconds() / 86400.0
    first_cc = points[0][1]
    last_cc = points[-1][1]
    delta_cycles = max(0, last_cc - first_cc)

    if days_observed > 0:
        cycles_per_day = round(delta_cycles / days_observed, 4)
    else:
        cycles_per_day = 0.0

    projected_30 = last_cc + int(round(cycles_per_day * 30))
    projected_90 = last_cc + int(round(cycles_per_day * 90))

    return {
        "insufficient_data": False,
        "data_points": len(points),
        "days_observed": round(days_observed, 1),
        "total_cycles_recorded": last_cc,
        "first_cycle_count": first_cc,
        "cycles_per_day": cycles_per_day,
        "projected_cycles_30d": projected_30,
        "projected_cycles_90d": projected_90,
    }


def calculate_thermal_trend(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyses temperature history to compute rolling average, peak, and drift.

    Args:
        history: List of reading dicts from db.get_history() — must contain
                 'timestamp' (ISO str) and 'temperature_c' (float | None).

    Returns dict with keys:
        insufficient_data   bool
        data_points         int
        avg_temp_c          float | None
        peak_temp_c         float | None
        rolling_avg_7d      float | None   — Average of most recent 7 calendar days
        drift_c_per_day     float | None   — Slope of temperature over time
        thermal_risk_level  str | None     — "Normal" | "Elevated" | "High"
        days_observed       float | None
    """
    MIN_POINTS = 3

    points: List[tuple] = []
    for r in history:
        ts = _parse_ts(r.get("timestamp", ""))
        tc = r.get("temperature_c")
        if ts is not None and isinstance(tc, (int, float)) and -10 <= tc <= 80:
            points.append((ts, float(tc)))

    if len(points) < MIN_POINTS:
        return {
            "insufficient_data": True,
            "data_points": len(points),
            "avg_temp_c": None,
            "peak_temp_c": None,
            "rolling_avg_7d": None,
            "drift_c_per_day": None,
            "thermal_risk_level": None,
            "days_observed": None,
        }

    points.sort(key=lambda p: p[0])
    t0 = points[0][0]
    t_last = points[-1][0]
    days_observed = (t_last - t0).total_seconds() / 86400.0

    temps = [p[1] for p in points]
    avg_temp = round(sum(temps) / len(temps), 1)
    peak_temp = round(max(temps), 1)

    # Rolling 7-day average (most recent 7 days)
    cutoff_7d = t_last - timedelta(days=7)
    recent = [p[1] for p in points if p[0] >= cutoff_7d]
    rolling_avg_7d = round(sum(recent) / len(recent), 1) if recent else avg_temp

    # Thermal drift (°C/day) from linear regression
    xs = [(p[0] - t0).total_seconds() / 86400.0 for p in points]
    slope, _, _ = _linear_regression(xs, temps)
    drift = round(slope, 4)

    if peak_temp >= 42.0 or avg_temp >= 40.0:
        risk = "High"
    elif peak_temp >= 38.0 or avg_temp >= 36.0:
        risk = "Elevated"
    else:
        risk = "Normal"

    return {
        "insufficient_data": False,
        "data_points": len(points),
        "avg_temp_c": avg_temp,
        "peak_temp_c": peak_temp,
        "rolling_avg_7d": rolling_avg_7d,
        "drift_c_per_day": drift,
        "thermal_risk_level": risk,
        "days_observed": round(days_observed, 1),
    }


def calculate_charge_runtime_estimate(
    design_capacity_mah: float,
    health_pct: float,
    typical_draw_ma: float = 250.0,
) -> Dict[str, Any]:
    """
    Estimates effective discharge runtime at the current health level and a
    given average current draw.

    Args:
        design_capacity_mah: OEM-rated capacity in mAh (e.g. 4500).
        health_pct:           Current battery health 0–100.
        typical_draw_ma:      Average current draw in mA (default 250 mA —
                              typical mixed-use smartphone load).

    Returns dict with keys:
        estimated_runtime_hours  float
        new_battery_hours        float  — Runtime at 100% health, same draw
        runtime_loss_pct         float  — How much runtime was lost to degradation
        at_health_pct            float
        at_draw_ma               float
        design_capacity_mah      float
        effective_capacity_mah   float
    """
    if design_capacity_mah <= 0 or not (0 < health_pct <= 100) or typical_draw_ma <= 0:
        return {
            "estimated_runtime_hours": None,
            "new_battery_hours": None,
            "runtime_loss_pct": None,
            "at_health_pct": round(health_pct, 1),
            "at_draw_ma": round(typical_draw_ma, 1),
            "design_capacity_mah": round(design_capacity_mah, 0),
            "effective_capacity_mah": None,
            "insufficient_data": True,
        }

    effective_mah = design_capacity_mah * (health_pct / 100.0)
    runtime_hours = round(effective_mah / typical_draw_ma, 2)
    new_hours = round(design_capacity_mah / typical_draw_ma, 2)
    loss_pct = round((1.0 - (effective_mah / design_capacity_mah)) * 100.0, 1)

    return {
        "estimated_runtime_hours": runtime_hours,
        "new_battery_hours": new_hours,
        "runtime_loss_pct": loss_pct,
        "at_health_pct": round(health_pct, 1),
        "at_draw_ma": round(typical_draw_ma, 1),
        "design_capacity_mah": round(design_capacity_mah, 0),
        "effective_capacity_mah": round(effective_mah, 0),
        "insufficient_data": False,
    }
