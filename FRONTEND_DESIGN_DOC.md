# Ion+ (Ion Battery Health Analyser) — Complete Frontend Design Document

**Document Version:** v2.4.0  
**Target Surface:** PyWebview (Microsoft Edge WebView2 Chromium Host)  
**Host Application:** Windows 10 / 11 Native Desktop Binary (`dist\Ion+.exe`)  
**Design Paradigm:** EURA Dark Obsidian (Luxury Health/Biometrics Aesthetic)  
**Architectural Mandate:** 100% Offline-Capable, Zero `node_modules` (Pure Vanilla ES6+), Zero Layout Shifts, Deterministic UI Reconciliation  

---

## 1. Executive Summary & Design Philosophy

### 1.1 The EURA Aesthetic Philosophy
Traditional battery diagnostics tools (e.g., AccuBattery, coconutBattery, BatteryInfoView) are engineered as austere technical tables or utilitarian form widgets. While functional, their visual presentation lacks the emotional polish and intuitive clarity demanded by modern consumer software.

Ion+ adopts the **EURA Dark Obsidian Design System**, a visual framework inspired by premium biometric health devices (such as Oura Ring, Apple Health, and Whoop). Battery degradation is treated not as an abstract hardware log, but as the physical **"biological age"** of the device:

1. **The Hero Centerpiece:** A single monumental metric ("The One Big Number") commanding visual hierarchy, framed by a continuous range dial showing real-time wear progression.
2. **Dynamic State-Adaptive Auroras:** Color palettes transition smoothly between Emerald Health ($\ge 85\%$), Amber Aging ($70\% - 84\%$), Crimson Degradation ($< 70\%$), and Slate Standby.
3. **Fluted-Glass Refraction:** An ambient SVG displacement background shader that mimics optical fluted glass caustics without introducing WebGL overhead.
4. **Physical Telemetry Integrity:** Every percentage, millivolt, milliampere, and microampere-hour is traceable to hardware registers with explicit data provenance badges.

### 1.2 The "Zero node_modules" Vanilla Architecture
Ion+ explicitly rejects heavy modern frontend frameworks (React, Vue, Angular, Svelte, Next.js) in favor of a **pure vanilla web architecture**:

```mermaid
flowchart TD
    subgraph Traditional_Bloat ["Traditional Web Framework Stack"]
        NPM["100,000+ Files in node_modules"] --> WEBPACK["Webpack / Vite Bundler"]
        WEBPACK --> VDOM["Virtual DOM Reconciliation Overhead"]
        VDOM --> RUNTIME["500KB+ JS Runtime Engine"]
    end

    subgraph Ion_Architecture ["Ion+ Pure Vanilla Architecture"]
        HTML["Single Semantic index.html (53 KB)"] --> NATIVE_DOM["Native Browser DOM APIs"]
        CSS["style.css + Tailwind JIT CDN (28 KB)"] --> GPU["Hardware-Accelerated CSS Engine"]
        JS["Vanilla ES6+ app.js (117 KB)"] --> SINGLETON["Reactive AppState Singleton"]
        CHART["Local Offline Chart.js (205 KB)"] --> CANVAS["HTML5 Canvas 2D Context"]
    end
```

#### Strategic Rationale:
1. **Instantaneous Cold-Start:** Zero bundle evaluation lag or transpilation overhead. PyWebview displays the UI immediately upon window creation.
2. **Deterministic Memory Footprint:** Eliminates Virtual DOM memory churn and Garbage Collector (GC) pauses during high-frequency telemetry polling.
3. **100% Offline Resilience:** No external npm registries or dynamic script loaders. The entire presentation tier is self-contained and loads reliably in air-gapped forensic environments.
4. **Direct Win32 / WebView2 Interop:** Native DOM manipulation guarantees perfect synchronization with PyWebview's Edge Chromium runtime and native window resizing events.

---

## 2. Layout Topology & View Hierarchy

