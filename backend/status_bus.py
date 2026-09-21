"""
Live Device Status Event Bus
Thread-safe in-memory event bus providing real-time backend activity feeds for the Ion+ dashboard.
"""

from __future__ import annotations
from collections import deque
from datetime import datetime
import threading
from typing import Any, Dict, List, Optional


class StatusBus:
    """Thread-safe event bus holding recent real-time device lifecycle events."""

    def __init__(self, max_events: int = 100):
        self._max_events = max_events
        self._events: deque = deque(maxlen=max_events)
        self._lock = threading.RLock()
        self._counter = 0

    def emit(
        self,
        device_serial: Optional[str],
        category: str,
        message: str,
        detail: Optional[Dict[str, Any]] = None,
        level: str = "info",
    ) -> Dict[str, Any]:
        """
        Emits a status event to the bus.

        :param device_serial: Serial of the device the event pertains to.
        :param category: One of 'connection', 'probe', 'consensus', 'health', 'calibration'.
        :param message: Human-readable description built directly from real runtime values.
        :param detail: Optional dictionary containing structured runtime metrics.
        :param level: 'info', 'success', or 'warning'.
        """
        now = datetime.now()
        with self._lock:
            self._counter += 1
            event = {
                "id": self._counter,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "time_display": now.strftime("%H:%M:%S"),
                "device_serial": device_serial,
                "category": category,
                "message": message,
                "detail": detail or {},
                "level": level,
            }
            self._events.append(event)
            return event

    def get_recent(
        self,
        limit: int = 20,
        device_serial: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Returns recent events ordered newest first.
        """
        with self._lock:
            events = list(self._events)

        if device_serial:
            events = [e for e in events if e.get("device_serial") == device_serial]

        # Return reversed (newest first) up to limit
        return list(reversed(events))[:limit]

    def clear(self) -> None:
        """Clears all stored events."""
        with self._lock:
            self._events.clear()
            self._counter = 0


# Global singleton instance
status_bus = StatusBus(max_events=100)


def emit_status(
    device_serial: Optional[str],
    category: str,
    message: str,
    detail: Optional[Dict[str, Any]] = None,
    level: str = "info",
) -> Dict[str, Any]:
    """Convenience helper to emit an event to the global status bus."""
    return status_bus.emit(
        device_serial=device_serial,
        category=category,
        message=message,
        detail=detail,
        level=level,
    )


def get_recent_status(
    limit: int = 20,
    device_serial: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Convenience helper to read recent events from the global status bus."""
    return status_bus.get_recent(limit=limit, device_serial=device_serial)
