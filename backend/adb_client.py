"""
ADB Client & Probing Subsystem
Interacts with Android device via ADB to pull battery dumpsys, explore sysfs nodes,
normalize capacity unit mismatches, and surface hardware cycle counts.
"""

from __future__ import annotations
import glob
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("battery_analyzer.adb")
logging.basicConfig(level=logging.INFO)


def find_adb_path() -> Optional[str]:
    """
    Locates the adb executable on the host system using:
    1. ADB_PATH environment variable override
    2. System PATH
    3. Bundled or local working directory paths
    4. WinGet package paths
    5. Android SDK default paths
    6. Fallback locations
    """
    env_path = os.environ.get("ADB_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    which_adb = shutil.which("adb")
    if which_adb:
        return which_adb

    candidate_patterns = [
        # Current executable / script directory
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "platform-tools", "adb.exe"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "adb.exe"),
        os.path.join(os.getcwd(), "platform-tools", "adb.exe"),
        os.path.join(os.getcwd(), "adb.exe"),
        # WinGet Package Locations
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_*\platform-tools\adb.exe"),
        os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_*\platform-tools\adb.exe"),
        # Standard Android SDK Locations
        os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"),
        os.path.expanduser(r"~\AppData\Local\Android\Sdk\platform-tools\adb.exe"),
        os.path.expandvars(r"%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe"),
        # Root drive direct installations
        r"C:\platform-tools\adb.exe",
        r"C:\adb\adb.exe",
        r"D:\platform-tools\adb.exe",
        r"D:\adb\adb.exe",
        # Android Studio / Tools
        r"C:\Program Files\Android\Android Studio\bin\adb.exe",
        r"C:\Program Files\Android\platform-tools\adb.exe",
        r"C:\Program Files (x86)\Android\platform-tools\adb.exe",
        r"C:\Program Files (x86)\Mission Planner\adb.exe",
    ]

    for pattern in candidate_patterns:
        matches = glob.glob(pattern)
        if matches:
            for match in matches:
                if os.path.isfile(match):
                    return os.path.abspath(match)

    return None


