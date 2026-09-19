"""
Unit and integration tests for:
1. Iterative Batch Fallback across model pool in backend/device_profiler.py.
2. Stopping when pool or time cap is exhausted (no infinite loops).
3. Pure math isolation in backend/health.py (no AI/network imports or calls in calculation path).
4. Core capacity metrics (Maximum Battery Capacity, Maximum Chemically Chargeable Capacity, Retention %, Fade %) and breakdown object.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from backend.device_profiler import DeviceProfiler, get_active_model_pool
from backend.health import calculate_health, build_breakdown


def test_iterative_batch_moves_to_next_batch_when_first_fails():
    """
    Verifies that when Batch 1 fails to reach majority consensus, the profiler
    automatically queries Batch 2 with remaining unresolved fields and stops once consensus is found.
    """
    async def _test():
        profiler = DeviceProfiler()

        # Create a 6-model custom pool (2 batches of 3)
        custom_pool = [
            # Batch 1
            {"provider": "openrouter", "model": "batch1-modelA"},
            {"provider": "openrouter", "model": "batch1-modelB"},
            {"provider": "huggingface", "model": "batch1-modelC"},
            # Batch 2
            {"provider": "openrouter", "model": "batch2-modelD"},
            {"provider": "openrouter", "model": "batch2-modelE"},
            {"provider": "huggingface", "model": "batch2-modelF"},
        ]

        # Mock call_openrouter and call_huggingface
        async def mock_call_openrouter(model_name, unresolved_fields, context_block, timeout=25.0):
            if model_name == "batch1-modelA":
                return {"cycle_count": "/sys/class/power_supply/bms/cycle_count"}
            elif model_name == "batch1-modelB":
                # Disagrees with modelA in Batch 1
                return {"cycle_count": "/sys/class/power_supply/battery/cycle_count"}
            elif model_name == "batch2-modelD":
                # Batch 2 model D agrees with model E
                return {"cycle_count": "/sys/class/power_supply/bms/cycle_count"}
            elif model_name == "batch2-modelE":
                # Batch 2 model E agrees with model D (2 of 3 in batch 2!)
                return {"cycle_count": "/sys/class/power_supply/bms/cycle_count"}
            return {"cycle_count": "not_found"}

        async def mock_call_hf(model_name, unresolved_fields, context_block, timeout=25.0):
            if model_name == "batch1-modelC":
                # Disagrees with both A and B in Batch 1
                return {"cycle_count": "not_found"}
            elif model_name == "batch2-modelF":
                return {"cycle_count": "not_found"}
            return None

        profiler.call_openrouter = AsyncMock(side_effect=mock_call_openrouter)
        profiler.call_huggingface = AsyncMock(side_effect=mock_call_hf)

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "mock-key"), \
             patch("backend.device_profiler.HF_API_KEY", "mock-key"):
            consensus, audit = await profiler.query_ai_consensus_iterative(
                unresolved_fields=["cycle_count"],
                context_block="Mock diagnostic dump",
                model_pool=custom_pool,
                time_cap_seconds=60.0,
                batch_size=3,
            )

        # Consensus must be resolved in Batch 2
        assert consensus["cycle_count"]["source"] == "ai_consensus"
        assert consensus["cycle_count"]["path"] == "/sys/class/power_supply/bms/cycle_count"
        assert "openrouter:batch2-modelD" in consensus["cycle_count"]["models_agreed"]
        assert "openrouter:batch2-modelE" in consensus["cycle_count"]["models_agreed"]

        # Audit must record exactly 2 attempted batches
        assert audit["total_batches_attempted"] == 2
        batch_history = audit["batch_history"]
        assert len(batch_history) == 2
        assert batch_history[0]["batch_index"] == 1
        assert batch_history[0]["fields_resolved_in_batch"] == []
        assert batch_history[1]["batch_index"] == 2
        assert batch_history[1]["fields_resolved_in_batch"] == ["cycle_count"]

    asyncio.run(_test())


def test_iterative_batch_stops_when_pool_exhausted():
    """
    Verifies that when all batches fail to reach consensus, the profiler stops
    cleanly (does NOT loop forever), records all batch attempts, and marks the field unresolved_no_consensus.
    """
    async def _test():
        profiler = DeviceProfiler()

        custom_pool = [
            # Batch 1
            {"provider": "openrouter", "model": "batch1-modelA"},
            {"provider": "openrouter", "model": "batch1-modelB"},
            {"provider": "huggingface", "model": "batch1-modelC"},
            # Batch 2
            {"provider": "openrouter", "model": "batch2-modelD"},
            {"provider": "openrouter", "model": "batch2-modelE"},
            {"provider": "huggingface", "model": "batch2-modelF"},
        ]

        # Every model gives conflicting answers across all batches
        counter = [0]
        async def mock_call(*args, **kwargs):
            counter[0] += 1
            return {"cycle_count": f"/sys/path/{counter[0]}"}

        profiler.call_openrouter = AsyncMock(side_effect=mock_call)
        profiler.call_huggingface = AsyncMock(side_effect=mock_call)

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "mock-key"), \
             patch("backend.device_profiler.HF_API_KEY", "mock-key"):
            consensus, audit = await profiler.query_ai_consensus_iterative(
                unresolved_fields=["cycle_count"],
                context_block="Mock diagnostic dump",
                model_pool=custom_pool,
                time_cap_seconds=60.0,
                batch_size=3,
            )

        # Must be marked unresolved_no_consensus
        assert consensus["cycle_count"]["source"] == "unresolved_no_consensus"
        assert consensus["cycle_count"]["path"] is None
        assert audit["total_batches_attempted"] == 2

    asyncio.run(_test())


def test_iterative_batch_respects_time_cap():
    """
    Verifies that when time cap expires, the search immediately terminates
    and does not execute subsequent batches.
    """
    async def _test():
        profiler = DeviceProfiler()

        custom_pool = [
            {"provider": "openrouter", "model": "batch1-modelA"},
            {"provider": "openrouter", "model": "batch1-modelB"},
            {"provider": "huggingface", "model": "batch1-modelC"},
            {"provider": "openrouter", "model": "batch2-modelD"},
            {"provider": "openrouter", "model": "batch2-modelE"},
            {"provider": "huggingface", "model": "batch2-modelF"},
        ]

        # Simulate slow first batch with conflicting answers that exceeds a short 0.1s time cap
        counter = [0]
        async def mock_slow_call(*args, **kwargs):
            await asyncio.sleep(0.15)
            counter[0] += 1
            return {"cycle_count": f"/sys/path/{counter[0]}"}

        profiler.call_openrouter = AsyncMock(side_effect=mock_slow_call)
        profiler.call_huggingface = AsyncMock(side_effect=mock_slow_call)

        with patch("backend.device_profiler.OPENROUTER_API_KEY", "mock-key"), \
             patch("backend.device_profiler.HF_API_KEY", "mock-key"):
            consensus, audit = await profiler.query_ai_consensus_iterative(
                unresolved_fields=["cycle_count"],
                context_block="Mock diagnostic dump",
                model_pool=custom_pool,
                time_cap_seconds=0.1,  # 100ms time cap
                batch_size=3,
            )

        # Should only execute batch 1 and immediately halt due to time cap
        assert audit["total_batches_attempted"] == 1
        assert consensus["cycle_count"]["source"] == "unresolved_no_consensus"

    asyncio.run(_test())


def test_health_pure_math_no_ai_imports():
    """
    Section 1 Verification:
    Verify backend/health.py contains zero AI/network imports (httpx, requests, urllib, etc.)
    and executes purely deterministic arithmetic.
    """
    health_mod = sys.modules.get("backend.health")
    assert health_mod is not None

    # Inspect module attributes & globals
    for attr in dir(health_mod):
        val = getattr(health_mod, attr)
        # Ensure no network clients or AI SDKs are present
        assert "httpx" not in str(val).lower()
        assert "requests" not in str(val).lower()
        assert "openrouter" not in str(val).lower()
        assert "huggingface" not in str(val).lower()
        assert "openai" not in str(val).lower()

    # Calculate health with completely mocked/isolated environment
    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4750000,
        charge_full_design_uah=5000000,
        charge_counter_uah=4750000,
        level_pct=100,
        cycle_count=120,
        voltage_mv=4180,
        temperature_c=29.0,
    )
    assert pct == 95.0
    assert method == "capacity_ratio"
    assert isinstance(pct, float)


def test_core_capacity_metrics_and_breakdown():
    """
    Section 2 & 4 Verification:
    Surfaces the two real, distinct values (Maximum Battery Capacity & Maximum Chemically Chargeable Capacity)
    and the core analytics ratio (capacity_retention_pct & capacity_fade_pct).
    """
    data_sources = {
        "charge_full": "local",
        "charge_full_design": "local",
        "cycle_count": "local",
        "charge_counter": "local",
        "temperature": "local",
    }

    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=4600000,        # Maximum Chemically Chargeable Capacity
        charge_full_design_uah=5000000, # Maximum Battery Capacity
        charge_counter_uah=4600000,
        level_pct=100,
        cycle_count=350,
        voltage_mv=4210,
        temperature_c=31.0,
        data_sources=data_sources,
    )

    # Verify Core Analytics Ratios
    # retention = (4600000 / 5000000) * 100 = 92.0%
    # fade = 100 - 92.0 = 8.0%
    assert details["capacity_retention_pct"] == 92.0
    assert details["capacity_fade_pct"] == 8.0

    # Verify Breakdown Object Structure
    bd = details["breakdown"]
    assert bd["maximum_battery_capacity"] == 5000000
    assert bd["maximum_chargeable_capacity_now"] == 4600000
    assert bd["capacity_retention_pct"] == 92.0
    assert bd["capacity_fade_pct"] == 8.0
    assert bd["cycle_fatigue_pct"] is not None and bd["cycle_fatigue_pct"] > 0
    assert bd["calendar_aging_pct"] is not None and bd["calendar_aging_pct"] > 0
    assert bd["stress_multiplier"] >= 1.0
    assert bd["final_health_pct"] == 92.0
    assert bd["data_sources"] == data_sources
    assert "Computed from confirmed real capacity" in bd["provenance_note"]


def test_breakdown_insufficient_data_state():
    """
    Section 4 Verification:
    When in insufficient_data state (< 7 days, cycle_count unexposed, no OEM SoH),
    the breakdown reflects capacity retention/fade from static registers,
    final_health_pct is strictly None, and data_sources notes insufficient_data.
    """
    data_sources = {
        "charge_full": "local",
        "charge_full_design": "local",
        "cycle_count": "insufficient_data",
        "charge_counter": "local",
        "temperature": "local",
    }

    pct, raw_ratio, recalibrated, method, details = calculate_health(
        charge_full_uah=5000000,
        charge_full_design_uah=5000000,
        charge_counter_uah=None,
        level_pct=100,
        cycle_count=None,  # Not exposed by OEM
        history_days=3.0,  # Under 7 days
        oem_reported_soh=None,
        data_sources=data_sources,
    )

    assert pct is None
    assert method == "insufficient_data"
    assert details["capacity_retention_pct"] == 100.0
    assert details["capacity_fade_pct"] == 0.0

    bd = details["breakdown"]
    assert bd["final_health_pct"] is None
    assert bd["maximum_battery_capacity"] == 5000000
    assert bd["maximum_chargeable_capacity_now"] == 5000000
    assert bd["data_sources"]["cycle_count"] == "insufficient_data"
    assert "Insufficient real data" in bd["provenance_note"]
