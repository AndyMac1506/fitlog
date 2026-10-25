# FitLog — Daily Fitness & Health Tracker

A polished, mobile-first Progressive Web App for daily logging on iPhone (Safari → Add to Home Screen). Works offline after the first load. All data stays in the browser’s `localStorage`, with JSON export/import for backups.

## Open on iPhone

### Option A — Local network (same Wi‑Fi as this machine)

1. Start the static server (from this folder):

   ```bash
   cd /workspace/fitness-tracker
   python3 -m http.server 8787
   ```

2. On your iPhone, open Safari and go to `http://<this-machine-ip>:8787`
3. Tap the Share button → **Add to Home Screen** → Add
4. Launch **FitLog** from your home screen (standalone, full-screen)

> Note: iOS may warn about non‑HTTPS sites. For a proper “installable” PWA over the internet, host this folder on HTTPS (e.g. Netlify, Cloudflare Pages, GitHub Pages, or a tunnel). The app itself is complete; hosting is the remaining step for remote Add‑to‑Home‑Screen.

### Option B — Standalone file (AirDrop / Files)

Open `fitness-tracker-standalone.html` in Safari. Everything is self‑contained (no service worker / offline shell). Still saves to `localStorage` on that browser.

## Features

- One log entry per calendar day
- Bodyweight (lbs) + weigh-in time
- Water (oz) with quick +8/+16 buttons and optional goal progress
- Sleep: bedtime, wake, auto duration (manual override), quality 1–10
- Steps (optional goal progress), cardio minutes
- Supplements: Morning / Noon / Night (Yes / No / N/A)
- Training: Yes / No / Rest
- Desire to train, energy in gym, energy outside gym, adherence (all 1–10)
- Resting HR, blood pressure (sys/dia), off-plan meal count
- Daily notes
- Sticky date nav, prev/next day, swipe between days
- Debounced auto-save with “Saved” indicator
- History calendar + recent list with fill %
- Settings: water & steps goals
- Export / import JSON (merge or replace)
- Dark-mode-friendly UI (follows system preference)
- PWA: manifest, theme color, Apple web-app meta, icons, service worker

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

- Logs: `fitlog:v1`
- Settings: `fitlog:settings:v1`
