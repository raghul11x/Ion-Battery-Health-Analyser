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

## 3. Design System & Visual Token Foundation (iOS 26 Liquid Glass)

### 3.1 Color Palette & Liquid Glass Tokens
All interface styling derives from an iOS 26 "Liquid Glass" design token specification configured in [`frontend/static/css/style.css`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/static/css/style.css):

```css
:root {
  /* Liquid Glass Surfaces & Optical Refraction */
  --glass-fill: rgba(255, 255, 255, 0.06);
  --glass-fill-strong: rgba(255, 255, 255, 0.12);
  --glass-tint-active: rgba(120, 190, 255, 0.22);
  --glass-edge: rgba(255, 255, 255, 0.22);
  --glass-edge-dim: rgba(255, 255, 255, 0.06);
  --glass-blur: 16px;
  --glass-saturate: 1.6;
  --glass-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.35),
                     inset 0 -1px 0 rgba(255, 255, 255, 0.06),
                     inset 0 0 24px rgba(255, 255, 255, 0.04);

  /* Geometry Radii */
  --radius-card: 28px;
  --radius-pill: 9999px;

  /* Deep Ambient Atmosphere Backdrop */
  --ambient-a: #0a2a43;             /* Deep Marine Blue */
  --ambient-b: #0b4a5a;             /* Deep Teal */
  --ambient-c: #0B0B10;             /* Obsidian Base */

  /* Theme-Matched Prism Aurora Tokens (Derived from Ambient Baseline) */
  --prism-base:   var(--ambient-c);            /* Obsidian base #0B0B10 */
  --prism-deep:   var(--ambient-a);            /* Deep marine blue #0a2a43 */
  --prism-mid:    var(--ambient-b);            /* Deep teal #0b4a5a */
  --prism-light:  rgba(120, 190, 255, 0.55);   /* Cool luminous blue (matches --glass-tint-active) */
  --prism-glint:  rgba(207, 234, 255, 0.28);   /* Cool white rib specular glint */
  --prism-accent: rgba(94, 234, 212, 0.35);    /* Teal accent glint (<= 8% of stripe length) */

  /* Text Roles (Strict WCAG AA >= 4.5:1 Contrast) */
  --text-primary: #FFFFFF;           /* Contrast 19.3:1 */
  --text-secondary: #A1A1AA;         /* Contrast 7.5:1 */
  --text-muted: #71717A;             /* Contrast 4.6:1 */
}
```

