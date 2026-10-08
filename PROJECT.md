# Project

## 1. Project Overview
- **Project Name:** Ion+ (also referenced as Ion Battery Health Analyser / Phone Battery Analyzer)
- **Purpose:** Ion+ is a local, privacy-first desktop diagnostics application designed for Android devices connected via USB-C. It overcomes OEM telemetry obfuscation (such as the generic *"Battery health: Good"* placeholder or missing kernel cycle counters) by communicating directly with the Android Debug Bridge (ADB) to extract physical gas-gauge counters, evaluate electrochemical State of Health (SoH) according to IEC 61960 standards, perform real-time Coulomb Counting verification, attribute per-app battery drain, and forecast cell replacement timelines.
- **Current State:** Fully functional, production-ready local desktop binary (`dist/Ion+.exe`) and development application with complete offline capability, zero external telemetry requirements, an interactive liquid-glass EURA aesthetic UI, and a suite of 129 passing automated tests.
- **High-Level Description:** The application operates as a standalone desktop utility combining a Python backend (FastAPI, SQLAlchemy, APScheduler) bundled with a native desktop window (PyWebview using Microsoft Edge WebView2). It polls connected Android hardware every 1.5 seconds via ADB, persists battery telemetry to a local SQLite database in WAL mode, executes electrochemical degradation formulas, and renders a 60 FPS, hardware-accelerated dashboard featuring real-time health gauges, historical charts, diagnostic logs, and wear habit insights.

---

## 2. Technology Stack
- **Frontend:**
  - Vanilla ES6+ JavaScript (no heavy frontend framework; zero build-step bundle)
  - Custom Web Components (`IonPreloader` with encapsulated Shadow DOM)
  - CSS3 with GPU-composited transitions, custom SVG displacement filter shaders (`#aurora-fluted`), and Tailwind CSS utility classes
  - Chart.js v4.4.1 (bundled locally at `frontend/static/js/chart.min.js` for 100% offline usage)
  - Geist Variable Font (bundled locally at `frontend/static/fonts/Geist-Variable.woff2`)
- **Backend:**
  - Python 3.10 / 3.11
  - FastAPI (REST API framework)
  - Uvicorn (ASGI web server)
  - APScheduler (background device polling watcher)
  - pure-python-adb & native system `adb.exe` bridge
  - HTTPX (asynchronous HTTP client for AI parameter discovery)
  - python-dotenv (environment variable loader)
- **Desktop Runtime & Shell:**
  - PyWebview v5.0+ (native Windows Edge Chromium WebView2 embedding)
  - Tkinter & Pillow (PIL) for the pre-launch startup splash screen (`splash.py`)
  - PyInstaller v6.22+ (single-file executable packaging)
- **Database:**
  - SQLite 3 with Write-Ahead Logging (WAL) enabled
  - SQLAlchemy v2.0+ (Object Relational Mapping)
- **Build Tools & Scripts:**
  - PyInstaller (`phone_battery_analyzer.spec`)
  - Batch scripts (`build_exe.bat`, `run.bat`, `run_debug.bat`, `create_shortcuts.bat`)
  - Pytest v8.0+ for automated test execution
- **Third-Party Services (Optional Fallback Only):**
  - OpenRouter API (NVIDIA Nemotron models for parameter discovery fallback)
  - Hugging Face Inference API (DeepSeek & Qwen models for secondary parameter discovery fallback)
  - *Note:* All third-party services are optional and only invoked during the automated deep parameter discovery process when local ADB heuristics cannot locate manufacturer-obscured sysfs nodes.

---

## 3. Project Structure