### 2.1 Viewport Container & Grid Architecture
The Ion+ viewport is structured as a full-bleed, responsive 12-column CSS grid constrained to `max-w-7xl` (1280px) on large displays, with a minimum supported resolution of `1024x700` pixels:

```mermaid
flowchart TB
    subgraph Window ["PyWebview Edge Chromium Window (1380x880)"]
        AURORA["Fixed Background: Fluted-Glass Aurora Shader (z-index: 0)"]
        
        subgraph App_Shell ["Application Shell (z-index: 10)"]
            HEADER["Sticky Top Navigation Bar (z-index: 40)<br/>Brand Cluster | Segmented Capsule Nav | Connection Capsule & CTA"]
            
            TOAST["Floating Device Connect Toast (z-index: 50)"]
            GUIDANCE["State-Aware USB Connection Guidance Banner"]
            FEED["Collapsible Live Device Status Feed"]
            
            subgraph View_Container ["Dynamic View Container (Single Active Section)"]
                V_DASH["View 1: #view-dashboard (EURA Home)"]
                V_TREND["View 2: #view-trends (Full Degradation Log)"]
                V_HABIT["View 3: #view-habits (Charging Habits & Thermal Stress)"]
                V_DIAG["View 4: #view-diagnostics (Sysfs & Dumpsys Probe)"]
            end
        end
        
        TOOLTIP["Global Shared Tooltip Container (z-index: 9999)"]
    end
```

### 2.2 Navigation Architecture
The header provides continuous access across four primary operational contexts via a floating, segmented **Capsule Navigation Pill**:

| Tab Identifier | Target Container | Operational Purpose |
| :--- | :--- | :--- |
| **`dashboard`** | `#view-dashboard` | Real-time EURA bio-age card, Heart Report chart, chemical capacities, longevity prediction, Coulomb calibration, and app drain attribution. |
| **`trends`** | `#view-trends` | Complete historical archive table with timestamped readings, cycle counters, and electrochemical calculation methods. |
| **`habits`** | `#view-habits` | Behavioral analytics: time exposed to high voltage (>80%), fast-charging rates, operating thermal baselines, and wear delta insights. |
| **`diagnostics`** | `#view-diagnostics` | Low-level hardware inspection: raw sysfs directory tree, power supply node registers, and parsed Android dumpsys tables. |

---

## 3. Design System & Visual Token Foundation

### 3.1 Color Palette & Semantic Tokens
All interface styling derives from a cohesive design token specification configured in [`frontend/static/css/style.css`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/static/css/style.css) and Tailwind CSS theme extensions:

```css
:root {
  /* Surfaces & Backgrounds */
  --surface-base: #0B0B10;           /* Deep Obsidian Base */
  --card-secondary: #0F1024;         /* Midnight Indigo Card Surface */
  --card-border: rgba(255, 255, 255, 0.08);
  --card-border-hover: rgba(255, 255, 255, 0.16);

  /* Primary Accent Gradients */
  --card-indigo-gradient: linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%);

  /* Text Roles */
  --text-primary: #FFFFFF;
  --text-secondary: #A1A1AA;         /* Zinc 400 */
  --text-muted: #71717A;             /* Zinc 500 */

  /* Aurora Header Accent */
  --aurora-stripe: rgba(139, 92, 246, 0.14);
}
```

### 3.2 Dynamic Hero Health Band Gradients
The centerpiece EURA hero card dynamically shifts its background gradient based on the calculated State of Health (SoH), providing instant peripheral feedback on cell condition:

