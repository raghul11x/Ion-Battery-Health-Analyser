# Ion+ Performance Report: Baseline

- **Recorded At:** 2026-10-01T11:56:15.886Z
- **Display Detected Hz:** 60 Hz
- **Target Frame Interval:** 16.67 ms
- **Frame Budget:** 10 ms
- **GPU Hardware Acceleration:** ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11)

## 10-Second Continuous Scroll Matrix

| View | State | Avg FPS | Target Hz | Worst Frame (ms) | Hitch Frames (>1.5x) | Frames in 1.2x % | Long Tasks (>50ms) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dashboard** | Idle | 35.2 FPS | 60 Hz | 100 ms | 254 | 2.5% | 0 (max 680ms) |
| **Trends** | Idle | 32.3 FPS | 60 Hz | 41.8 ms | 320 | 0.3% | 0 (max 680ms) |
| **Habits** | Idle | 42.6 FPS | 60 Hz | 37.6 ms | 137 | 3.3% | 0 (max 680ms) |
| **Diagnostics** | Idle | 51 FPS | 60 Hz | 24.9 ms | 0 | 29.9% | 0 (max 680ms) |
| **Dashboard** | Connected | 33 FPS | 60 Hz | 54.2 ms | 293 | 1.5% | 0 (max 680ms) |
| **Trends** | Connected | 44.3 FPS | 60 Hz | 75 ms | 47 | 1.8% | 0 (max 680ms) |
| **Habits** | Connected | 36.5 FPS | 60 Hz | 41.7 ms | 283 | 0.5% | 0 (max 680ms) |
| **Diagnostics** | Connected | 40.6 FPS | 60 Hz | 33.1 ms | 201 | 10.3% | 0 (max 680ms) |

## Observations & Known Scroll Bottlenecks
1. **Backdrop Filter Cascades**: Active blur filters on every card and inner pills compounding fill rate.
2. **SVG Fluted Glass Shader**: Live `feDisplacementMap` calculating during scroll passes.
3. **Non-Composited Animated Transitions**: Left and width transitions triggering layout passes.
4. **Off-Screen Work**: Full DOM rendering of uncontained cards below the fold.
5. **History Table**: Non-virtualized rows leading to increased layout/paint cost when seeded.