```
Battery analyser/
├── Artifacts/                      # Architectural designs, benchmarks, and research specs
│   ├── DESIGN_DOC.md               # Complete system design documentation
│   ├── FRONTEND_DESIGN_DOC.md      # Frontend visual and animation design specifications
│   ├── ai-parameter-lookup.md      # Dual-tier AI discovery specification
│   ├── toggle-button.md            # Glass toggle CSS reference implementation
│   ├── perf-baseline.md            # Initial performance baseline metrics
│   └── perf-after.md               # Post-optimization 60 FPS verification report
├── backend/                        # Python application logic & services
│   ├── __init__.py                 # Backend package initializer
│   ├── adb_client.py               # Hardware ADB client, sysfs scanner & dumpsys parser
│   ├── api_routes.py               # FastAPI REST endpoint definitions
│   ├── app_battery_stats.py        # Framework batterystats parser & per-app drain attribution
│   ├── calibration.py              # Active Coulomb counting current integration engine
│   ├── db.py                       # SQLAlchemy models, SQLite configuration & queries
│   ├── device_profiler.py          # Sysfs register discovery & dual-provider AI consensus
│   ├── health.py                   # Electrochemical health math & unit normalization
│   ├── main.py                     # FastAPI application factory, middleware & route mounting
│   ├── prediction.py               # Lifespan forecasting & 80% charge cap simulation
│   ├── status_bus.py               # Thread-safe in-memory status event queue
│   └── watcher.py                  # APScheduler background hardware polling watcher
├── docs/                           # Documentation assets and JSON perf metrics
│   └── perf-after.json             # Post-optimization performance telemetry output
├── frontend/                       # Static UI assets and templates
│   ├── history.html                # Dedicated historical reading log view
│   ├── index.html                  # Primary EURA obsidian dashboard template
│   ├── ion-preloader.js            # Standalone root preloader script
│   └── static/                     # Assets served via /static mount
│       ├── assets/                 # Favicons, logos, brand mark SVGs
│       ├── css/                    # Stylesheets
│       │   ├── style.css           # Primary application styling, aurora loop, EURA cards
│       │   └── toggle.css          # Liquid-glass sparkle toggle component styles
│       ├── fonts/                  # Bundled typography
│       │   ├── Geist-Variable.woff2# Offline Geist variable font
│       │   └── LICENSE.txt         # Font license
│       └── js/                     # Client scripts
│           ├── app.js              # Primary dashboard state coordinator & poller
│           ├── chart.min.js        # Offline Chart.js library
│           ├── ion-preloader.js    # Shadow-DOM isolated atom preloader component
│           ├── perf.js             # Performance diagnostics HUD & adaptive quality tier
│           └── toggle.js           # Reusable sparkle toggle generator
├── reference/                      # UI design references
│   └── RadialGlowButton.tsx        # Reference implementation for radial button shine
├── scripts/                        # Utility & automation scripts
│   └── record_perf.py              # Automated 10-second continuous scroll test harness
├── tests/                          # Automated Pytest test suite
│   ├── test_ai_cascade.py          # AI fallback cascade & consensus unit tests
│   ├── test_api.py                 # FastAPI REST endpoint integration tests
│   ├── test_app_battery_stats.py   # Batterystats parsing tests
│   ├── test_aurora_loop.py         # 60s continuous aurora background loop invariants
│   ├── test_calibration.py         # Coulomb integration calculation tests
│   ├── test_codebase_quality.py    # Zero-regression quality tests
│   ├── test_db.py                  # Database CRUD and anomaly fixer tests
│   ├── test_deep_scan.py           # Deep sysfs excavation tests
│   ├── test_device_profiler.py     # Parameter discovery tests
│   ├── test_health.py              # Electrochemical health equation tests
│   ├── test_hero_dial.py           # Zero-hallucination dial tests
│   ├── test_ion_preloader.py       # Isolated preloader lifecycle tests
│   ├── test_iterative_profiler.py  # Iterative profiler tests
│   ├── test_parser.py              # Dumpsys battery output parsing tests
│   ├── test_prd_metrics.py         # IEC standard metric tests
│   ├── test_prediction.py          # Battery lifespan prediction tests
│   ├── test_sparkle_toggles.py     # Toggle interactivity tests
│   ├── test_status_bus.py          # Status event queue tests
│   ├── test_toggle_styles.py       # CSS toggle specification invariant tests
│   └── test_virtual_phones.py      # Multi-OEM virtual device tests
├── build_exe.bat                   # Batch script to compile dist\Ion+.exe
├── create_shortcuts.bat            # Desktop and Start Menu shortcut generator
├── desktop.py                      # Desktop app launcher (Uvicorn daemon + PyWebview)
├── phone_battery_analyzer.spec     # PyInstaller build specification
├── pytest.ini                      # Pytest configuration
├── requirements.txt                # Python package dependencies
├── run.bat                         # Native launch script with auto-venv setup
├── run_debug.bat                   # Verbose console launch script
└── splash.py                       # Native Tkinter frameless splash screen
```

---

## 4. Architecture

### 4.1 System Topology & Responsibilities
Ion+ follows a local-first client-server desktop architecture running entirely on the user's Windows machine.

```
+-----------------------------------------------------------------------------------+
|                              Windows Host Machine                                 |
|                                                                                   |
|  [Tkinter Splash Screen] (splash.py)                                              |
|          | (Progress steps during boot)                                           |
|          v                                                                        |
|  [PyWebview Edge Chromium Window] (desktop.py)                                    |
|          |                                                                        |
|          v                                                                        |
|  [Frontend Single-Page App] (frontend/index.html + app.js)                        |
|          |                                                                        |
|          | HTTP REST Calls (127.0.0.1:8765/api/*)                                 |
|          v                                                                        |
|  [FastAPI Backend Engine] (backend/main.py)                                       |
|          |                                                                        |
|          +---> [API Routers] (backend/api_routes.py)                              |
|          |         |                                                              |
|          |         +---> [Health Engine] (backend/health.py)                      |
|          |         +---> [Prediction Engine] (backend/prediction.py)              |
|          |         +---> [Calibration Manager] (backend/calibration.py)           |
|          |         +---> [App Drain Attributor] (backend/app_battery_stats.py)    |
|          |         +---> [Status Event Bus] (backend/status_bus.py)               |
|          |                                                                        |
|          +---> [Background Watcher] (backend/watcher.py, APScheduler 1.5s)        |
|          |         |                                                              |
|          |         v                                                              |
|          +---> [Hardware Bridge] (backend/adb_client.py)                          |
|          |         |                                                              |
|          |         +---> Host adb.exe (Port 5037)                                 |
|          |                   |                                                    |
|          |                   | USB-C (ADB Protocol)                               |
|          |                   v                                                    |
|          |         [Connected Android Phone]                                      |
|          |           • dumpsys battery                                            |
|          |           • /sys/class/power_supply/*                                  |
|          |           • dumpsys batterystats                                       |
|          |                                                                        |
|          +---> [Local Persistence] (backend/db.py -> battery_data.db [WAL])       |
|          |                                                                        |
|          +---> [AI Fallback Discovery] (backend/device_profiler.py)               |
|                    (Only invoked if sysfs parameters missing)                     |
|                    • OpenRouter API                                               |
|                    • Hugging Face API                                             |
+-----------------------------------------------------------------------------------+
```

