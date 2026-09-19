# Phone Battery Health Analyzer

An ADB-powered desktop tool that connects to an Android phone over a USB-C cable and provides an accurate, trend-based assessment of real battery degradation — bypassing the vague *"Battery health: Good"* label by calculating genuine capacity loss and logging historical trends in a dark glassmorphic dashboard.

![Brand Mark](frontend/static/assets/logo-mark.svg)

---

## Key Features

- **Direct Hardware Probing (No Root Required)**:
  - Communicates via Android Debug Bridge (`adb shell dumpsys battery` and `/sys/class/power_supply/battery/...`).
  - Probes design capacity, current full capacity, voltage, temperature, cycle counts, and charging status.
  - Automatically identifies which sysfs paths are accessible on OEM firmware (such as Nothing OS on the Nothing Phone 2a).
- **Dual-Engine Health Calculation**:
  - **Primary Method (`capacity_ratio`)**:
    $$\text{Health \%} = \frac{\text{charge\_full\_uah}}{\text{charge\_full\_design\_uah}} \times 100$$
  - **Fallback Method (`trend_estimate`)**:
    Used when OEM firmware hides `charge_full_design`. Compares observed capacity against the initial logged baseline.
- **Charging Habit & Wear Analytics**:
  - Time spent in high state-of-charge ($>80\%$).
  - Fast-charging frequency (high voltage $>4200\text{ mV}$).
  - Operational temperature history and thermal stress warnings ($>42^\circ\text{C}$).
- **EURA iOS Health/Wellness Desktop UI (v2)**:
  - Centerpiece hero card with giant bold health % typography (EURA "24 years" bio-age aesthetic).
  - Meaning-driven dynamic gradients: Emerald ($\ge 85\%$, `#14532D` $\to$ `#22C55E`), Amber ($70\text{--}84\%$, `#7C2D12` $\to$ `#F59E0B`), and Crimson ($< 70\%$, `#7F1D1D` $\to$ `#EF4444`).
  - Integrated horizontal range dial (0–100) with a live position pin and comparative status diagnosis line.
  - Black "Heart Report" trend card with a white line chart and a 3-stat summary row underneath (Temperature, Voltage, Cycle Count).
  - Deep indigo-to-violet-to-black cinematic diagonal background (`#0A0E27` $\to$ `#1B1035` $\to$ `#000000`) with ambient glow.
  - Floating pill-capsule navigation (`Dashboard`, `History`, `Insights`, `Diagnostics`) and pill connection button.
- **Background Watcher**:
  - APScheduler polling loop automatically detects phone connection events and records readings without manual intervention.
- **100% Local & Private**:
  - No cloud connections, no telemetry, zero data leaving your computer.
  - Self-contained SQLite database (`battery_data.db`).
  - Bundled local Chart.js library for complete offline operation.

---

## Project Structure

```
Battery analyser/
├── backend/
│   ├── adb_client.py        # ADB connection & hardware sysfs/dumpsys probe
│   ├── db.py                # SQLite schema (PRD §8) & aggregation queries
│   ├── health.py            # Primary & fallback health calculation engines
│   ├── watcher.py           # Background connection watcher (APScheduler)
│   ├── api_routes.py        # FastAPI REST endpoints
│   └── main.py              # Application entrypoint & static file serving
├── frontend/
│   ├── index.html           # Desktop dashboard shell
│   ├── history.html         # History view redirect
│   └── static/
│       ├── css/style.css    # Dark glassmorphism, glows & animations
│       ├── js/app.js        # State, live polling, & Chart.js logic
│       ├── js/chart.min.js  # Offline-ready Chart.js bundle
│       └── assets/          # Brand logos, icons, and favicon
├── tests/
│   ├── test_health.py       # Health calculation tests
│   ├── test_db.py           # Database CRUD & aggregation tests
│   ├── test_parser.py       # Dumpsys & sysfs parsing tests
│   └── test_api.py          # FastAPI endpoint integration tests
├── desktop.py               # Native desktop window launcher (PyWebview)
├── run.bat                  # One-click Windows runner
├── requirements.txt         # Project dependencies
└── README.md
```

---

## Phone Setup (One-Time)

To allow the analyzer to communicate with your Android phone:

1. **Enable Developer Options**:
   - Open **Settings** $\to$ **About Phone**.
   - Tap **Build Number** 7 times until you see *"You are now a developer!"*.
2. **Enable USB Debugging**:
   - Open **Settings** $\to$ **System** $\to$ **Developer Options**.
   - Toggle **USB Debugging** to **ON**.
3. **Connect to Laptop**:
   - Plug the phone into your computer via a USB-C cable.
   - When the notification appears on the phone, select **File Transfer / Android Auto** (do not leave it on *"Charging only"*).
4. **Authorize Computer**:
   - On the phone screen, accept the prompt: *"Allow USB debugging from this computer?"*.
   - Check **"Always allow from this computer"** and tap **Allow**.

---

## Running the Application

### Option 1: Standalone `.exe` (Recommended - Native Desktop App)
Double-click **`dist\Phone Battery Analyzer.exe`** or the **Phone Battery Analyzer** shortcut on your Windows Desktop.
- **Adobe-Style Startup Screen**: Frameless dark glassmorphic splash card with app logo, glowing progress bar, and real-time initialization ticker.
- **Zero Command Prompt Window**: Launches directly into the desktop window.
- **Self-Contained**: Can be copied anywhere or pinned to your Windows Taskbar/Start Menu.

### Option 2: Windows Desktop Shortcut
Double-click the **Phone Battery Analyzer** shortcut on your Desktop or in the project folder.
*(If you ever move the project folder, run `create_shortcuts.bat` to refresh the shortcuts).*

### Option 3: Quick Launch (`run.bat`)
Double-click `run.bat`. It launches the compiled `.exe` (or `pythonw.exe`) and closes the console immediately.

### Option 4: Developer / Debug Mode (`run_debug.bat`)
If you want to view live backend terminal logs and debug messages:
```cmd
run_debug.bat
```

### Option 5: Rebuilding the Executable (`build_exe.bat`)
To recompile the standalone `.exe` after making any code or styling changes:
```cmd
build_exe.bat
```
Output executable will be generated at: `dist\Phone Battery Analyzer.exe`.

---

## Diagnostic Hardware Probe CLI

To run a quick hardware probe from your command line and inspect what sysfs fields your connected device exposes:
```powershell
.\.venv\Scripts\python.exe -m backend.adb_client
```

---

## Running Automated Tests

```powershell
.\.venv\Scripts\python.exe -m pytest tests/ -v
```
