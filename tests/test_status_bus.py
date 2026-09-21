"""
Tests for Live Device Status Event Bus and /api/device-status endpoint.
"""

import threading
import pytest
from fastapi.testclient import TestClient
from backend.status_bus import StatusBus, status_bus, emit_status, get_recent_status
from backend.main import app

client = TestClient(app)


def test_status_bus_emit_and_order():
    bus = StatusBus(max_events=10)
    bus.clear()

    e1 = bus.emit("dev1", "connection", "Connected to Phone", {"model": "Phone"}, level="info")
    e2 = bus.emit("dev1", "probe", "Hardware probe: 4/5 fields resolved", level="info")
    e3 = bus.emit("dev2", "health", "Health calculated: 94.2%", level="success")

    assert e1["id"] == 1
    assert e2["id"] == 2
    assert e3["id"] == 3

    recent = bus.get_recent(limit=10)
    assert len(recent) == 3
    # Newest first
    assert recent[0]["id"] == 3
    assert recent[0]["category"] == "health"
    assert recent[1]["id"] == 2
    assert recent[2]["id"] == 1


def test_status_bus_filter_by_serial():
    bus = StatusBus(max_events=10)
    bus.clear()

    bus.emit("dev-A", "connection", "Dev A connected")
    bus.emit("dev-B", "connection", "Dev B connected")
    bus.emit("dev-A", "health", "Dev A health: 91%")

    dev_a_events = bus.get_recent(limit=10, device_serial="dev-A")
    assert len(dev_a_events) == 2
    assert all(e["device_serial"] == "dev-A" for e in dev_a_events)
    assert dev_a_events[0]["message"] == "Dev A health: 91%"


def test_status_bus_max_limit_and_overflow():
    bus = StatusBus(max_events=5)
    for i in range(10):
        bus.emit("dev", "probe", f"Event #{i}")

    recent = bus.get_recent(limit=10)
    assert len(recent) == 5
    # Should only have events 5, 6, 7, 8, 9 (newest first: 9..5)
    assert recent[0]["message"] == "Event #9"
    assert recent[-1]["message"] == "Event #5"


def test_status_bus_thread_safety():
    bus = StatusBus(max_events=1000)
    bus.clear()

    def worker(worker_id: int):
        for i in range(50):
            bus.emit(f"dev-{worker_id}", "probe", f"Thread {worker_id} msg {i}")

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    recent = bus.get_recent(limit=500)
    assert len(recent) == 250
    ids = [e["id"] for e in recent]
    # All IDs should be strictly descending and unique
    assert ids == sorted(ids, reverse=True)
    assert len(set(ids)) == 250


def test_api_device_status_endpoint():
    # Emit test events to global bus
    status_bus.clear()
    emit_status("test-serial-1", "connection", "Device connected (test-serial-1)", {"model": "Test Model"})
    emit_status("test-serial-1", "probe", "Hardware probe: 5 resolved metrics", level="info")
    emit_status("test-serial-2", "consensus", "AI consensus completed", level="info")

    res = client.get("/api/device-status?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["count"] == 3
    assert len(data["events"]) == 3
    assert data["events"][0]["category"] == "consensus"

    # Test limit param
    res_limit = client.get("/api/device-status?limit=1")
    assert res_limit.status_code == 200
    assert res_limit.json()["count"] == 1

    # Test serial filtering param
    res_serial = client.get("/api/device-status?serial=test-serial-1")
    assert res_serial.status_code == 200
    events_s1 = res_serial.json()["events"]
    assert len(events_s1) == 2
    assert all(e["device_serial"] == "test-serial-1" for e in events_s1)