### 4.2 Component Communication & Execution Flow
1. **Startup:** `desktop.py` displays `splash.py`, verifies TCP ports (default 8765), starts FastAPI in a daemon background thread, waits for `/api/status` readiness, closes the splash screen, and opens the native PyWebview window.
2. **Preloading:** The frontend mounts `ion-preloader.js` (an isolated Shadow DOM component) which displays an animated atom orbital loader while initial diagnostic data (`/api/snapshot`, `/api/status`, `/api/history`) is fetched.
3. **Hardware Watcher:** `watcher.py` uses APScheduler running every 1.5 seconds to poll `adb devices`. When an authorized device is connected, it retrieves dumpsys battery state, performs periodic sysfs register scans, evaluates health metrics, logs records to SQLite, and pushes notifications to `status_bus.py`.
4. **Data Presentation:** `app.js` polls `/api/snapshot` and `/api/device-status` every 2.5 seconds, updating UI metrics, animating the range dial, redrawing Chart.js curves, and rendering live log events.

---

## 5. Application Features

### 5.1 Implemented Features
- **Direct USB-C ADB Probing:**
  - Automated detection of connected Android hardware without root privileges.
  - Parsing of `dumpsys battery` (status, level, voltage, temperature, technology, AC/USB power).
  - Deep sysfs file hierarchy discovery across `/sys/class/power_supply/*` for vendor fuel gauges (`mtk_gauge`, `google,battery`, `qcom,battery`, `oplus_chg`, `sec-battery`, etc.).
  - *Implementation:* `backend/adb_client.py`.
- **Electrochemical State of Health (SoH) Engine:**
  - Primary Capacity Ratio calculation: `(charge_full / charge_full_design) * 100`.
  - Apple-standard electrochemical aging algorithm incorporating cyclic wear, calendar degradation, and temperature/voltage operational stress factors.
  - Dynamic scale normalization for OEM register unit quirks (µAh, 10 µAh, and mAh).
  - *Implementation:* `backend/health.py`.
- **Predictive Longevity & Replacement Engine:**
  - Projects exact months and charge cycles remaining until the battery degrades past industry (80%) and severe (75%) replacement boundaries.
  - Interactive simulation demonstrating lifespan extension gained by capping charging at 80% State of Charge.
  - *Implementation:* `backend/prediction.py`.
- **Live Coulomb Counting Calibration Wizard:**
  - Active numerical Riemann integration ($Q = \int I \, dt$) during charging sessions to measure actual absorbed capacity in milliamp-hours.
  - Supports live hardware sampling or deterministic 3-minute simulated test runs.
  - *Implementation:* `backend/calibration.py`.
- **Per-App Battery Drain Attribution:**
  - Parses `dumpsys batterystats --checkin` to extract per-UID wakelock times, CPU foreground/background times, radio activity, and estimated mAh consumption.
  - Maps Android UIDs to friendly application names.
  - *Implementation:* `backend/app_battery_stats.py`.
- **AI-Assisted Device Parameter Discovery (Fallback):**
  - Multi-model majority-vote consensus using OpenRouter (Nemotron models) and Hugging Face (DeepSeek/Qwen models) to locate hidden sysfs register paths when automated heuristics fail.
  - Hardware anti-hallucination verification: candidate paths are strictly tested on the physical device via ADB before acceptance.
  - *Implementation:* `backend/device_profiler.py`.
- **EURA Dark Obsidian User Interface:**
  - Fluted glass aesthetic with dynamic background aurora horizontal drift loop.
  - Centerpiece hero card featuring battery health percentage and dynamic tri-state color gradients (Healthy Green, Fair Amber, Poor Crimson).
  - Synchronized horizontal range dial indicator (`range-dial-pin`).
  - Seamless optical-flow tab transitions and GPU-composited navigation pill indicator.
  - *Implementation:* `frontend/index.html`, `frontend/static/css/style.css`, `frontend/static/js/app.js`.
- **Offline Mock / Demo Mode:**
  - Single-click demo data toggle that injects and cleans 30-day realistic historical battery telemetry for preview and testing when no device is connected.
  - *Implementation:* `backend/api_routes.py` (`/api/seed-mock`, `/api/unseed-mock`), `backend/db.py`.