| Health Band | SoH Range | CSS Class / Gradient Token | Visual Meaning |
| :--- | :--- | :--- | :--- |
| **Optimal / Healthy** | $\ge 85.0\%$ | `hero-gradient-healthy`<br/>`linear-gradient(135deg, #14532D 0%, #15803D 50%, #22C55E 100%)` | Vibrant Emerald; optimal lithium intercalation retention. |
| **Fair Condition** | $70.0\% - 84.9\%$ | `hero-gradient-fair`<br/>`linear-gradient(135deg, #7C2D12 0%, #C2410C 50%, #F59E0B 100%)` | Warm Amber Bronze; moderate capacity fade observed. |
| **Needs Care** | $< 70.0\%$ | `hero-gradient-poor`<br/>`linear-gradient(135deg, #7F1D1D 0%, #B91C1C 50%, #EF4444 100%)` | Deep Crimson Obsidian; high internal cell impedance. |
| **Standby / Unknown** | `None` / Idle | `hero-gradient-unknown`<br/>`linear-gradient(135deg, #1E293B 0%, #334155 50%, #475569 100%)` | Muted Slate Noir; awaiting physical USB connection. |

### 3.3 Typography & Tabular Metric Hierarchy
To maintain strict legibility during real-time value updates, Ion+ enforces a split typographic hierarchy:
- **Display & Headings:** Native Apple system font stack (`-apple-system`, `BlinkMacSystemFont`, `"SF Pro Display"`, `"Inter"`, `sans-serif`) with tight letter spacing (`tracking-tight`).
- **Telemetry Counters & Hardware Registers:** Monospace font stack (`font-mono`, `ui-monospace`, `Consolas`, `monospace`) utilizing OpenType tabular figures (`tnum`). This prevents layout jitter and horizontal bouncing when digits fluctuate.

---

## 4. Fluted-Glass Aurora Background Shader Pipeline

### 4.1 Shader Architecture & Optical Principles
The application background features a hardware-accelerated, transparent AuroraHero shader that recreates the optical caustic distortion of industrial fluted glass.

```mermaid
flowchart LR
    A["Repeating Linear Rainbow Stripes<br/>#60a5fa | #e879f9 | #5eead4"] --> B["SVG Radial Mask<br/>radial-gradient(ellipse at 100% 0%)"]
    B --> C["Animation Engine<br/>smoothBg 60s Infinite Pan"]
    C --> D["mix-blend-mode: difference"]
    
    E["SVG Filter: #fluted"] --> F["feImage: Embedded Data-URI Vector"]
    F --> G["feTile: Tiled Column Pattern"]
    G --> H["feGaussianBlur: stdDeviation .0001"]
    H --> I["feDisplacementMap: scale .08 (R & G channels)"]
    
    D & I --> J["Final Caustic Aurora Surface<br/>(Rendered behind Obsidian UI)"]
```

