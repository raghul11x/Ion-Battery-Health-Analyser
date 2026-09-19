"""
Predictive Battery Replacement & Longevity Engine.
Calculates remaining lifespan, days, and cycles to reach industry & Apple replacement thresholds (80% and 75%).
Also simulates longevity extensions when capping daily charging at 80%.
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