### 5.2 Partially Implemented Features
- **Automated Deep Sysfs Scan Scheduling:** A 15-minute background timer exists in `watcher.py` to trigger deep batterystats pulls, but deep scans currently primarily run during initial device connection and manual probe actions.
- **Hardware Profile Sync to Cloud:** Device profiles are currently stored purely in local SQLite; there is no remote repository or community sharing of discovered sysfs maps.

### 5.3 Planned / TODO Features
- None currently flagged in the source code. The project is functionally complete for local single-machine diagnostic analysis.

---

## 6. Frontend

- **Framework:** Vanilla ES6+ JavaScript, HTML5, CSS3. No Node.js build pipeline or bundling tools required at runtime.
- **Entry Points:**
  - `frontend/index.html`: Primary single-page application dashboard.
  - `frontend/history.html`: Dedicated historical reading log view.
  - `frontend/static/js/ion-preloader.js`: Initial boot preloader component.
- **Pages & Views (Tab Navigation within index.html):**
  1. `#view-dashboard`: Main EURA health hero card, status badges, heart report chart, quick metrics.
  2. `#view-trends`: Capacity retention curve, time filters (7D, 30D, 90D, All), historical reading table, Coulomb calibration panel.
  3. `#view-habits`: Wear habit analytics, thermal stress gauges, per-app battery drain breakdown.
  4. `#view-diagnostics`: Raw `dumpsys battery` outputs, sysfs registers, and system debug info.
- **Reusable Frontend Components:**
  - `IonPreloader` (`frontend/static/js/ion-preloader.js`): Self-contained Custom Web Component utilizing closed Shadow DOM. Handles startup stage progress and transforms into the header logo upon readiness.
  - `createSparkleToggle` (`frontend/static/js/toggle.js`): Reusable liquid-glass toggle generator with micro-sparkles, keyboard accessibility, and ARIA labels.
  - `IonPerf` HUD (`frontend/static/js/perf.js`): Developer diagnostic heads-up display (toggled via `Ctrl+Shift+P`) measuring refresh rate (Hz), frame intervals, hitches, and LongTasks.
- **State Management:**
  - Centralized in-memory `state` object inside `frontend/static/js/app.js` storing active tab, connected device data, snapshot details, chart instances, calibration state, and polling intervals.
- **API Communication:**
  - Native `fetch()` calls communicating with backend endpoints (`/api/snapshot`, `/api/status`, `/api/history`, etc.) using exponential backoff and debounced scheduling (`scheduleRenderPass`).

---

## 7. Backend

- **Framework:** FastAPI (Python) running over `uvicorn`.
- **Entry Point:**
  - Desktop executable launcher: `desktop.py`
  - FastAPI app definition: `backend/main.py`
- **Modules & Services:**
  - `backend/api_routes.py`: Controller routing REST endpoints to services.
  - `backend/adb_client.py`: Hardware abstraction layer interacting with `adb.exe`.
  - `backend/health.py`: Electrochemical State-of-Health business logic.
  - `backend/prediction.py`: Battery degradation and lifespan forecast modeling.
  - `backend/calibration.py`: Numerical Riemann integration for Coulomb counting.
  - `backend/app_battery_stats.py`: Parser for Android framework `batterystats`.
  - `backend/device_profiler.py`: Automated sysfs discovery and AI consensus client.
  - `backend/watcher.py`: Background device polling scheduler.
  - `backend/status_bus.py`: Real-time diagnostic event bus.
  - `backend/db.py`: Database access layer and ORM definitions.
- **Middleware:**
  - `CORSMiddleware`: Configured to permit requests from local loopback origins (`127.0.0.1`, `localhost`, `app://pywebview`).
- **Validation:**
  - Pydantic models (`BaseModel`) for incoming JSON payloads (`SeedRequest`, `LogReadingRequest`).
- **Error Handling:**
  - Standardized `HTTPException` responses with logging via Python's standard `logging` library. Graceful fallback to cached database readings upon ADB disconnection.

---

## 8. Database

- **Technology:** SQLite 3 managed via SQLAlchemy ORM.
- **Storage File:** `battery_data.db` located in the application root (or adjacent to executable when frozen).
- **Configuration:** Write-Ahead Logging (WAL) mode enabled for high-concurrency read/write operations without locking the UI.
- **Schema & Tables:**

### Table: `battery_readings`
Stores time-series battery telemetry snapshots recorded from devices.
- `id` (Integer, Primary Key)
- `timestamp` (DateTime, Indexed)
- `device_serial` (String(64), Indexed)
- `device_model` (String(128))
- `level_pct` (Integer)
- `voltage_mv` (Integer)
- `temperature_c` (Float)
- `charge_counter_uah` (Integer, Nullable)
- `charge_full_uah` (Integer, Nullable)
- `charge_full_design_uah` (Integer, Nullable)
- `cycle_count` (Integer, Nullable)
- `cycle_count_type` (String(32): `'hardware'` | `'estimated'`)
- `health_pct` (Float)
- `effective_capacity_uah` (Integer, Nullable)
- `raw_capacity_ratio` (Float, Nullable)
- `recalibrated` (Integer: 0 or 1)
- `health_method` (String(32): `'capacity_ratio'` | `'trend_estimate'`)
- `status` (String(32))
- `health_flag` (String(32))
- `is_demo` (Integer: 0 for real hardware, 1 for seeded demo data)

