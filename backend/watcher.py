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
from backend.status_bus import emit_status

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
        # Per-serial timestamp of last *full* ADB probe (sysfs scan + DB write).
        # Between full probes, fast ticks only update last_status from dumpsys battery.
        self.last_full_probe_time: Dict[str, Optional[datetime]] = {}
        # Per-serial timestamp of last *deep scan* (batterystats pull + app drain attribution).
        # Follows a 15-minute TTL cadence to avoid excessive ADB overhead.
        self.last_deep_scan_time: Dict[str, Optional[datetime]] = {}
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
                disconnected_serial = self.last_status.get("serial")
                emit_status(disconnected_serial, "connection", f"Device disconnected ({disconnected_serial})", {"serial": disconnected_serial}, level="warning")
                # Invalidate the deep-scan cache so next connection gets a fresh excavation
                if disconnected_serial and hasattr(self.adb, "invalidate_deep_scan_cache"):
                    self.adb.invalidate_deep_scan_cache(disconnected_serial)
                if disconnected_serial in self.last_deep_scan_time:
                    self.last_deep_scan_time.pop(disconnected_serial, None)

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
        # Full probe: on fresh connect, or if >= 3 min have passed since last full probe for this serial
        last_full = self.last_full_probe_time.get(serial)
        full_probe_needed = (
            last_full is None
            or (now - last_full) >= timedelta(minutes=3)
        )

        self.last_connected_serial = serial
        self.last_status["connected"] = True
        self.last_status["serial"] = serial

        if is_fresh_connect:
            emit_status(serial, "connection", f"Connected to {target_device.get('model', 'Android Device')} ({serial})", {"serial": serial, "model": target_device.get("model")}, level="success")
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

        if is_fresh_connect or full_probe_needed:
            logger.info(f"Auto-logging full reading for device {serial} (Fresh connect: {is_fresh_connect})...")
            try:
                self.log_reading_for_device(serial)
                self.last_full_probe_time[serial] = now
            except Exception as e:
                logger.error(f"Error during auto-log for device {serial}: {e}")
        else:
            # Fast tick: only refresh live telemetry (level/temp/voltage) without expensive sysfs scan
            self._log_fast_reading(serial)

        # Deep Scan (15-min TTL): app battery stats attribution pull
        last_deep = self.last_deep_scan_time.get(serial)
        deep_scan_needed = (
            last_deep is None
            or (now - last_deep) >= timedelta(minutes=15)
        )
        if is_fresh_connect or deep_scan_needed:
            try:
                self.run_app_drain_scan(serial)
                self.last_deep_scan_time[serial] = now
            except Exception as e:
                logger.warning(f"Note during app drain scan for {serial}: {e}")


    def run_app_drain_scan(self, serial: str) -> List[Dict[str, Any]]:
        """
        Executes an app battery drain scan using dumpsys batterystats:
        1. Pulls machine-parseable checkin output (pull_batterystats_checkin).
        2. Pulls power-profile secondary estimation (pull_batterystats_charged).
        3. Identifies and resolves unique UIDs to package names (resolve_package_names).
        4. Parses and structures the readings with zero hallucinated data.
        5. Persists the snapshot into SQLite app_power_readings table.
        """
        try:
            from backend.app_battery_stats import parse_batterystats_checkin
            logger.info(f"[DEEP SCAN] Running app battery drain scan for {serial} (15m cadence)...")
            checkin_raw = self.adb.pull_batterystats_checkin(serial) if hasattr(self.adb, "pull_batterystats_checkin") else ""
            if not checkin_raw:
                return []

            charged_raw = self.adb.pull_batterystats_charged(serial) if hasattr(self.adb, "pull_batterystats_charged") else ""

            # Discover unique UIDs in checkin to resolve in batch
            uids = set()
            for line in checkin_raw.splitlines():
                toks = line.strip().split(",")
                if len(toks) >= 4 and toks[1].isdigit():
                    uids.add(int(toks[1]))

            uid_map = self.adb.resolve_package_names(list(uids), serial=serial) if hasattr(self.adb, "resolve_package_names") else {}

            parsed_readings = parse_batterystats_checkin(
                checkin_text=checkin_raw,
                charged_text=charged_raw,
                uid_map=uid_map,
                serial=serial,
            )

            if parsed_readings:
                inserted = db.insert_app_power_readings(serial, parsed_readings)
                logger.info(f"[DEEP SCAN] Saved {inserted} app power records to DB for {serial}.")

            return parsed_readings
        except Exception as e:
            logger.error(f"[DEEP SCAN ERROR] Failed app battery drain scan for {serial}: {e}")
            return []


    def _log_fast_reading(self, serial: str) -> None:
        """
        Light-weight live-telemetry refresh between full probes.

        Executes a single `dumpsys battery` call (one ADB subprocess) to get
        the current level, temperature, and voltage, then updates `last_status`
        in memory.  Does NOT run scan_all_power_supplies(), does NOT write a DB
        row — that keeps per-tick ADB overhead to a minimum while the UI still
        shows live values between full 3-minute probe cycles.
        """
        try:
            dumpsys = self.adb.probe_dumpsys_battery(serial)
            if not dumpsys or "error" in dumpsys:
                return
            level = dumpsys.get("level")
            temp = dumpsys.get("temperature_c")
            voltage = dumpsys.get("voltage")
            status_label = dumpsys.get("status_label", "Unknown")

            # Update live status fields only
            if level is not None:
                self.last_status["live_level_pct"] = level
            if temp is not None:
                self.last_status["live_temp_c"] = temp
            if voltage is not None:
                self.last_status["live_voltage_mv"] = voltage
            self.last_status["live_status"] = status_label
            logger.debug(
                f"[FAST TICK] {serial}: level={level}%, temp={temp}°C, volt={voltage}mV, status={status_label}"
            )
        except Exception as e:
            logger.debug(f"[FAST TICK] Error for {serial}: {e}")

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

        cycles_str = f"{cycle_count} ({cycle_count_type})" if cycle_count is not None else "Unavailable"
        emit_status(
            serial,
            "health",
            f"Health calculated: {displayed_health}% via {health_method} | Cycles: {cycles_str} | Temp: {temp_c}°C",
            {"health_pct": displayed_health, "health_method": health_method, "cycle_count": cycle_count, "cycle_type": cycle_count_type, "voltage_mv": voltage_mv, "temperature_c": temp_c},
            level="success" if displayed_health >= 80.0 else "info",
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
