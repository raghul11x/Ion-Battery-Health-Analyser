"""
Unit and integration tests for Deep Metadata Excavation Layer & Zero-Hallucination SoH Detection.
Verifies:
1. Deep scan dynamically discovers non-standard power_supply subdirectories (oplus_chg, bms, mtk-battery)
   and aggregates framework-level dumpsys batterystats.
2. OEM SoH local heuristic regex flags plausible SoH fields and ignores irrelevant registers.
3. Insufficient-data state triggers when cycle_count is missing and history is < 7 days (health_pct is null).
4. Health calculation transitions correctly from insufficient-data to trend_estimate_no_cycle_data
   once 7+ days of charge_counter history accumulate.
5. Strict hallucination rejection: models returning fabricated SoH percentages without verbatim
   matching lines in the raw dump are rejected, and oem_reported_soh remains null.
"""

from unittest.mock import MagicMock
import pytest

from backend.adb_client import ADBClient
from backend.device_profiler import (
    DeviceProfiler,
    OEM_SOH_REGEX,
    clean_oem_soh_response,
)
from backend.health import (
    calculate_health,
    get_health_band,
)


def test_deep_scan_discovers_all_nodes():
    """Verifies that deep_scan traverses non-standard subdirectories and gathers dumpsys batterystats."""
    client = ADBClient()

    def mock_shell(serial, command, timeout=None):
        if "ls /sys/class/power_supply/oplus_chg" in command:
            return ("battery_soh charge_full cycle_count fast_chg_status", "", 0)
        elif "ls /sys/class/power_supply/mtk-battery" in command:
            return ("capacity temp", "", 0)
        elif "ls /sys/class/power_supply" in command:
            return ("battery oplus_chg mtk-battery usb", "", 0)
        elif "cat /sys/class/power_supply/oplus_chg/battery_soh" in command:
            return ("92", "", 0)
        elif "cat /sys/class/power_supply/oplus_chg/charge_full" in command:
            return ("5000000", "", 0)
        elif "cat /sys/class/power_supply/oplus_chg/cycle_count" in command:
            return ("", "No such file", 1)
        elif "cat /sys/class/power_supply/oplus_chg/fast_chg_status" in command:
            return ("1", "", 0)
        elif "cat /sys/class/power_supply/mtk-battery/capacity" in command:
            return ("85", "", 0)
        elif "cat /sys/class/power_supply/mtk-battery/temp" in command:
            return ("295", "", 0)
        elif "dumpsys batterystats --charged" in command:
            return ("Charge statistics since last charged: 4200 mAh", "", 0)
        elif "dumpsys batterystats --history" in command:
            return ("Historical battery events: 124 charge cycles logged", "", 0)
        return ("", "", 0)

    client.run_shell = MagicMock(side_effect=mock_shell)

    res = client.deep_scan("realme-test-serial")

    # 1. Non-standard OEM directories discovered
    assert "oplus_chg" in res["subdirectories"]
    assert "mtk-battery" in res["subdirectories"]

    # 2. Attribute files correctly parsed into structured tree
    oplus = res["sysfs"]["oplus_chg"]
    assert oplus["battery_soh"]["int_val"] == 92
    assert oplus["battery_soh"]["readable"] is True
    assert oplus["charge_full"]["int_val"] == 5000000
    assert oplus["cycle_count"]["readable"] is False

    # 3. Framework-level batterystats collected
    assert "4200 mAh" in res["batterystats_charged"]
    assert "124 charge cycles logged" in res["batterystats_history"]

    # 4. Raw dump lines and unified text present for AI consensus
    assert "/sys/class/power_supply/oplus_chg/battery_soh: 92" in res["raw_dump_text"]
    assert "=== DUMPSYS BATTERYSTATS --CHARGED ===" in res["raw_dump_text"]


def test_oem_soh_heuristic_detection():
    """Verifies that the OEM SoH heuristic correctly identifies SoH keys and rejects unrelated ones."""
    profiler = DeviceProfiler()

    mock_deep_scan = {
        "sysfs": {
            "oplus_chg": {
                "battery_soh": {
                    "path": "/sys/class/power_supply/oplus_chg/battery_soh",
                    "raw": "92",
                    "int_val": 92,
                    "readable": True,
                },
                "charge_control_limit_max": {
                    "path": "/sys/class/power_supply/oplus_chg/charge_control_limit_max",
                    "raw": "100",
                    "int_val": 100,
                    "readable": True,
                },
            },
            "bms": {
                "soh": {
                    "path": "/sys/class/power_supply/bms/soh",
                    "raw": "88",
                    "int_val": 88,
                    "readable": True,
                },
                "temp": {
                    "path": "/sys/class/power_supply/bms/temp",
                    "raw": "310",
                    "int_val": 310,
                    "readable": True,
                },
            },
        },
        "raw_dump_text": (
            "/sys/class/power_supply/oplus_chg/battery_soh: 92\n"
            "/sys/class/power_supply/oplus_chg/charge_control_limit_max: 100\n"
            "/sys/class/power_supply/bms/soh: 88\n"
            "/sys/class/power_supply/bms/temp: 310\n"
        ),
    }

    candidates = profiler.detect_oem_soh_candidates(mock_deep_scan)
    field_names = [c["field"] for c in candidates]

    # battery_soh and soh should be flagged
    assert "oplus_chg/battery_soh" in field_names
    assert "bms/soh" in field_names

    # Irrelevant registers must NOT be flagged
    assert "oplus_chg/charge_control_limit_max" not in field_names
    assert "bms/temp" not in field_names

    cand_dict = {c["field"]: c["soh_pct"] for c in candidates}
    assert cand_dict["oplus_chg/battery_soh"] == 92.0
    assert cand_dict["bms/soh"] == 88.0