### 4.2 SVG Filter Definition
Configured in [`frontend/index.html`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/index.html#L44-L60):
```html
<filter id="fluted" primitiveUnits="objectBoundingBox">
  <feImage x="0" y="0" result="image_0" crossorigin="anonymous"
    href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E...%3C/svg%3E"
    preserveAspectRatio="none meet" width=".03" height="1" />
  <feTile in="image_0" result="tile_0" />
  <feGaussianBlur stdDeviation=".0001" edgeMode="none" in="tile_0" result="bar_smoothness" x="0" y="0" />
  <feDisplacementMap scale=".08" xChannelSelector="R" yChannelSelector="G"
    in="SourceGraphic" in2="bar_smoothness" result="displacement_0" />
</filter>
```

### 4.3 Performance & Lifecycle Optimization
1. **Fixed Coordinate Inset:** The wrapper uses `position: fixed; inset: 0; pointer-events: none; z-index: 0;`, completely isolating it from the document layout flow and preventing DOM reflow triggers.
2. **Window Minimization / Blur Throttling:**
   ```javascript
   window.addEventListener('blur', () => {
     document.querySelector('.ion-aurora-wrap')?.classList.add('ion-aurora-paused');
   });
   window.addEventListener('focus', () => {
     document.querySelector('.ion-aurora-wrap')?.classList.remove('ion-aurora-paused');
   });
   ```
   When the desktop window is minimized or loses focus, the CSS animation play state is paused (`animation-play-state: paused !important`), reducing idle GPU utilization to 0.0%.

---

## 5. Reactive State Architecture & Data Flow

### 5.1 AppState Singleton (Single Source of Truth)
Ion+ implements a centralized, reactive publish-subscribe state pattern in [`frontend/static/js/app.js`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/static/js/app.js):

```mermaid
stateDiagram-v2
    [*] --> Idle: Application Boot

    Idle --> Connected: USB Device Plugged (State: "device")
    Idle --> Seeded: User Clicks "Seed 30D"
    
    Connected --> Idle: Cable Unplugged / ADB Disconnect
    Seeded --> Idle: Cable Connected or Fresh Launch

    state Connected {
        [*] --> PollingFast
        PollingFast --> SnapshotUpdate: Every 1.0s (/api/snapshot)
        PollingFast --> HistoryUpdate: Every 10.0s (/api/history)
        PollingFast --> AppDrainUpdate: Every 10.0s (/api/app-drain)
    }
```

```javascript
const AppState = {
  connected: false,
  mode: 'idle', // 'idle' | 'connected' | 'seeded'
  device: null,
  snapshot: null,
  systemStatus: null,
  _listeners: [],

  subscribe(listener) {
    this._listeners.push(listener);
    listener({ ...this });
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  },

  notify() {
    const payload = { ...this };
    for (const listener of this._listeners) {
      try { listener(payload); } catch (err) { console.error('AppState error:', err); }
    }
  },

  updateFromSystemStatus(status) { ... },
  setSnapshot(snapshot) { ... },
  setSeededMode(mockSerial, mockSnapshot) { ... }
};
```

### 5.2 Subscription Registrations
Five specialized subscribers bind directly to `AppState`:
1. **`subscribeTopBar`:** Manages the connection dot pulsing state, status badge text, device name labels, and last-seen timestamps.
2. **`subscribeGuidanceBanner`:** Toggles the amber warning banner for `unauthorized` (RSA key required) and `offline` devices.
3. **`subscribeHeroHeadline`:** Updates the primary cinematic title (*"Genuine Battery Degradation"* vs *"Authorization Required"* vs *"Plug In to Begin"*).
4. **`masterDashboardSubscriber`:** Orchestrates the centerpiece EURA hero card, range dial, 3-stat row, chemical capacity cards, predictive timeline, and pure math breakdown.
5. **`subscribeTopBatteryDrainers`:** Controls empty-state banners and triggers app drain list re-rendering.

### 5.3 Non-Destructive DOM Reconciliation
High-frequency polling loops can disrupt user interaction (such as dropping scroll position or collapsing opened accordions). Ion+ enforces **scoped reconciliation**:
- Scroll positions are queried via `window.scrollY` and preserved across re-renders.
- Dropdown toggles and filter pills maintain active classes using `dataset` attributes.
- Canvas chart updates use Chart.js's in-place data replacement rather than canvas recreation whenever dataset lengths match.

---

## 6. Core Dashboard Components & Subsystems

### 6.1 Hero Centerpiece Card (EURA Bio-Age Paradigm)
The hero card ([`frontend/index.html`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/index.html#L278-L345)) translates electrochemical health into an immediate visual verdict:

```mermaid
flowchart TD
    subgraph Hero_Card ["EURA Hero Card Anatomy"]
        TOP["Top Row: Battery Health Label | OEM SoH Badge | Status Pill"]
        NUM["Center: 'The One Big Number' (7xl–9xl font) + Unit (%)"]
        DIAL["Continuous Range Dial: 0% Poor · 50% · 70% Fair · 85% Good · 100% Factory"]
        PIN["Calibrated Dial Marker Pin (style.left = clamp(0, SoH, 100)%)"]
        BOTTOM["Bottom Row: Steady and Healthy Heading | Subtext | Health Method Badge"]
    end
    
    TOP --> NUM
    NUM --> DIAL
    DIAL --> PIN
    PIN --> BOTTOM
```

#### Marker Pin Clamping Formula:
```javascript
const rawHealth = s.health_pct !== null ? s.health_pct : 100;
const clampedHealth = Math.min(100, Math.max(0, rawHealth));
el.rangeDialMarker.style.left = `${clampedHealth}%`;
```

### 6.2 Heart Report: Capacity Retention Curve (Chart.js)
Rendered into `#heart-report-chart` using the local [`frontend/static/js/chart.min.js`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/static/js/chart.min.js) bundle:

```mermaid
flowchart LR
    A["Raw SQLite Time-Series"] --> B["Dual-Axis Dataset Mapper"]
    B --> C["Primary Y-Axis (yHealth):<br/>Solid White Spline (#FFFFFF)<br/>Gradient Area Drop (0.15 to 0.0)"]
    B --> D["Secondary Y-Axis (yTemp):<br/>Dashed Indigo Curve (#818CF8)<br/>3px on / 3px off dash"]
    
    C & D --> E["Interactive Canvas Rendering<br/>Tension: 0.0 (Strict Truthfulness)<br/>Custom Tooltip with Voltage & Cycles"]
```

#### Visual Styling Specifications:
- **Tension Zero (`tension: 0.0`):** Spline curves are strictly linear point-to-point. Bezier curve smoothing is forbidden to prevent artificial interpolation of unrecorded wear.
- **Dual Y-Axes:** Left axis scales tightly around recorded health percentage; right axis tracks operating temperature in °C.
- **Dataset Toggles:** Interactive pill buttons `#toggle-metric-health` and `#toggle-metric-temp` toggle series visibility dynamically via `chartInstance.setDatasetVisibility(idx, isVisible)`.
- **Time Window Filtering:** `7D`, `14D`, `30D`, and `90D` buttons trigger `/api/history?days={days}` without full-page reloads.

### 6.3 Chemical Capacity & Data Provenance Card
Surfaces physical battery capacity with rigorous data lineage:
- **Max Chemically Chargeable Capacity ($C_{\text{full}}$):** The current maximum capacity achievable by the fuel gauge.
- **Design Capacity Ceiling ($C_{\text{design}}$):** Factory nominal rating.
- **Provenance Badges:**
  - `Local USB` (Emerald): Read directly from kernel sysfs.
  - `AI Consensus` (Cyan): Resolved via multi-model LLM majority vote.
  - `Apple Standard SoH` (Indigo): Synthesized via IEC 61960 polynomial calibration due to static OEM registers.
- **Capacity Retention & Fade Delta Pills:** Displays instantaneous retention ($\frac{C_{\text{full}}}{C_{\text{design}}} \cdot 100$) and capacity fade ($100 - \text{Retention}$).

### 6.4 Longevity Forecasting & 80% Charge Cap Simulator
Implemented in [`frontend/index.html`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/index.html#L474-L558):
- **Months Remaining Countdown:** Bold monospace countdown to the 80.0% retention threshold.
- **Trilinear Gradient Progress Bar:** `bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500` indicating current position relative to the 80% service limit.
- **Interactive 80% Charge Cap Simulator:**
  - Toggle switch (`#sim-cap-toggle`) initiates real-time electrochemical simulation.
  - Reveals a side-by-side comparison grid comparing the **Normal Habit** timeline vs. the **80% Capped** timeline.
  - Highlights quantified lifespan extension (e.g., *"+1.8 years extended lifespan"*).

### 6.5 Active Coulomb Counting Wizard
Provides hardware verification when OEM registers are static or suspected of gas-gauge drift:
- **Real-Time Ammeter Widgets:**
  - Charging Current ($I$ in $\text{mA}$): Live ammeter readings sampled at 600ms intervals.
  - Accumulated Charge ($Q$ in $\text{mAh}$): Riemann sum numerical integration ($Q = \int I\, dt$).
- **Lifecycle Controls:**
  - `Start Live Test`: Engages physical current integration while the device charges.
  - `Demo Run`: Executes a 20-second simulated fast-charge profile for demonstration.
  - `Stop`: Finalizes the run and computes extrapolated capacity ($C_{\text{extrapolated}} = \frac{Q}{\Delta\text{SoC}} \times 100$).
- **Extrapolated Verdict Box:** Displays final chemical capacity and State of Health in an emerald/amber highlight container.

### 6.6 App Battery Drain Attribution Subsystem
Surfaces granular per-application power usage extracted via Android checkin dumps:
- **Window Filters:** `24H`, `7D`, and `All` time windows.
- **Sort Selectors:** Sort by `Wakelock` hold time (ms), Background CPU (`Bg CPU` in ms), or `Est. Power` (mAh).
- **Thermal Correlation Banner:** Automatically appears when background wakelocks coincide with device temperatures exceeding 40.0°C.
- **Zero-Hallucination Labeling:** Secondary estimated mAh figures are tagged with provenance notes clarifying derivation from OEM `power_profile.xml`.

### 6.7 Pure Mathematical Model Breakdown & Audit Strip
A 6-card audit strip at the bottom of the dashboard detailing the exact formulas and parameters used in the health calculation:
1. `Capacity Fade (%)`: Raw chemical capacity reduction.
2. `Cycle Fatigue (%)`: Intercalation wear ($\alpha \cdot n^\beta$).
3. `Calendar Aging (%)`: SEI layer growth ($\gamma \cdot \sqrt{t}$).
4. `Stress Factor`: Combined thermal Arrhenius and high-voltage multiplier ($S_T \cdot S_V$).
5. `Final Health (%)`: Calibrated State of Health.
6. `Data Sources`: Visual pills for Fuel Gauge, Design, and Cycle data provenance.

---

## 7. Secondary Views & Diagnostic Subsystems

### 7.1 Historical Archive Table (`#view-trends`)
- **Sticky Column Headers:** Fixed header bar (`#0F1024` with backdrop blur) allows scrolling through thousands of readings without losing column alignment.
- **Attributes Rendered:** Timestamp (localized), Health %, Charge Level %, Terminal Voltage (mV), Operating Temp (°C), OEM Cycle Count, and Calculation Method.
- **Dynamic Counter Badge:** Displays total reading count and recorded time span.

### 7.2 Biometric Habits & Wear Insights View (`#view-habits`)
Surfaces behavioral telemetry to help users preserve cell longevity:
- **4 Key Stat Cards:**
  - `Time Above 80%`: Percentage of time exposed to high-voltage degradation stress.
  - `Fast Charging Rate`: Frequency of high-current thermal charging events.
  - `Average Temp`: Historical baseline operating temperature.
  - `Capacity Fade Delta`: Measured capacity fade since the first recorded session.
- **Diagnostic Insights Engine:** Generates rule-based advice cards (e.g., *"Elevated Thermal Exposure Detected"*, *"Optimal Charge Cycling"*).

### 7.3 Sysfs & Dumpsys Diagnostic Probe View (`#view-diagnostics`)
A deep forensic inspector for hardware verification:
- **Sysfs Directory Tree:** Collapsible explorer displaying all discovered power supply nodes (`/sys/class/power_supply/battery/*`, `bms`, `oplus_chg`, `mtk-battery`).
- **Raw Register Key-Value Grid:** Live string outputs for every node attribute (`charge_full`, `current_now`, `voltage_now`, `status`, `technology`).
- **Dumpsys Output Viewer:** Formatted raw output of `dumpsys battery` and `dumpsys batterystats`.

---

## 8. Interactive Micro-Interactions & Assistive Flows

### 8.1 Device Connected Toast Notification
When an active USB connection is recognized, a glassmorphic floating toast slides into the top-right viewport:

```mermaid
sequenceDiagram
    participant Poll as Watcher Poll
    participant Toast as Toast Manager
    participant DOM as #device-connect-toast
    
    Poll->>Toast: isNewConnection (serial changed)
    Toast->>DOM: Add class .toast-visible
    Toast->>DOM: Reset & trigger #toast-progress drain animation (3s)
    Toast->>Toast: Start 3000ms holdTimer
    
    alt User clicks close button
        DOM->>Toast: Click event
        Toast->>DOM: Add class .toast-exiting (220ms fade & slide)
    else 3000ms timer elapses
        Toast->>DOM: Add class .toast-exiting (220ms fade & slide)
    end
    
    Toast->>DOM: Remove .toast-visible & .toast-exiting
```

### 8.2 Collapsible Live Device Status Feed
A ribbon positioned above the dashboard provides real-time streaming feedback:
- **Pulsing Indicator:** Animated emerald/cyan radar ping indicating active communication.
- **Event Preview:** Inlines the latest event (e.g., *"ADB query executed: dumpsys battery"*).
- **Collapsible Drawer:** Expands into a timestamped terminal stream showing background watcher events.
- **Persistence:** Expansion state is saved in `sessionStorage` (`ion_status_feed_expanded`).

### 8.3 Interactive Standby Connection Assistant
Visible during `idle`, `unauthorized`, or `offline` states, this accordion guides users whose devices are not immediately detected:
1. **USB Mode Switch:** Instructions to switch from *Charging Only* to *File Transfer (MTP)*.
2. **Developer Mode:** Tap *Build Number* 7 times to unlock settings.
3. **OEM Specifics:**
   - *Xiaomi / Redmi / POCO:* Enable *Install via USB* and *Security settings*.
   - *OnePlus / OPPO / Realme:* Accept the permanent RSA key fingerprint prompt.
   - *Samsung One UI:* Guidance on Samsung USB driver verification.
4. **Re-scan USB Devices Button:** Triggers `POST /api/reconnect` to cycle the ADB socket bridge without restarting the desktop application.

---

## 9. Accessibility, Responsiveness & Cross-Platform Behavior

### 9.1 Accessibility (a11y) Conformance
1. **ARIA Roles & States:**
   - Toast notifications use `role="status"` and `aria-live="polite"`.
   - Modals and accordions utilize `aria-expanded` and `aria-controls`.
   - Toggle buttons utilize `role="switch"` and `aria-checked`.
2. **Reduced Motion Support:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     .aurora-hero-bg .ion-aurora-overlay { animation: none !important; }
     .toast-glassmorphic { transition: none !important; }
   }
   ```
   Users with vestibular motion sensitivities receive static gradients and instantaneous transitions.
3. **Contrast Compliance:** All primary text tokens meet WCAG 2.1 AA contrast standards ($\ge 4.5:1$) against obsidian and indigo surfaces.

### 9.2 High-DPI & Scaling Support
PyWebview executes inside Microsoft Edge WebView2, supporting Windows display scaling ($100\%$, $125\%$, $150\%$, $200\%$):
- Vector icons are rendered in SVG or high-resolution PNG (`icon-1024.png`).
- Canvas contexts automatically adjust for device pixel ratios (`window.devicePixelRatio`), ensuring razor-sharp Chart.js curves on 4K monitors.

---

## 10. Performance, Resource Optimization & Security

### 10.1 Memory Management & Canvas Lifecycle
To prevent memory leaks during 24/7 background monitoring:
- Existing Chart.js instances are destroyed via `state.chartInstance.destroy()` before allocating new charts.
- Interval timers (`pollTimer`, `calibrationPollTimer`, `holdTimer`) are tracked and cleared on state transitions.
- Global event listeners are registered once during application boot rather than in render loops.

### 10.2 Security Architecture
1. **Zero External Network Calls:** All scripts, stylesheets, and fonts are either local or loaded via immutable cached CDNs. No user telemetry is ever transmitted.
2. **XSS Prevention:** All dynamic strings (device models, serials, package names, sysfs paths) pass through `escapeHtml()` or are assigned via `element.textContent`, preventing HTML/script injection from malicious Android device descriptors.
3. **Content Security Policy (CSP):** The embedded server serves strict headers restricting script execution to local origins and approved CDNs.