class ADBClient:
    """Encapsulates ADB operations for battery and hardware sysfs inspection."""

    STATUS_MAP = {
        1: "Unknown",
        2: "Charging",
        3: "Discharging",
        4: "Not charging",
        5: "Full",
    }

    HEALTH_MAP = {
        1: "Unknown",
        2: "Good",
        3: "Overheat",
        4: "Dead",
        5: "Over voltage",
        6: "Unspecified failure",
        7: "Cold",
    }

    def __init__(self, adb_path: Optional[str] = None):
        self.adb_path = adb_path or find_adb_path()

    def is_available(self) -> bool:
        """Returns True if an ADB executable is discovered, dynamically retrying if needed."""
        if not self.adb_path or not os.path.isfile(self.adb_path):
            self.adb_path = find_adb_path()
        return self.adb_path is not None and os.path.isfile(self.adb_path)

    def restart_server(self) -> bool:
        """Kills and restarts the ADB server to recover hung sockets or refresh device enumeration."""
        if not self.is_available():
            return False
        try:
            logger.info("Restarting ADB server daemon...")
            self.run_cmd(["kill-server"], timeout=6.0)
            self.run_cmd(["start-server"], timeout=10.0)
            return True
        except Exception as e:
            logger.warning(f"Error restarting ADB server: {e}")
            return False

    def run_cmd(self, args: List[str], timeout: float = 12.0) -> Tuple[str, str, int]:
        """Executes an adb command safely."""
        if not self.is_available():
            return "", "ADB executable not found", -1

        cmd = [self.adb_path] + args
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            return res.stdout.strip(), res.stderr.strip(), res.returncode
        except subprocess.TimeoutExpired:
            return "", f"Command timed out after {timeout}s", -2
        except Exception as ex:
            return "", str(ex), -3

    def get_devices(self) -> List[Dict[str, str]]:
        """
        Lists all connected devices and their authorization status.
        Parses `adb devices -l` accurately, skipping any daemon start banners or headers.
        """
        stdout, _, code = self.run_cmd(["devices", "-l"])
        if code != 0 or not stdout:
            return []

        devices = []
        header_seen = False
        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue

            if "List of devices attached" in line:
                header_seen = True
                continue

            # Skip until we have passed the header, and skip daemon log lines
            if not header_seen or line.startswith("*"):
                continue

            parts = line.split()
            if len(parts) < 2:
                continue

            serial = parts[0]
            state = parts[1]
            extra_dict: Dict[str, str] = {"serial": serial, "state": state}

            for item in parts[2:]:
                if ":" in item:
                    k, v = item.split(":", 1)
                    extra_dict[k] = v

            devices.append(extra_dict)

        return devices

    def get_device_props(self, serial: str) -> Dict[str, str]:
        """Retrieves hardware model, manufacturer, and Android version."""
        props = {}
        for key, prop_name in [
            ("model", "ro.product.model"),
            ("brand", "ro.product.brand"),
            ("manufacturer", "ro.product.manufacturer"),
            ("market_name", "ro.product.marketname"),
            ("android_version", "ro.build.version.release"),
            ("security_patch", "ro.build.version.security_patch"),
        ]:
            out, _, _ = self.run_cmd(["-s", serial, "shell", "getprop", prop_name])
            if out:
                props[key] = out.strip()
            else:
                props[key] = "Unknown"
        return props

    def run_shell(self, serial: str, command: str, timeout: float = 8.0) -> Tuple[str, str, int]:
        """Runs a shell command on the target device."""
        return self.run_cmd(["-s", serial, "shell", command], timeout=timeout)

    def probe_dumpsys_battery(self, serial: str) -> Dict[str, Any]:
        """Pulls and parses `dumpsys battery`."""
        stdout, stderr, code = self.run_shell(serial, "dumpsys battery")
        if code != 0 or not stdout:
            return {"error": stderr or "Failed to run dumpsys battery"}

        parsed: Dict[str, Any] = {"raw_output": stdout}
        for line in stdout.splitlines():
            line = line.strip()
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            key = k.strip().lower().replace(" ", "_")
            val = v.strip()

            if val.isdigit():
                parsed[key] = int(val)
            elif val.lower() in ["true", "false"]:
                parsed[key] = val.lower() == "true"
            else:
                parsed[key] = val

        # Normalize mapped values
        status_code = parsed.get("status")
        if isinstance(status_code, int):
            parsed["status_label"] = self.STATUS_MAP.get(status_code, f"Code {status_code}")
        else:
            parsed["status_label"] = "Unknown"

        health_code = parsed.get("health")
        if isinstance(health_code, int):
            parsed["health_label"] = self.HEALTH_MAP.get(health_code, f"Code {health_code}")
        else:
            parsed["health_label"] = "Unknown"

        # Normalize temperature: Android reports in tenths of °C (e.g. 295 -> 29.5°C)
        raw_temp = parsed.get("temperature")
        if isinstance(raw_temp, (int, float)):
            if raw_temp > 1000:
                parsed["temperature_c"] = round(raw_temp / 1000.0, 1)
            elif raw_temp > 100:
                parsed["temperature_c"] = round(raw_temp / 10.0, 1)
            else:
                parsed["temperature_c"] = float(raw_temp)
        else:
            parsed["temperature_c"] = None

        # Normalize cycle count if exposed directly by dumpsys battery (Android 14+, Samsung, Pixel)
        dumpsys_cycle_val: Optional[int] = None
        dumpsys_cycle_src: Optional[str] = None
        for c_key in [
            "battery_cycle_count",
            "cycle_count",
            "mbatterycyclecount",
            "battery_cycle",
            "mbatterycycle",
        ]:
            raw_c = parsed.get(c_key)
            if isinstance(raw_c, int) and 0 <= raw_c < 20000:
                dumpsys_cycle_val = raw_c
                dumpsys_cycle_src = f"dumpsys battery ({c_key})"
                break

        # Samsung usage counter fallback (mSavedBatteryUsage)
        if dumpsys_cycle_val is None:
            raw_usage = parsed.get("msavedbatteryusage")
            if isinstance(raw_usage, int) and raw_usage >= 0:
                scaled = int(round(raw_usage / 100.0)) if raw_usage >= 1000 else raw_usage
                if 0 <= scaled < 20000:
                    dumpsys_cycle_val = scaled
                    dumpsys_cycle_src = "dumpsys battery (mSavedBatteryUsage)"

        parsed["cycle_count"] = dumpsys_cycle_val
        parsed["cycle_count_source"] = dumpsys_cycle_src

        return parsed

    def probe_sysfs_paths(self, serial: str) -> Dict[str, Any]:
        """
        Directly queries standard sysfs power_supply registers.
        Returns dict with charge_full_uah, charge_full_design_uah, cycle_count.
        """
        paths = [
            "/sys/class/power_supply/battery",
            "/sys/class/power_supply/bms",
            "/sys/class/power_supply/fg",
            "/sys/class/power_supply/main",
        ]
        result: Dict[str, Any] = {
            "charge_full_uah": None,
            "charge_full_design_uah": None,
            "cycle_count": None,
        }
        for base in paths:
            if result["charge_full_uah"] is None:
                out, _, code = self.run_shell(serial, f"cat {base}/charge_full")
                if code == 0 and out.strip().isdigit():
                    result["charge_full_uah"] = int(out.strip())

            if result["charge_full_design_uah"] is None:
                out, _, code = self.run_shell(serial, f"cat {base}/charge_full_design")
                if code == 0 and out.strip().isdigit():
                    result["charge_full_design_uah"] = int(out.strip())

            if result["cycle_count"] is None:
                for c_attr in ["cycle_count", "batt_cycle_count", "battery_cycle_count", "fg_cycle", "battery_cycle", "total_cycle"]:
                    out, _, code = self.run_shell(serial, f"cat {base}/{c_attr}")
                    if code == 0 and out.strip().isdigit():
                        c_val = int(out.strip())
                        if 0 <= c_val < 20000:
                            result["cycle_count"] = c_val
                            break

        return result

    def scan_all_power_supplies(self, serial: str) -> Dict[str, Any]:
        """
        Discovers all power_supply subdirectories via `ls /sys/class/power_supply/`
        and inspects all readable attributes in each subdirectory.
        """
        out, _, code = self.run_shell(serial, "ls /sys/class/power_supply")
        if code != 0 or not out:
            # Fallback to standard nodes if ls fails
            subdirs = ["battery", "bms", "main", "fg", "usb"]
        else:
            subdirs = [s.strip() for s in out.split() if s.strip()]

        supplies_tree: Dict[str, Dict[str, Any]] = {}
        candidate_attributes = [
            "cycle_count",
            "charge_full",
            "charge_full_design",
            "charge_counter",
            "temp",
            "capacity",
            "voltage_now",
            "current_now",
            "status",
            "health",
            "technology",
            "model_name",
            # Vendor / OEM registers
            "battery_soh",
            "soh",
            "fg_cycle",
            "battery_cycle",
            "batt_temp",
            "fast_chg_status",
            # Deep OEM cycle counters (Samsung, MediaTek, Pixel, Xiaomi, OnePlus)
            "batt_cycle_count",
            "battery_cycle_count",
            "batt_cycle",
            "total_cycle",
            "cycle",
            "fg_cycle_count",
            "cycle_count_id",
            "battery_cycles",
            "soh_cycle_count",
            "batt_discharge_level",
        ]

        for node in subdirs:
            node_path = f"/sys/class/power_supply/{node}"
            supplies_tree[node] = {}

            # Check if directory exists
            test_out, _, test_code = self.run_shell(serial, f"ls {node_path}")
            if test_code != 0:
                continue

            available_files = [f.strip() for f in test_out.split() if f.strip()]

            for attr in candidate_attributes:
                if attr in available_files:
                    fpath = f"{node_path}/{attr}"
                    c_out, _, c_code = self.run_shell(serial, f"cat {fpath}")
                    if c_code == 0 and c_out:
                        val_str = c_out.strip()
                        supplies_tree[node][attr] = {
                            "path": fpath,
                            "raw": val_str,
                            "int_val": int(val_str) if val_str.isdigit() or (val_str.startswith("-") and val_str[1:].isdigit()) else None,
                            "readable": True,
                        }
                    else:
                        supplies_tree[node][attr] = {
                            "path": fpath,
                            "readable": False,
                        }

        return supplies_tree

    def deep_scan(self, serial: str) -> Dict[str, Any]:
        """
        Deep metadata excavation layer:
        1. Recursively enumerates ALL subdirectories under /sys/class/power_supply/
           (including battery, bms, fg, oplus_chg, bbc_battery, mtk-battery, etc.).
        2. Cats every readable attribute file inside each directory, capturing the full key-value dump.
        3. Captures dumpsys batterystats --charged and dumpsys batterystats --history.
        4. Compiles structured tree and unified raw text dump for AI consensus verification.
        """
        out, _, code = self.run_shell(serial, "ls /sys/class/power_supply")
        if code != 0 or not out:
            subdirs = ["battery", "bms", "main", "fg", "usb", "oplus_chg", "bbc_battery", "mtk-battery"]
        else:
            subdirs = [s.strip() for s in out.split() if s.strip()]

        supplies_tree: Dict[str, Dict[str, Any]] = {}
        raw_dump_lines: List[str] = []

        raw_dump_lines.append(f"=== SYSFS POWER SUPPLY NODES (Device: {serial}) ===")

        for node in subdirs:
            node_path = f"/sys/class/power_supply/{node}"
            supplies_tree[node] = {}

            test_out, _, test_code = self.run_shell(serial, f"ls {node_path}")
            if test_code != 0 or not test_out:
                continue

            available_files = [f.strip() for f in test_out.split() if f.strip()]

            for attr in available_files:
                if attr in ["subsystem", "device", "power"]:
                    continue

                fpath = f"{node_path}/{attr}"
                c_out, _, c_code = self.run_shell(serial, f"cat {fpath}")
                if c_code == 0 and c_out is not None:
                    val_str = c_out.strip()
                    int_val = int(val_str) if val_str.isdigit() or (val_str.startswith("-") and val_str[1:].isdigit()) else None
                    supplies_tree[node][attr] = {
                        "path": fpath,
                        "raw": val_str,
                        "int_val": int_val,
                        "readable": True,
                    }
                    raw_dump_lines.append(f"{fpath}: {val_str}")
                else:
                    supplies_tree[node][attr] = {
                        "path": fpath,
                        "readable": False,
                    }

        # Also capture dumpsys batterystats --charged and --history
        raw_dump_lines.append("\n=== DUMPSYS BATTERYSTATS --CHARGED ===")
        bs_charged_out, _, bs_charged_code = self.run_shell(serial, "dumpsys batterystats --charged", timeout=12.0)
        bs_charged_clean = bs_charged_out.strip() if bs_charged_code == 0 and bs_charged_out else "Not available or empty"
        raw_dump_lines.append(bs_charged_clean)

        raw_dump_lines.append("\n=== DUMPSYS BATTERYSTATS --HISTORY ===")
        bs_hist_out, _, bs_hist_code = self.run_shell(serial, "dumpsys batterystats --history", timeout=12.0)
        bs_hist_clean = bs_hist_out.strip() if bs_hist_code == 0 and bs_hist_out else "Not available or empty"
        raw_dump_lines.append(bs_hist_clean)

        raw_dump_text = "\n".join(raw_dump_lines)

        return {
            "device_serial": serial,
            "timestamp": datetime.utcnow().isoformat(),
            "subdirectories": subdirs,
            "sysfs": supplies_tree,
            "batterystats_charged": bs_charged_clean,
            "batterystats_history": bs_hist_clean,
            "raw_dump_lines": raw_dump_lines,
            "raw_dump_text": raw_dump_text,
        }

    def probe_device(self, serial: str) -> Dict[str, Any]:
        """
        Executes a complete battery and hardware probe for a given device:
        1. Queries dumpsys battery.
        2. Scans all /sys/class/power_supply nodes.
        3. Identifies charge_full, charge_full_design, charge_counter, cycle_count with exact file paths.
        4. Normalizes units and generates the raw diagnostic dump.
        """
        props = self.get_device_props(serial)
        dumpsys = self.probe_dumpsys_battery(serial)
        power_tree = self.scan_all_power_supplies(serial)

        # Dynamic search priority across all discovered nodes
        preferred_order = ["battery", "bms", "fg", "main", "oplus_chg", "bbc_battery", "mtk-battery"]
        discovered_nodes = list(power_tree.keys())
        search_nodes = [n for n in preferred_order if n in discovered_nodes] + [n for n in discovered_nodes if n not in preferred_order]
        if not search_nodes:
            search_nodes = preferred_order

        # 1. Locate charge_full
        charge_full_raw: Optional[int] = None
        charge_full_path: Optional[str] = None
        for node in search_nodes:
            entry = power_tree.get(node, {}).get("charge_full")
            if entry and entry.get("readable") and entry.get("int_val") and entry["int_val"] > 0:
                charge_full_raw = entry["int_val"]
                charge_full_path = entry["path"]
                break

        # 2. Locate charge_full_design
        charge_full_design_raw: Optional[int] = None
        charge_full_design_path: Optional[str] = None
        for node in search_nodes:
            entry = power_tree.get(node, {}).get("charge_full_design")
            if entry and entry.get("readable") and entry.get("int_val") and entry["int_val"] > 0:
                charge_full_design_raw = entry["int_val"]
                charge_full_design_path = entry["path"]
                break

        # 3. Locate charge_counter
        charge_counter_raw: Optional[int] = dumpsys.get("charge_counter")
        charge_counter_path: str = "dumpsys battery (Charge counter)"
        if charge_counter_raw is None:
            for node in search_nodes:
                entry = power_tree.get(node, {}).get("charge_counter")
                if entry and entry.get("readable") and entry.get("int_val"):
                    charge_counter_raw = entry["int_val"]
                    charge_counter_path = entry["path"]
                    break

        # 4. Locate cycle_count with deep phone data extraction across OEM layers
        cycle_count_raw: Optional[int] = None
        cycle_count_path: Optional[str] = None

        # Tier 1: dumpsys battery (Android 14+, Pixel, Samsung, Motorola)
        if dumpsys.get("cycle_count") is not None:
            c_cand = dumpsys["cycle_count"]
            if isinstance(c_cand, int) and 0 <= c_cand < 20000:
                cycle_count_raw = c_cand
                cycle_count_path = dumpsys.get("cycle_count_source") or "dumpsys battery (cycle count)"

        # Tier 2: Sysfs power supply hardware nodes across all discovered power supplies
        if cycle_count_raw is None:
            cycle_keys = [
                "cycle_count",
                "batt_cycle_count",
                "battery_cycle_count",
                "fg_cycle",
                "battery_cycle",
                "total_cycle",
                "cycle",
                "fg_cycle_count",
                "cycle_count_id",
                "batt_cycle",
                "battery_cycles",
                "soh_cycle_count",
                "batt_discharge_level",
            ]
            for node in search_nodes:
                node_data = power_tree.get(node, {})
                for cycle_key in cycle_keys:
                    entry = node_data.get(cycle_key)
                    if entry and entry.get("readable") and entry.get("int_val") is not None:
                        val = entry["int_val"]
                        # Plausibility check: reject negative or driver overflow (e.g. 65535, 4294967295)
                        if 0 <= val < 20000:
                            cycle_count_raw = val
                            cycle_count_path = entry["path"]
                            break
                if cycle_count_raw is not None:
                    break

        # Tier 3: dumpsys batterystats (Discharge/Charge cycle counters)
        if cycle_count_raw is None:
            bs_out, _, bs_code = self.run_shell(serial, "dumpsys batterystats --charged")
            if bs_code != 0 or not bs_out:
                bs_out, _, bs_code = self.run_shell(serial, "dumpsys batterystats")
            if bs_code == 0 and bs_out:
                import re
                m = re.search(r"(?:charge cycle count|discharge cycle count|discharge_cycle|mdischargecyclecount)\s*[:=]\s*(\d+)", bs_out, re.IGNORECASE)
                if not m:
                    m = re.search(r"\bdcc,(\d+)\b", bs_out)
                if m:
                    val = int(m.group(1))
                    if 0 <= val < 20000:
                        cycle_count_raw = val
                        cycle_count_path = "dumpsys batterystats (Charge cycle count)"

        # Tier 4: Direct vendor / OEM sysfs fallback paths
        if cycle_count_raw is None:
            vendor_paths = [
                "/sys/class/power_supply/battery/batt_cycle_count",
                "/sys/class/power_supply/battery/cycle_count",
                "/sys/class/power_supply/bms/cycle_count",
                "/sys/class/power_supply/google,battery/cycle_count",
                "/efs/FactoryApp/batt_discharge_level",
            ]
            for vpath in vendor_paths:
                out, _, code = self.run_shell(serial, f"cat {vpath}")
                if code == 0 and out:
                    val_str = out.strip()
                    if val_str.isdigit():
                        val = int(val_str)
                        if 0 <= val < 20000:
                            cycle_count_raw = val
                            cycle_count_path = vpath
                            break

        # Check unit scale mismatch
        from backend.health import normalize_capacity_units
        norm_full, norm_design, raw_ratio_unconverted, unit_note = normalize_capacity_units(
            charge_full_raw, charge_full_design_raw
        )

        # Build detailed diagnostic dump
        raw_dump = {
            "device_serial": serial,
            "device_model": props.get("model", "Android Device"),
            "manufacturer": props.get("manufacturer", "Unknown"),
            "android_version": props.get("android_version", "Unknown"),
            "dumpsys": {
                "level": dumpsys.get("level"),
                "voltage": dumpsys.get("voltage"),
                "temperature": dumpsys.get("temperature"),
                "temperature_c": dumpsys.get("temperature_c"),
                "health": dumpsys.get("health"),
                "health_label": dumpsys.get("health_label"),
                "status": dumpsys.get("status"),
                "status_label": dumpsys.get("status_label"),
                "technology": dumpsys.get("technology"),
            },
            "registers": {
                "charge_full": {
                    "raw_val": charge_full_raw,
                    "normalized_uah": norm_full,
                    "path": charge_full_path,
                },
                "charge_full_design": {
                    "raw_val": charge_full_design_raw,
                    "normalized_uah": norm_design,
                    "path": charge_full_design_path,
                },
                "charge_counter": {
                    "raw_val": charge_counter_raw,
                    "source": charge_counter_path,
                },
                "cycle_count": {
                    "raw_val": cycle_count_raw,
                    "path": cycle_count_path,
                    "exposed_by_hardware": cycle_count_raw is not None,
                    "status": "hardware" if cycle_count_raw is not None else "unavailable",
                },
                "unit_audit": {
                    "raw_ratio_before_conversion": raw_ratio_unconverted,
                    "normalized_ratio_pct": (norm_full / float(norm_design) * 100.0) if norm_full and norm_design else None,
                    "explanation": unit_note,
                },
            },
            "power_supplies_scanned": power_tree,
        }

        # Log diagnostic report
        self.print_diagnostic_dump(raw_dump)

        report = {
            "serial": serial,
            "device_info": props,
            "dumpsys_battery": dumpsys,
            "power_supplies": power_tree,
            "raw_dump": raw_dump,
            "summary": {
                "model": props.get("model", "Android Device"),
                "level_pct": dumpsys.get("level"),
                "voltage_mv": dumpsys.get("voltage"),
                "temperature_c": dumpsys.get("temperature_c"),
                "status": dumpsys.get("status_label", "Unknown"),
                "health_flag": dumpsys.get("health_label", "Unknown"),
                "charge_counter_uah": charge_counter_raw,
                "charge_full_raw": charge_full_raw,
                "charge_full_path": charge_full_path,
                "charge_full_uah": norm_full,
                "charge_full_design_raw": charge_full_design_raw,
                "charge_full_design_path": charge_full_design_path,
                "charge_full_design_uah": norm_design,
                "cycle_count": cycle_count_raw,
                "cycle_count_path": cycle_count_path,
                "cycle_count_exposed": cycle_count_raw is not None,
                "cycle_count_status": "hardware" if cycle_count_raw is not None else "unavailable",
                "has_design_capacity": norm_design is not None,
                "recommended_method": "capacity_ratio" if norm_design is not None else "trend_estimate",
            },
        }

        try:
            from backend.status_bus import emit_status
            resolved = []
            unresolved = []
            if norm_full is not None:
                resolved.append(f"charge_full={norm_full}µAh")
            else:
                unresolved.append("charge_full")
            if norm_design is not None:
                resolved.append(f"design={norm_design}µAh")
            else:
                unresolved.append("charge_full_design")
            if cycle_count_raw is not None:
                resolved.append(f"cycles={cycle_count_raw}")
            else:
                unresolved.append("cycle_count")
            if charge_counter_raw is not None:
                resolved.append("counter")
            else:
                unresolved.append("charge_counter")
            if dumpsys.get("voltage") is not None:
                resolved.append(f"{dumpsys.get('voltage')}mV")
            if dumpsys.get("temperature_c") is not None:
                resolved.append(f"{dumpsys.get('temperature_c')}°C")

            emit_status(
                serial,
                "probe",
                f"Hardware probe: {len(resolved)} metrics found ({', '.join(resolved[:3])}) | {len(unresolved)} unexposed",
                {"resolved": resolved, "unresolved": unresolved, "cycle_count": cycle_count_raw, "charge_full_uah": norm_full, "design_uah": norm_design},
                level="success" if len(unresolved) == 0 else "info",
            )
        except Exception:
            pass

        return report

    def print_diagnostic_dump(self, dump: Dict[str, Any]) -> None:
        """Logs the formatted raw hardware diagnostic dump."""
        reg = dump.get("registers", {})
        ds = dump.get("dumpsys", {})
        cf = reg.get("charge_full", {})
        cfd = reg.get("charge_full_design", {})
        cc = reg.get("charge_counter", {})
        cy = reg.get("cycle_count", {})
        ua = reg.get("unit_audit", {})

        print("\n" + "=" * 65)
        print("          RAW HARDWARE BATTERY DIAGNOSTIC DUMP")
        print("=" * 65)
        print(f"Device: {dump.get('manufacturer')} {dump.get('device_model')} (Serial: {dump.get('device_serial')})")
        print(f"Android Version: {dump.get('android_version')}")
        print("\n1. DUMPSYS BATTERY:")
        print(f"   Level:        {ds.get('level')}%")
        print(f"   Voltage:      {ds.get('voltage')} mV")
        print(f"   Temperature:  {ds.get('temperature')} (tenths of °C -> {ds.get('temperature_c')} °C)")
        print(f"   Status:       {ds.get('status')} ({ds.get('status_label')})")
        print(f"   Health:       {ds.get('health')} ({ds.get('health_label')})")
        print(f"   Technology:   {ds.get('technology')}")

        print("\n2. SYSFS CAPACITY REGISTERS:")
        print(f"   charge_full:        {cf.get('raw_val')} (from: {cf.get('path')})")
        print(f"   charge_full_design: {cfd.get('raw_val')} (from: {cfd.get('path')})")
        print(f"   charge_counter:     {cc.get('raw_val')} (from: {cc.get('source')})")

        print("\n3. UNIT SCALE & RATIO AUDIT:")
        print(f"   Raw Values Side-by-Side: full={cf.get('raw_val')} vs design={cfd.get('raw_val')}")
        print(f"   Raw Ratio Before Conv:   {ua.get('raw_ratio_before_conversion')}")
        print(f"   Scale Diagnosis:         {ua.get('explanation')}")
        print(f"   Normalized in µAh:       full={cf.get('normalized_uah')} µAh | design={cfd.get('normalized_uah')} µAh")
        print(f"   Normalized Ratio:        {ua.get('normalized_ratio_pct'):.2f}%" if ua.get('normalized_ratio_pct') else "   Normalized Ratio: N/A")

        print("\n4. CYCLE COUNT:")
        if cy.get("exposed_by_hardware") and cy.get("raw_val") is not None:
            print(f"   Hardware Cycle Count:    {cy.get('raw_val')} cycles (from: {cy.get('path')})")
        else:
            print(f"   Hardware Cycle Count:    Unavailable (not exposed by OEM firmware)")
        print("=" * 65 + "\n")


def run_cli_probe() -> None:
    """Command-line runner for the probe phase."""
    client = ADBClient()
    print("ADB Binary Path:", client.adb_path or "NOT FOUND")

    if not client.is_available():
        print("[ERROR] ADB executable could not be located.")
        return

    devices = client.get_devices()
    print(f"Connected Devices: {len(devices)}")

    if not devices:
        print("\nNo Android devices detected over USB.")
        return

    for dev in devices:
        serial = dev["serial"]
        state = dev["state"]
        if state != "device":
            print(f"[WARNING] Device {serial} is in state '{state}' (unauthorized or offline).")
            continue

        client.probe_device(serial)


if __name__ == "__main__":
    run_cli_probe()