### Table: `device_profiles`
Stores verified sysfs register paths and OEM State of Health data per hardware serial.
- `id` (Integer, Primary Key)
- `device_serial` (String(64), Unique, Indexed)
- `device_model` (String(128))
- `manufacturer` (String(64))
- `android_version` (String(32))
- `created_at` (DateTime)
- `updated_at` (DateTime)
- `charge_full_path` / `charge_full_source` (String(256), String(32))
- `charge_full_design_path` / `charge_full_design_source` (String(256), String(32))
- `cycle_count_path` / `cycle_count_source` (String(256), String(32))
- `charge_counter_path` / `charge_counter_source` (String(256), String(32))
- `temperature_path` / `temperature_source` (String(256), String(32))
- `deep_scan_raw` (Text, Nullable)
- `oem_soh_pct` (Float, Nullable)
- `oem_soh_source` (String(64), Nullable)
- `oem_soh_register` (String(256), Nullable)

### Table: `calibration_records`
Stores completed Coulomb counting charge calibration runs.
- `id` (Integer, Primary Key)
- `session_id` (String(32), Unique, Indexed)
- `device_serial` (String(64), Indexed)
- `timestamp` (DateTime)
- `start_level_pct` (Integer)
- `end_level_pct` (Integer)
- `accumulated_mah` (Float)
- `extrapolated_capacity_mah` (Float)
- `calibrated_health_pct` (Float)
- `design_capacity_mah` (Float)
- `is_simulated` (Integer: 0 or 1)

### Table: `app_power_readings`
Stores per-application battery drain attribution metrics.
- `id` (Integer, Primary Key)
- `device_serial` (String(64), Indexed)
- `timestamp` (DateTime, Indexed)
- `package_name` (String(256))
- `wakelock_ms` (Integer)
- `wakelock_count` (Integer)
- `cpu_fg_ms` (Integer)
- `cpu_bg_ms` (Integer)
- `radio_active_ms` (Integer)
- `gps_active_ms` (Integer)
- `estimated_mah` (Float, Nullable)

- **Database Access Layer:** The `Database` class in `backend/db.py` provides session management, automated table creation (`Base.metadata.create_all`), schema upgrades, query helpers, and historical rollups.

---

## 9. Authentication & Authorization

- **Implementation Status:** Not applicable / None.
- **Explanation:** Ion+ is a local, offline single-user desktop diagnostic tool designed to run entirely on the user's personal workstation. It exposes no public web interfaces and requires no user accounts, passwords, JWT tokens, or role-based permissions. The FastAPI backend binds exclusively to localhost (`127.0.0.1`).

---

## 10. API Documentation

All API endpoints are defined in `backend/api_routes.py` with prefix `/api`:

| Method | Endpoint | Purpose | Auth | Request Body | Response Format | Source File |
|---|---|---|---|---|---|---|
| `GET` | `/api/status` | Reports ADB availability, connected device count, and watcher status | None | None | JSON object (`adb_available`, `connected_devices`, `watcher_status`) | `backend/api_routes.py#L36` |
| `GET` | `/api/device-status` | Streams live real-time hardware status events from event bus | None | Query: `limit`, `serial` | JSON object (`status`, `count`, `events`) | `backend/api_routes.py#L57` |
| `POST` | `/api/reconnect` | Restarts the host ADB server and triggers immediate device poll | None | None | JSON object (`get_system_status()`) | `backend/api_routes.py#L68` |
| `GET` | `/api/snapshot` | Returns live battery snapshot or latest database reading | None | Query: `serial`, `include_demo` | JSON object (health, voltage, temp, cycles, forecast) | `backend/api_routes.py#L77` |
| `GET` | `/api/raw-diagnostic` | Returns raw dumpsys and sysfs directory inspection output | None | Query: `serial` | JSON object (`dumpsys_battery`, `sysfs_paths`) | `backend/api_routes.py#L434` |
| `GET` | `/api/history` | Fetches historical time-series battery reading records | None | Query: `days`, `serial`, `include_demo` | JSON array of `BatteryReading` dictionaries | `backend/api_routes.py#L451` |
| `GET` | `/api/insights` | Computes charging habit analytics and thermal wear statistics | None | Query: `days`, `serial`, `include_demo` | JSON object (`above_80_pct`, `fast_charge_pct`, `avg_temp_c`) | `backend/api_routes.py#L467` |
| `GET` | `/api/probe` | Performs manual hardware probing on connected device | None | Query: `serial` | JSON object with hardware register details | `backend/api_routes.py#L476` |
| `POST` | `/api/log-reading` | Forces logging of the current battery state to SQLite | None | JSON: `LogReadingRequest(serial)` | JSON object of recorded reading | `backend/api_routes.py#L492` |
| `POST` | `/api/seed-mock` | Injects a 30-day realistic historical mock dataset | None | JSON: `SeedRequest(days, serial, model)` | JSON object (`status`, `seeded_count`) | `backend/api_routes.py#L509` |
| `POST` | `/api/unseed-mock` | Purges all mock records (`is_demo = 1`) from SQLite | None | None | JSON object (`status`, `deleted_count`) | `backend/api_routes.py#L526` |
| `GET` | `/api/devices` | Lists physical and historically recorded devices | None | None | JSON object (`devices`, `active_count`) | `backend/api_routes.py#L538` |
| `GET` | `/api/device-profile` | Retrieves stored sysfs path mapping and OEM SoH for a device | None | Query: `serial` | JSON object of `DeviceProfile` | `backend/api_routes.py#L572` |
| `POST` | `/api/profile-device` | Triggers sysfs deep discovery with AI consensus fallback | None | Query: `serial`, `force_ai` | JSON object (`profile`, `fields_resolved`) | `backend/api_routes.py#L591` |
| `GET` | `/api/prediction` | Computes lifespan forecast and 80% charge cap simulation | None | Query: `serial`, `rated_cycles` | JSON object (`days_remaining`, `projected_date_iso`) | `backend/api_routes.py#L614` |
| `GET` | `/api/app-drain` | Returns per-app battery drain attribution from batterystats | None | Query: `serial`, `limit`, `sort_by` | JSON object (`status`, `apps`, `total_apps`) | `backend/api_routes.py#L652` |
| `POST` | `/api/calibration/start` | Starts active Coulomb counting charge calibration | None | Query: `serial`, `simulated` | JSON object (`session_id`, `status`) | `backend/api_routes.py#L779` |
| `GET` | `/api/calibration/status` | Streams live numerical metrics of active calibration session | None | None | JSON object (`accumulated_mah`, `extrapolated_capacity_mah`) | `backend/api_routes.py#L810` |
| `POST` | `/api/calibration/stop` | Finalizes calibration session and writes record to SQLite | None | None | JSON object (`session_id`, `calibrated_health_pct`) | `backend/api_routes.py#L816` |
| `POST` | `/api/calibration/reset` | Resets current calibration session to idle | None | None | JSON object (`status: idle`) | `backend/api_routes.py#L835` |
| `GET` | `/api/calibration/history` | Retrieves historical completed Coulomb calibration sessions | None | Query: `serial` | JSON array of `CalibrationRecord` objects | `backend/api_routes.py#L841` |

