"""
Unit and integration tests for AI-Assisted Device Parameter Discovery Layer.
Verifies:
- Rule 1: Local-first authority (ADB probe first, resolved local fields never queried via AI)
- Rule 2 & 4: Majority-vote consensus validation across 3, 2, 1, and 0 responses
- Rule 3: Cold-start 503 estimated_time retry vs immediate bailout
- Rule 5: Database storage discipline (no duplicates, local always wins, no overwrite of resolved fields)
- Clean JSON parsing and normalization
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from backend.db import Database
from backend.device_profiler import (
    DeviceProfiler,
    clean_json_response,
)


def test_clean_json_response_parsing():
    """Verifies markdown stripping, boundary detection, and not_found normalization."""
    # 1. Clean JSON
    res = clean_json_response('{"charge_full_design": "/sys/class/power_supply/battery/charge_full_design"}')
    assert res == {"charge_full_design": "/sys/class/power_supply/battery/charge_full_design"}

    # 2. Markdown fences
    wrapped = "```json\n{\n  \"cycle_count\": \"/sys/class/power_supply/bms/cycle_count\"\n}\n```"
    res2 = clean_json_response(wrapped)
    assert res2 == {"cycle_count": "/sys/class/power_supply/bms/cycle_count"}

    # 3. Commentary with embedded JSON and not_found synonyms
    commentary = (
        "Here is the hardware path:\n"
        "{\"charge_full_design\": \"None\", \"cycle_count\": \"not_found\", \"temperature\": \"/sys/class/power_supply/battery/temp\"}\n"
        "Hope this helps!"
    )
    res3 = clean_json_response(commentary)
    assert res3["charge_full_design"] == "not_found"
    assert res3["cycle_count"] == "not_found"
    assert res3["temperature"] == "/sys/class/power_supply/battery/temp"

    # 4. Invalid text
    assert clean_json_response("No json here") is None


def test_majority_voting_3_responses_two_agree():
    """Rule 4: 3 responses, 2 agree on exact path string -> consensus accepted."""
    profiler = DeviceProfiler()
    responses = {
        "OpenRouter:modelA": {
            "charge_full_design": "/sys/class/power_supply/battery/charge_full_design",
            "cycle_count": "not_found",
        },
        "OpenRouter:modelB": {
            "charge_full_design": "/sys/class/power_supply/battery/charge_full_design",
            "cycle_count": "/sys/class/power_supply/battery/cycle_count",
        },
        "HuggingFace:modelC": {
            "charge_full_design": "/sys/class/power_supply/bms/charge_full_design",
            "cycle_count": "/sys/class/power_supply/bms/cycle_count",
        },
    }
    consensus, audit = profiler.compute_majority_consensus(
        responses, ["charge_full_design", "cycle_count"]
    )

    # charge_full_design: 2 of 3 agreed on exact path
    assert consensus["charge_full_design"]["source"] == "ai_consensus"
    assert consensus["charge_full_design"]["path"] == "/sys/class/power_supply/battery/charge_full_design"
    assert set(consensus["charge_full_design"]["models_agreed"]) == {"OpenRouter:modelA", "OpenRouter:modelB"}

    # cycle_count: all 3 gave different values (not_found, path1, path2) -> no consensus
    assert consensus["cycle_count"]["source"] == "unresolved_no_consensus"
    assert consensus["cycle_count"]["path"] is None


def test_majority_voting_3_responses_all_disagree():
    """Rule 4: 3 responses, all 3 disagree on path -> unresolved_no_consensus."""
    profiler = DeviceProfiler()
    responses = {
        "m1": {"charge_full_design": "/sys/path/one"},
        "m2": {"charge_full_design": "/sys/path/two"},
        "m3": {"charge_full_design": "/sys/path/three"},
    }
    consensus, _ = profiler.compute_majority_consensus(responses, ["charge_full_design"])
    assert consensus["charge_full_design"]["source"] == "unresolved_no_consensus"
    assert consensus["charge_full_design"]["path"] is None


def test_majority_voting_2_responses_agree_and_disagree():
    """Rule 4: 2 responses (HF failed/timed out) - both must agree exactly."""
    profiler = DeviceProfiler()

    # Case A: Both agree
    responses_agree = {
        "OpenRouter:modelA": {"cycle_count": "/sys/class/power_supply/battery/cycle_count"},
        "OpenRouter:modelB": {"cycle_count": "/sys/class/power_supply/battery/cycle_count"},
    }
    c_agree, _ = profiler.compute_majority_consensus(responses_agree, ["cycle_count"])
    assert c_agree["cycle_count"]["source"] == "ai_consensus"
    assert c_agree["cycle_count"]["path"] == "/sys/class/power_supply/battery/cycle_count"

    # Case B: Disagree (two conflicting answers never form a majority)
    responses_disagree = {
        "OpenRouter:modelA": {"cycle_count": "/sys/class/power_supply/battery/cycle_count"},
        "OpenRouter:modelB": {"cycle_count": "/sys/class/power_supply/bms/cycle_count"},
    }
    c_disagree, _ = profiler.compute_majority_consensus(responses_disagree, ["cycle_count"])
    assert c_disagree["cycle_count"]["source"] == "unresolved_no_consensus"
    assert c_disagree["cycle_count"]["path"] is None


def test_majority_voting_1_response_never_accepted():
    """Rule 4: 1 response alone is NEVER accepted as consensus regardless of confidence."""
    profiler = DeviceProfiler()
    responses_one = {
        "OpenRouter:modelA": {"charge_full_design": "/sys/class/power_supply/battery/charge_full_design"},
    }
    consensus, _ = profiler.compute_majority_consensus(responses_one, ["charge_full_design"])
    assert consensus["charge_full_design"]["source"] == "unresolved_no_consensus"
    assert consensus["charge_full_design"]["path"] is None


def test_local_first_precedence_no_ai_calls():
    """
    Rule 1: If ADB local probe resolves all fields,
    zero AI network calls are made and local values are preserved.
    """
    async def _test():
        mock_adb = MagicMock()
        mock_adb.probe_device.return_value = {
            "device_info": {"model": "Pixel 8", "manufacturer": "Google", "android_version": "14"},
            "dumpsys_battery": {"raw_output": "dumpsys text", "temperature_c": 28.5},
            "power_supplies": {},
            "summary": {
                "charge_full_path": "/sys/class/power_supply/battery/charge_full",
                "charge_full_raw": 4500000,
                "charge_full_design_path": "/sys/class/power_supply/battery/charge_full_design",
                "charge_full_design_raw": 4575000,
                "cycle_count_path": "/sys/class/power_supply/battery/cycle_count",
                "cycle_count": 142,
                "charge_counter_uah": 4000000,
                "temperature_c": 28.5,
            },
        }

        profiler = DeviceProfiler(adb_client=mock_adb)
        profiler.call_openrouter = AsyncMock()
        profiler.call_huggingface = AsyncMock()

        result = await profiler.profile_device("pixel-test-serial", force_ai=False)

        # Assert ZERO AI calls were fired
        assert profiler.call_openrouter.call_count == 0
        assert profiler.call_huggingface.call_count == 0

        # Assert all fields are recorded as 'local'
        fields = result["fields"]
        assert fields["charge_full"]["source"] == "local"
        assert fields["charge_full_design"]["source"] == "local"
        assert fields["cycle_count"]["source"] == "local"
        assert fields["charge_counter"]["source"] == "local"
        assert fields["temperature"]["source"] == "local"

    asyncio.run(_test())


def test_hf_cold_start_503_retry_and_bailout():
    """Rule 3: Tests HF 503 handling: retries once if estimated_time fits budget; bails if too long."""
    async def _test():
        profiler = DeviceProfiler()

        # Case 1: Short estimated_time -> sleeps and retries once
        with patch("httpx.AsyncClient") as mock_client_cls, patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__.return_value = mock_client

            # First call: 503 with 2.5s estimated_time; Second call: 200 OK
            resp_503 = MagicMock(status_code=503, text='{"estimated_time": 2.5}')
            resp_503.json.return_value = {"estimated_time": 2.5}

            resp_200 = MagicMock(status_code=200, text='{"charge_full_design": "/sys/class/power_supply/bms/charge_full_design"}')
            resp_200.json.return_value = {"charge_full_design": "/sys/class/power_supply/bms/charge_full_design"}

            mock_client.post.side_effect = [resp_503, resp_200]

            with patch("backend.device_profiler.HF_API_KEY", "dummy-key"):
                res = await profiler.call_huggingface("test-model", ["charge_full_design"], "context", timeout=25.0)

            assert mock_sleep.call_count == 1
            assert res == {"charge_full_design": "/sys/class/power_supply/bms/charge_full_design"}

        # Case 2: Excessive estimated_time (e.g. 50s) -> bails immediately, no retry
        with patch("httpx.AsyncClient") as mock_client_cls, patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__.return_value = mock_client

            resp_long_503 = MagicMock(status_code=503, text='{"estimated_time": 50.0}')
            resp_long_503.json.return_value = {"estimated_time": 50.0}
            mock_client.post.side_effect = [resp_long_503]

            with patch("backend.device_profiler.HF_API_KEY", "dummy-key"):
                res = await profiler.call_huggingface("test-model", ["charge_full_design"], "context", timeout=25.0)

            assert mock_sleep.call_count == 0
            assert res is None

    asyncio.run(_test())


def test_database_profile_storage_and_no_overwrite():
    """
    Rule 5: Database storage discipline
    - Checks device_profiles table creation
    - Local source always wins and is NEVER overwritten by AI
    - Existing row is updated without row duplication
    """
    test_db = Database(":memory:")

    # Initial profile with some local and some unresolved fields
    profile_data_1 = {
        "device_serial": "device-audit-001",
        "device_model": "Test Phone",
        "manufacturer": "OEM",
        "android_version": "14",
        "fields": {
            "charge_full": {"path": "/sys/battery/charge_full", "source": "local"},
            "charge_full_design": {"path": None, "source": "unresolved"},
            "cycle_count": {"path": "/sys/battery/cycle_count", "source": "local"},
            "charge_counter": {"path": "dumpsys battery", "source": "local"},
            "temperature": {"path": "dumpsys battery", "source": "local"},
        },
        "consensus_detail": {"note": "initial"},
    }

    saved_1 = test_db.save_or_update_device_profile(profile_data_1)
    assert saved_1["device_serial"] == "device-audit-001"
    assert saved_1["fields"]["charge_full"]["source"] == "local"
    assert saved_1["fields"]["charge_full_design"]["source"] == "unresolved"

    # Second pass: AI consensus discovers charge_full_design, and tries to change charge_full
    profile_data_2 = {
        "device_serial": "device-audit-001",
        "device_model": "Test Phone Updated",
        "manufacturer": "OEM",
        "android_version": "14",
        "fields": {
            # Attempt to overwrite local with AI (MUST BE REJECTED)
            "charge_full": {"path": "/ai/hallucination/path", "source": "ai_consensus"},
            # Valid AI discovery for previously unresolved field (MUST BE ACCEPTED)
            "charge_full_design": {"path": "/sys/bms/charge_full_design", "source": "ai_consensus"},
        },
        "consensus_detail": {"models_agreed": ["m1", "m2"]},
    }

    saved_2 = test_db.save_or_update_device_profile(profile_data_2)

    # 1. Row ID must match (updated existing row, no duplicate)
    assert saved_2["id"] == saved_1["id"]

    # 2. Local field was preserved and blocked AI overwrite
    assert saved_2["fields"]["charge_full"]["path"] == "/sys/battery/charge_full"
    assert saved_2["fields"]["charge_full"]["source"] == "local"

    # 3. Unresolved field was updated with AI consensus
    assert saved_2["fields"]["charge_full_design"]["path"] == "/sys/bms/charge_full_design"
    assert saved_2["fields"]["charge_full_design"]["source"] == "ai_consensus"
