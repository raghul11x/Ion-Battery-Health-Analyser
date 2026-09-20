"""
Background Watcher Subsystem (APScheduler)
Periodically polls for ADB device connections and auto-logs battery readings in real-time.
"""

from __future__ import annotations
from datetime import datetime, timedelta
import logging
from typing import Any, Dict, Optional
from apscheduler.schedulers.background import BackgroundScheduler
from backend.adb_client import ADBClient
from backend.db import db
from backend.health import calculate_health

logger = logging.getLogger("battery_analyzer.watcher")
logging.basicConfig(level=logging.INFO)


class DeviceWatcher:
    """Manages high-frequency ADB device polling and auto-logging."""

    def __init__(self, poll_interval_seconds: float = 1.5):
        self.poll_interval = poll_interval_seconds
        self.adb = ADBClient()
        self.scheduler: Optional[BackgroundScheduler] = None
        self.last_connected_serial: Optional[str] = None
        self.last_logged_time: Optional[datetime] = None
        self.last_status: Dict[str, Any] = {
            "connected": False,
            "serial": None,
            "model": None,
            "last_check": None,
            "last_log": None,
            "log_count_session": 0,
        }

    def poll_cycle(self) -> None:
        """Executes a single check and auto-logs if device is connected."""
        now = datetime.utcnow()
        self.last_status["last_check"] = now.isoformat()

        if not self.adb.is_available():
            self.last_status["connected"] = False
            self.last_status["error"] = "ADB binary not found"
            return

        devices = self.adb.get_devices()
        active_devices = [d for d in devices if d.get("state") == "device"]

        if not active_devices:
            if self.last_status.get("connected"):
                logger.info("Device disconnected.")
            self.last_status["connected"] = False
            self.last_status["serial"] = None
            self.last_status["model"] = None
            self.last_connected_serial = None

            unauth = [d for d in devices if d.get("state") == "unauthorized"]
            offline = [d for d in devices if d.get("state") == "offline"]
            if unauth:
                self.last_status["device_state"] = "unauthorized"
                self.last_status["unauthorized_serial"] = unauth[0]["serial"]
            elif offline:
                self.last_status["device_state"] = "offline"
                self.last_status["offline_serial"] = offline[0]["serial"]
            else:
                self.last_status["device_state"] = "none"
            return

        self.last_status["device_state"] = "device"

        # Device is present
        target_device = active_devices[0]
        serial = target_device["serial"]

        is_fresh_connect = (self.last_connected_serial != serial)
        interval_elapsed = (
            self.last_logged_time is None
            or (now - self.last_logged_time) >= timedelta(minutes=3)
        )

        self.last_connected_serial = serial
        self.last_status["connected"] = True
        self.last_status["serial"] = serial

        if is_fresh_connect:
            # Rule 7: Run parameter discovery once per new device serial, cached thereafter
            cached_prof = db.get_device_profile(serial)
            if not cached_prof:
                logger.info(f"Discovered new device {serial}. Running local-first parameter discovery...")
                self.is_profiling = True
                self.profiling_message = "Profiling new device..."
                self.last_status["is_profiling"] = True
                self.last_status["profiling_message"] = self.profiling_message
                try:
                    import asyncio
                    from backend.device_profiler import profiler
                    asyncio.run(profiler.profile_device(serial))
                except Exception as ex:
                    logger.warning(f"Device profiling note: {ex}")
                finally:
                    self.is_profiling = False
                    self.profiling_message = None
                    self.last_status["is_profiling"] = False
                    self.last_status["profiling_message"] = None

        if is_fresh_connect or interval_elapsed:
            logger.info(f"Auto-logging reading for device {serial} (Fresh connect: {is_fresh_connect})...")
            try:
                self.log_reading_for_device(serial)
            except Exception as e:
                logger.error(f"Error during auto-log for device {serial}: {e}")

    def log_reading_for_device(self, serial: str) -> Optional[Dict[str, Any]]:
        """Probes the device, normalizes units, and commits a record to SQLite."""
        probe_data = self.adb.probe_device(serial)
        summary = probe_data["summary"]
        device_info = probe_data["device_info"]

        level_pct = summary.get("level_pct")
        if level_pct is None:
            logger.warning(f"Could not read battery level for device {serial}")
            return None

        voltage_mv = summary.get("voltage_mv") or 0
        temp_c = summary.get("temperature_c") or 25.0
        counter_uah = summary.get("charge_counter_uah")
        charge_full_uah = summary.get("charge_full_uah")
        charge_full_design_uah = summary.get("charge_full_design_uah")

        # Hardware cycle count vs estimated cycle count fallback
        hw_cycle_count = summary.get("cycle_count")
        if hw_cycle_count is not None and hw_cycle_count >= 0:
            cycle_count = hw_cycle_count
            cycle_count_type = "hardware"
        else:
            est_cycles = db.get_estimated_cycles(serial)
            if est_cycles > 0:
                cycle_count = est_cycles
                cycle_count_type = "estimated"
            else:
                cycle_count = None
                cycle_count_type = "unavailable"

        status = summary.get("status") or "Unknown"
        health_flag = summary.get("health_flag") or "Good"

        model_name = device_info.get("model") or "Android Device"
        if device_info.get("manufacturer") and device_info["manufacturer"] != "Unknown":
            model_name = f"{device_info['manufacturer']} {model_name}"

        baseline = db.get_first_baseline(serial)

        displayed_health, raw_ratio, recalibrated, health_method, details = calculate_health(
            charge_full_uah=charge_full_uah,
            charge_full_design_uah=charge_full_design_uah,
            charge_counter_uah=counter_uah,
            level_pct=level_pct,
            baseline_record=baseline,
            cycle_count=cycle_count,
            voltage_mv=voltage_mv,
            temperature_c=temp_c,
        )

        record = db.insert_reading(
            level_pct=level_pct,
            voltage_mv=voltage_mv,
            temperature_c=temp_c,
            health_pct=displayed_health,
            effective_capacity_uah=details.get("effective_capacity_uah"),
            raw_capacity_ratio=raw_ratio,
            recalibrated=recalibrated,
            health_method=health_method,
            device_serial=serial,
            device_model=model_name,
            charge_counter_uah=counter_uah,
            charge_full_uah=charge_full_uah,
            charge_full_design_uah=charge_full_design_uah,
            cycle_count=cycle_count,
            cycle_count_type=cycle_count_type,
            status=status,
            health_flag=health_flag,
        )

        now = datetime.utcnow()
        self.last_logged_time = now
        self.last_status["model"] = model_name
        self.last_status["last_log"] = now.isoformat()
        self.last_status["log_count_session"] += 1

        logger.info(
            f"Successfully recorded battery reading #{record['id']}: "
            f"{displayed_health}% (Raw: {raw_ratio}%, Recalibrated: {recalibrated}, Cycles: {cycle_count} [{cycle_count_type}])"
        )
        return record

    def start(self) -> None:
        """Starts the background scheduler."""
        if self.scheduler is not None and self.scheduler.running:
            return

        self.scheduler = BackgroundScheduler(daemon=True)
        self.scheduler.add_job(
            self.poll_cycle,
            "interval",
            seconds=self.poll_interval,
            id="adb_battery_watcher",
            replace_existing=True,
        )
        self.scheduler.start()
        logger.info(f"DeviceWatcher started with {self.poll_interval}s real-time interval.")
        self.poll_cycle()

    def stop(self) -> None:
        """Shuts down the background scheduler."""
        if self.scheduler and self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("DeviceWatcher stopped.")

    def get_status(self) -> Dict[str, Any]:
        """Returns current live polling status."""
        return dict(self.last_status)


watcher = DeviceWatcher()
