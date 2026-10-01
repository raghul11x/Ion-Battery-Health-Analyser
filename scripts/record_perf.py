"""
Automated Performance Baseline & Verification Harness for Ion+
Runs 10-second continuous scroll benchmarks across all 4 views (Idle & Connected)
"""

import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import time
import json
import threading
import urllib.request
import uvicorn
import webview

from backend.main import app

PORT = 8769
HOST = "127.0.0.1"
BASE_URL = f"http://{HOST}:{PORT}"

def run_server():
    config = uvicorn.Config(
        app=app,
        host=HOST,
        port=PORT,
        log_level="error",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server.run()

def is_server_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/api/status", timeout=0.5) as response:
            return response.status == 200
    except Exception:
        return False

def format_markdown_table(report, filename):
    lines = []
    lines.append("# Ion+ Performance Report: Baseline")
    lines.append("")
    lines.append(f"- **Recorded At:** {report.get('timestamp')}")
    lines.append(f"- **Display Detected Hz:** {report.get('hz')} Hz")
    lines.append(f"- **Target Frame Interval:** {report.get('frameMs')} ms")
    lines.append(f"- **Frame Budget:** {report.get('budgetMs')} ms")
    lines.append(f"- **GPU Hardware Acceleration:** {report.get('gpu')}")
    lines.append("")
    lines.append("## 10-Second Continuous Scroll Matrix")
    lines.append("")
    lines.append("| View | State | Avg FPS | Target Hz | Worst Frame (ms) | Hitch Frames (>1.5x) | Frames in 1.2x % | Long Tasks (>50ms) |")
    lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

    for t in report.get("tests", []):
        view_name = t["view"].replace("view-", "").capitalize()
        state_name = t["state"].capitalize()
        fps = t["avgFps"]
        hz = t["hz"]
        worst = t["worstFrameMs"]
        hitches = t["hitchCount"]
        p12 = t["framesWithin1_2xPct"]
        long_tasks = f"{t['longTasksDetected']} (max {t['worstLongTaskMs']}ms)"
        lines.append(f"| **{view_name}** | {state_name} | {fps} FPS | {hz} Hz | {worst} ms | {hitches} | {p12}% | {long_tasks} |")

    lines.append("")
    lines.append("## Observations & Known Scroll Bottlenecks")
    lines.append("1. **Backdrop Filter Cascades**: Active blur filters on every card and inner pills compounding fill rate.")
    lines.append("2. **SVG Fluted Glass Shader**: Live `feDisplacementMap` calculating during scroll passes.")
    lines.append("3. **Non-Composited Animated Transitions**: Left and width transitions triggering layout passes.")
    lines.append("4. **Off-Screen Work**: Full DOM rendering of uncontained cards below the fold.")
    lines.append("5. **History Table**: Non-virtualized rows leading to increased layout/paint cost when seeded.")
    lines.append("")

    content = "\n".join(lines)
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[PERF HARNESS] Written baseline report to {filename}")

def main():
    target_file = sys.argv[1] if len(sys.argv) > 1 else "docs/perf-baseline.md"
    print(f"[PERF HARNESS] Starting server on {BASE_URL}...")
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    for _ in range(30):
        if is_server_ready():
            break
        time.sleep(0.2)
    else:
        print("[ERROR] FastAPI server failed to start.")
        sys.exit(1)

    print("[PERF HARNESS] Server is up. Initializing PyWebview window...")
    window = webview.create_window(
        title="Ion+ Perf Benchmark Harness",
        url=BASE_URL,
        width=1280,
        height=860,
        background_color="#0B0B10",
    )

    def on_loaded():
        def run_benchmarks():
            time.sleep(2.5) # allow charts and initial layout to settle
            print("[PERF HARNESS] Initiating window.IonPerf.runFullSuite()...")
            window.evaluate_js("""
                window.IonPerf.runFullSuite(function(report) {
                    window.__suiteDone = report;
                });
            """)

            # Poll for completion
            while True:
                time.sleep(2.0)
                done = window.evaluate_js("window.__suiteDone || null")
                if done:
                    print("[PERF HARNESS] Benchmark suite complete! Formatting report...")
                    format_markdown_table(done, target_file)
                    break

            time.sleep(1.0)
            window.destroy()

        threading.Thread(target=run_benchmarks, daemon=True).start()

    window.events.loaded += on_loaded
    webview.start(gui="edgechromium", debug=False)
    print("[PERF HARNESS] Finished benchmark execution.")

if __name__ == "__main__":
    main()