def test_insufficient_data_state_under_7_days():
    """
    Zero-Hallucination verification:
    When cycle_count is missing, oem_reported_soh is None, and history < 7 days,
    the health model must set health_status='insufficient_data' and health_pct=None (NEVER 100%).
    """
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=5000000,
        charge_full_design_uah=5000000,
        charge_counter_uah=None,
        level_pct=100,
        cycle_count=None,  # Not exposed by OEM
        history_days=2.5,  # Under 7 days
        oem_reported_soh=None,
    )

    # Health percentage must be explicitly None (NEVER false 100%)
    assert pct is None
    assert method == "insufficient_data"
    assert details["health_status"] == "insufficient_data"
    assert details["history_days"] == 2.5
    assert details["days_required"] == 7.0
    assert details["days_remaining"] == 4.5
    assert "Cycle count isn't exposed by this device's firmware" in details["note"]

    # Health band should map to 'Gathering data...'
    band = get_health_band(pct)
    assert band["band"] == "Unknown"
    assert band["label"] == "Gathering data..."


def test_transition_to_trend_estimate_after_7_days():
    """
    Verifies that once 7+ days of history accumulate on a device with missing cycle_count,
    the model transitions to 'trend_estimate_no_cycle_data'.
    """
    baseline = {
        "charge_full_uah": 5000000,
        "charge_counter_uah": 5000000,
        "level_pct": 100,
        "timestamp": "2026-09-01T12:00:00",
    }

    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=5000000,  # Static factory register
        charge_full_design_uah=5000000,
        charge_counter_uah=4700000,
        level_pct=100,
        baseline_record=baseline,
        cycle_count=None,
        history_days=8.5,  # Accumulated > 7 days
        oem_reported_soh=None,
    )

    assert method == "trend_estimate_no_cycle_data"
    assert details["health_status"] == "evaluated"
    assert pct == 94.0  # 4700000 / 5000000 = 94.0%
    assert details["recalibrated"] is False


def test_hallucination_rejection_no_grounded_citation():
    """
    Zero-Hallucination verification:
    Feed consensus layer a raw dump containing NO SoH field.
    A model confidently returns a fabricated value with a line not present in the dump.
    Assert the hallucination is rejected, citation is marked invalid, and oem_reported_soh stays null.
    """
    profiler = DeviceProfiler()

    raw_dump_text = (
        "=== SYSFS POWER SUPPLY NODES ===\n"
        "/sys/class/power_supply/battery/voltage_now: 4125000\n"
        "/sys/class/power_supply/battery/temp: 298\n"
        "/sys/class/power_supply/battery/capacity: 78\n"
    )

    # Model A fabricates a value and quotes a path that does NOT exist in raw_dump_text
    model_responses = {
        "OpenRouter:modelA": {
            "is_soh": True,
            "quoted_line": "/sys/class/power_supply/battery/battery_soh: 94",
            "soh_pct": 94.0,
        },
        "OpenRouter:modelB": {
            "is_soh": False,
            "quoted_line": "not_found",
            "soh_pct": None,
        },
        "HuggingFace:modelC": {
            "is_soh": False,
            "quoted_line": "not_found",
            "soh_pct": None,
        },
    }

    # Verify individual citation validation
    is_valid_a, val_a = profiler.verify_oem_soh_response(model_responses["OpenRouter:modelA"], raw_dump_text)
    assert is_valid_a is False
    assert val_a is None

    # Compute consensus across all 3
    agreed_soh, audit = profiler.compute_oem_soh_consensus(
        candidate_soh=94.0,
        raw_dump_text=raw_dump_text,
        model_responses=model_responses,
    )

    # Must be completely rejected!
    assert agreed_soh is None
    assert audit["decision"] == "unresolved_no_consensus"
    assert audit["model_details"]["OpenRouter:modelA"]["citation_valid"] is False


def test_oem_soh_consensus_accepted_when_grounded():
    """
    Verifies that when 2 of 3 models agree AND quote lines that actually exist in the raw dump,
    the OEM SoH consensus is accepted.
    """
    profiler = DeviceProfiler()

    raw_dump_text = (
        "=== SYSFS POWER SUPPLY NODES ===\n"
        "/sys/class/power_supply/oplus_chg/battery_soh: 92\n"
        "/sys/class/power_supply/oplus_chg/status: Charging\n"
    )

    model_responses = {
        "OpenRouter:modelA": {
            "is_soh": True,
            "quoted_line": "/sys/class/power_supply/oplus_chg/battery_soh: 92",
            "soh_pct": 92.0,
        },
        "OpenRouter:modelB": {
            "is_soh": True,
            "quoted_line": "/sys/class/power_supply/oplus_chg/battery_soh: 92",
            "soh_pct": 92.0,
        },
        "HuggingFace:modelC": {
            "is_soh": False,
            "quoted_line": "not_found",
            "soh_pct": None,
        },
    }

    agreed_soh, audit = profiler.compute_oem_soh_consensus(
        candidate_soh=92.0,
        raw_dump_text=raw_dump_text,
        model_responses=model_responses,
    )

    assert agreed_soh == 92.0
    assert audit["decision"] == "ai_consensus"
    assert set(audit["agreeing_models"]) == {"OpenRouter:modelA", "OpenRouter:modelB"}
