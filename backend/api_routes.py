"""
FastAPI REST API Routes
Provides data endpoints for the frontend dashboard and PyWebview shell.
"""

from __future__ import annotations
from datetime import datetime
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.adb_client import ADBClient
from backend.calibration import calibration_manager
from backend.db import db
from backend.health import calculate_health, get_health_band, get_temperature_band
from backend.prediction import calculate_replacement_forecast
from backend.status_bus import get_recent_status
from backend.watcher import watcher

logger = logging.getLogger("battery_analyzer.api")

router = APIRouter(prefix="/api", tags=["Battery Analyzer"])
adb = ADBClient()


class SeedRequest(BaseModel):
    days: int = 30
    serial: str = "mock-phone-2a"
    model: str = "Nothing Phone 2a"


class LogReadingRequest(BaseModel):
    serial: Optional[str] = None


@router.get("/status")
def get_system_status() -> Dict[str, Any]:
    """Returns ADB availability, detected devices, and watcher state."""
    is_avail = adb.is_available()
    devices = adb.get_devices() if is_avail else []
    active = [d for d in devices if d.get("state") == "device"]
    unauth = [d for d in devices if d.get("state") == "unauthorized"]
    offline = [d for d in devices if d.get("state") == "offline"]
    return {
        "adb_available": is_avail,
        "adb_path": adb.adb_path,
        "connected_devices": devices,
        "active_device_count": len(active),
        "unauthorized_count": len(unauth),
        "offline_count": len(offline),
        "device_state": "device" if active else ("unauthorized" if unauth else ("offline" if offline else "none")),
        "watcher_status": watcher.get_status(),
    }


@router.get("/device-status")
def get_device_status(limit: int = Query(default=20, ge=1, le=100), serial: Optional[str] = None) -> Dict[str, Any]:
    """Returns the live stream of real hardware and background activity events."""
    events = get_recent_status(limit=limit, device_serial=serial)
    return {
        "status": "ok",
        "count": len(events),
        "events": events,
    }


@router.post("/reconnect")
def reconnect_adb() -> Dict[str, Any]:
    """Restarts ADB server and triggers an immediate watcher device poll."""
    logger.info("Reconnect requested by user/client. Restarting ADB daemon...")
    adb.restart_server()
    watcher.poll_cycle()
    return get_system_status()


