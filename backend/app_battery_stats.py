"""
App Battery Drain Attribution Engine
Parses Android framework-level `dumpsys batterystats --checkin` and `--charged` metrics.
Extracts per-UID wakelock hold times, wakelock counts, CPU usage (foreground and background),
mobile/Wi-Fi radio active durations, and GPS/location active times.
Correlates with secondary estimated power (mAh) from power_profile.xml approximations.
"""

from __future__ import annotations
from datetime import datetime
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from backend.status_bus import emit_status

logger = logging.getLogger("battery_analyzer.app_battery_stats")


# Common human-readable display names for Android system packages and popular apps
KNOWN_APP_DISPLAY_NAMES: Dict[str, str] = {
    "android": "Android System",
    "com.google.android.gms": "Google Play Services",
    "com.android.vending": "Google Play Store",
    "com.google.android.youtube": "YouTube",
    "com.google.android.apps.maps": "Google Maps",
    "com.google.android.googlequicksearchbox": "Google App",
    "com.google.android.apps.photos": "Google Photos",
    "com.google.android.gm": "Gmail",
    "com.google.android.apps.messaging": "Messages",
    "com.android.chrome": "Chrome",
    "com.whatsapp": "WhatsApp",
    "com.instagram.android": "Instagram",
    "com.facebook.katana": "Facebook",
    "com.facebook.orca": "Messenger",
    "com.twitter.android": "X (Twitter)",
    "org.telegram.messenger": "Telegram",
    "com.spotify.music": "Spotify",
    "com.netflix.mediaclient": "Netflix",
    "com.amazon.mShop.android.shopping": "Amazon Shopping",
    "com.snapchat.android": "Snapchat",
    "com.reddit.frontpage": "Reddit",
    "com.discord": "Discord",
    "com.tiktok.android": "TikTok",
    "root": "Root Process",
    "mediaserver": "Media Server",
    "audioserver": "Audio Server",
    "cameraserver": "Camera Server",
    "com.android.phone": "Phone & SIM Services",
    "com.android.nfc": "NFC Service",
}


def get_app_display_name(package_name: str) -> str:
    """
    Transforms package identifiers into clean, user-friendly application titles.
    e.g. `com.google.android.youtube` -> `YouTube`
         `UID: 10999 (Uninstalled / System)` -> `Uninstalled App (UID 10999)`
    """
    if not package_name:
        return "Unknown Application"

    if package_name in KNOWN_APP_DISPLAY_NAMES:
        return KNOWN_APP_DISPLAY_NAMES[package_name]

    if package_name.startswith("UID:"):
        return package_name

    # Check for simple package name patterns: com.company.appname -> Appname
    parts = package_name.split(".")
    if len(parts) >= 2:
        candidate = parts[-1].capitalize()
        # If candidate is too generic (e.g. "android", "app", "mobile"), check previous token
        if candidate.lower() in ["android", "app", "mobile", "client", "ui"] and len(parts) >= 3:
            candidate = f"{parts[-2].capitalize()} {candidate}"
        return candidate

    return package_name


