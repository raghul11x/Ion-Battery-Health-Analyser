"""
Unit and integration tests for AI-Assisted Parameter Lookup Cascade and USB Debugging Optimization.

Verifies:
1. Cascade Stage 1: OpenRouter Primary (nvidia/nemotron-3-ultra-550b-a55b:free) resolves fields and stops early.
2. Cascade Stage 2: OpenRouter Fallback (nvidia/nemotron-3.5-lightning:free) is called when Primary fails.
3. Cascade Stage 3: Hugging Face Primary (deepseek-ai/DeepSeek-V4-Flash-0731) is called when OpenRouter fails.
4. Cascade Stage 4: Hugging Face Fallback (Qwen/Qwen3-32B) is called when HF Primary fails.
5. Hardware verification: Paths suggested by AI are verified via ADB cat on the device.
6. OEM Design Capacity Spec: Resolves design capacity in uAh from design_capacity_mah.
7. Local-first authority: Full USB probe resolves parameters locally with zero API calls.
8. Direct OEM SoH extraction from hardware sysfs nodes.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from backend.adb_client import ADBClient
from backend.device_profiler import (
    DeviceProfiler,
    OPENROUTER_MODEL_1,
    OPENROUTER_MODEL_2,
    HF_MODEL,
    HF_MODEL_2,
)


def test_cascade_stage_1_openrouter_primary_resolves_and_halts():
    """Stage 1: OpenRouter primary model succeeds -> stops immediately, no fallback calls."""
    async def _test():
        mock_adb = MagicMock()
        # When ADB cats the discovered path, it exists on the phone
        mock_adb.run_shell.return_value = ("5000000\n", "", 0)

        profiler = DeviceProfiler(adb_client=mock_adb)
        profiler.call_openrouter = AsyncMock(return_value={
            "charge_full_design": "/sys/class/power_supply/battery/charge_full_design"
        })
        profiler.call_huggingface = AsyncMock()

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "test-or-key"), \
             patch("backend.device_profiler.HF_API_KEY", "test-hf-key"):
            results, audit = await profiler.query_ai_cascade(
                serial="test-device-1",
                unresolved_fields=["charge_full_design"],
                context_block="dummy context",
            )

        # Primary OpenRouter model was queried exactly once
        assert profiler.call_openrouter.call_count == 1
        call_model = profiler.call_openrouter.call_args_list[0][0][0]
        assert call_model == OPENROUTER_MODEL_1

        # Hugging Face was never called
        assert profiler.call_huggingface.call_count == 0

        # Field resolved with hardware verification
        assert results["charge_full_design"]["source"] == "ai_verified"
        assert results["charge_full_design"]["path"] == "/sys/class/power_supply/battery/charge_full_design"
        assert results["charge_full_design"]["value"] == 5000000

        # Exactly 1 log entry in audit
        assert len(audit["cascade_logs"]) == 1
        assert audit["cascade_logs"][0]["stage"] == "openrouter_primary"

    asyncio.run(_test())


def test_cascade_stage_2_openrouter_fallback_when_primary_fails():
    """Stage 2: OpenRouter primary fails -> OpenRouter fallback succeeds, HF not called."""
    async def _test():
        mock_adb = MagicMock()
        mock_adb.run_shell.return_value = ("450\n", "", 0)

        profiler = DeviceProfiler(adb_client=mock_adb)

        # Primary returns None/fails, fallback returns valid path
        async def mock_call_or(model_name, fields, ctx, timeout=25.0):
            if model_name == OPENROUTER_MODEL_1:
                return None  # Primary fails
            elif model_name == OPENROUTER_MODEL_2:
                return {"cycle_count": "/sys/class/power_supply/bms/cycle_count"}
            return None

        profiler.call_openrouter = AsyncMock(side_effect=mock_call_or)
        profiler.call_huggingface = AsyncMock()

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "test-or-key"), \
             patch("backend.device_profiler.HF_API_KEY", "test-hf-key"):
            results, audit = await profiler.query_ai_cascade(
                serial="test-device-2",
                unresolved_fields=["cycle_count"],
                context_block="dummy context",
            )

        assert profiler.call_openrouter.call_count == 2
        models_called = [c[0][0] for c in profiler.call_openrouter.call_args_list]
        assert models_called == [OPENROUTER_MODEL_1, OPENROUTER_MODEL_2]

        # Hugging Face was never called
        assert profiler.call_huggingface.call_count == 0

        assert results["cycle_count"]["source"] == "ai_verified"
        assert results["cycle_count"]["path"] == "/sys/class/power_supply/bms/cycle_count"
        assert results["cycle_count"]["value"] == 450

    asyncio.run(_test())


def test_cascade_stage_3_falls_back_to_huggingface_primary():
    """Stage 3: Both OpenRouter models fail -> falls back to Hugging Face primary model."""
    async def _test():
        mock_adb = MagicMock()
        mock_adb.run_shell.return_value = ("4800000\n", "", 0)

        profiler = DeviceProfiler(adb_client=mock_adb)
        # OpenRouter returns empty or not_found
        profiler.call_openrouter = AsyncMock(return_value={"charge_full_design": "not_found"})

        # HF primary succeeds
        profiler.call_huggingface = AsyncMock(return_value={
            "charge_full_design": "/sys/class/power_supply/battery/charge_full_design"
        })

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "test-or-key"), \
             patch("backend.device_profiler.HF_API_KEY", "test-hf-key"):
            results, audit = await profiler.query_ai_cascade(
                serial="test-device-3",
                unresolved_fields=["charge_full_design"],
                context_block="dummy context",
            )

        # Both OpenRouter models were attempted
        assert profiler.call_openrouter.call_count == 2
        # HF primary was called
        assert profiler.call_huggingface.call_count == 1
        hf_model_called = profiler.call_huggingface.call_args_list[0][0][0]
        assert hf_model_called == HF_MODEL

        assert results["charge_full_design"]["source"] == "ai_verified"
        assert results["charge_full_design"]["path"] == "/sys/class/power_supply/battery/charge_full_design"

    asyncio.run(_test())


def test_cascade_stage_4_falls_back_to_huggingface_secondary():
    """Stage 4: OpenRouter fails and HF primary fails -> HF fallback (Qwen/Qwen3-32B) resolves."""
    async def _test():
        mock_adb = MagicMock()
        mock_adb.run_shell.return_value = ("185\n", "", 0)

        profiler = DeviceProfiler(adb_client=mock_adb)
        profiler.call_openrouter = AsyncMock(return_value=None)

        async def mock_call_hf(model_name, fields, ctx, timeout=25.0):
            if model_name == HF_MODEL:
                return None  # HF Primary fails
            elif model_name == HF_MODEL_2:
                return {"cycle_count": "/sys/class/power_supply/bms/battery_cycle"}
            return None

        profiler.call_huggingface = AsyncMock(side_effect=mock_call_hf)

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "test-or-key"), \
             patch("backend.device_profiler.HF_API_KEY", "test-hf-key"):
            results, audit = await profiler.query_ai_cascade(
                serial="test-device-4",
                unresolved_fields=["cycle_count"],
                context_block="dummy context",
            )

        assert profiler.call_openrouter.call_count == 2
        assert profiler.call_huggingface.call_count == 2
        hf_models_called = [c[0][0] for c in profiler.call_huggingface.call_args_list]
        assert hf_models_called == [HF_MODEL, HF_MODEL_2]

        assert results["cycle_count"]["source"] == "ai_verified"
        assert results["cycle_count"]["path"] == "/sys/class/power_supply/bms/battery_cycle"
        assert results["cycle_count"]["value"] == 185

    asyncio.run(_test())


def test_oem_design_capacity_spec_fallback():
    """Tests resolution of design capacity from design_capacity_mah spec."""
    async def _test():
        mock_adb = MagicMock()
        # Sysfs path does not exist on phone
        mock_adb.run_shell.return_value = ("", "No such file", 1)

        profiler = DeviceProfiler(adb_client=mock_adb)
        profiler.call_openrouter = AsyncMock(return_value={
            "charge_full_design": "not_found",
            "design_capacity_mah": "5000",
        })

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "test-or-key"):
            results, audit = await profiler.query_ai_cascade(
                serial="test-device-5",
                unresolved_fields=["charge_full_design"],
                context_block="dummy context",
            )

        assert results["charge_full_design"]["source"] == "ai_design_spec"
        assert results["charge_full_design"]["value"] == 5000000  # 5000 mAh * 1000 uAh
        assert "5000 mAh" in results["charge_full_design"]["path"]

    asyncio.run(_test())


def test_hardware_direct_oem_soh_extraction():
    """Verifies that direct OEM SoH registers in sysfs are detected locally without AI."""
    mock_adb = ADBClient()
    mock_adb.is_available = MagicMock(return_value=True)

    def mock_shell(serial, cmd, timeout=None):
        if "getprop" in cmd:
            return ("Realme GT", "", 0)
        if "dumpsys battery" in cmd:
            return ("Current Battery Service state:\n  level: 80\n  voltage: 4100\n  temperature: 270\n  status: 3", "", 0)
        if "ls /sys/class/power_supply" in cmd and "battery" not in cmd and "oplus_chg" not in cmd:
            return ("battery oplus_chg", "", 0)
        if "ls /sys/class/power_supply/oplus_chg" in cmd:
            return ("battery_soh charge_full charge_full_design", "", 0)
        if "cat /sys/class/power_supply/oplus_chg/battery_soh" in cmd:
            return ("96", "", 0)
        if "cat /sys/class/power_supply/oplus_chg/charge_full" in cmd:
            return ("4800000", "", 0)
        if "cat /sys/class/power_supply/oplus_chg/charge_full_design" in cmd:
            return ("5000000", "", 0)
        return ("", "", 0)

    mock_adb.run_shell = MagicMock(side_effect=mock_shell)
    probe_res = mock_adb.probe_device("realme-test-1")
    summary = probe_res["summary"]

    # OEM SoH detected directly from hardware
    assert summary["oem_reported_soh"] == 96.0
    assert summary["oem_soh_path"] == "/sys/class/power_supply/oplus_chg/battery_soh"
