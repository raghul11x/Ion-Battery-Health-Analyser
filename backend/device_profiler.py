"""
AI-Assisted Device Parameter Discovery Layer
Implements:
1. Local-first authority: ADB sysfs/dumpsys probing always runs FIRST.
   Resolved local fields are final and never queried via AI.
2. Concurrent dual-provider fallback: OpenRouter (2 models) + Hugging Face (1 model)
   fired via asyncio.gather with independent timeouts (20-25s).
3. Cold-start mitigation: HF 503 estimated_time retry & optional background startup ping.
4. Majority-vote consensus validation: strictly prevents hallucinations.
   - 3 responses: requires >=2 agreeing on exact path.
   - 2 responses: requires both (2 of 2) agreeing exactly.
   - 1 response: never accepted as consensus (unresolved_no_consensus).
5. Storage discipline: exactly one final value per field ('local' or 'ai_consensus').
   Existing device profiles are updated only for still-unresolved fields.
"""

from __future__ import annotations
import asyncio
from datetime import datetime
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

# Load environment configuration before initializing clients
load_dotenv()

from backend.adb_client import ADBClient
from backend.db import db
from backend.status_bus import emit_status

logger = logging.getLogger("battery_analyzer.device_profiler")

# Provider API Keys
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
HF_API_KEY = os.getenv("HF_API_KEY", "").strip()

# Configured Models
OPENROUTER_MODEL_1 = os.getenv("OPENROUTER_MODEL_1", "meta-llama/llama-3.3-70b-instruct:free").strip()
OPENROUTER_MODEL_2 = os.getenv("OPENROUTER_MODEL_2", "google/gemini-2.0-flash-exp:free").strip()
HF_MODEL = os.getenv("HF_MODEL", "Qwen/Qwen2.5-Coder-7B-Instruct").strip()

# Iterative Model Pool (batches of 3 across OpenRouter and Hugging Face)
DEFAULT_MODEL_POOL: List[Dict[str, str]] = [
    # Batch 1 (Primary high-accuracy models)
    {"provider": "openrouter", "model": OPENROUTER_MODEL_1},
    {"provider": "openrouter", "model": OPENROUTER_MODEL_2},
    {"provider": "huggingface", "model": HF_MODEL},
    # Batch 2 (Secondary robust fallback)
    {"provider": "openrouter", "model": os.getenv("OPENROUTER_MODEL_3", "deepseek/deepseek-chat:free").strip()},
    {"provider": "openrouter", "model": os.getenv("OPENROUTER_MODEL_4", "qwen/qwen-2.5-coder-32b-instruct:free").strip()},
    {"provider": "huggingface", "model": os.getenv("HF_MODEL_2", "meta-llama/Llama-3.1-8B-Instruct").strip()},
    # Batch 3 (Tertiary fallback)
    {"provider": "openrouter", "model": os.getenv("OPENROUTER_MODEL_5", "mistralai/mistral-7b-instruct:free").strip()},
    {"provider": "openrouter", "model": os.getenv("OPENROUTER_MODEL_6", "google/gemini-2.0-flash-thinking-exp:free").strip()},
    {"provider": "huggingface", "model": os.getenv("HF_MODEL_3", "mistralai/Mistral-7B-Instruct-v0.3").strip()},
]


def get_active_model_pool(custom_pool: Optional[List[Dict[str, str]]] = None) -> List[Dict[str, str]]:
    """
    Returns active models filtered by configured API keys, avoiding duplicate models.
    """
    source_pool = custom_pool if custom_pool is not None else DEFAULT_MODEL_POOL
    active: List[Dict[str, str]] = []
    seen = set()

    for item in source_pool:
        provider = item.get("provider", "").lower()
        model = item.get("model", "").strip()
        if not model:
            continue

        if provider == "openrouter" and not OPENROUTER_API_KEY:
            continue
        if provider == "huggingface" and not HF_API_KEY:
            continue

        key = f"{provider}:{model}"
        if key not in seen:
            seen.add(key)
            active.append({"provider": provider, "model": model})

    return active


CORE_BATTERY_FIELDS = [
    "charge_full",
    "charge_full_design",
    "cycle_count",
    "charge_counter",
    "temperature",
]

OEM_SOH_REGEX = re.compile(r"(?:^|_)soh(?:$|_)|state_of_health|battery_health|health_pct", re.I)


