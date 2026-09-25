"""
SQLite Data Layer (SQLAlchemy ORM)
Manages historical battery logs, device records, capacity unit corrections,
recalibration flags, and cycle count tracking (hardware and estimated).
"""

from __future__ import annotations
from datetime import datetime, timedelta
import logging
import os
import random
import sys
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    create_engine,
    desc,
    func,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger("battery_analyzer.db")
Base = declarative_base()

if getattr(sys, "frozen", False):
    DEFAULT_DB_FILE = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "battery_data.db"))
else:
    DEFAULT_DB_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "battery_data.db"))


class BatteryReading(Base):
    """Stores a single battery probe snapshot."""
    __tablename__ = "battery_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    device_serial = Column(String(64), index=True, default="default")
    device_model = Column(String(128), default="Android Device")
    level_pct = Column(Integer, nullable=False)
    voltage_mv = Column(Integer, nullable=False)
    temperature_c = Column(Float, nullable=False)
    charge_counter_uah = Column(Integer, nullable=True)
    charge_full_uah = Column(Integer, nullable=True)
    charge_full_design_uah = Column(Integer, nullable=True)
    cycle_count = Column(Integer, nullable=True)
    cycle_count_type = Column(String(32), default="hardware")  # 'hardware' or 'estimated'
    health_pct = Column(Float, nullable=False)
    effective_capacity_uah = Column(Integer, nullable=True)
    raw_capacity_ratio = Column(Float, nullable=True)
    recalibrated = Column(Integer, default=0)  # 1 if raw_capacity_ratio > 100%
    health_method = Column(String(32), nullable=False)  # 'capacity_ratio' or 'trend_estimate'
    status = Column(String(32), default="Unknown")
    health_flag = Column(String(32), default="Good")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "device_serial": self.device_serial,
            "device_model": self.device_model,
            "level_pct": self.level_pct,
            "voltage_mv": self.voltage_mv,
            "temperature_c": round(self.temperature_c, 1) if self.temperature_c is not None else None,
            "charge_counter_uah": self.charge_counter_uah,
            "charge_full_uah": self.charge_full_uah,
            "charge_full_design_uah": self.charge_full_design_uah,
            "effective_capacity_uah": self.effective_capacity_uah,
            "cycle_count": self.cycle_count,
            "cycle_count_type": self.cycle_count_type or "hardware",
            "health_pct": round(self.health_pct, 1) if self.health_pct is not None else None,
            "raw_capacity_ratio": round(self.raw_capacity_ratio, 2) if self.raw_capacity_ratio is not None else None,
            "recalibrated": bool(self.recalibrated),
            "health_method": self.health_method,
            "status": self.status,
            "health_flag": self.health_flag,
        }