### 3.2 Core Glass Utility Classes
- `.cinematic-backdrop`: Single outer liquid glass container (`border-radius: 32px`, `backdrop-filter: blur(16px)`, `padding: clamp(1.25rem, 2.5vw, 2rem)`) providing unified optical refraction for the entire hero zone.
- `.hero-card`: Recessed inset content panel (`border-radius: 24px`, `padding: clamp(1.25rem, 2vw, 1.75rem)`, `backdrop-filter: none !important;`) eliminating nested blur costs while maintaining crisp visual depth.
- `.hero-number-wrap`: Baseline-aligned wrapper holding `.hero-number-val` and `.hero-number-unit` (`display: inline-flex; align-items: baseline;`).
- `.hero-number-val`: Monospace tabular figures (`min-width: 2.2ch; text-align: right; font-variant-numeric: tabular-nums lining-nums; font-family: ui-monospace...`) eliminating horizontal and vertical jitter between `-- %` and `100 %`.
- `.glass`: Card surfaces with 28px radius, `var(--glass-fill)`, 16px blur, 160% saturation, dimensional drop shadow, and crisp inner specular highlights.
- `.glass-pill`: Pill-shaped glass container (`border-radius: 9999px`) used for segmented navigation bars, connection pills, status badges, and tooltips.
- `.glass-active`: Active luminous glass blob with `var(--glass-tint-active)` and heightened top highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.45)`).
- `.glass-chip`: Compact pill badge for hardware provenance (`OEM sysfs`, `Local`, `IEC 61960`) with solid alpha fill without nested blur.
- `.glass-btn-primary`: Luminous CTA button with cyan/indigo glass gradient and dynamic specular sheen.

### 3.3 Dynamic Hero Health Band Translucent Gradients
The centerpiece EURA hero card combines Liquid Glass refraction on the outer container with translucent state gradients (15%–35% opacity) to float smoothly over the deep ambient backdrop:

| Health Band | SoH Range | CSS Class / Translucent Gradient Token | Visual Meaning |
| :--- | :--- | :--- | :--- |
| **Optimal / Healthy** | $\ge 85.0\%$ | `hero-gradient-healthy`<br/>`linear-gradient(135deg, rgba(20,83,45,0.35), rgba(21,128,61,0.25), rgba(34,197,94,0.18))` | Translucent Emerald; optimal lithium intercalation retention. |
| **Fair Condition** | $70.0\% - 84.9\%$ | `hero-gradient-fair`<br/>`linear-gradient(135deg, rgba(124,45,18,0.35), rgba(194,65,12,0.25), rgba(245,158,11,0.18))` | Translucent Warm Amber; moderate capacity fade observed. |
| **Needs Care** | $< 70.0\%$ | `hero-gradient-poor`<br/>`linear-gradient(135deg, rgba(127,29,29,0.38), rgba(185,28,28,0.28), rgba(239,68,68,0.18))` | Translucent Crimson; elevated impedance. |
| **Standby / Unknown** | `None` / Idle | `hero-gradient-unknown`<br/>`linear-gradient(135deg, rgba(30,41,59,0.30), rgba(51,65,85,0.20), rgba(71,85,105,0.15))` | Translucent Slate; awaiting physical USB connection. |

### 3.4 Accessibility, Contrast & Reduced-Transparency Fallbacks
1. **WCAG AA Compliance:** All primary text (#FFFFFF) and secondary text (#A1A1AA) meet or exceed the 4.5:1 contrast requirement across all glass cards and over dynamic background blooms.
2. **Readability Scrim:** A dedicated ambient scrim layer (`background: rgba(5, 10, 18, 0.45)`) sits between the fluted-glass aurora and UI layer, guaranteeing high contrast even over peak stripe brightness.
3. **Reduced-Transparency Fallback:** Full support for `prefers-reduced-transparency: reduce` and manual `body.no-glass` class. When enabled, all backdrop filters are disabled (`backdrop-filter: none !important`), and surfaces gracefully fall back to solid dark opaque panels (`--card-secondary: #0F1024`).
4. **Tabular Metric Jitter Elimination:** All numbers use monospace tabular figures (`font-mono`, `font-variant-numeric: tabular-nums lining-nums`) to guarantee zero layout shift during live 1Hz polling.

---

## 4. Deep Ambient Atmosphere & Refraction Shader Pipeline

### 4.1 Theme-Matched Fluted-Glass Prism Aurora Background
The background transitions away from saturated rainbow bands to a sophisticated, theme-matched prism aurora that recreates vertical fluted-glass optical refraction:

```mermaid
flowchart LR
    A["Theme-Matched Prism Stripes<br/>--prism-base -> --prism-deep -> --prism-mid -> --prism-light"] --> B["SVG Radial Mask<br/>radial-gradient(ellipse at 100% 0%)"]
    B --> C["Animation Engine<br/>smoothBg 60s Pan (transform: translate3d)"]
    C --> D["mix-blend-mode: screen (opacity: 0.65)"]
    
    E["SVG Filter: #fluted"] --> F["feImage: Neutral Grayscale Gradient Vector"]
    F --> G["feTile: Tiled Column Pattern (width .03)"]
    G --> H["feGaussianBlur: stdDeviation .0001"]
    H --> I["feDisplacementMap: scale .08 (R & G channels)"]
    
    D & I --> J["Fluted-Glass Prism Aurora Surface<br/>(Rendered behind dark readability scrim)"]
```