def clean_oem_soh_response(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Strips markdown and parses JSON response for OEM SoH verification:
    { "is_soh": bool, "quoted_line": str, "soh_pct": float }
    """
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        cleaned = cleaned[start_idx : end_idx + 1]

    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return {
                "is_soh": bool(data.get("is_soh", False)),
                "quoted_line": str(data.get("quoted_line", "")).strip(),
                "soh_pct": float(data.get("soh_pct")) if data.get("soh_pct") is not None and not isinstance(data.get("soh_pct"), bool) else None,
            }
    except Exception as e:
        logger.warning(f"Failed to parse OEM SoH model JSON: {e} | Raw text was: {raw_text[:200]}")
    return None


def clean_json_response(raw_text: str) -> Optional[Dict[str, str]]:
    """
    Strips markdown fences, explanations, and extracts clean JSON mapping fields to paths.
    """
    if not raw_text:
        return None

    cleaned = raw_text.strip()
    # Strip markdown code blocks ```json ... ``` or ``` ... ```
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    # Search for first '{' and last '}'
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        cleaned = cleaned[start_idx : end_idx + 1]

    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            normalized: Dict[str, str] = {}
            for k, v in data.items():
                if isinstance(v, str):
                    val_str = v.strip()
                    normalized[str(k).strip()] = "not_found" if val_str.lower() in ["not_found", "none", "null", "unknown", "n/a"] else val_str
                else:
                    normalized[str(k).strip()] = "not_found"
            return normalized
    except Exception as e:
        logger.warning(f"Failed to parse model JSON: {e} | Raw text was: {raw_text[:200]}")
    return None


class DeviceProfiler:
    """Orchestrates local-first device profiling with concurrent AI consensus fallback."""

    def __init__(self, adb_client: Optional[ADBClient] = None):
        self.adb = adb_client or ADBClient()

    def evaluate_local_fields(self, serial: str) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
        """
        Rule 1: Probes device via ADB sysfs & dumpsys battery FIRST.
        Classifies each of the 5 core fields as 'resolved_local' or 'unresolved'.
        """
        probe_data = self.adb.probe_device(serial)
        summary = probe_data.get("summary", {})
        dumpsys = probe_data.get("dumpsys_battery", {})
        device_info = probe_data.get("device_info", {})

        fields_status: Dict[str, Dict[str, Any]] = {}

        # 1. charge_full
        cf_path = summary.get("charge_full_path")
        cf_val = summary.get("charge_full_raw") or summary.get("charge_full_uah")
        if cf_path and cf_val and cf_val > 0:
            fields_status["charge_full"] = {
                "status": "resolved_local",
                "path": cf_path,
                "value": cf_val,
                "source": "local",
            }
        else:
            fields_status["charge_full"] = {
                "status": "unresolved",
                "path": None,
                "value": None,
                "source": "unresolved",
            }

        # 2. charge_full_design
        cfd_path = summary.get("charge_full_design_path")
        cfd_val = summary.get("charge_full_design_raw") or summary.get("charge_full_design_uah")
        if cfd_path and cfd_val and cfd_val > 0:
            fields_status["charge_full_design"] = {
                "status": "resolved_local",
                "path": cfd_path,
                "value": cfd_val,
                "source": "local",
            }
        else:
            fields_status["charge_full_design"] = {
                "status": "unresolved",
                "path": None,
                "value": None,
                "source": "unresolved",
            }

        # 3. cycle_count
        cy_path = summary.get("cycle_count_path")
        cy_val = summary.get("cycle_count")
        if cy_path and cy_val is not None:
            fields_status["cycle_count"] = {
                "status": "resolved_local",
                "path": cy_path,
                "value": cy_val,
                "source": "local",
            }
        else:
            fields_status["cycle_count"] = {
                "status": "unresolved",
                "path": None,
                "value": None,
                "source": "unresolved",
            }

        # 4. charge_counter
        cc_val = summary.get("charge_counter_uah")
        if cc_val is not None and cc_val > 0:
            fields_status["charge_counter"] = {
                "status": "resolved_local",
                "path": "dumpsys battery (Charge counter)",
                "value": cc_val,
                "source": "local",
            }
        else:
            fields_status["charge_counter"] = {
                "status": "unresolved",
                "path": None,
                "value": None,
                "source": "unresolved",
            }

        # 5. temperature
        temp_val = summary.get("temperature_c")
        if temp_val is not None:
            fields_status["temperature"] = {
                "status": "resolved_local",
                "path": "dumpsys battery (temperature)",
                "value": temp_val,
                "source": "local",
            }
        else:
            fields_status["temperature"] = {
                "status": "unresolved",
                "path": None,
                "value": None,
                "source": "unresolved",
            }

        return fields_status, probe_data

    def build_raw_context_block(self, serial: str, probe_data: Dict[str, Any]) -> str:
        """Constructs the raw context text from getprop, dumpsys, and power_supply scan."""
        device_info = probe_data.get("device_info", {})
        dumpsys = probe_data.get("dumpsys_battery", {})
        power_tree = probe_data.get("power_supplies", {})

        # 1. Properties
        props_text = "\n".join([f"[{k}]: [{v}]" for k, v in device_info.items()])

        # 2. Dumpsys
        raw_dumpsys = dumpsys.get("raw_output", "")
        if not raw_dumpsys:
            # Fallback to key items if raw text not stored
            raw_dumpsys = "\n".join([f"{k}: {v}" for k, v in dumpsys.items() if k != "raw_output"])

        # 3. Power supply file tree
        tree_lines = []
        for supply_name, attrs in power_tree.items():
            tree_lines.append(f"/sys/class/power_supply/{supply_name}:")
            for attr_name, attr_data in attrs.items():
                readable = attr_data.get("readable", False)
                raw_val = attr_data.get("raw", "")
                if readable:
                    tree_lines.append(f"  - {attr_name} (readable, value='{raw_val}') -> {attr_data.get('path')}")
                else:
                    tree_lines.append(f"  - {attr_name} (not readable or unreadable)")

        power_text = "\n".join(tree_lines) if tree_lines else "No sysfs power supplies found."

        return (
            f"=== DEVICE PROPERTIES (getprop) ===\n{props_text}\n\n"
            f"=== DUMPSYS BATTERY OUTPUT ===\n{raw_dumpsys}\n\n"
            f"=== /sys/class/power_supply/ DIRECTORY & ATTRIBUTES ===\n{power_text}"
        )

    async def call_openrouter(
        self,
        model_name: str,
        unresolved_fields: List[str],
        context_block: str,
        timeout: float = 25.0,
    ) -> Optional[Dict[str, str]]:
        """Makes an asynchronous call to OpenRouter for unresolved fields."""
        if not OPENROUTER_API_KEY:
            logger.info(f"[PROFILER] Skipping OpenRouter call to '{model_name}': OPENROUTER_API_KEY not configured.")
            return None

        prompt = (
            f"You are an expert Android kernel and battery power_supply sysfs engineer.\n"
            f"Analyze the device context below and determine the exact sysfs absolute file path on this device "
            f"for ONLY the following unresolved battery fields:\n"
            f"{json.dumps(unresolved_fields)}\n\n"
            f"Context:\n{context_block}\n\n"
            f"STRICT RULES:\n"
            f"1. For each requested field, return the exact absolute sysfs file path (e.g. '/sys/class/power_supply/battery/charge_full_design') "
            f"if you can confidently identify it from the provided device context.\n"
            f"2. If you cannot confidently identify the exact path on this specific device, return 'not_found' for that field.\n"
            f"3. DO NOT guess, hallucinate, or average paths.\n"
            f"4. Respond with ONLY a valid JSON object matching the requested fields, with no markdown code blocks and no commentary.\n"
            f"Example: {{\"charge_full_design\": \"/sys/class/power_supply/bms/charge_full_design\"}}"
        )

        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/phone-battery-health-analyzer",
            "X-Title": "Phone Battery Health Analyzer",
        }
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "You are a precise Android sysfs hardware inspector. Return JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 500,
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=headers,
                    json=payload,
                )
                if res.status_code == 200:
                    data = res.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    parsed = clean_json_response(content)
                    if parsed:
                        logger.info(f"[PROFILER] OpenRouter ({model_name}) succeeded: {parsed}")
                        return parsed
                else:
                    logger.warning(f"[PROFILER] OpenRouter ({model_name}) returned HTTP {res.status_code}: {res.text[:200]}")
        except asyncio.TimeoutError:
            logger.warning(f"[PROFILER] OpenRouter ({model_name}) timed out after {timeout}s.")
        except Exception as e:
            logger.warning(f"[PROFILER] OpenRouter ({model_name}) error: {e}")

        return None

    async def call_huggingface(
        self,
        model_name: str,
        unresolved_fields: List[str],
        context_block: str,
        timeout: float = 25.0,
    ) -> Optional[Dict[str, str]]:
        """
        Makes an asynchronous call to Hugging Face Inference API with Rule 3 cold-start mitigation.
        Parses 503 estimated_time and retries once if within timeout budget.
        """
        if not HF_API_KEY:
            logger.info(f"[PROFILER] Skipping Hugging Face call to '{model_name}': HF_API_KEY not configured.")
            return None

        prompt = (
            f"You are an expert Android kernel and battery power_supply sysfs engineer.\n"
            f"Analyze the device context below and determine the exact sysfs absolute file path on this device "
            f"for ONLY the following unresolved battery fields:\n"
            f"{json.dumps(unresolved_fields)}\n\n"
            f"Context:\n{context_block}\n\n"
            f"STRICT RULES:\n"
            f"1. For each requested field, return the exact absolute sysfs file path (e.g. '/sys/class/power_supply/battery/charge_full_design') "
            f"if you can confidently identify it from the provided device context.\n"
            f"2. If you cannot confidently identify the exact path on this specific device, return 'not_found' for that field.\n"
            f"3. DO NOT guess, hallucinate, or average paths.\n"
            f"4. Respond with ONLY a valid JSON object matching the requested fields, with no markdown code blocks and no commentary.\n"
            f"Example: {{\"charge_full_design\": \"/sys/class/power_supply/bms/charge_full_design\"}}"
        )

        # Alias mapping for current router endpoints
        target_model = model_name
        if target_model in ["meta-llama/Meta-Llama-3-8B-Instruct", "meta-llama/Meta-Llama-3-8B"]:
            target_model = "meta-llama/Llama-3.1-8B-Instruct"

        headers = {
            "Authorization": f"Bearer {HF_API_KEY}",
            "Content-Type": "application/json",
        }
        url = "https://router.huggingface.co/v1/chat/completions"

        payload = {
            "model": target_model,
            "messages": [
                {"role": "system", "content": "You are a precise Android sysfs hardware inspector. Return JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 500,
        }

        async def _do_post(client: httpx.AsyncClient, post_timeout: float) -> Tuple[Optional[int], Optional[str], Optional[Dict[str, Any]]]:
            try:
                r = await client.post(url, headers=headers, json=payload, timeout=post_timeout)
                try:
                    js = r.json()
                except Exception:
                    js = None
                return r.status_code, r.text, js
            except asyncio.TimeoutError:
                return 408, "Timeout", None
            except Exception as ex:
                return 500, str(ex), None

        try:
            async with httpx.AsyncClient() as client:
                status, text_out, data = await _do_post(client, timeout)

                # Rule 3: Cold-start 503 handling
                if status == 503 and isinstance(data, dict) and "estimated_time" in data:
                    est_time = float(data.get("estimated_time", 0))
                    logger.info(f"[HF COLD-START] Model '{target_model}' loading. Estimated time: {est_time:.1f}s.")

                    # If wait fits comfortably within timeout budget, retry once
                    if est_time <= (timeout - 5.0) and est_time > 0:
                        logger.info(f"[HF COLD-START] Sleeping {est_time:.1f}s before automatic retry...")
                        await asyncio.sleep(est_time)
                        retry_timeout = max(5.0, timeout - est_time)
                        status, text_out, data = await _do_post(client, retry_timeout)
                    else:
                        logger.warning(f"[HF COLD-START] Estimated time {est_time:.1f}s exceeds remaining budget. Bailing immediately.")
                        return None

                if status == 200:
                    raw_content = ""
                    if isinstance(data, dict) and "choices" in data and len(data["choices"]) > 0:
                        raw_content = data["choices"][0].get("message", {}).get("content", "")
                    elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                        raw_content = data[0].get("generated_text", "")
                    elif isinstance(data, dict) and "generated_text" in data:
                        raw_content = data.get("generated_text", "")
                    elif text_out:
                        raw_content = text_out

                    parsed = clean_json_response(raw_content)
                    if parsed:
                        logger.info(f"[PROFILER] Hugging Face ({target_model}) succeeded: {parsed}")
                        return parsed
                else:
                    logger.warning(f"[PROFILER] Hugging Face ({target_model}) returned HTTP {status}: {text_out[:200] if text_out else ''}")
        except asyncio.TimeoutError:
            logger.warning(f"[PROFILER] Hugging Face ({target_model}) timed out.")
        except Exception as e:
            logger.warning(f"[PROFILER] Hugging Face ({target_model}) error: {e}")

        return None

    def compute_majority_consensus(
        self,
        successful_responses: Dict[str, Dict[str, str]],
        unresolved_fields: List[str],
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
        """
        Rule 4: Majority-vote validation — no hallucination
        - 3 responses: accept a value only if at least 2 of 3 agree on exact path string.
          (If all 3 return not_found, consensus is not_found).
        - 2 responses: both must agree exactly. Conflicting answers -> unresolved_no_consensus.
        - 1 response: never accepted on its own -> unresolved_no_consensus.
        - 0 responses: unresolved_no_consensus.
        """
        n = len(successful_responses)
        results: Dict[str, Dict[str, Any]] = {}
        consensus_audit: Dict[str, Any] = {}

        for field in unresolved_fields:
            votes: Dict[str, List[str]] = {}  # normalized_val -> [model_names]

            for model_name, resp in successful_responses.items():
                val = resp.get(field, "not_found")
                if not val:
                    val = "not_found"
                val_norm = val.strip()
                votes.setdefault(val_norm, []).append(model_name)

            chosen_path: Optional[str] = None
            chosen_source = "unresolved_no_consensus"
            agreeing_models: List[str] = []

            if n == 3:
                # Need at least 2 of 3
                majority_found = False
                for candidate_val, model_list in votes.items():
                    if len(model_list) >= 2:
                        majority_found = True
                        if candidate_val.lower() != "not_found":
                            chosen_path = candidate_val
                            chosen_source = "ai_consensus"
                            agreeing_models = model_list
                        else:
                            chosen_path = None
                            chosen_source = "unresolved_no_consensus"
                            agreeing_models = model_list
                        break
                if not majority_found:
                    chosen_source = "unresolved_no_consensus"

            elif n == 2:
                # Both must agree exactly
                if len(votes) == 1:
                    candidate_val, model_list = next(iter(votes.items()))
                    if candidate_val.lower() != "not_found":
                        chosen_path = candidate_val
                        chosen_source = "ai_consensus"
                        agreeing_models = model_list
                    else:
                        chosen_path = None
                        chosen_source = "unresolved_no_consensus"
                        agreeing_models = model_list
                else:
                    # Conflicting answers
                    chosen_source = "unresolved_no_consensus"

            elif n == 1:
                # 1 response is NEVER accepted as consensus on its own
                chosen_source = "unresolved_no_consensus"

            else:
                chosen_source = "unresolved_no_consensus"

            results[field] = {
                "path": chosen_path,
                "source": chosen_source,
                "models_agreed": agreeing_models,
            }

            consensus_audit[field] = {
                "votes": votes,
                "models_count": n,
                "decision": chosen_source,
                "accepted_path": chosen_path,
                "models_agreed": agreeing_models,
            }

        audit_detail = {
            "timestamp": datetime.utcnow().isoformat(),
            "models_queried": list(successful_responses.keys()),
            "successful_count": n,
            "raw_responses": successful_responses,
            "field_consensus": consensus_audit,
        }

        return results, audit_detail

    def detect_oem_soh_candidates(self, deep_scan_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Scans all deep-scan key names for ones matching OEM_SOH_REGEX
        (e.g., soh, state_of_health, battery_health, health_pct).
        Matches ONLY against field names that literally appear in the raw deep-scan dump.
        """
        candidates: List[Dict[str, Any]] = []
        supplies_tree = deep_scan_data.get("sysfs", {})
        raw_dump_text = deep_scan_data.get("raw_dump_text", "")

        for node, attrs in supplies_tree.items():
            if not isinstance(attrs, dict):
                continue
            for attr, info in attrs.items():
                if not isinstance(info, dict):
                    continue

                if OEM_SOH_REGEX.search(attr) or OEM_SOH_REGEX.search(f"{node}_{attr}"):
                    fpath = info.get("path")
                    raw_val = str(info.get("raw", "")).strip()
                    if not raw_val:
                        continue

                    expected_line = f"{fpath}: {raw_val}"
                    # Strict validation: candidate must literally appear in raw_dump_text
                    if expected_line not in raw_dump_text and f"{attr}: {raw_val}" not in raw_dump_text:
                        continue

                    int_val = info.get("int_val")
                    if int_val is not None:
                        val_f = float(int_val)
                        if 0.0 <= val_f <= 100.0:
                            candidates.append({
                                "field": f"{node}/{attr}",
                                "path": fpath,
                                "raw_line": expected_line,
                                "soh_pct": val_f,
                            })
                        elif 100.0 < val_f <= 10000.0:
                            candidates.append({
                                "field": f"{node}/{attr}",
                                "path": fpath,
                                "raw_line": expected_line,
                                "soh_pct": round(val_f / 100.0, 1),
                            })
        return candidates

    def verify_oem_soh_response(self, response: Any, raw_dump_text: str) -> Tuple[bool, Optional[float]]:
        """
        Zero-Hallucination verification:
        A model response is only accepted if:
        1. It returns is_soh == True and a numeric soh_pct.
        2. It quotes/references the actual matching line from raw_dump_text.
        3. The quoted_line exists verbatim in raw_dump_text.
        """
        if not isinstance(response, dict):
            return False, None
        if not response.get("is_soh"):
            return False, None

        quoted_line = response.get("quoted_line")
        if not quoted_line or not isinstance(quoted_line, str):
            logger.warning("[HALLUCINATION REJECTED] Model did not provide quoted_line citation.")
            return False, None

        quoted_clean = quoted_line.strip()
        if quoted_clean.lower() in ["not_found", "none", "null"] or not quoted_clean:
            return False, None

        if quoted_clean not in raw_dump_text:
            logger.warning(f"[HALLUCINATION REJECTED] Quoted line '{quoted_clean}' does not exist in raw dump!")
            return False, None

        val = response.get("soh_pct")
        if isinstance(val, (int, float)) and 0.0 <= float(val) <= 100.0:
            return True, float(val)
        return False, None

    def compute_oem_soh_consensus(
        self,
        candidate_soh: float,
        raw_dump_text: str,
        model_responses: Dict[str, Any],
    ) -> Tuple[Optional[float], Dict[str, Any]]:
        """
        Majority-vote consensus for OEM-reported SoH:
        - Validates citations to strictly reject ungrounded hallucinations.
        - Requires >=2 agreeing verified votes among 3 models, or 2 of 2 for 2 models.
        - Returns (agreed_soh_pct, audit_dict).
        """
        verified_votes: Dict[float, List[str]] = {}
        audit_votes: Dict[str, Any] = {}
        n = len(model_responses)

        for model_name, resp in model_responses.items():
            is_valid, soh_val = self.verify_oem_soh_response(resp, raw_dump_text)
            audit_votes[model_name] = {
                "raw_response": resp,
                "citation_valid": is_valid,
                "verified_soh": soh_val,
            }
            if is_valid and soh_val is not None:
                verified_votes.setdefault(soh_val, []).append(model_name)

        chosen_soh: Optional[float] = None
        chosen_decision = "unresolved_no_consensus"
        agreeing_models: List[str] = []

        if n == 3:
            for val, models in verified_votes.items():
                if len(models) >= 2:
                    chosen_soh = val
                    chosen_decision = "ai_consensus"
                    agreeing_models = models
                    break
        elif n == 2:
            if len(verified_votes) == 1:
                val, models = next(iter(verified_votes.items()))
                if len(models) == 2:
                    chosen_soh = val
                    chosen_decision = "ai_consensus"
                    agreeing_models = models

        audit = {
            "models_queried": list(model_responses.keys()),
            "models_count": n,
            "verified_votes": verified_votes,
            "decision": chosen_decision,
            "accepted_soh": chosen_soh,
            "agreeing_models": agreeing_models,
            "model_details": audit_votes,
        }
        return chosen_soh, audit

    async def call_openrouter_oem_soh(
        self,
        model_name: str,
        prompt: str,
        timeout: float = 25.0,
    ) -> Optional[Dict[str, Any]]:
        if not OPENROUTER_API_KEY:
            return None
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/phone-battery-health-analyzer",
            "X-Title": "Phone Battery Health Analyzer",
        }
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "You are a precise Android sysfs hardware inspector. Return JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 300,
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return clean_oem_soh_response(content)
        except Exception as ex:
            logger.warning(f"OpenRouter OEM SoH error ({model_name}): {ex}")
        return None

    async def call_hf_oem_soh(
        self,
        model_name: str,
        prompt: str,
        timeout: float = 25.0,
    ) -> Optional[Dict[str, Any]]:
        if not HF_API_KEY:
            return None
        target_model = model_name
        if target_model in ["meta-llama/Meta-Llama-3-8B-Instruct", "meta-llama/Meta-Llama-3-8B"]:
            target_model = "meta-llama/Llama-3.1-8B-Instruct"
        url = "https://router.huggingface.co/v1/chat/completions"
        headers = {"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}
        payload = {
            "model": target_model,
            "messages": [
                {"role": "system", "content": "You are a precise Android sysfs hardware inspector. Return JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 300,
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return clean_oem_soh_response(content)
        except Exception as ex:
            logger.warning(f"HF OEM SoH error ({model_name}): {ex}")
        return None

    async def query_ai_consensus_iterative(
        self,
        unresolved_fields: List[str],
        context_block: str,
        model_pool: Optional[List[Dict[str, str]]] = None,
        time_cap_seconds: float = 180.0,
        batch_size: int = 3,
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
        """
        Iterative Batch-Fallback AI Consensus:
        1. Queries models from pool in batches of 3 concurrently.
        2. Requires 2-of-3 agreement per batch (or 2-of-2 if batch of 2).
        3. If consensus is reached for any fields, they are marked resolved and removed
           from subsequent batch queries.
        4. If fields remain unresolved, automatically queries the NEXT batch of 3 models.
        5. Halts when:
           - All fields are resolved, OR
           - Total time cap is reached, OR
           - The model pool is exhausted.
        6. Produces a full audit log detailing every batch attempt.
        """
        start_time = time.monotonic()
        active_pool = get_active_model_pool(model_pool)

        remaining_fields = list(unresolved_fields)
        final_consensus: Dict[str, Dict[str, Any]] = {}
        batch_logs: List[Dict[str, Any]] = []

        if not active_pool or not remaining_fields:
            for f in remaining_fields:
                final_consensus[f] = {
                    "path": None,
                    "source": "unresolved_no_consensus",
                    "models_agreed": [],
                }
            audit_detail = {
                "timestamp": datetime.utcnow().isoformat(),
                "total_batches_attempted": 0,
                "total_models_pool_size": len(active_pool),
                "total_elapsed_seconds": 0.0,
                "batch_history": [],
                "final_consensus": final_consensus,
            }
            return final_consensus, audit_detail

        # Group pool into batches of batch_size
        batches = [active_pool[i : i + batch_size] for i in range(0, len(active_pool), batch_size)]

        for batch_idx, batch_models in enumerate(batches):
            if not remaining_fields:
                logger.info(f"[PROFILER] All fields resolved before batch {batch_idx + 1}. Halting.")
                break

            elapsed = time.monotonic() - start_time
            if elapsed >= time_cap_seconds:
                logger.warning(
                    f"[PROFILER] Time cap of {time_cap_seconds}s reached ({elapsed:.1f}s elapsed). "
                    f"Halting iterative search at batch {batch_idx + 1}."
                )
                break

            remaining_budget = max(5.0, time_cap_seconds - elapsed)
            batch_timeout = min(25.0, remaining_budget)

            logger.info(
                f"[PROFILER] Firing Batch {batch_idx + 1}/{len(batches)} "
                f"({len(batch_models)} models) for unresolved fields: {remaining_fields} "
                f"[timeout={batch_timeout:.1f}s, elapsed={elapsed:.1f}s]"
            )

            tasks = []
            model_labels = []
            for m in batch_models:
                p = m["provider"]
                name = m["model"]
                label = f"{p}:{name}"
                model_labels.append(label)
                if p == "openrouter":
                    tasks.append(self.call_openrouter(name, remaining_fields, context_block, timeout=batch_timeout))
                elif p == "huggingface":
                    tasks.append(self.call_huggingface(name, remaining_fields, context_block, timeout=batch_timeout))

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            successful_responses: Dict[str, Dict[str, str]] = {}
            for lbl, res in zip(model_labels, batch_results):
                if isinstance(res, dict) and not isinstance(res, Exception):
                    successful_responses[lbl] = res
                elif isinstance(res, Exception):
                    logger.warning(f"[PROFILER] Batch {batch_idx + 1} model {lbl} raised: {res}")

            # Compute consensus for current batch
            batch_consensus, batch_audit = self.compute_majority_consensus(
                successful_responses, remaining_fields
            )

            resolved_in_batch = []
            for f in list(remaining_fields):
                c_res = batch_consensus.get(f, {})
                if c_res.get("source") == "ai_consensus" and c_res.get("path"):
                    final_consensus[f] = c_res
                    resolved_in_batch.append(f)
                    remaining_fields.remove(f)

            batch_logs.append({
                "batch_index": batch_idx + 1,
                "models_queried": model_labels,
                "successful_count": len(successful_responses),
                "unresolved_fields_in": list(remaining_fields + resolved_in_batch),
                "responses": successful_responses,
                "consensus_results": batch_consensus,
                "fields_resolved_in_batch": resolved_in_batch,
                "remaining_unresolved": list(remaining_fields),
                "elapsed_seconds": round(time.monotonic() - start_time, 2),
            })

            logger.info(
                f"[PROFILER] Batch {batch_idx + 1} complete: {len(resolved_in_batch)} fields resolved "
                f"({resolved_in_batch}), {len(remaining_fields)} remaining."
            )

        # Mark any fields still unresolved as unresolved_no_consensus
        for f in remaining_fields:
            final_consensus[f] = {
                "path": None,
                "source": "unresolved_no_consensus",
                "models_agreed": [],
            }

        total_elapsed = round(time.monotonic() - start_time, 2)
        audit_detail = {
            "timestamp": datetime.utcnow().isoformat(),
            "total_batches_attempted": len(batch_logs),
            "total_models_pool_size": len(active_pool),
            "total_elapsed_seconds": total_elapsed,
            "batch_history": batch_logs,
            "final_consensus": final_consensus,
        }

        return final_consensus, audit_detail

    async def verify_oem_soh_iterative(
        self,
        cand: Dict[str, Any],
        raw_deep_scan_text: str,
        model_pool: Optional[List[Dict[str, str]]] = None,
        time_cap_seconds: float = 180.0,
        batch_size: int = 3,
    ) -> Tuple[Optional[float], Dict[str, Any]]:
        """
        Iteratively verifies an OEM SoH candidate across batches of 3 models until
        2-of-3 consensus (with verbatim line verification) is reached or pool/time cap is exhausted.
        """
        start_time = time.monotonic()
        active_pool = get_active_model_pool(model_pool)
        batch_logs: List[Dict[str, Any]] = []

        if not active_pool:
            return None, {
                "total_batches_attempted": 0,
                "decision": "unresolved_no_consensus",
                "accepted_soh": None,
                "batch_history": [],
            }

        verification_prompt = (
            f"You are verifying an Android OEM hardware battery register from a device diagnostic dump.\n"
            f"A local heuristic flagged candidate field: '{cand['field']}' (path: '{cand['path']}') with value '{cand['soh_pct']}'.\n\n"
            f"Device Diagnostic Dump:\n\"\"\"\n{raw_deep_scan_text[:3000]}\n\"\"\"\n\n"
            f"TASK:\n"
            f"Determine if this field represents a manufacturer-reported battery health percentage (0-100%).\n"
            f"CRITICAL RULES:\n"
            f"1. You MUST quote the EXACT LINE from the dump above that contains this field in 'quoted_line'.\n"
            f"2. If not found or unsure, return is_soh=false and quoted_line='not_found'.\n"
            f"3. Never guess or hallucinate.\n\n"
            f"Respond strictly in JSON:\n"
            f'{{"is_soh": true, "quoted_line": "{cand["raw_line"]}", "soh_pct": {cand["soh_pct"]}}}'
        )

        batches = [active_pool[i : i + batch_size] for i in range(0, len(active_pool), batch_size)]
        chosen_soh: Optional[float] = None
        final_decision = "unresolved_no_consensus"

        for batch_idx, batch_models in enumerate(batches):
            elapsed = time.monotonic() - start_time
            if elapsed >= time_cap_seconds:
                logger.warning(f"[PROFILER] Time cap reached during OEM SoH verification at batch {batch_idx + 1}.")
                break

            remaining_budget = max(5.0, time_cap_seconds - elapsed)
            batch_timeout = min(25.0, remaining_budget)

            tasks = []
            model_labels = []
            for m in batch_models:
                p = m["provider"]
                name = m["model"]
                label = f"{p}:{name}"
                model_labels.append(label)
                if p == "openrouter":
                    tasks.append(self.call_openrouter_oem_soh(name, verification_prompt, timeout=batch_timeout))
                elif p == "huggingface":
                    tasks.append(self.call_hf_oem_soh(name, verification_prompt, timeout=batch_timeout))

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            model_soh_responses: Dict[str, Any] = {}
            for lbl, res in zip(model_labels, batch_results):
                if isinstance(res, dict) and not isinstance(res, Exception):
                    model_soh_responses[lbl] = res

            batch_soh, batch_audit = self.compute_oem_soh_consensus(
                cand["soh_pct"], raw_deep_scan_text, model_soh_responses
            )

            batch_logs.append({
                "batch_index": batch_idx + 1,
                "models_queried": model_labels,
                "responses": model_soh_responses,
                "batch_decision": batch_audit.get("decision"),
                "accepted_soh": batch_soh,
                "elapsed_seconds": round(time.monotonic() - start_time, 2),
            })

            if batch_soh is not None:
                chosen_soh = batch_soh
                final_decision = "ai_consensus"
                logger.info(f"[PROFILER] OEM SoH verified by consensus in Batch {batch_idx + 1}: {chosen_soh}%")
                break

        audit = {
            "total_batches_attempted": len(batch_logs),
            "total_elapsed_seconds": round(time.monotonic() - start_time, 2),
            "decision": final_decision,
            "accepted_soh": chosen_soh,
            "batch_history": batch_logs,
        }
        return chosen_soh, audit

    async def profile_device(
        self,
        serial: str,
        force_ai: bool = False,
        model_pool: Optional[List[Dict[str, str]]] = None,
        time_cap_seconds: float = 180.0,
    ) -> Dict[str, Any]:
        """
        Complete profiling pipeline:
        1. Local sysfs/dumpsys probe first + deep scan excavation (always authoritative).
        2. Identify unresolved fields.
        3. Check cache; if all fields known or cached, return.
        4. If unresolved fields exist, run iterative batch fallback across model pool.
        5. Run majority-vote consensus per batch until resolved or pool exhausted.
        6. Detect OEM SoH heuristic candidates and verify with iterative AI consensus.
        7. Merge local authority + AI consensus.
        8. Save to SQLite device_profiles with raw_deep_scan and oem_reported_soh.
        9. Log summary table.
        """
        # Step 1: Run local probe first (always authoritative)
        fields_status, probe_data = self.evaluate_local_fields(serial)
        deep_scan_raw = self.adb.deep_scan(serial) if hasattr(self.adb, "deep_scan") else {}
        deep_scan_data = deep_scan_raw if isinstance(deep_scan_raw, dict) else {}
        raw_text = deep_scan_data.get("raw_dump_text")
        raw_deep_scan_text = raw_text if isinstance(raw_text, str) else ""

        device_info = probe_data.get("device_info", {})
        model_name = device_info.get("model") or "Android Device"
        if device_info.get("manufacturer") and device_info["manufacturer"] != "Unknown":
            model_name = f"{device_info['manufacturer']} {model_name}"

        # Check existing cached profile in SQLite
        cached_profile = db.get_device_profile(serial)
        unresolved_fields = [
            f for f in CORE_BATTERY_FIELDS
            if fields_status[f]["status"] == "unresolved"
        ]

        cached_oem_soh = cached_profile.get("oem_reported_soh") if cached_profile else None

        # If existing profile already resolved some fields locally or via prior consensus, merge them
        if cached_profile and not force_ai:
            cached_fields = cached_profile.get("fields", {})
            for f in list(unresolved_fields):
                c_field = cached_fields.get(f, {})
                c_src = c_field.get("source")
                c_path = c_field.get("path")
                if c_path and c_src in ["local", "ai_consensus"]:
                    fields_status[f] = {
                        "status": f"cached_{c_src}",
                        "path": c_path,
                        "value": None,
                        "source": c_src,
                    }
                    unresolved_fields.remove(f)

        logger.info(
            f"[PROFILER] Device {serial} ({model_name}): "
            f"{len(CORE_BATTERY_FIELDS) - len(unresolved_fields)} resolved locally/cached, "
            f"{len(unresolved_fields)} unresolved: {unresolved_fields}"
        )
        emit_status(
            serial,
            "probe",
            f"Device parameter profile: {len(CORE_BATTERY_FIELDS) - len(unresolved_fields)}/{len(CORE_BATTERY_FIELDS)} fields resolved locally/cached",
            {"resolved": [f for f in CORE_BATTERY_FIELDS if f not in unresolved_fields], "unresolved": unresolved_fields},
        )

        consensus_results: Dict[str, Dict[str, Any]] = {}
        consensus_detail: Optional[Dict[str, Any]] = None

        # Step 2: If unresolved fields exist, run iterative batch fallback
        active_pool = get_active_model_pool(model_pool)
        if unresolved_fields and active_pool:
            context_block = self.build_raw_context_block(serial, probe_data)
            logger.info(
                f"[PROFILER] Running iterative fallback for unresolved fields: {unresolved_fields} "
                f"across pool of {len(active_pool)} models (time cap: {time_cap_seconds}s)..."
            )
            emit_status(
                serial,
                "consensus",
                f"Starting AI consensus for {len(unresolved_fields)} unresolved fields ({', '.join(unresolved_fields)}) across {len(active_pool)} models",
                {"unresolved_fields": unresolved_fields, "model_count": len(active_pool)},
            )
            consensus_results, consensus_detail = await self.query_ai_consensus_iterative(
                unresolved_fields=unresolved_fields,
                context_block=context_block,
                model_pool=model_pool,
                time_cap_seconds=time_cap_seconds,
            )
        elif unresolved_fields:
            logger.info("[PROFILER] Unresolved fields exist, but no AI API keys are configured. Proceeding without AI fallback.")
            for f in unresolved_fields:
                consensus_results[f] = {
                    "path": None,
                    "source": "unresolved_no_consensus",
                    "models_agreed": [],
                }

        # Step 3: Merge final profile (Rule 5: Local always wins and blocks AI!)
        final_fields: Dict[str, Dict[str, Any]] = {}
        for f in CORE_BATTERY_FIELDS:
            loc = fields_status[f]
            if loc["status"] == "resolved_local":
                final_fields[f] = {
                    "path": loc["path"],
                    "source": "local",
                    "value": loc.get("value"),
                    "models_agreed": [],
                }
            elif loc.get("source") in ["local", "ai_consensus"] and loc.get("path"):
                final_fields[f] = {
                    "path": loc["path"],
                    "source": loc["source"],
                    "value": None,
                    "models_agreed": [],
                }
            else:
                ai_res = consensus_results.get(f, {})
                final_fields[f] = {
                    "path": ai_res.get("path"),
                    "source": ai_res.get("source", "unresolved_no_consensus"),
                    "value": None,
                    "models_agreed": ai_res.get("models_agreed", []),
                }

        for f in unresolved_fields:
            ai_res = consensus_results.get(f, {})
            src = ai_res.get("source", "unresolved_no_consensus")
            if src == "ai_consensus":
                models_str = " + ".join(ai_res.get("models_agreed", []))
                emit_status(
                    serial,
                    "consensus",
                    f"AI consensus confirmed '{f}' via {models_str} -> {ai_res.get('path')}",
                    {"field": f, "path": ai_res.get("path"), "models": ai_res.get("models_agreed", [])},
                    level="success",
                )
            else:
                emit_status(
                    serial,
                    "consensus",
                    f"AI consensus: '{f}' remains unresolved (no agreement)",
                    {"field": f, "source": src},
                    level="info",
                )

        # Step 4: OEM-Reported SoH Detection & Iterative AI Verification
        oem_soh_val = cached_oem_soh
        oem_soh_audit = None

        if oem_soh_val is None or force_ai:
            candidates = self.detect_oem_soh_candidates(deep_scan_data)
            if candidates:
                cand = candidates[0]
                if active_pool:
                    logger.info(
                        f"[PROFILER] OEM SoH candidate detected: {cand['field']}={cand['soh_pct']}%. "
                        f"Verifying iteratively via AI consensus..."
                    )
                    chosen_soh, oem_soh_audit = await self.verify_oem_soh_iterative(
                        cand=cand,
                        raw_deep_scan_text=raw_deep_scan_text,
                        model_pool=model_pool,
                        time_cap_seconds=time_cap_seconds,
                    )
                    oem_soh_val = chosen_soh
                else:
                    logger.info("[PROFILER] OEM SoH candidate found, but no AI keys configured. Keeping null until consensus verified.")
                    oem_soh_val = None

        if oem_soh_val is not None:
            emit_status(
                serial,
                "consensus",
                f"OEM-reported battery health verified by AI consensus: {oem_soh_val}%",
                {"soh_pct": oem_soh_val},
                level="success",
            )

        if consensus_detail is None:
            consensus_detail = {}
        if oem_soh_audit:
            consensus_detail["oem_soh_verification"] = oem_soh_audit

        profile_record = {
            "device_serial": serial,
            "device_model": model_name,
            "manufacturer": device_info.get("manufacturer", "Unknown"),
            "android_version": device_info.get("android_version", "Unknown"),
            "fields": final_fields,
            "raw_deep_scan": raw_deep_scan_text,
            "oem_reported_soh": oem_soh_val,
            "consensus_detail": consensus_detail,
        }

        # Save to SQLite
        saved = db.save_or_update_device_profile(profile_record)

        # Step 5: Log summary table (Rule 6)
        self.print_summary_table(serial, model_name, final_fields, oem_soh_val)
        return saved

    def print_summary_table(
        self,
        serial: str,
        model_name: str,
        fields: Dict[str, Dict[str, Any]],
        oem_soh: Optional[float] = None,
    ) -> None:
        """Rule 6: Prints clear summary table of discovered parameters."""
        header = f"DEVICE PARAMETER PROFILE: {model_name} (Serial: {serial})"
        print("\n" + "=" * 90)
        print(f" {header.center(88)} ")
        print("=" * 90)
        print(f"{'Field Name':<22} | {'Source':<24} | {'Value or Discovered Path':<40} | {'Models Agreed'}")
        print("-" * 90)

        for field_name in CORE_BATTERY_FIELDS:
            info = fields.get(field_name, {})
            source = info.get("source", "unresolved")
            path = info.get("path") or "—"
            agreed = ", ".join(info.get("models_agreed", [])) if info.get("models_agreed") else "—"

            if len(path) > 38:
                display_path = "..." + path[-35:]
            else:
                display_path = path

            print(f"{field_name:<22} | {source:<24} | {display_path:<40} | {agreed}")

        if oem_soh is not None:
            print(f"{'oem_reported_soh':<22} | {'ai_consensus':<24} | {str(oem_soh) + '%':<40} | Verified")

        print("=" * 90 + "\n")


async def warmup_hf_model() -> None:
    """
    Rule 3: Cold-start warm-up ping at app startup.
    Fires a lightweight request to the HF model in the background so cold-start cost
    is paid before any real device needs profiling.
    """
    if not HF_API_KEY:
        logger.debug("[HF WARM-UP] HF_API_KEY not configured. Skipping startup warm-up ping.")
        return

    target_model = HF_MODEL
    if target_model in ["meta-llama/Meta-Llama-3-8B-Instruct", "meta-llama/Meta-Llama-3-8B"]:
        target_model = "meta-llama/Llama-3.1-8B-Instruct"

    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": target_model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5,
    }

    logger.info(f"[HF WARM-UP] Sending background warm-up ping to '{target_model}'...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code == 200:
                logger.info(f"[HF WARM-UP] Hugging Face model '{target_model}' is warm and ready.")
            elif res.status_code == 503:
                logger.info(f"[HF WARM-UP] Hugging Face model '{target_model}' is waking up (status 503).")
            else:
                logger.debug(f"[HF WARM-UP] Model ping returned status {res.status_code}.")
    except Exception as e:
        logger.debug(f"[HF WARM-UP] Background ping note: {e}")


# Singleton instance
profiler = DeviceProfiler()