class DeviceProfile(Base):
    """
    Stores hardware parameters and sysfs paths discovered for a specific device.
    Follows local-first authority with verified AI fallback consensus.
    """
    __tablename__ = "device_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_serial = Column(String(64), unique=True, index=True, nullable=False)
    device_model = Column(String(128), default="Android Device")
    manufacturer = Column(String(64), default="Unknown")
    android_version = Column(String(32), default="Unknown")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # 5 Core Fields: (path, source)
    # source: 'local', 'ai_consensus', 'unresolved_no_consensus'
    charge_full_path = Column(String(256), nullable=True)
    charge_full_source = Column(String(32), default="unresolved")

    charge_full_design_path = Column(String(256), nullable=True)
    charge_full_design_source = Column(String(32), default="unresolved")

    cycle_count_path = Column(String(256), nullable=True)
    cycle_count_source = Column(String(32), default="unresolved")

    charge_counter_path = Column(String(256), nullable=True)
    charge_counter_source = Column(String(32), default="unresolved")

    temperature_path = Column(String(256), nullable=True)
    temperature_source = Column(String(32), default="unresolved")

    # Deep scan dump and OEM-reported SoH
    raw_deep_scan = Column(Text, nullable=True)
    oem_reported_soh = Column(Float, nullable=True)

    # JSON audit trail of AI consensus votes
    consensus_detail = Column(Text, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        import json
        detail = None
        if self.consensus_detail:
            try:
                detail = json.loads(self.consensus_detail)
            except Exception:
                detail = self.consensus_detail

        return {
            "id": self.id,
            "device_serial": self.device_serial,
            "device_model": self.device_model,
            "manufacturer": self.manufacturer,
            "android_version": self.android_version,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "raw_deep_scan": self.raw_deep_scan,
            "oem_reported_soh": round(self.oem_reported_soh, 1) if self.oem_reported_soh is not None else None,
            "fields": {
                "charge_full": {
                    "path": self.charge_full_path,
                    "source": self.charge_full_source,
                },
                "charge_full_design": {
                    "path": self.charge_full_design_path,
                    "source": self.charge_full_design_source,
                },
                "cycle_count": {
                    "path": self.cycle_count_path,
                    "source": self.cycle_count_source,
                },
                "charge_counter": {
                    "path": self.charge_counter_path,
                    "source": self.charge_counter_source,
                },
                "temperature": {
                    "path": self.temperature_path,
                    "source": self.temperature_source,
                },
            },
            "consensus_detail": detail,
        }


class CalibrationRecord(Base):
    """Stores completed Coulomb charge test calibration runs."""
    __tablename__ = "calibration_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(32), unique=True, index=True)
    device_serial = Column(String(64), index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    start_level_pct = Column(Integer, nullable=False)
    end_level_pct = Column(Integer, nullable=False)
    accumulated_mah = Column(Float, nullable=False)
    extrapolated_capacity_mah = Column(Float, nullable=False)
    calibrated_health_pct = Column(Float, nullable=False)
    design_capacity_mah = Column(Float, nullable=False)
    is_simulated = Column(Integer, default=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "device_serial": self.device_serial,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "start_level_pct": self.start_level_pct,
            "end_level_pct": self.end_level_pct,
            "accumulated_mah": self.accumulated_mah,
            "extrapolated_capacity_mah": self.extrapolated_capacity_mah,
            "calibrated_health_pct": self.calibrated_health_pct,
            "design_capacity_mah": self.design_capacity_mah,
            "is_simulated": bool(self.is_simulated),
        }


class AppPowerReading(Base):
    """Stores per-application battery drain attribution metrics from dumpsys batterystats."""
    __tablename__ = "app_power_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_serial = Column(String(64), index=True, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    package_name = Column(String(256), nullable=False)
    wakelock_ms = Column(Integer, default=0)
    wakelock_count = Column(Integer, default=0)
    cpu_fg_ms = Column(Integer, default=0)
    cpu_bg_ms = Column(Integer, default=0)
    radio_active_ms = Column(Integer, default=0)
    gps_active_ms = Column(Integer, default=0)
    estimated_mah = Column(Float, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "device_serial": self.device_serial,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "package_name": self.package_name,
            "wakelock_ms": self.wakelock_ms,
            "wakelock_count": self.wakelock_count,
            "cpu_fg_ms": self.cpu_fg_ms,
            "cpu_bg_ms": self.cpu_bg_ms,
            "radio_active_ms": self.radio_active_ms,
            "gps_active_ms": self.gps_active_ms,
            "estimated_mah": round(self.estimated_mah, 2) if self.estimated_mah is not None else None,
        }


class Database:
    """Database management interface."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or DEFAULT_DB_FILE
        self.engine = create_engine(f"sqlite:///{self.db_path}", echo=False)
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.init_db()

    def init_db(self) -> None:
        """Creates tables and runs auto-migrations for new columns."""
        # Ensure SQLite executes with WAL pragma and 5s busy timeout
        try:
            with self.engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL;"))
                conn.execute(text("PRAGMA busy_timeout=5000;"))
                conn.commit()
        except Exception as e:
            logger.debug(f"SQLite PRAGMA setup note: {e}")

        Base.metadata.create_all(self.engine)
        self._run_migrations()
        self.fix_existing_anomalies()

    def _run_migrations(self) -> None:
        """Checks for missing columns and adds them via ALTER TABLE."""
        try:
            with self.engine.connect() as conn:
                result = conn.execute(text("PRAGMA table_info(battery_readings)"))
                existing_cols = {row[1] for row in result.fetchall()}

                if "raw_capacity_ratio" not in existing_cols:
                    logger.info("Migrating database: adding raw_capacity_ratio column...")
                    conn.execute(text("ALTER TABLE battery_readings ADD COLUMN raw_capacity_ratio REAL"))

                if "recalibrated" not in existing_cols:
                    logger.info("Migrating database: adding recalibrated column...")
                    conn.execute(text("ALTER TABLE battery_readings ADD COLUMN recalibrated INTEGER DEFAULT 0"))

                if "cycle_count_type" not in existing_cols:
                    logger.info("Migrating database: adding cycle_count_type column...")
                    conn.execute(text("ALTER TABLE battery_readings ADD COLUMN cycle_count_type VARCHAR(32) DEFAULT 'hardware'"))

                if "effective_capacity_uah" not in existing_cols:
                    logger.info("Migrating database: adding effective_capacity_uah column...")
                    conn.execute(text("ALTER TABLE battery_readings ADD COLUMN effective_capacity_uah INTEGER"))

                # Migrations for device_profiles
                result_dp = conn.execute(text("PRAGMA table_info(device_profiles)"))
                existing_dp_cols = {row[1] for row in result_dp.fetchall()}

                if "raw_deep_scan" not in existing_dp_cols:
                    logger.info("Migrating database: adding raw_deep_scan to device_profiles...")
                    conn.execute(text("ALTER TABLE device_profiles ADD COLUMN raw_deep_scan TEXT"))

                if "oem_reported_soh" not in existing_dp_cols:
                    logger.info("Migrating database: adding oem_reported_soh to device_profiles...")
                    conn.execute(text("ALTER TABLE device_profiles ADD COLUMN oem_reported_soh REAL"))

                # Migrations for app_power_readings
                result_apr = conn.execute(text("PRAGMA table_info(app_power_readings)"))
                existing_apr_cols = {row[1] for row in result_apr.fetchall()}
                if existing_apr_cols:
                    for col_name, col_type in [
                        ("wakelock_ms", "INTEGER DEFAULT 0"),
                        ("wakelock_count", "INTEGER DEFAULT 0"),
                        ("cpu_fg_ms", "INTEGER DEFAULT 0"),
                        ("cpu_bg_ms", "INTEGER DEFAULT 0"),
                        ("radio_active_ms", "INTEGER DEFAULT 0"),
                        ("gps_active_ms", "INTEGER DEFAULT 0"),
                        ("estimated_mah", "REAL"),
                    ]:
                        if col_name not in existing_apr_cols:
                            logger.info(f"Migrating database: adding {col_name} to app_power_readings...")
                            conn.execute(text(f"ALTER TABLE app_power_readings ADD COLUMN {col_name} {col_type}"))

                conn.commit()
        except Exception as e:
            logger.warning(f"Database migration note: {e}")

    def fix_existing_anomalies(self) -> None:
        """Corrects past readings that had units mismatch, health_pct > 100%, or static registers on degraded devices."""
        session = self.get_session()
        try:
            from backend.health import calculate_apple_standard_health

            readings = session.query(BatteryReading).all()
            updated_count = 0

            for row in readings:
                modified = False

                # 1. 10x design capacity correction if in 10 µAh (Nothing Phone 2a MediaTek fuel gauge)
                if (
                    row.charge_full_design_uah
                    and row.charge_full_design_uah < 1000000
                    and row.charge_full_uah
                    and row.charge_full_uah > 1000000
                ):
                    row.charge_full_design_uah = row.charge_full_design_uah * 10
                    modified = True

                if row.charge_full_uah and row.charge_full_design_uah:
                    ratio = (row.charge_full_uah / float(row.charge_full_design_uah)) * 100.0
                    row.raw_capacity_ratio = round(ratio, 2)
                    row.recalibrated = 1 if ratio > 100.0 else 0

                    # 2. Static uncalibrated OEM register repair:
                    # If device has 50+ cycles and reported >= 98.5% capacity, calibrate using Apple standard
                    if row.cycle_count and row.cycle_count >= 50 and ratio >= 98.5:
                        apple_res = calculate_apple_standard_health(
                            cycle_count=row.cycle_count,
                            charge_full_design_uah=row.charge_full_design_uah,
                            temperature_c=row.temperature_c,
                            voltage_mv=row.voltage_mv,
                        )
                        row.health_pct = apple_res["apple_health_pct"]
                        row.health_method = "apple_standard_calibrated"
                        row.effective_capacity_uah = apple_res["effective_capacity_uah"]
                        modified = True
                    elif row.health_pct > 100.0:
                        row.health_pct = min(100.0, round(ratio, 1))
                        modified = True

                # 3. Ensure effective_capacity_uah is populated
                if row.effective_capacity_uah is None:
                    if row.charge_full_design_uah and row.health_pct:
                        row.effective_capacity_uah = int(round(row.charge_full_design_uah * (row.health_pct / 100.0)))
                    else:
                        row.effective_capacity_uah = row.charge_full_uah
                    modified = True

                if modified:
                    updated_count += 1

            if updated_count > 0:
                session.commit()
                logger.info(f"Database anomaly fix complete: updated {updated_count} readings with Apple-standard calibration.")
        except Exception as ex:
            session.rollback()
            logger.warning(f"Anomaly correction note: {ex}")
        finally:
            session.close()

    def get_session(self) -> Session:
        return self.SessionLocal()

    def insert_reading(
        self,
        level_pct: int,
        voltage_mv: int,
        temperature_c: float,
        health_pct: float,
        health_method: str,
        device_serial: str = "default",
        device_model: str = "Android Device",
        charge_counter_uah: Optional[int] = None,
        charge_full_uah: Optional[int] = None,
        charge_full_design_uah: Optional[int] = None,
        effective_capacity_uah: Optional[int] = None,
        cycle_count: Optional[int] = None,
        cycle_count_type: str = "hardware",
        raw_capacity_ratio: Optional[float] = None,
        recalibrated: bool = False,
        status: str = "Unknown",
        health_flag: str = "Good",
        timestamp: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Inserts a new reading and commits to SQLite."""
        session = self.get_session()
        try:
            clamped_health = min(100.0, max(0.0, round(health_pct, 1)))
            eff_cap = effective_capacity_uah
            if eff_cap is None:
                if charge_full_design_uah and charge_full_design_uah > 0:
                    eff_cap = int(round(charge_full_design_uah * (clamped_health / 100.0)))
                else:
                    eff_cap = charge_full_uah

            reading = BatteryReading(
                timestamp=timestamp or datetime.utcnow(),
                device_serial=device_serial,
                device_model=device_model,
                level_pct=level_pct,
                voltage_mv=voltage_mv,
                temperature_c=temperature_c,
                charge_counter_uah=charge_counter_uah,
                charge_full_uah=charge_full_uah,
                charge_full_design_uah=charge_full_design_uah,
                effective_capacity_uah=eff_cap,
                cycle_count=cycle_count,
                cycle_count_type=cycle_count_type,
                health_pct=clamped_health,
                raw_capacity_ratio=raw_capacity_ratio,
                recalibrated=1 if recalibrated else 0,
                health_method=health_method,
                status=status,
                health_flag=health_flag,
            )
            session.add(reading)
            session.commit()
            session.refresh(reading)
            return reading.to_dict()
        finally:
            session.close()

    def get_latest_reading(self, device_serial: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Fetches the most recently recorded reading."""
        session = self.get_session()
        try:
            query = session.query(BatteryReading)
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)
            reading = query.order_by(desc(BatteryReading.timestamp)).first()
            return reading.to_dict() if reading else None
        finally:
            session.close()

    def get_history(
        self,
        device_serial: Optional[str] = None,
        limit: int = 500,
        days: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Retrieves chronological history records.
        Sorted ascending by timestamp for charting.
        """
        session = self.get_session()
        try:
            query = session.query(BatteryReading)
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)
            if days:
                cutoff = datetime.utcnow() - timedelta(days=days)
                query = query.filter(BatteryReading.timestamp >= cutoff)

            readings = query.order_by(desc(BatteryReading.timestamp)).limit(limit).all()
            readings.reverse()
            return [r.to_dict() for r in readings]
        finally:
            session.close()

    def get_first_baseline(self, device_serial: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Finds the earliest valid reading for the device to establish a baseline."""
        session = self.get_session()
        try:
            query = session.query(BatteryReading)
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)
            reading = (
                query.filter(
                    (BatteryReading.charge_full_uah.isnot(None))
                    | (BatteryReading.charge_counter_uah.isnot(None))
                )
                .order_by(BatteryReading.timestamp.asc())
                .first()
            )
            return reading.to_dict() if reading else None
        finally:
            session.close()

    def get_estimated_cycles(self, device_serial: Optional[str] = None) -> int:
        """
        Estimates total charge cycles from accumulated positive charge_counter deltas
        logged in SQLite: sum(positive deltas) / charge_full_design.
        """
        session = self.get_session()
        try:
            query = session.query(BatteryReading)
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)
            readings = query.order_by(BatteryReading.timestamp.asc()).all()

            total_positive_deltas = 0
            prev_counter = None

            for r in readings:
                if r.charge_counter_uah is not None:
                    if prev_counter is not None and r.charge_counter_uah > prev_counter:
                        total_positive_deltas += (r.charge_counter_uah - prev_counter)
                    prev_counter = r.charge_counter_uah

            latest = readings[-1] if readings else None
            design_cap = (latest.charge_full_design_uah if latest and latest.charge_full_design_uah else 5000000)

            if design_cap and design_cap > 0 and total_positive_deltas > 0:
                return max(1, int(round(total_positive_deltas / float(design_cap))))
            return 0
        finally:
            session.close()

    def get_history_duration_days(self, device_serial: Optional[str] = None) -> float:
        """
        Calculates the temporal span in days between the earliest and latest logged readings
        for the given device. Returns 0.0 if fewer than 2 readings exist.
        """
        session = self.get_session()
        try:
            query = session.query(
                func.min(BatteryReading.timestamp),
                func.max(BatteryReading.timestamp),
                func.count(BatteryReading.id),
            )
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)
            min_ts, max_ts, count = query.one()
            if not count or count < 2 or not min_ts or not max_ts:
                return 0.0
            delta_days = (max_ts - min_ts).total_seconds() / 86400.0
            return max(0.0, float(delta_days))
        finally:
            session.close()

    def get_devices(self) -> List[Dict[str, Any]]:
        """Lists distinct devices recorded in the database."""
        session = self.get_session()
        try:
            rows = (
                session.query(
                    BatteryReading.device_serial,
                    BatteryReading.device_model,
                    func.count(BatteryReading.id).label("readings_count"),
                    func.max(BatteryReading.timestamp).label("last_seen"),
                )
                .group_by(BatteryReading.device_serial, BatteryReading.device_model)
                .all()
            )
            return [
                {
                    "serial": r[0],
                    "model": r[1],
                    "readings_count": r[2],
                    "last_seen": r[3].isoformat() if r[3] else None,
                }
                for r in rows
            ]
        finally:
            session.close()

    def get_insights(self, device_serial: Optional[str] = None) -> Dict[str, Any]:
        """Calculates charging habits, temperature exposure, and degradation delta."""
        session = self.get_session()
        try:
            query = session.query(BatteryReading)
            if device_serial:
                query = query.filter(BatteryReading.device_serial == device_serial)

            all_readings = query.order_by(BatteryReading.timestamp.asc()).all()
            if not all_readings:
                return {
                    "total_readings": 0,
                    "time_above_80_pct": 0.0,
                    "fast_charge_pct": 0.0,
                    "avg_temp_c": 0.0,
                    "max_temp_c": 0.0,
                    "health_delta_pct": 0.0,
                    "current_health_pct": None,
                    "insights_list": [],
                }

            total = len(all_readings)
            above_80 = sum(1 for r in all_readings if r.level_pct >= 80)
            high_voltage = sum(1 for r in all_readings if r.voltage_mv >= 4200 and r.status == "Charging")
            temps = [r.temperature_c for r in all_readings if r.temperature_c is not None]
            avg_temp = sum(temps) / len(temps) if temps else 0.0
            max_temp = max(temps) if temps else 0.0

            first_health = all_readings[0].health_pct
            latest_health = all_readings[-1].health_pct
            health_delta = round(latest_health - first_health, 2)

            time_above_80_pct = round((above_80 / total) * 100, 1)
            charging_readings = sum(1 for r in all_readings if r.status == "Charging")
            fast_charge_pct = (
                round((high_voltage / charging_readings) * 100, 1)
                if charging_readings > 0
                else 0.0
            )

            insights_list = []

            if health_delta < -1.0:
                insights_list.append({
                    "type": "warning",
                    "pill": "Degrading",
                    "pill_color": "amber",
                    "trend": "down",
                    "title": "Capacity Fade Detected",
                    "description": f"Health decreased by {abs(health_delta)}% over {len(all_readings)} logged events.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })
            else:
                insights_list.append({
                    "type": "good",
                    "pill": "Stable",
                    "pill_color": "green",
                    "trend": "stable",
                    "title": "Healthy Retention",
                    "description": f"Battery capacity is holding steady at {latest_health}%.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })

            if max_temp >= 42.0:
                insights_list.append({
                    "type": "alert",
                    "pill": "High Temp",
                    "pill_color": "red",
                    "trend": "down",
                    "title": "Heat Stress Logged",
                    "description": f"Battery reached {max_temp}°C. Prolonged heat accelerates electrolyte breakdown.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })
            elif avg_temp >= 36.0:
                insights_list.append({
                    "type": "warning",
                    "pill": "Warm Average",
                    "pill_color": "amber",
                    "trend": "stable",
                    "title": "Moderate Thermal Load",
                    "description": f"Average operating temperature is {round(avg_temp, 1)}°C.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })
            else:
                insights_list.append({
                    "type": "good",
                    "pill": "Optimal",
                    "pill_color": "green",
                    "trend": "up",
                    "title": "Cool Operation",
                    "description": f"Average temperature is well-controlled at {round(avg_temp, 1)}°C.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })

            if time_above_80_pct > 35.0:
                insights_list.append({
                    "type": "warning",
                    "pill": "High SoC Habit",
                    "pill_color": "amber",
                    "trend": "down",
                    "title": f"{time_above_80_pct}% Time Above 80%",
                    "description": "Keeping lithium cells above 80% for long durations increases anode mechanical stress.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })
            else:
                insights_list.append({
                    "type": "good",
                    "pill": "Balanced SoC",
                    "pill_color": "green",
                    "trend": "stable",
                    "title": "Balanced Charging Habits",
                    "description": f"Only {time_above_80_pct}% of readings logged above 80% level.",
                    "timestamp": all_readings[-1].timestamp.strftime("%b %d, %H:%M"),
                })

            return {
                "total_readings": total,
                "time_above_80_pct": time_above_80_pct,
                "fast_charge_pct": fast_charge_pct,
                "avg_temp_c": round(avg_temp, 1),
                "max_temp_c": round(max_temp, 1),
                "health_delta_pct": health_delta,
                "current_health_pct": latest_health,
                "insights_list": insights_list,
            }
        finally:
            session.close()

    def seed_mock_data(self, device_serial: str = "mock-device-01", device_model: str = "Nothing Phone 2a", days: int = 30) -> int:
        """Seeds realistic 30-day degradation trend data."""
        session = self.get_session()
        try:
            count = session.query(BatteryReading).filter(BatteryReading.device_serial == device_serial).count()
            if count >= 30:
                return count

            now = datetime.utcnow()
            design_cap = 5000000
            start_health = 99.4
            end_health = 96.2

            readings_to_add = []
            total_points = days * 3

            for i in range(total_points):
                t = now - timedelta(days=days * (total_points - i) / total_points)
                progress = i / max(1, total_points - 1)
                current_health = min(100.0, round(start_health - (start_health - end_health) * progress + random.uniform(-0.15, 0.15), 1))
                full_cap = int(design_cap * (current_health / 100.0))
                cycle = int(45 + (i * 0.4))
                level = random.choice([28, 45, 62, 79, 85, 94, 100])
                status = "Charging" if level in [85, 94, 100] and random.random() > 0.4 else "Discharging"
                voltage = int(3700 + (level / 100.0) * 600 + random.randint(-40, 40))
                temp = round(28.0 + random.uniform(0.5, 9.5) + (3.0 if status == "Charging" else 0.0), 1)
                counter = int(full_cap * (level / 100.0))

                readings_to_add.append(
                    BatteryReading(
                        timestamp=t,
                        device_serial=device_serial,
                        device_model=device_model,
                        level_pct=level,
                        voltage_mv=voltage,
                        temperature_c=temp,
                        charge_counter_uah=counter,
                        charge_full_uah=full_cap,
                        charge_full_design_uah=design_cap,
                        effective_capacity_uah=full_cap,
                        cycle_count=cycle,
                        cycle_count_type="hardware",
                        health_pct=current_health,
                        raw_capacity_ratio=current_health,
                        recalibrated=0,
                        health_method="capacity_ratio",
                        status=status,
                        health_flag="Good",
                    )
                )

            session.add_all(readings_to_add)
            session.commit()
            return len(readings_to_add)
        finally:
            session.close()

    def get_device_profile(self, device_serial: str) -> Optional[Dict[str, Any]]:
        """Retrieves cached device hardware profile if it exists."""
        session = self.get_session()
        try:
            profile = session.query(DeviceProfile).filter(DeviceProfile.device_serial == device_serial).first()
            return profile.to_dict() if profile else None
        finally:
            session.close()

    def save_or_update_device_profile(self, profile_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Saves or updates a device profile following Rule 5:
        - Each field gets exactly one final value: source 'local' or 'ai_consensus'.
        - Local always wins and blocks the AI path for that field.
        - If profile exists: only fills in still-empty/unresolved fields.
        - Never duplicates rows; never overwrites an already-resolved field.
        """
        import json
        serial = profile_data["device_serial"]
        session = self.get_session()
        try:
            profile = session.query(DeviceProfile).filter(DeviceProfile.device_serial == serial).first()
            fields = profile_data.get("fields", {})

            if profile is None:
                # Create brand new row
                profile = DeviceProfile(
                    device_serial=serial,
                    device_model=profile_data.get("device_model", "Android Device"),
                    manufacturer=profile_data.get("manufacturer", "Unknown"),
                    android_version=profile_data.get("android_version", "Unknown"),
                    charge_full_path=fields.get("charge_full", {}).get("path"),
                    charge_full_source=fields.get("charge_full", {}).get("source", "unresolved"),
                    charge_full_design_path=fields.get("charge_full_design", {}).get("path"),
                    charge_full_design_source=fields.get("charge_full_design", {}).get("source", "unresolved"),
                    cycle_count_path=fields.get("cycle_count", {}).get("path"),
                    cycle_count_source=fields.get("cycle_count", {}).get("source", "unresolved"),
                    charge_counter_path=fields.get("charge_counter", {}).get("path"),
                    charge_counter_source=fields.get("charge_counter", {}).get("source", "unresolved"),
                    temperature_path=fields.get("temperature", {}).get("path"),
                    temperature_source=fields.get("temperature", {}).get("source", "unresolved"),
                    raw_deep_scan=profile_data.get("raw_deep_scan") if isinstance(profile_data.get("raw_deep_scan"), str) else None,
                    oem_reported_soh=float(profile_data.get("oem_reported_soh")) if isinstance(profile_data.get("oem_reported_soh"), (int, float)) else None,
                    consensus_detail=json.dumps(profile_data.get("consensus_detail")) if profile_data.get("consensus_detail") else None,
                )
                session.add(profile)
            else:
                # Update existing row: ONLY fill in still-unresolved / empty fields
                profile.device_model = profile_data.get("device_model") or profile.device_model
                profile.manufacturer = profile_data.get("manufacturer") or profile.manufacturer
                profile.android_version = profile_data.get("android_version") or profile.android_version
                profile.updated_at = datetime.utcnow()

                if isinstance(profile_data.get("raw_deep_scan"), str):
                    profile.raw_deep_scan = profile_data.get("raw_deep_scan")

                if isinstance(profile_data.get("oem_reported_soh"), (int, float)):
                    profile.oem_reported_soh = float(profile_data.get("oem_reported_soh"))

                for field_name in ["charge_full", "charge_full_design", "cycle_count", "charge_counter", "temperature"]:
                    field_info = fields.get(field_name)
                    if not field_info:
                        continue

                    path_attr = f"{field_name}_path"
                    source_attr = f"{field_name}_source"
                    curr_source = getattr(profile, source_attr, "unresolved")

                    # If already resolved locally, NEVER overwrite
                    if curr_source == "local":
                        continue

                    # If new info is local, or if current was unresolved and new info is ai_consensus
                    new_source = field_info.get("source")
                    new_path = field_info.get("path")
                    if new_source == "local" or (curr_source != "ai_consensus" and new_source == "ai_consensus"):
                        if new_path:
                            setattr(profile, path_attr, new_path)
                            setattr(profile, source_attr, new_source)

                if profile_data.get("consensus_detail"):
                    profile.consensus_detail = json.dumps(profile_data.get("consensus_detail"))

            session.commit()
            return profile.to_dict()
        finally:
            session.close()

    def save_calibration_record(
        self,
        session_id: str,
        device_serial: str,
        start_level_pct: int,
        end_level_pct: int,
        accumulated_mah: float,
        extrapolated_capacity_mah: float,
        calibrated_health_pct: float,
        design_capacity_mah: float = 4990.0,
        is_simulated: bool = False,
    ) -> Dict[str, Any]:
        """Saves a completed Coulomb charge test session to database."""
        session = self.get_session()
        try:
            rec = CalibrationRecord(
                session_id=session_id,
                device_serial=device_serial,
                start_level_pct=start_level_pct,
                end_level_pct=end_level_pct,
                accumulated_mah=round(accumulated_mah, 2),
                extrapolated_capacity_mah=round(extrapolated_capacity_mah, 1),
                calibrated_health_pct=round(calibrated_health_pct, 1),
                design_capacity_mah=round(design_capacity_mah, 1),
                is_simulated=1 if is_simulated else 0,
            )
            session.add(rec)
            session.commit()
            session.refresh(rec)
            return rec.to_dict()
        finally:
            session.close()

    def get_calibration_records(self, device_serial: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetches history of calibration test runs."""
        session = self.get_session()
        try:
            q = session.query(CalibrationRecord)
            if device_serial:
                q = q.filter(CalibrationRecord.device_serial == device_serial)
            records = q.order_by(desc(CalibrationRecord.timestamp)).limit(20).all()
            return [r.to_dict() for r in records]
        finally:
            session.close()

    def insert_app_power_readings(
        self,
        serial: str,
        readings: List[Dict[str, Any]],
        timestamp: Optional[datetime] = None,
    ) -> int:
        """
        Persists a batch of app power readings captured during a Deep Scan.
        Preserves history across batterystats resets.
        """
        if not readings:
            return 0
        ts = timestamp or datetime.utcnow()
        session = self.get_session()
        count = 0
        try:
            for r in readings:
                pkg = r.get("package_name")
                if not pkg:
                    continue
                record = AppPowerReading(
                    device_serial=serial,
                    timestamp=ts,
                    package_name=pkg,
                    wakelock_ms=int(r.get("wakelock_ms") or 0),
                    wakelock_count=int(r.get("wakelock_count") or 0),
                    cpu_fg_ms=int(r.get("cpu_fg_ms") or 0),
                    cpu_bg_ms=int(r.get("cpu_bg_ms") or 0),
                    radio_active_ms=int(r.get("radio_active_ms") or 0),
                    gps_active_ms=int(r.get("gps_active_ms") or 0),
                    estimated_mah=float(r["estimated_mah"]) if r.get("estimated_mah") is not None else None,
                )
                session.add(record)
                count += 1
            session.commit()
            return count
        except Exception as e:
            session.rollback()
            logger.error(f"[DB ERROR] Error inserting app power readings: {e}")
            return 0
        finally:
            session.close()

    def get_app_drain_readings(
        self,
        serial: Optional[str] = None,
        window_hours: int = 24,
        sort_by: str = "wakelock_ms",
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Retrieves top battery draining apps within the specified time window,
        aggregating raw device counters and secondary power estimates.
        """
        session = self.get_session()
        try:
            cutoff = datetime.utcnow() - timedelta(hours=window_hours) if window_hours > 0 else datetime.min
            query = session.query(AppPowerReading).filter(AppPowerReading.timestamp >= cutoff)
            if serial:
                query = query.filter(AppPowerReading.device_serial == serial)

            all_readings = query.all()
            if not all_readings:
                return []

            # Group by package_name: accumulate max observed counters in this window
            pkg_map: Dict[str, Dict[str, Any]] = {}
            from backend.app_battery_stats import format_duration_ms, get_app_display_name

            for row in all_readings:
                pkg = row.package_name
                if pkg not in pkg_map:
                    pkg_map[pkg] = {
                        "package_name": pkg,
                        "display_name": get_app_display_name(pkg),
                        "wakelock_ms": row.wakelock_ms or 0,
                        "wakelock_count": row.wakelock_count or 0,
                        "cpu_fg_ms": row.cpu_fg_ms or 0,
                        "cpu_bg_ms": row.cpu_bg_ms or 0,
                        "radio_active_ms": row.radio_active_ms or 0,
                        "gps_active_ms": row.gps_active_ms or 0,
                        "estimated_mah": row.estimated_mah,
                        "last_seen": row.timestamp,
                    }
                else:
                    curr = pkg_map[pkg]
                    curr["wakelock_ms"] = max(curr["wakelock_ms"], row.wakelock_ms or 0)
                    curr["wakelock_count"] = max(curr["wakelock_count"], row.wakelock_count or 0)
                    curr["cpu_fg_ms"] = max(curr["cpu_fg_ms"], row.cpu_fg_ms or 0)
                    curr["cpu_bg_ms"] = max(curr["cpu_bg_ms"], row.cpu_bg_ms or 0)
                    curr["radio_active_ms"] = max(curr["radio_active_ms"], row.radio_active_ms or 0)
                    curr["gps_active_ms"] = max(curr["gps_active_ms"], row.gps_active_ms or 0)
                    if row.estimated_mah is not None:
                        curr["estimated_mah"] = max(curr["estimated_mah"] or 0.0, row.estimated_mah)
                    if row.timestamp and (curr["last_seen"] is None or row.timestamp > curr["last_seen"]):
                        curr["last_seen"] = row.timestamp

            items = list(pkg_map.values())
            for item in items:
                item["cpu_total_ms"] = item["cpu_fg_ms"] + item["cpu_bg_ms"]
                item["wakelock_duration_display"] = format_duration_ms(item["wakelock_ms"])
                item["is_estimated_power"] = True
                item["estimated_power_note"] = "Derived from OEM power_profile.xml approximations; secondary signal."
                if item["last_seen"]:
                    item["last_seen_iso"] = item["last_seen"].isoformat()

            # Sort field handling: wakelock_ms, cpu_bg_ms, estimated_mah
            if sort_by == "cpu_bg_ms":
                items.sort(key=lambda x: (x["cpu_bg_ms"], x["wakelock_ms"]), reverse=True)
            elif sort_by == "estimated_mah":
                items.sort(key=lambda x: (x["estimated_mah"] or 0.0, x["wakelock_ms"]), reverse=True)
            else:  # default wakelock_ms
                items.sort(key=lambda x: (x["wakelock_ms"], x["cpu_bg_ms"], x["estimated_mah"] or 0.0), reverse=True)

            return items[:limit]
        finally:
            session.close()

    def get_thermal_correlation_summary(
        self,
        serial: Optional[str] = None,
        window_hours: int = 24,
    ) -> Dict[str, Any]:
        """
        Cross-references temperature_c in battery_readings for the same time window.
        Detects if high operating temperatures (>35.0°C) occurred during device activity.
        """
        session = self.get_session()
        try:
            cutoff = datetime.utcnow() - timedelta(hours=window_hours) if window_hours > 0 else datetime.min
            query = session.query(BatteryReading).filter(BatteryReading.timestamp >= cutoff)
            if serial:
                query = query.filter(BatteryReading.device_serial == serial)

            readings = query.all()
            if not readings:
                return {
                    "has_thermal_stress": False,
                    "avg_temp_c": None,
                    "max_temp_c": None,
                    "elevated_readings_count": 0,
                    "thermal_summary": "No historical thermal logs recorded in this window.",
                }

            temps = [r.temperature_c for r in readings if r.temperature_c is not None]
            if not temps:
                return {
                    "has_thermal_stress": False,
                    "avg_temp_c": None,
                    "max_temp_c": None,
                    "elevated_readings_count": 0,
                    "thermal_summary": "Thermal telemetry unavailable for this window.",
                }

            avg_t = round(sum(temps) / len(temps), 1)
            max_t = round(max(temps), 1)
            elevated_count = sum(1 for t in temps if t >= 35.0)
            has_stress = max_t >= 35.0 or avg_t >= 33.0

            if max_t >= 40.0:
                summary = f"Severe thermal stress detected: peak {max_t}°C reached ({elevated_count} readings ≥35°C)."
            elif has_stress:
                summary = f"Elevated device temperature during background activity (peak {max_t}°C, avg {avg_t}°C)."
            else:
                summary = f"Operating temperature remained normal (peak {max_t}°C, avg {avg_t}°C)."

            return {
                "has_thermal_stress": has_stress,
                "avg_temp_c": avg_t,
                "max_temp_c": max_t,
                "elevated_readings_count": elevated_count,
                "thermal_summary": summary,
            }
        finally:
            session.close()


db = Database()