### 4.2 Optical Shader Architecture & Neutral Grayscale Displacement Map
```html
<svg class="hidden-svg-filter" width="0" height="0">
  <filter id="fluted" primitiveUnits="objectBoundingBox">
    <feImage xlink:href="data:image/svg+xml;utf8,<svg ...><linearGradient id='g'><stop offset='0%' stop-color='%23000000'/><stop offset='50%' stop-color='%23ffffff'/><stop offset='100%' stop-color='%23000000'/></linearGradient><rect width='100%' height='100%' fill='url(%23g)'/></svg>" width=".03" height="1" preserveAspectRatio="none meet"/>
    <feTile result="tile_0" />
    <feGaussianBlur stdDeviation=".0001" in="tile_0" result="bar_smoothness" />
    <feDisplacementMap scale=".08" xChannelSelector="R" yChannelSelector="G" in="SourceGraphic" in2="bar_smoothness" />
  </filter>
</svg>
```
Key architectural properties:
- **Neutral Grayscale Map:** The embedded vector displacement map uses neutral grays (`#000000` $\rightarrow$ `#ffffff` $\rightarrow$ `#000000`), ensuring that optical refraction introduces zero unwanted color casts.
- **Theme-Matched Color System:** Stripes are built exclusively from `--prism-*` tokens mapped to the app's ambient blue/teal palette. No hardcoded hex colors exist in CSS; changing theme tokens automatically updates the aurora.
- **Color Inversion Prevention:** `mix-blend-mode: screen` (with `opacity: 0.65`) prevents inversion artifacts (such as browns or oranges) inherent to `mix-blend-mode: difference`, maintaining crisp oceanic hues across the 60s cycle.
- **Optical Scrim Protection:** `<div class="aurora-scrim"></div>` (`rgba(5, 10, 18, 0.45)`) sits immediately on top of the fluted aurora, dampening background luminance so that glass cards remain the focal luminous elements.

### 4.3 Performance, Pacing & Scroll Throttling
1. **Compositor-Only Transformation:**
   ```css
   @keyframes smoothBg {
     0% { transform: translate3d(0, 0, 0); }
     100% { transform: translate3d(-50%, 0, 0); }
   }
   ```
   Animates strictly via GPU-accelerated `translate3d`, avoiding CPU repaints and `background-position` layout invalidations.
2. **Active Scroll Pausing:** During user scroll gestures, `.aurora-paused` is dynamically applied via `app.js` scroll listeners, freezing animation execution and resuming 150 ms after scrolling ends.
3. **Window Blur & Minimize Throttling:** Aurora playback automatically halts when the window loses focus or is minimized, dropping background GPU utilization to 0%.
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

## 6. Core Dashboard Components & Subsystems (Liquid Glass Architecture)