def format_duration_ms(ms: int) -> str:
    """
    Formats a millisecond duration into a clean human-readable string.
    e.g. 142000 -> '2m 22s', 4500 -> '4.5s', 7200000 -> '2h 0m', 0 -> '0s'
    """
    if ms is None or ms <= 0:
        return "0s"

    seconds = ms / 1000.0
    if seconds < 60:
        return f"{seconds:.1f}s" if seconds < 10 else f"{int(seconds)}s"

    minutes = int(seconds // 60)
    rem_seconds = int(seconds % 60)
    if minutes < 60:
        return f"{minutes}m {rem_seconds}s"

    hours = int(minutes // 60)
    rem_minutes = int(minutes % 60)
    return f"{hours}h {rem_minutes}m"


def parse_charged_estimated_power(charged_text: str) -> Dict[int, float]:
    """
    Parses the 'Estimated power use (mAh):' section from human-readable dumpsys batterystats.
    Returns a dictionary mapping integer UID to estimated mAh.

    Note: These figures are derived from OEM power_profile.xml and represent
    approximate, secondary estimations rather than direct hardware counter readings.
    """
    if not charged_text:
        return {}

    estimated_power: Dict[int, float] = {}
    in_section = False

    for line in charged_text.splitlines():
        line_clean = line.strip()
        if "Estimated power use (mAh):" in line_clean or "Estimated power use:" in line_clean:
            in_section = True
            continue

        if in_section:
            # Stop if we hit another top-level section header
            if line_clean and not line.startswith(" ") and not line.startswith("\t"):
                if not line_clean.startswith("Uid") and not line_clean.startswith("UID"):
                    break

            # Match lines like: "Uid 10123: 145.2 ( ... )" or "Uid u0a123: 145.2 ( ... )"
            match = re.search(r"Uid\s+(?:u\d+a)?(\d+):\s+([\d\.]+)", line_clean, re.IGNORECASE)
            if match:
                raw_id_str = match.group(1)
                mah_str = match.group(2)
                try:
                    raw_id = int(raw_id_str)
                    # If formatted as u0a123, raw_id is 123 -> uid is 10000 + 123 = 10123
                    if "u0a" in line_clean.lower() or (raw_id < 1000 and "u" in line_clean.lower()):
                        uid = 10000 + raw_id
                    else:
                        uid = raw_id

                    estimated_power[uid] = float(mah_str)
                except ValueError:
                    continue

    return estimated_power


def parse_batterystats_checkin(
    checkin_text: str,
    charged_text: Optional[str] = None,
    uid_map: Optional[Dict[int, str]] = None,
    serial: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Parses the comma-delimited `dumpsys batterystats --checkin` machine output.

    Extracts per-UID:
    - wakelock_ms (total partial wakelock hold duration in milliseconds)
    - wakelock_count (number of times a wakelock was acquired)
    - cpu_fg_ms (foreground user/system CPU execution time in ms)
    - cpu_bg_ms (background user/system CPU execution time in ms)
    - radio_active_ms (mobile radio + active Wi-Fi data transfer duration in ms)
    - gps_active_ms (GPS and fine location hardware sensor hold time in ms)
    - estimated_mah (optional secondary approximation from parallel --charged pull)

    Resilience Guarantee:
    - Malformed or corrupt records are logged to StatusBus without failing the scan.
    - Zero hallucinated values: missing fields default strictly to 0.
    """
    if not checkin_text or not checkin_text.strip():
        logger.warning(f"[APP DRAIN] Empty batterystats --checkin output for device {serial}")
        return []

    # Map of UID -> accumulator dictionary
    uid_records: Dict[int, Dict[str, Any]] = {}
    malformed_count = 0
    uid_map = uid_map or {}

    for line_idx, raw_line in enumerate(checkin_text.splitlines()):
        line = raw_line.strip()
        if not line:
            continue

        tokens = [t.strip() for t in line.split(",")]
        # Standard checkin line: version, uid, aggregation, section_tag, ...
        if len(tokens) < 4:
            continue

        # Check if field 1 is an integer UID
        uid_str = tokens[1]
        if not uid_str.isdigit():
            # Could be system summary header lines (e.g. vers, line summary)
            continue

        try:
            uid = int(uid_str)
        except ValueError:
            malformed_count += 1
            continue

        # Initialize accumulator for this UID if new
        if uid not in uid_records:
            uid_records[uid] = {
                "uid": uid,
                "wakelock_ms": 0,
                "wakelock_count": 0,
                "cpu_fg_ms": 0,
                "cpu_bg_ms": 0,
                "radio_active_ms": 0,
                "gps_active_ms": 0,
                "estimated_mah": None,
                "wakelock_names": set(),
            }

        rec = uid_records[uid]
        tag = tokens[3].lower()

        try:
            # 1. Wakelock records: 'wl' (per-lock) or 'awl' (aggregated wakelock)
            if tag == "wl":
                # Checkin format: vers,uid,aggregation,"wl",name,full_time,f_marker,full_count,partial_time,p_marker,partial_count,...
                if len(tokens) >= 5:
                    lock_name = tokens[4]
                    if lock_name:
                        rec["wakelock_names"].add(lock_name)

                # Find partial wakelock fields: look for 'p' marker or position-based fallback
                partial_time = 0
                partial_count = 0

                if "p" in tokens:
                    p_idx = tokens.index("p")
                    # Token immediately preceding 'p' is duration; token immediately following is count
                    if p_idx > 0 and tokens[p_idx - 1].isdigit():
                        partial_time = int(tokens[p_idx - 1])
                    if p_idx + 1 < len(tokens) and tokens[p_idx + 1].isdigit():
                        partial_count = int(tokens[p_idx + 1])
                elif len(tokens) >= 9:
                    # Fallback standard positional index: tag, full_time, f, full_cnt, partial_time, p, partial_cnt
                    if tokens[8].isdigit():
                        partial_time = int(tokens[8])
                    if len(tokens) >= 11 and tokens[10].isdigit():
                        partial_count = int(tokens[10])

                # If partial wakelock is 0 but full wakelock exists (e.g. 'f' marker)
                if partial_time == 0 and "f" in tokens:
                    f_idx = tokens.index("f")
                    if f_idx > 0 and tokens[f_idx - 1].isdigit():
                        partial_time = int(tokens[f_idx - 1])
                    if f_idx + 1 < len(tokens) and tokens[f_idx + 1].isdigit():
                        partial_count = int(tokens[f_idx + 1])

                rec["wakelock_ms"] += partial_time
                rec["wakelock_count"] += partial_count

            elif tag == "awl":
                # Aggregated wakelock data: vers,uid,aggregation,"awl",total_time,bg_time
                if len(tokens) >= 5 and tokens[4].isdigit():
                    awl_total = int(tokens[4])
                    # If per-lock wl did not already accumulate duration, populate from awl
                    if rec["wakelock_ms"] < awl_total:
                        rec["wakelock_ms"] = awl_total

            # 2. CPU usage: 'cpu' or 'proc'
            elif tag == "cpu":
                # Checkin format: vers,uid,aggregation,"cpu",user_time,system_time
                user_time = int(tokens[4]) if len(tokens) > 4 and tokens[4].isdigit() else 0
                sys_time = int(tokens[5]) if len(tokens) > 5 and tokens[5].isdigit() else 0
                rec["cpu_fg_ms"] += user_time
                rec["cpu_bg_ms"] += sys_time

            elif tag == "proc":
                # Process records: vers,uid,aggregation,"proc",name,user_time,system_time,starts
                if len(tokens) >= 7:
                    u_time = int(tokens[5]) if tokens[5].isdigit() else 0
                    s_time = int(tokens[6]) if tokens[6].isdigit() else 0
                    # Only add if cpu records were absent for this UID
                    if rec["cpu_fg_ms"] == 0 and rec["cpu_bg_ms"] == 0:
                        rec["cpu_fg_ms"] += u_time
                        rec["cpu_bg_ms"] += s_time

            # 3. Mobile Radio: 'm'
            elif tag == "m":
                # Checkin format: vers,uid,aggregation,"m",rx_bytes,tx_bytes,rx_packets,tx_packets,active_time,...
                if len(tokens) >= 9 and tokens[8].isdigit():
                    rec["radio_active_ms"] += int(tokens[8])

            # 4. Wi-Fi: 'w'
            elif tag == "w":
                # Checkin format: vers,uid,aggregation,"w",full_wifi_lock,scan_time,running_time,...
                if len(tokens) >= 7 and tokens[6].isdigit():
                    rec["radio_active_ms"] += int(tokens[6])

            # 5. GPS / Location: 'gpr' or 'gps'
            elif tag in ["gpr", "gps"]:
                # Checkin format: vers,uid,aggregation,"gpr",gps_time_ms,gps_count
                if len(tokens) >= 5 and tokens[4].isdigit():
                    rec["gps_active_ms"] += int(tokens[4])

            # 6. Direct power line if checkin includes pws (Power Summary)
            elif tag == "pws":
                if len(tokens) >= 5:
                    try:
                        rec["estimated_mah"] = float(tokens[4])
                    except ValueError:
                        pass

        except Exception as e:
            malformed_count += 1
            logger.debug(f"[APP DRAIN] Malformed line #{line_idx} for UID {uid}: {line} ({e})")
            if malformed_count <= 5:
                try:
                    emit_status(
                        serial,
                        "app_drain_scan",
                        f"Malformed checkin token line #{line_idx}: {e}",
                        {"raw_line": line[:100], "error": str(e)},
                        level="warning",
                    )
                except Exception:
                    pass

    # Merge secondary power estimations from parallel dumpsys batterystats --charged
    if charged_text:
        charged_powers = parse_charged_estimated_power(charged_text)
        for uid, mah in charged_powers.items():
            if uid in uid_records:
                uid_records[uid]["estimated_mah"] = mah
            else:
                # App had power usage in power_profile but 0 wakelock checkin entries
                uid_records[uid] = {
                    "uid": uid,
                    "wakelock_ms": 0,
                    "wakelock_count": 0,
                    "cpu_fg_ms": 0,
                    "cpu_bg_ms": 0,
                    "radio_active_ms": 0,
                    "gps_active_ms": 0,
                    "estimated_mah": mah,
                    "wakelock_names": set(),
                }

    # Finalize structured records with package resolution and display metadata
    results: List[Dict[str, Any]] = []
    for uid, rec in uid_records.items():
        # Filter out UIDs with absolute zero activity across all metrics
        has_activity = (
            rec["wakelock_ms"] > 0
            or rec["wakelock_count"] > 0
            or rec["cpu_fg_ms"] > 0
            or rec["cpu_bg_ms"] > 0
            or rec["radio_active_ms"] > 0
            or rec["gps_active_ms"] > 0
            or (rec["estimated_mah"] is not None and rec["estimated_mah"] > 0.0)
        )
        if not has_activity:
            continue

        pkg_name = uid_map.get(uid) or f"UID: {uid} (Uninstalled / System)"
        display_name = get_app_display_name(pkg_name)

        results.append({
            "uid": uid,
            "package_name": pkg_name,
            "display_name": display_name,
            "wakelock_ms": rec["wakelock_ms"],
            "wakelock_count": rec["wakelock_count"],
            "wakelock_duration_display": format_duration_ms(rec["wakelock_ms"]),
            "cpu_fg_ms": rec["cpu_fg_ms"],
            "cpu_bg_ms": rec["cpu_bg_ms"],
            "cpu_total_ms": rec["cpu_fg_ms"] + rec["cpu_bg_ms"],
            "radio_active_ms": rec["radio_active_ms"],
            "gps_active_ms": rec["gps_active_ms"],
            "estimated_mah": round(rec["estimated_mah"], 2) if rec["estimated_mah"] is not None else None,
            "is_estimated_power": True,
            "estimated_power_note": "Derived from OEM power_profile.xml approximations; secondary signal.",
            "wakelock_tags": sorted(list(rec["wakelock_names"]))[:5],
        })

    # Sort descending by wakelock_ms by default
    results.sort(key=lambda x: (x["wakelock_ms"], x["cpu_bg_ms"], x["estimated_mah"] or 0), reverse=True)

    # Emit completion event to live device feed
    try:
        top_app = results[0]["display_name"] if results else "None"
        emit_status(
            serial,
            "app_drain_scan",
            f"App drain analysis: {len(results)} active packages profiled (Top drainer: {top_app})",
            {
                "active_apps_count": len(results),
                "malformed_lines_handled": malformed_count,
                "top_app": top_app,
                "top_wakelock_ms": results[0]["wakelock_ms"] if results else 0,
            },
            level="success" if results else "info",
        )
    except Exception:
        pass

    return results