---

## 11. Environment & Configuration

Environment variables are loaded via `python-dotenv` from `.env` in the project root:

- `OPENROUTER_API_KEY=` — API key for OpenRouter AI parameter discovery fallback.
- `HF_API_KEY=` — API key for Hugging Face Inference API parameter discovery fallback.
- `OPENROUTER_MODEL_1=` — Primary OpenRouter model (defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`).
- `OPENROUTER_MODEL_2=` — Secondary OpenRouter model (defaults to `nvidia/nemotron-3.5-lightning:free`).
- `HF_MODEL=` / `HF_MODEL_1=` — Primary Hugging Face model (defaults to `deepseek-ai/DeepSeek-V4-Flash-0731`).
- `HF_MODEL_2=` — Secondary Hugging Face model (defaults to `Qwen/Qwen3-32B`).
- `ADB_PATH=` — Optional manual file path override to `adb.exe`.

Where configuration is loaded:
- `backend/device_profiler.py#L31` executes `load_dotenv()` and reads the AI keys and model identifiers.
- `backend/adb_client.py#L31` checks `os.environ.get("ADB_PATH")`.

---

## 12. Dependencies

Documented from `requirements.txt`:

| Package | Version Specifier | Purpose |
|---|---|---|
| `fastapi` | `>=0.110.0` | High-performance asynchronous REST API framework for serving frontend and data endpoints. |
| `uvicorn` | `>=0.28.0` | ASGI web server running the FastAPI backend inside a background daemon thread. |
| `pywebview` | `>=5.0.0` | Native Windows desktop GUI shell wrapping Microsoft Edge Chromium WebView2. |
| `sqlalchemy` | `>=2.0.0` | ORM for local SQLite persistence, schema management, and time-series aggregations. |
| `apscheduler` | `>=3.10.4` | Background job scheduler running the 1.5s device watcher polling loop. |
| `pure-python-adb` | `>=0.3.0.dev0` | Python client communicating over port 5037 with the local ADB server daemon. |
| `httpx` | `>=0.27.0` | Asynchronous HTTP client executing concurrent AI model discovery queries. |
| `pytest` | `>=8.0.0` | Test runner for executing unit and integration test suites. |
| `python-dotenv` | `>=1.0.0` | Loads environment variables from `.env` file into `os.environ`. |

---

## 13. Scripts & Commands

All verified commands available for development, testing, and distribution:

- **Installing Dependencies:**
  ```powershell
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  ```
- **Development Launch (Native Desktop Window):**
  ```powershell
  .\run.bat
  # or
  .\.venv\Scripts\pythonw.exe desktop.py
  ```
- **Development Launch (Console Debug Mode):**
  ```powershell
  .\run_debug.bat
  # or
  .\.venv\Scripts\python.exe desktop.py --debug
  ```
- **Headless Backend Server Launch:**
  ```powershell
  .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload
  ```
- **Running Automated Test Suite:**
  ```powershell
  .\.venv\Scripts\python.exe -m pytest -q
  ```
- **Running Specific Test Module:**
  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_health.py -v
  ```
- **Building Standalone Executable (`dist\Ion+.exe`):**
  ```powershell
  .\build_exe.bat
  # or
  .\.venv\Scripts\pyinstaller.exe phone_battery_analyzer.spec --noconfirm --clean
  ```
- **Performance Benchmark Recording:**
  ```powershell
  .\.venv\Scripts\python.exe scripts/record_perf.py
  ```
- **Desktop Shortcut Creation:**
  ```powershell
  .\create_shortcuts.bat
  ```

---

## 14. Data Flow

### End-to-End Diagnostic Flow Example:
1. **User Action:** User plugs Android device into PC via USB-C cable.
2. **Detection:** `DeviceWatcher` (`backend/watcher.py`) polls `adb devices` via `ADBClient` (`backend/adb_client.py`).
3. **Hardware Probe:** `ADBClient` executes `dumpsys battery` and reads `/sys/class/power_supply/*` sysfs registers.
4. **Health Computation:** Telemetry is forwarded to `calculate_health()` (`backend/health.py`), which normalizes scale units (e.g., 10 µAh vs µAh) and evaluates capacity ratio and Apple-standard electrochemical aging formulas.
5. **Persistence:** The calculated snapshot is committed to `battery_readings` in `battery_data.db` (`backend/db.py`).
6. **Notification:** A status event is emitted to `StatusBus` (`backend/status_bus.py`).
7. **UI Update:** The client polling loop in `app.js` calls `/api/snapshot` and updates the hero health card, smoothly glides the range dial pin to the measured health percentage, draws the updated reading on Chart.js, and displays the device name.

```
USB Plug-In
    │
    ▼
DeviceWatcher (watcher.py) ──> ADBClient (adb_client.py) ──> Android Kernel Sysfs
    │
    ▼
Health Engine (health.py) ──> Database (db.py -> battery_data.db)
    │
    ▼
StatusBus (status_bus.py) ──> API Route (/api/snapshot)
    │
    ▼
Frontend Client (app.js) ──> DOM / Canvas Update (Hero Number, Dial, Chart)
```

---

## 15. Important Files

| File | Purpose | Importance |
|---|---|---|
| `desktop.py` | Desktop application launcher managing port discovery, FastAPI daemon, and PyWebview window. | **Critical:** Main desktop entry point. |
| `backend/main.py` | FastAPI application factory, static asset mounting, CORS middleware, and lifespan handlers. | **Critical:** Backend entry point. |
| `backend/api_routes.py` | REST API endpoint handlers coordinating services, database, and client communication. | **Critical:** Core API contract layer. |
| `backend/adb_client.py` | Hardware communication layer probing kernel sysfs files, battery dumpsys, and cycle counts. | **Critical:** Hardware interface. |
| `backend/health.py` | Electrochemical State-of-Health equations, unit normalizations, and stress modifiers. | **Critical:** Core mathematical calculation engine. |
| `backend/prediction.py` | Battery lifespan forecasting, replacement boundary models, and 80% charge cap simulation. | **High:** Longevity analytics engine. |
| `backend/calibration.py` | Riemann current integration manager for empirical Coulomb charge testing. | **High:** Active capacity calibration engine. |
| `backend/db.py` | SQLite database schema, SQLAlchemy models, migration logic, and time-series queries. | **Critical:** Persistence layer. |
| `backend/watcher.py` | Background APScheduler service polling ADB connections and logging readings. | **High:** Real-time hardware monitoring. |
| `backend/device_profiler.py`| Automated sysfs register scanner with dual-provider AI consensus fallback. | **High:** Vendor fragmentation resolver. |
| `frontend/index.html` | Primary Single Page Application template containing the obsidian layout and views. | **Critical:** Main UI document. |
| `frontend/static/js/app.js` | Client-side application controller managing UI state, polling, charts, and interactions. | **Critical:** Main frontend controller. |
| `frontend/static/css/style.css`| Master stylesheet featuring EURA theme, liquid-glass shaders, and optical flow transitions. | **Critical:** Visual styling and animation system. |
| `frontend/static/js/ion-preloader.js`| Encapsulated Shadow-DOM atom preloader component with animated logo handoff. | **High:** App initialization experience. |
| `phone_battery_analyzer.spec`| PyInstaller packaging configuration for compiling standalone binary `dist\Ion+.exe`. | **High:** Distribution and build system. |

---

## 16. Current Implementation Status

### Working
- Full ADB device connection polling, auto-reconnect, and multi-device detection.
- Primary capacity ratio and Apple-standard electrochemical health algorithms.
- MediaTek, Qualcomm, Samsung, Google, and OnePlus capacity scale normalizations (µAh / 10 µAh / mAh).
- Historical readings persistence, range filtering (7D, 30D, 90D, All), and CSV export.
- EURA dark obsidian theme with continuous 60s aurora loop and 60 FPS GPU-composited transitions.
- Interactive horizontal range dial indicator (`range-dial-pin`).
- Dual-provider AI consensus discovery fallback (OpenRouter + Hugging Face) with physical ADB verification.
- Coulomb counting current integration charging wizard and simulated test run.
- Per-app battery drain attribution via `dumpsys batterystats`.
- Standalone Windows compilation (`dist\Ion+.exe`) and 129/129 automated tests passing.

### Partially Implemented
- Deep batterystats excavation runs on device connection and manual probe; automated periodic background deep scans are subject to a 15-minute interval to preserve ADB responsiveness.

### TODO
- No active TODO comments or incomplete stubs exist in the production source files.

### Known Issues
- `pure-python-adb` deprecation warnings on newer Python runtimes during async socket handling (handled internally with fallback subprocess calls).
- Starlette `TestClient` deprecation warnings during pytest runs (`httpx2` suggestion; does not affect runtime application).

---

## 17. Technical Debt

- **Duplicated Preloader Source:** `frontend/ion-preloader.js` and `frontend/static/js/ion-preloader.js` exist as duplicates to accommodate both relative web roots and PyInstaller bundled asset paths.
- **Large Monolithic Files:**
  - `backend/device_profiler.py` (1,590 lines) contains both sysfs regex patterns and AI model query logic.
  - `backend/adb_client.py` (1,107 lines) handles both low-level subprocess execution and high-level string parsing.
  - `frontend/static/js/app.js` (3,650 lines) manages view switching, DOM rendering, chart updates, and polling in a single file.
- **Hardcoded Thresholds:** Easing curves and minimum animation times are defined directly in CSS and JavaScript constants rather than an external configuration file.

---

## 18. Security Considerations

- **Local Loopback Only:** The FastAPI server binds strictly to `127.0.0.1` (localhost). It is not accessible from external networks.
- **CORS Restrictions:** Cross-Origin Resource Sharing is constrained to `127.0.0.1`, `localhost`, and `app://pywebview`.
- **Sanitized Subprocess Execution:** `ADBClient` commands avoid raw shell expansion and pass argument arrays to `subprocess.run()`.
- **API Key Protection:** LLM provider keys (`OPENROUTER_API_KEY`, `HF_API_KEY`) are loaded via environment variables and are never transmitted to the frontend or persisted to the SQLite database.
- **Privacy Assurance:** Zero telemetry, analytics, or user identifiers leave the workstation. Database records remain entirely on the local disk.

---

## 19. Development Guidelines

- **Component Placement:**
  - Backend API endpoints belong in `backend/api_routes.py`.
  - Battery physics and health equations belong in `backend/health.py`.
  - Database schema changes belong in `backend/db.py`.
  - Frontend scripts belong in `frontend/static/js/`.
  - Frontend stylesheets belong in `frontend/static/css/`.
- **Coding Conventions:**
  - Python files use type annotations (`from __future__ import annotations`).
  - Frontend utilizes standard ES6+ with DOM manipulation and passive event listeners.
  - Animations must use GPU-composited CSS properties (`transform: translate3d`, `opacity`) and avoid `transition: all` to ensure locked 60 FPS execution.
  - Text rendered during transforms must include `-webkit-font-smoothing: antialiased` and `backface-visibility: hidden` to prevent edge blur.

---

## 20. AI Coding Context

### Before Making Changes
- Inspect existing tests in `tests/` before modifying backend equations or database schemas.
- Run `.venv\Scripts\python.exe -m pytest -q` to verify the baseline before and after edits.
- Ensure `test_aurora_loop.py` invariants are respected: `@keyframes aurora-drift` must retain its 60s-90s duration and centered `50% 50%` to `350% 50%` coordinates.
- Ensure `test_toggle_styles.py` invariants are respected: track sizing tokens (`--h: 34px`) and knob position (`--k: calc(var(--h) - 2px - var(--pad) * 2)`) must remain intact.

### Do Not Change Without Approval
- `backend/db.py`: Database column names and table schemas (`battery_readings`, `device_profiles`).
- `backend/health.py`: Core capacity ratio formulas and IEC 61960 unit normalization thresholds.
- `phone_battery_analyzer.spec`: PyInstaller hidden imports and asset bundling declarations.
- API route signatures in `backend/api_routes.py`.

### Coding Principles
- **Preserve Existing Architecture:** Do not introduce heavy frontend frameworks (React, Vue) or replace the local SQLite database.
- **Offline Integrity:** Never add external CDN dependencies that fail when disconnected from the internet.
- **Minimal Changes:** Avoid cosmetic reformatting of unrelated files.
- **Zero Hallucination:** Never mock or default battery health values to arbitrary placeholders (e.g. 100%) when data is unavailable.

---

## 21. Change Log

### Recent Changes
- No changes recorded yet.

---

## 22. Documentation Maintenance

This `PROJECT.md` file must be reviewed and updated whenever:
1. Architectural patterns or major components are introduced or deprecated.
2. New REST API endpoints are added or modified in `backend/api_routes.py`.
3. Database models or schemas change in `backend/db.py`.
4. Dependencies are added, updated, or removed in `requirements.txt`.
5. Core electrochemical calculation equations are altered in `backend/health.py`.
6. Desktop launcher or build configurations are updated in `desktop.py` or `phone_battery_analyzer.spec`.