### 6.1 Hero Centerpiece Card (Liquid Glass Bio-Age Paradigm)
The hero card ([`frontend/index.html`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/index.html#L204-L350)) translates electrochemical health into an immediate visual verdict floating on a translucent, refractive glass surface:

```mermaid
flowchart TD
    subgraph Hero_Architecture ["Liquid Glass Unified Hero Anatomy"]
        OUTER["Outer Glass Surface (.cinematic-backdrop)<br/>border-radius: 32px | blur(16px) | padding: clamp(1.25rem, 2.5vw, 2rem)"]
        LEFT["Left Column: Eyebrow | Headline | Subtext | Health Band Legend | Connection Assistant Glass Pill"]
        INSET["Right Column: Inset Glass Panel (#hero-card)<br/>border-radius: 24px | backdrop-filter: none (No Nested Blur)"]
        
        TOP["Top Row: Battery Health Label | OEM SoH Badge (.glass-chip) | Exactly ONE Status Pill (.glass-pill)"]
        NUM["Center: Baseline-Aligned Tabular Number (.hero-number-wrap)<br/>.hero-number-val (clamp 4.25-6.25rem, min-width: 2.2ch) + .hero-number-unit (%)"]
        DIAL["Refractive Glass Dial Track (#hero-health-dial, role='meter')<br/>0% Poor · 50% · 70% Fair · 85% Good · 100% Factory"]
        PIN["Hidden-on-Null Marker Pin (.range-dial-pin.hidden)"]
        BOTTOM["Bottom Row: Diagnostic Heading | Subtext | Method Badge (hidden in standby)"]
        
        OUTER --> LEFT & INSET
        INSET --> TOP --> NUM --> DIAL --> PIN --> BOTTOM
    end
```

#### Visual Styling & Structural Specifications:
1. **Unified Outer Glass Surface & Zero Nested Blur:**
   - The entire hero zone is enclosed by a single outer glass container (`.cinematic-backdrop`) featuring `border-radius: 32px`, `backdrop-filter: blur(16px)`, and responsive `padding: clamp(1.25rem, 2.5vw, 2rem)`.
   - The inner `#hero-card` is rendered as an inset content panel (`border-radius: 24px`, `padding: clamp(1.25rem, 2vw, 1.75rem)`). To eliminate GPU fill-rate compounding, `#hero-card` enforces `backdrop-filter: none !important;` and `-webkit-backdrop-filter: none !important;`.
2. **Vertical Footprint Compaction ($\le 520\text{px}$):**
   - Padding, gaps, and typography scale via CSS `clamp()`, keeping the entire hero block strictly $\le 520\text{px}$ tall at standard desktop resolutions ($1380\times 880$). This guarantees that the "Health Report" section header below remains immediately visible above the fold without requiring initial user scroll.
3. **Baseline-Aligned Tabular Hero Number & Jitter Elimination:**
   - Both the numerical value and percentage sign share a single common baseline container (`.hero-number-wrap` with `display: inline-flex; align-items: baseline;`).
   - `.hero-number-val` enforces monospace tabular figures (`font-variant-numeric: tabular-nums lining-nums; font-family: ui-monospace, ...`) with a fixed `min-width: 2.2ch; text-align: right;`. This guarantees zero horizontal or vertical layout reflow when transitioning between `-- %`, single-digit, double-digit, and three-digit values (`9%`, `88%`, `100%`).
   - Sizing: `font-size: clamp(4.25rem, 6.8vw, 6.25rem)` for the number and `clamp(1.75rem, 2.7vw, 2.4rem)` for `.hero-number-unit`.
4. **Zero-Hallucination Dial Knob Invariant (Hidden on Null):**
   - In standby, idle, offline, unauthorized, or insufficient data states (`health_pct` is null/undefined):
     - The marker pin (`#range-dial-marker`) is completely hidden via `.range-dial-pin.hidden { display: none !important; }` and `aria-hidden="true"`.
     - Dial track fill remains empty; scale labels remain visible.
     - Accessible attributes: `aria-valuenow` is removed, and `aria-valuetext="Health unavailable"` is announced.
   - When real numeric health is received:
     - The marker pin is unhidden (`classList.remove('hidden')`).
     - Display health is clamped to $[0.0, 100.0]$.
     - Dial position is clamped to $[2, 98]\%$ for clean pin margin within the track.
     - `aria-valuenow` is set to the rounded integer, and `aria-valuetext` is set to `<val>%`.
   - Codebase Zero-Hallucination Audit: All legacy `: 100` and `|| 83` fallbacks for health values were audited and eliminated.
5. **Standby State & Connection Guide Polish:**
   - Exactly ONE status pill appears inside `#hero-card` during standby (`Awaiting Device`). The secondary `#hero-method-badge` is hidden (`classList.add('hidden')`) to eliminate redundant labeling.
   - The standby connection assistant toggle is styled as a prominent glass pill (`#toggle-connection-guide-btn`) with `text-cyan-200` ($\ge 4.5:1$ AA contrast), `aria-expanded="false"`, and `aria-controls="connection-guide-steps"`.

### 6.2 Heart Report: Capacity Retention Curve (Chart.js)
Rendered into `#heart-report-chart` using the local [`frontend/static/js/chart.min.js`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/static/js/chart.min.js) bundle inside a `.glass` card:

```mermaid
flowchart LR
    A["Raw SQLite Time-Series"] --> B["Dual-Axis Dataset Mapper"]
    B --> C["Primary Y-Axis (yHealth):<br/>Solid White Spline (#FFFFFF)<br/>Gradient Area Drop (0.15 to 0.0)"]
    B --> D["Secondary Y-Axis (yTemp):<br/>Dashed Indigo Curve (#818CF8)<br/>3px on / 3px off dash"]
    
    C & D --> E["Interactive Canvas Rendering<br/>Tension: 0.0 (Strict Truthfulness)<br/>Liquid Glass Grid Lines (rgba(255,255,255,0.06))"]
```

#### Visual Styling Specifications:
- **Tension Zero (`tension: 0.0`):** Spline curves are strictly linear point-to-point. Bezier curve smoothing is strictly forbidden.
- **Subtle Glass Grid Lines:** Both X-axis and primary Y-axis use faint `rgba(255, 255, 255, 0.06)` grid rules that complement translucent glass cards without visual clutter.
- **Segmented Glass Bars (`.segmented-glass-bar`):** Both dataset metric toggles (`#chart-metric-toggles`) and timeline filters (`#time-filter-container`) share identical 34px pill heights with active luminous glass blob states (`.active`).

### 6.3 Chemical Capacity & Data Provenance Card
Surfaces physical battery capacity with rigorous data lineage:
- **Max Chemically Chargeable Capacity ($C_{\text{full}}$):** The current maximum capacity achievable by the fuel gauge.
- **Design Capacity Ceiling ($C_{\text{design}}$):** Factory nominal rating.
- **Provenance Badges (`.glass-chip`):**
  - `Local USB` (`.glass-chip-success`): Read directly from kernel sysfs.
  - `AI Consensus` (`.glass-chip-cyan`): Resolved via multi-model LLM majority vote.
  - `Apple Standard SoH` (`.glass-chip`): Synthesized via IEC 61960 polynomial calibration.
- **Capacity Retention & Fade Delta Panels:** Housed in frosted glass sub-panels (`p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-sm`).

### 6.4 Longevity Forecasting & 80% Charge Cap Simulator
Implemented in [`frontend/index.html`](file:///c:/Users/raghu/OneDrive/Documents/ChatGPT/Battery%20analyser/frontend/index.html#L474-L558):
- **Months Remaining Countdown:** Bold monospace countdown to the 80.0% retention threshold.
- **Trilinear Gradient Progress Bar:** `bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500` inside a frosted glass trough.
- **Interactive 80% Charge Cap Simulator:**
  - Liquid glass toggle switch (`#sim-cap-toggle`) with luminous pearl knob (`#sim-cap-knob`).
  - Reveals a side-by-side comparison grid comparing the **Normal Habit** glass panel vs. the **80% Capped** cyan glass panel.
  - Quantifies extended battery lifespan (e.g., *"+1.8 years extended lifespan"*).

### 6.5 Active Coulomb Counting Wizard
Provides hardware verification when OEM registers are static or suspected of gas-gauge drift:
- **Real-Time Ammeter Glass Panels:**
  - Charging Current ($I$ in $\text{mA}$): Live ammeter readings sampled at 600ms intervals.
  - Accumulated Charge ($Q$ in $\text{mAh}$): Riemann sum numerical integration ($Q = \int I\, dt$).
- **Lifecycle Controls:**
  - `#cal-start-btn`: Primary glass pill CTA (`.glass-btn-primary rounded-full`) with specular sheen.
  - `#cal-sim-btn`: Frosted interactive glass pill (`.glass-interactive rounded-full`).
  - `#cal-stop-btn`: Translucent rose glass pill (`.glass-pill border-rose-500/40 bg-rose-500/15`).
- **Extrapolated Verdict Box:** Translucent cyan glass panel (`bg-cyan-950/30 border-cyan-500/30 backdrop-blur-sm`).

### 6.6 App Battery Drain Attribution Subsystem
Surfaces granular per-application power usage extracted via Android checkin dumps:
- **Window Filters:** `.segmented-glass-bar` holding `24H`, `7D`, and `All` glass pills.
- **Sort Selectors:** `.segmented-glass-bar` holding `Wakelock`, `Bg CPU`, and `Est. Power` glass pills with active blue glass highlights.
- **Thermal Correlation Banner:** Glass alert container (`glass bg-amber-500/10 border-amber-500/30 text-amber-200`).
- **Zero-Hallucination Labeling:** Secondary estimated mAh figures are tagged with provenance notes clarifying derivation from OEM `power_profile.xml`.

### 6.7 Pure Mathematical Model Breakdown & Audit Strip
A 6-card audit strip composed of frosted glass panels (`p-3 rounded-2xl bg-white/[0.03] border-white/[0.08]`):
1. `Capacity Fade (%)`: Raw chemical capacity reduction.
2. `Cycle Fatigue (%)`: Intercalation wear ($\alpha \cdot n^\beta$).
3. `Calendar Aging (%)`: SEI layer growth ($\gamma \cdot \sqrt{t}$).
4. `Stress Factor`: Combined thermal Arrhenius and high-voltage multiplier ($S_T \cdot S_V$).
5. `Final Health (%)`: Calibrated State of Health.
6. `Data Sources`: Visual chips (`.glass-chip`) for Fuel Gauge, Design, and Cycle data provenance.

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
