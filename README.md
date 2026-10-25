# FitLog — Daily Fitness & Health Tracker

A polished, mobile-first Progressive Web App for daily logging on iPhone (Safari → Add to Home Screen). Works offline after the first load. Daily logs stay in the browser’s `localStorage`; **progress photos** use **IndexedDB**. JSON export/import covers logs (not photo blobs).

**Live:** https://andymac1506.github.io/fitlog/

## Open on iPhone

### Option A — GitHub Pages (recommended)

1. Open https://andymac1506.github.io/fitlog/ in Safari  
2. Share → **Add to Home Screen** → Add  
3. Launch **FitLog** from your home screen  

Hard-refresh or reopen the Home Screen app after updates so the new service worker cache loads.

### Option B — Local network (same Wi‑Fi as this machine)

```bash
cd /workspace/fitness-tracker
python3 -m http.server 8787
```

Then open `http://<this-machine-ip>:8787` in Safari → Add to Home Screen.

### Option C — Standalone file (AirDrop / Files)

Open `fitness-tracker-standalone.html` in Safari for daily logging. **Progress photos are intended for the hosted multi-file PWA** (IndexedDB + camera capture are more reliable over HTTPS). The standalone file may omit or degrade photo features; prefer GitHub Pages for Front / Side / Rear photos.

## Features

- One log entry per calendar day
- Bodyweight (lbs) + weigh-in time
- Water (oz) with quick +8/+16 buttons and optional goal progress
- Sleep: bedtime, wake, auto duration (manual override), quality 1–10
- Steps (optional goal progress), cardio minutes
- Nutrition: protein / carbs / fat (g), live calories (4P+4C+9F), progress vs that day’s macro targets
- Supplements: Morning / Noon / Night (Yes / No / N/A)
- Training: Yes / No / Rest
- Desire to train, energy in gym, energy outside gym, adherence (all 1–10)
- Resting HR, blood pressure (sys/dia), off-plan meal count
- Daily notes
- Sticky date nav, prev/next day, swipe between days
- Debounced auto-save with “Saved” indicator
- History calendar + recent list with fill %
- **Score** screen: 7-day & 30-day consistency, habit hit rate, blend score, and logging streak
- **Progress photos**: weekly Front / Side / Rear (IndexedDB, compressed JPEGs), date list, side-by-side compare with presets, opacity overlay, and “Prepare for bot review” zip pack
- Settings: water & steps goals; macro targets (historical per-day snapshots)
- Export / import JSON (merge or replace) for daily logs
- Dark-mode-friendly UI (follows system preference)
- PWA: manifest, theme color, Apple web-app meta, icons, service worker


## Nutrition & macro targets

Daily **protein / carbs / fat** (grams) live on the main log. **Calories** are calculated as `4×protein + 4×carbs + 9×fat` and update as you type. If all three macros are empty, calories show as — (not 0).

Macro **targets** are set under Settings → Macro targets (with derived target calories). Important:

| Layer | What it stores |
|--------|----------------|
| **Settings** (`fitlog:settings:v1`) | Current defaults: `proteinGoal`, `carbsGoal`, `fatGoal` (plus water/steps goals) |
| **Each daily log** | Snapshot fields `targetProtein`, `targetCarbs`, `targetFat`, `targetCalories` |

- Opening/saving a day that has **no** snapshot yet copies the **current** settings targets onto that day once; they then stick.
- Changing Settings updates the defaults **and today’s snapshot only** — past days are never rewritten.
- **Apply current targets to today** refreshes today’s snapshot from Settings (still never all history).
- When browsing a past day, progress bars use **that day’s** stored targets, not live Settings.

Intake + day targets are included in JSON export/import.

## Progress photos

Open the camera icon in the header.

| Piece | Detail |
|--------|--------|
| **Angles** | Front, Side, Rear per photo day |
| **Storage** | IndexedDB (`fitlog-photos`), not localStorage. Full image max edge ~1600px JPEG @ 0.82; thumbnails ~320px |
| **Capture** | Camera or file picker (iPhone-friendly) |
| **Compare** | Date A vs Date B, stacked/side-by-side per angle |
| **Presets** | Last week (−7d), this time last month (−1 calendar month), since month start (1st of Date A’s month), since year start (Jan 1), previous photo day. Missing dates snap to the nearest earlier day with photos |
| **Overlay** | Optional opacity slider for the same angle |
| **Bot review** | Downloads a zip of Date A + Date B angles plus `README.txt` — attach in App Builder chat for a summary. No backend upload |

## Scoring

Open the star icon in the header for the Score screen.

| Metric | Formula |
|--------|---------|
| **Logged day** | Any non-empty field on that day’s log (metrics, supplements, notes, etc.) |
| **Consistency** | `(logged days) / (days in window)` for Last 7 or Last 30 days ending today |
| **Habit checks** (per logged day) | Supplements Morning/Noon/Night: pass if Yes or N/A, fail if No or blank. Training: pass if Yes/No/Rest. Adherence: pass if 1–10 set. Water/Steps goals: only if set in Settings; pass when met |
| **Habit hit rate** | `(passed checks) / (applicable checks)` across logged days in the window. Shows “—” if no applicable checks |
| **Blend (0–100)** | `round(0.4 × consistency% + 0.6 × habitHit%)`. If habit hit is unavailable, blend = consistency only |
| **Logging streak** | Consecutive logged days ending today, or yesterday if today is still empty |

## Project layout

```
fitness-tracker/
  index.html
  manifest.webmanifest
  sw.js
  README.md
  fitness-tracker-standalone.html
  assets/
    app.js
    photos.js
    styles.css
    icon.svg
    icon-180.png
    icon-192.png
    icon-512.png
```

## Units & defaults

- Bodyweight: **lbs**
- Water: **oz**
- Sleep duration: hours (auto from bedtime → wake, including overnight)
- Scales: 1–10 (tap again to clear)
- Empty fields are fine; nothing is required each day

## Data keys

- Logs: `fitlog:v1` (localStorage)
- Settings: `fitlog:settings:v1` (localStorage)
- Progress photos: IndexedDB database `fitlog-photos` / store `photos`