@router.get("/snapshot")
def get_snapshot(serial: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns current snapshot. If phone is connected, returns live hardware reading.
    Otherwise returns latest recorded reading from SQLite.
    """
    devices = adb.get_devices() if adb.is_available() else []
    active = [d for d in devices if d.get("state") == "device"]
    unauth = [d for d in devices if d.get("state") == "unauthorized"]
    offline = [d for d in devices if d.get("state") == "offline"]

    # Special handling for device connected but waiting for USB debugging authorization
    if not active and unauth:
        u_dev = unauth[0]
        logger.info(f"Detected unauthorized device {u_dev.get('serial')}. Awaiting user approval on phone screen.")
        return {
            "live": False,
            "connected": False,
            "connection_state": "unauthorized",
            "device_serial": u_dev.get("serial"),
            "device_model": u_dev.get("model") or "Android Device",
            "level_pct": None,
            "voltage_mv": None,
            "temperature_c": None,
            "health_pct": None,
            "effective_capacity_uah": None,
            "replacement_forecast": None,
            "cycle_count": None,
            "cycle_count_type": "unavailable",
            "cycle_count_display": "Unavailable",
            "health_status": "unauthorized",
            "status": "Unauthorized",
            "health_flag": "Unknown",
            "health_band": "unknown",
            "temperature_band": "normal",
            "connection_guidance": "Phone detected! Please unlock your phone screen and tap 'Allow USB debugging' on the prompt.",
        }

    # Special handling for offline device (cable / socket issue)
    if not active and offline:
        off_dev = offline[0]
        logger.warning(f"Detected offline device {off_dev.get('serial')}.")
        return {
            "live": False,
            "connected": False,
            "connection_state": "offline",
            "device_serial": off_dev.get("serial"),
            "device_model": off_dev.get("model") or "Android Device",
            "level_pct": None,
            "voltage_mv": None,
            "temperature_c": None,
            "health_pct": None,
            "effective_capacity_uah": None,
            "replacement_forecast": None,
            "cycle_count": None,
            "cycle_count_type": "unavailable",
            "cycle_count_display": "Unavailable",
            "health_status": "offline",
            "status": "Offline",
            "health_flag": "Unknown",
            "health_band": "unknown",
            "temperature_band": "normal",
            "connection_guidance": "Device is offline. Please reconnect USB cable or toggle USB Debugging in Developer Options.",
        }

    # No device actively connected over USB and no explicit serial requested -> Return clean idle state
    if not active and not serial:
        return {
            "live": False,
            "connected": False,
            "connection_state": "disconnected",
            "device_serial": None,
            "device_model": None,
            "level_pct": None,
            "voltage_mv": None,
            "temperature_c": None,
            "health_pct": None,
            "effective_capacity_uah": None,
            "charge_full_uah": None,
            "charge_full_design_uah": None,
            "replacement_forecast": None,
            "cycle_count": None,
            "cycle_count_type": "unavailable",
            "cycle_count_display": "Unavailable",
            "health_status": "disconnected",
            "status": "Disconnected",
            "health_flag": "Unknown",
            "health_band": "unknown",
            "temperature_band": "normal",
        }

    target_serial = serial or (active[0]["serial"] if active else None)
    if not target_serial:
        db_devs = db.get_devices()
        real_devs = [
            d for d in db_devs
            if not any(d["serial"].startswith(p) for p in ("auto-test", "api-test", "mock-", "test-"))
        ]
        if real_devs:
            target_serial = real_devs[0]["serial"]
        elif db_devs:
            target_serial = db_devs[0]["serial"]

    # 1. LIVE HARDWARE SNAPSHOT
    if target_serial and any(d["serial"] == target_serial for d in active):
        try:
            probe = adb.probe_device(target_serial)
            summary = probe["summary"]
            dev_info = probe["device_info"]

            level_pct = summary.get("level_pct") or 0
            voltage_mv = summary.get("voltage_mv") or 0
            temp_c = summary.get("temperature_c") or 25.0
            counter_uah = summary.get("charge_counter_uah")
            charge_full_uah = summary.get("charge_full_uah")
            charge_full_design_uah = summary.get("charge_full_design_uah")

            # Check cached profile for OEM SoH and data sources
            profile = db.get_device_profile(target_serial)
            oem_soh = profile.get("oem_reported_soh") if profile else None
            history_days = db.get_history_duration_days(target_serial)

            # NOTE: Cycle count MUST be resolved before data_sources dictionary is constructed!
            hw_cycle_count = summary.get("cycle_count")
            if hw_cycle_count is not None and hw_cycle_count >= 0:
                cycle_count = hw_cycle_count
                cycle_count_type = "hardware"
            else:
                if history_days >= 7.0:
                    est_cycles = db.get_estimated_cycles(target_serial)
                    if est_cycles > 0:
                        cycle_count = est_cycles
                        cycle_count_type = "estimated"
                    else:
                        cycle_count = None
                        cycle_count_type = "unavailable"
                else:
                    cycle_count = None
                    cycle_count_type = "unavailable"

            profile_fields = profile.get("fields", {}) if profile else {}
            data_sources = {
                "charge_full": profile_fields.get("charge_full", {}).get("source", "local" if charge_full_uah else "insufficient_data"),
                "charge_full_design": profile_fields.get("charge_full_design", {}).get("source", "local" if charge_full_design_uah else "insufficient_data"),
                "cycle_count": profile_fields.get("cycle_count", {}).get("source", "local" if (cycle_count is not None and cycle_count >= 0) else "unavailable"),
                "charge_counter": profile_fields.get("charge_counter", {}).get("source", "local" if counter_uah else "insufficient_data"),
                "temperature": profile_fields.get("temperature", {}).get("source", "local" if temp_c is not None else "insufficient_data"),
            }

            status = summary.get("status") or "Unknown"
            health_flag = summary.get("health_flag") or "Good"

            baseline = db.get_first_baseline(target_serial)
            displayed_health, raw_ratio, recalibrated, method, details = calculate_health(
                charge_full_uah=charge_full_uah,
                charge_full_design_uah=charge_full_design_uah,
                charge_counter_uah=counter_uah,
                level_pct=level_pct,
                baseline_record=baseline,
                cycle_count=cycle_count,
                voltage_mv=voltage_mv,
                temperature_c=temp_c,
                history_days=history_days,
                oem_reported_soh=oem_soh,
                data_sources=data_sources,
            )

            model_name = dev_info.get("model") or "Android Device"
            if dev_info.get("manufacturer") and dev_info["manufacturer"] != "Unknown":
                model_name = f"{dev_info['manufacturer']} {model_name}"

            forecast = None
            if displayed_health is not None:
                forecast = calculate_replacement_forecast(
                    current_health_pct=displayed_health,
                    cycle_count=cycle_count,
                )

            return {
                "live": True,
                "connected": True,
                "timestamp": datetime.utcnow().isoformat(),
                "device_serial": target_serial,
                "device_model": model_name,
                "level_pct": level_pct,
                "voltage_mv": voltage_mv,
                "temperature_c": temp_c,
                "charge_counter_uah": counter_uah,
                "charge_full_uah": charge_full_uah,
                "charge_full_design_uah": charge_full_design_uah,
                "maximum_battery_capacity_uah": details.get("breakdown", {}).get("maximum_battery_capacity"),
                "maximum_chargeable_capacity_uah": details.get("breakdown", {}).get("maximum_chargeable_capacity_now"),
                "capacity_retention_pct": details.get("capacity_retention_pct"),
                "capacity_fade_pct": details.get("capacity_fade_pct"),
                "breakdown": details.get("breakdown"),
                "effective_capacity_uah": details.get("effective_capacity_uah") or charge_full_uah,
                "is_static_register": details.get("is_uncalibrated_static_register", False),
                "apple_standard": details.get("apple_standard"),
                "replacement_forecast": forecast,
                "cycle_count": cycle_count,
                "cycle_count_type": cycle_count_type,
                "cycle_count_display": str(cycle_count) if cycle_count is not None else "Unavailable",
                "health_pct": displayed_health,
                "health_status": details.get("health_status", "evaluated" if displayed_health is not None else "insufficient_data"),
                "oem_reported_soh": details.get("oem_reported_soh") or oem_soh,
                "soh_divergence_flag": details.get("soh_divergence_flag", False),
                "soh_divergence_delta": details.get("soh_divergence_delta"),
                "history_days": round(history_days, 1),
                "raw_capacity_ratio": raw_ratio,
                "recalibrated": recalibrated,
                "health_method": method,
                "health_details": details,
                "status": status,
                "health_flag": health_flag,
                "health_band": get_health_band(displayed_health),
                "temperature_band": get_temperature_band(temp_c),
            }
        except Exception as e:
            logger.error(f"Error generating live hardware snapshot for {target_serial}: {e}", exc_info=True)

    # 2. LATEST RECORDED FROM DATABASE (DISCONNECTED STATE)
    latest = db.get_latest_reading(target_serial)
    if latest:
        eff_cap = latest.get("effective_capacity_uah")
        if eff_cap is None:
            if latest.get("charge_full_design_uah") and latest.get("health_pct"):
                eff_cap = int(round(latest["charge_full_design_uah"] * (latest["health_pct"] / 100.0)))
            else:
                eff_cap = latest.get("charge_full_uah")

        h_val = latest.get("health_pct")
        c_val = latest.get("cycle_count")
        cf = latest.get("charge_full_uah")
        cfd = latest.get("charge_full_design_uah")
        chargeable_now = eff_cap or cf
        retention = None
        fade = None
        if chargeable_now and cfd and cfd > 0:
            retention = round((chargeable_now / float(cfd)) * 100.0, 2)
            if h_val is not None and abs(retention - h_val) < 0.1:
                retention = h_val
            fade = round(max(0.0, 100.0 - retention), 2)

        forecast = calculate_replacement_forecast(current_health_pct=h_val, cycle_count=c_val) if h_val is not None else None

        profile = db.get_device_profile(latest["device_serial"]) if "device_serial" in latest else None
        oem_soh = profile.get("oem_reported_soh") if profile else None
        divergence = False
        if h_val is not None and oem_soh is not None:
            divergence = abs(h_val - oem_soh) > 10.0

        disc_sources = {
            "charge_full": "local" if cf else "insufficient_data",
            "charge_full_design": "local" if cfd else "insufficient_data",
            "cycle_count": "local" if c_val else "insufficient_data",
            "charge_counter": "local" if latest.get("charge_counter_uah") else "insufficient_data",
            "temperature": "local" if latest.get("temperature_c") is not None else "insufficient_data",
        }
        disc_breakdown = {
            "maximum_battery_capacity": cfd,
            "maximum_chargeable_capacity_now": chargeable_now,
            "capacity_retention_pct": retention,
            "capacity_fade_pct": fade,
            "cycle_fatigue_pct": None,
            "calendar_aging_pct": None,
            "stress_multiplier": 1.0,
            "final_health_pct": h_val,
            "data_sources": disc_sources,
            "provenance_note": f"Cached from database reading on {latest.get('timestamp')}",
        }

        cached_cycle = latest.get("cycle_count")
        cached_type = latest.get("cycle_count_type") or ("hardware" if cached_cycle is not None else "unavailable")
        if cached_cycle is None:
            cached_type = "unavailable"

        return {
            "live": False,
            "connected": False,
            **latest,
            "cycle_count": cached_cycle,
            "cycle_count_type": cached_type,
            "cycle_count_display": str(cached_cycle) if cached_cycle is not None else "Unavailable",
            "status": "Disconnected",
            "maximum_battery_capacity_uah": cfd,
            "maximum_chargeable_capacity_uah": chargeable_now,
            "capacity_retention_pct": retention,
            "capacity_fade_pct": fade,
            "breakdown": disc_breakdown,
            "effective_capacity_uah": eff_cap,
            "replacement_forecast": forecast,
            "health_status": "evaluated" if h_val is not None else "insufficient_data",
            "oem_reported_soh": oem_soh,
            "soh_divergence_flag": divergence,
            "health_band": get_health_band(latest.get("health_pct")),
            "temperature_band": get_temperature_band(latest.get("temperature_c")),
        }

    # 3. NO DATA YET
    return {
        "live": False,
        "connected": False,
        "level_pct": None,
        "voltage_mv": None,
        "temperature_c": None,
        "health_pct": None,
        "effective_capacity_uah": None,
        "replacement_forecast": None,
        "raw_capacity_ratio": None,
        "recalibrated": False,
        "cycle_count": None,
        "cycle_count_type": "unavailable",
        "cycle_count_display": "Unavailable",
        "health_method": "none",
        "device_serial": None,
        "device_model": "No device connected",
        "status": "Disconnected",
        "health_band": get_health_band(None),
        "temperature_band": get_temperature_band(None),
    }


@router.get("/raw-diagnostic")
def get_raw_diagnostic(serial: Optional[str] = None) -> Dict[str, Any]:
    """Returns the unadulterated raw hardware diagnostic dump."""
    if not adb.is_available():
        raise HTTPException(status_code=503, detail="ADB binary not found on host system.")

    devices = adb.get_devices()
    active = [d for d in devices if d.get("state") == "device"]
    target_serial = serial or (active[0]["serial"] if active else None)

    if not target_serial:
        raise HTTPException(status_code=404, detail="No active Android device connected over USB.")

    probe = adb.probe_device(target_serial)
    return probe.get("raw_dump", {})


@router.get("/history")
def get_history(
    serial: Optional[str] = None,
    limit: int = Query(default=500, ge=10, le=1000),
    days: Optional[int] = Query(default=None, ge=1, le=365),
) -> Dict[str, Any]:
    """Returns chronological reading entries for trend graphing."""
    readings = db.get_history(device_serial=serial, limit=limit, days=days)
    return {
        "count": len(readings),
        "device_serial": serial,
        "readings": readings,
    }


@router.get("/insights")
def get_insights(serial: Optional[str] = None) -> Dict[str, Any]:
    """Returns charging habit metrics, thermal events, and wear indicators."""
    return db.get_insights(device_serial=serial)


@router.get("/probe")
def get_probe_report(serial: Optional[str] = None) -> Dict[str, Any]:
    """Runs a full hardware and sysfs probe diagnostic."""
    if not adb.is_available():
        raise HTTPException(status_code=503, detail="ADB binary not found on host system.")

    devices = adb.get_devices()
    active = [d for d in devices if d.get("state") == "device"]

    target_serial = serial or (active[0]["serial"] if active else None)
    if not target_serial:
        raise HTTPException(status_code=404, detail="No authorized Android device connected over USB.")

    return adb.probe_device(target_serial)


@router.post("/log-reading")
def log_reading_manual(payload: Optional[LogReadingRequest] = None) -> Dict[str, Any]:
    """Forces an immediate probe and database persistence."""
    serial = payload.serial if payload else None
    if not serial:
        devices = adb.get_devices() if adb.is_available() else []
        active = [d for d in devices if d.get("state") == "device"]
        if not active:
            raise HTTPException(status_code=400, detail="No active device connected to log.")
        serial = active[0]["serial"]

    rec = watcher.log_reading_for_device(serial)
    if not rec:
        raise HTTPException(status_code=500, detail="Failed to log reading for device.")
    return {"status": "success", "reading": rec}


@router.post("/seed-mock")
def seed_mock_data(payload: SeedRequest) -> Dict[str, Any]:
    """Seeds realistic historical readings for testing and previewing charts."""
    count = db.seed_mock_data(
        device_serial=payload.serial,
        device_model=payload.model,
        days=payload.days,
    )
    return {
        "status": "success",
        "seeded_count": count,
        "device_serial": payload.serial,
        "device_model": payload.model,
        "days": payload.days,
    }


@router.get("/devices")
def list_devices() -> List[Dict[str, Any]]:
    """Returns all devices seen in database history."""
    return db.get_devices()


@router.get("/device-profile")
def get_device_profile_endpoint(serial: Optional[str] = Query(None)) -> Dict[str, Any]:
    """Retrieves discovered hardware profile for the connected or specified device."""
    devices = adb.get_devices() if adb.is_available() else []
    active = [d for d in devices if d.get("state") == "device"]
    target_serial = serial or (active[0]["serial"] if active else None)

    if not target_serial:
        all_devs = db.get_devices()
        if all_devs:
            target_serial = all_devs[0]["serial"]

    if not target_serial:
        return {"device_serial": None, "profile": None}

    prof = db.get_device_profile(target_serial)
    return {"device_serial": target_serial, "profile": prof}


@router.post("/profile-device")
async def profile_device_endpoint(payload: LogReadingRequest) -> Dict[str, Any]:
    """Triggers parameter discovery profiling on-demand."""
    serial = payload.serial
    if not serial:
        devices = adb.get_devices() if adb.is_available() else []
        active = [d for d in devices if d.get("state") == "device"]
        if not active:
            raise HTTPException(status_code=400, detail="No active device connected to profile.")
        serial = active[0]["serial"]

    from backend.device_profiler import profiler
    res = await profiler.profile_device(serial, force_ai=True)
    return {"status": "success", "profile": res}


class CalibrationStartRequest(BaseModel):
    serial: Optional[str] = None
    simulate: bool = False
    initial_level_pct: Optional[int] = None
    design_capacity_mah: Optional[float] = None


@router.get("/prediction")
def get_prediction_endpoint(
    serial: Optional[str] = Query(None),
    target: float = Query(80.0, ge=60.0, le=95.0),
    health: Optional[float] = Query(None, ge=40.0, le=100.0),
    cycles: Optional[int] = Query(None, ge=0),
) -> Dict[str, Any]:
    """Returns predictive replacement timeline, countdown, and 80%-cap simulation."""
    snap = get_snapshot(serial)
    current_health = health if health is not None else snap.get("health_pct")
    current_cycles = cycles if cycles is not None else snap.get("cycle_count")

    if current_health is None:
        if snap.get("connected") or serial:
            return {
                "device_serial": snap.get("device_serial"),
                "device_model": snap.get("device_model"),
                "connected": snap.get("connected", False),
                "insufficient_data": True,
                "message": "Not enough data yet",
                "forecast": None,
            }
        current_health = 83.0  # Fallback for standalone preview when no device connected

    forecast = calculate_replacement_forecast(
        current_health_pct=current_health,
        cycle_count=current_cycles,
        target_threshold_pct=target,
    )
    return {
        "device_serial": snap.get("device_serial"),
        "device_model": snap.get("device_model"),
        "connected": snap.get("connected", False),
        "insufficient_data": False,
        "forecast": forecast,
    }


@router.get("/app-drain")
def get_app_battery_drain(
    window: str = Query(default="24h", description="Time window, e.g. 1h, 24h, 7d, 30d, all"),
    sort_by: str = Query(default="wakelock_ms", description="Sort by: wakelock_ms, cpu_bg_ms, estimated_mah"),
    limit: int = Query(default=10, ge=1, le=50),
    serial: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """
    Returns application battery drain attribution based on dumpsys batterystats counters.
    Ranked descending by wakelock time by default, with options to rank by background CPU or estimated power.
    Correlates with device thermal history to detect elevated operating stress during background activity.
    """
    window_lower = window.lower().strip()
    if window_lower.endswith("h"):
        try:
            window_hours = int(window_lower[:-1])
        except ValueError:
            window_hours = 24
    elif window_lower.endswith("d"):
        try:
            window_hours = int(window_lower[:-1]) * 24
        except ValueError:
            window_hours = 24
    elif window_lower == "all":
        window_hours = 0
    else:
        window_hours = 24

    devices = adb.get_devices() if adb.is_available() else []
    active = [d for d in devices if d.get("state") == "device"]

    connected_serial = active[0]["serial"] if active else None
    target_serial = serial or connected_serial
    is_connected = bool(connected_serial and (target_serial == connected_serial))

    # If target is mock/seed, seed synthetic Nothing Phone 2a checkin data if not present
    if target_serial == "mock-phone-2a" or (not target_serial and not active):
        if not target_serial:
            target_serial = "mock-phone-2a"
        existing_mock = db.get_app_drain_readings(serial="mock-phone-2a", window_hours=0, limit=1)
        if not existing_mock:
            from datetime import timedelta
            from backend.adb_client import (
                SYNTHETIC_NOTHING_PHONE_2A_CHECKIN,
                SYNTHETIC_NOTHING_PHONE_2A_CHARGED,
            )
            from backend.app_battery_stats import parse_batterystats_checkin
            uid_map = {
                1000: "android",
                10156: "com.google.android.youtube",
                10123: "com.instagram.android",
                10199: "com.google.android.apps.maps",
                10045: "com.whatsapp",
            }
            mock_parsed = parse_batterystats_checkin(
                checkin_text=SYNTHETIC_NOTHING_PHONE_2A_CHECKIN,
                charged_text=SYNTHETIC_NOTHING_PHONE_2A_CHARGED,
                uid_map=uid_map,
                serial="mock-phone-2a",
            )
            now = datetime.utcnow()
            recent_apps = [r for r in mock_parsed if r.get("uid") in [10123, 10199, 10156]]
            mid_apps = [r for r in mock_parsed if r.get("uid") in [1000, 10045]]
            older_apps = [r for r in mock_parsed if r.get("uid") not in [10123, 10199, 10156, 1000, 10045]]

            if recent_apps:
                db.insert_app_power_readings("mock-phone-2a", recent_apps, timestamp=now - timedelta(hours=2))
            if mid_apps:
                db.insert_app_power_readings("mock-phone-2a", mid_apps, timestamp=now - timedelta(days=3))
            if older_apps:
                db.insert_app_power_readings("mock-phone-2a", older_apps, timestamp=now - timedelta(days=10))

    # If real device is connected and DB currently has no records for it, run an on-demand scan
    if is_connected and target_serial:
        curr_items = db.get_app_drain_readings(serial=target_serial, window_hours=window_hours, sort_by=sort_by, limit=limit)
        if not curr_items:
            try:
                watcher.run_app_drain_scan(target_serial)
            except Exception as e:
                logger.warning(f"[API NOTE] Immediate app drain scan note for {target_serial}: {e}")

    # Query DB for top apps
    items = db.get_app_drain_readings(
        serial=target_serial,
        window_hours=window_hours,
        sort_by=sort_by,
        limit=limit,
    )

    # Query thermal correlation summary
    thermal_data = db.get_thermal_correlation_summary(
        serial=target_serial,
        window_hours=window_hours,
    )

    # Tag items with thermal stress flag if correlation exists
    has_stress = thermal_data.get("has_thermal_stress", False)
    max_t = thermal_data.get("max_temp_c")

    for idx, item in enumerate(items):
        if has_stress and (item.get("wakelock_ms", 0) > 60000 or idx < 3):
            item["has_thermal_correlation"] = True
            item["thermal_flag"] = f"Elevated device temperature ({max_t}°C peak) during background activity"
        else:
            item["has_thermal_correlation"] = False
            item["thermal_flag"] = None

    snap = get_snapshot(target_serial) if target_serial else {}

    return {
        "status": "ok",
        "device_serial": target_serial,
        "device_model": snap.get("device_model") or ("Nothing Phone 2a" if target_serial == "mock-phone-2a" else None),
        "connected": is_connected,
        "window": window,
        "window_hours": window_hours,
        "sort_by": sort_by,
        "total_apps": len(items),
        "thermal_correlation": has_stress,
        "thermal_summary": thermal_data.get("thermal_summary", "Normal thermal baseline."),
        "thermal_peak_c": max_t,
        "thermal_avg_c": thermal_data.get("avg_temp_c"),
        "items": items,
        "disclaimer": "Counters trace to dumpsys batterystats --checkin. Estimated power figures derived from OEM power_profile.xml approximations.",
    }


@router.post("/calibration/start")
def start_calibration(payload: Optional[CalibrationStartRequest] = None) -> Dict[str, Any]:
    """Starts an active Coulomb counting charge calibration session."""
    sim = payload.simulate if payload else False
    req_serial = payload.serial if payload else None

    if not req_serial and not sim:
        devices = adb.get_devices() if adb.is_available() else []
        active = [d for d in devices if d.get("state") == "device"]
        if not active:
            sim = True
            req_serial = "simulated-device"
        else:
            req_serial = active[0]["serial"]

    serial = req_serial or "simulated-device"
    snap = get_snapshot(serial)
    init_level = (payload.initial_level_pct if payload and payload.initial_level_pct is not None else None) or snap.get("level_pct") or 25
    design_cap = (payload.design_capacity_mah if payload and payload.design_capacity_mah else None) or (
        (snap.get("charge_full_design_uah") or 4990000) / 1000.0
    )

    res = calibration_manager.start_session(
        device_serial=serial,
        initial_level_pct=init_level,
        design_capacity_mah=design_cap,
        simulate=sim,
    )
    return res


@router.get("/calibration/status")
def get_calibration_status() -> Dict[str, Any]:
    """Streams live Coulomb counting data, accumulated mAh, and extrapolated capacity."""
    return calibration_manager.get_status()


@router.post("/calibration/stop")
def stop_calibration() -> Dict[str, Any]:
    """Stops the active calibration test session and stores result in DB."""
    status = calibration_manager.stop_session()
    if status.get("accumulated_mah", 0) > 0 and status.get("session_id"):
        db.save_calibration_record(
            session_id=status["session_id"],
            device_serial=status.get("device_serial") or "unknown",
            start_level_pct=status.get("start_level_pct") or 0,
            end_level_pct=status.get("current_level_pct") or 0,
            accumulated_mah=status.get("accumulated_mah") or 0.0,
            extrapolated_capacity_mah=status.get("extrapolated_capacity_mah") or 0.0,
            calibrated_health_pct=status.get("calibrated_health_pct") or 0.0,
            design_capacity_mah=status.get("design_capacity_mah") or 4990.0,
            is_simulated=status.get("is_simulated", False),
        )
    return status


@router.post("/calibration/reset")
def reset_calibration() -> Dict[str, Any]:
    """Resets the calibration state machine."""
    return calibration_manager.reset()


@router.get("/calibration/history")
def get_calibration_history(serial: Optional[str] = Query(None)) -> List[Dict[str, Any]]:
    """Retrieves previous calibration test runs."""
    return db.get_calibration_records(serial)


