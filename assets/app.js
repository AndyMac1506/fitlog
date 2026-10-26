(function () {
  'use strict';

  const STORAGE_KEY = 'fitlog:v1';
  const SETTINGS_KEY = 'fitlog:settings:v1';

  const FIELD_KEYS = [
    'bodyweight', 'weighInTime', 'bmTiming', 'waist', 'water', 'bedtime', 'wakeTime',
    'sleepDuration', 'sleepDurationManual', 'sleepScore', 'sleepQuality', 'steps', 'cardio',
    'protein', 'carbs', 'fat',
    'supplementsMorning', 'supplementsNoon', 'supplementsNight',
    'training', 'desireToTrain', 'energyInGym', 'energyOutsideGym',
    'adherence', 'restingHR', 'bpSystolic', 'bpDiastolic', 'offPlanMeals', 'notes'
  ];

  const TARGET_KEYS = ['targetProtein', 'targetCarbs', 'targetFat', 'targetCalories'];

  /** @type {{ logs: Record<string, object>, version: number }} */
  let store = { version: 1, logs: {} };
  /** @type {{ waterGoal: number|null, stepsGoal: number|null, proteinGoal: number|null, carbsGoal: number|null, fatGoal: number|null }} */
  let settings = { waterGoal: null, stepsGoal: null, proteinGoal: null, carbsGoal: null, fatGoal: null };

  /** Day-level macro target snapshot for the currently viewed date */
  let currentDayTargets = { targetProtein: '', targetCarbs: '', targetFat: '', targetCalories: '' };

  let currentDate = todayKey();
  let calMonth = new Date();
  let saveTimer = null;
  let durationManual = false;
  let touchStartX = 0;
  let touchStartY = 0;
  /** @type {'7'|'30'|'90'|'all'} */
  let chartRange = '30';

  // --- Date helpers ---
  function todayKey() {
    return formatDateKey(new Date());
  }

  function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function shiftDate(key, days) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + days);
    return formatDateKey(d);
  }

  function formatDisplayDate(key) {
    const d = parseDateKey(key);
    const today = todayKey();
    const yesterday = shiftDate(today, -1);
    const tomorrow = shiftDate(today, 1);
    const long = d.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    if (key === today) return { label: 'Today', sub: long };
    if (key === yesterday) return { label: 'Yesterday', sub: long };
    if (key === tomorrow) return { label: 'Tomorrow', sub: long };
    return {
      label: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      sub: String(d.getFullYear())
    };
  }

  // --- Persistence ---
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          store = { version: 1, logs: parsed.logs || parsed || {} };
          if (!parsed.logs && typeof parsed === 'object') {
            // migrate flat accidental shape
            const maybeLogs = {};
            for (const k of Object.keys(parsed)) {
              if (/^\d{4}-\d{2}-\d{2}$/.test(k)) maybeLogs[k] = parsed[k];
            }
            if (Object.keys(maybeLogs).length) store.logs = maybeLogs;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load store', e);
    }
  }

  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        settings = {
          waterGoal: p.waterGoal != null && p.waterGoal !== '' ? Number(p.waterGoal) : null,
          stepsGoal: p.stepsGoal != null && p.stepsGoal !== '' ? Number(p.stepsGoal) : null,
          proteinGoal: p.proteinGoal != null && p.proteinGoal !== '' ? Number(p.proteinGoal) : null,
          carbsGoal: p.carbsGoal != null && p.carbsGoal !== '' ? Number(p.carbsGoal) : null,
          fatGoal: p.fatGoal != null && p.fatGoal !== '' ? Number(p.fatGoal) : null
        };
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function emptyLog() {
    return {
      bodyweight: '',
      weighInTime: '',
      bmTiming: '',
      waist: '',
      water: '',
      bedtime: '',
      wakeTime: '',
      sleepDuration: '',
      sleepDurationManual: false,
      sleepScore: '',
      sleepQuality: '',
      steps: '',
      cardio: '',
      protein: '',
      carbs: '',
      fat: '',
      targetProtein: '',
      targetCarbs: '',
      targetFat: '',
      targetCalories: '',
      supplementsMorning: '',
      supplementsNoon: '',
      supplementsNight: '',
      training: '',
      desireToTrain: '',
      energyInGym: '',
      energyOutsideGym: '',
      adherence: '',
      restingHR: '',
      bpSystolic: '',
      bpDiastolic: '',
      offPlanMeals: '',
      notes: '',
      updatedAt: null
    };
  }

  function calcCalories(protein, carbs, fat) {
    const hasP = protein !== '' && protein != null;
    const hasC = carbs !== '' && carbs != null;
    const hasF = fat !== '' && fat != null;
    if (!hasP && !hasC && !hasF) return null;
    const p = hasP ? Number(protein) : 0;
    const c = hasC ? Number(carbs) : 0;
    const f = hasF ? Number(fat) : 0;
    if ([p, c, f].some((n) => Number.isNaN(n))) return null;
    return Math.round(4 * p + 4 * c + 9 * f);
  }

  function snapshotTargetsFromSettings() {
    const tp = settings.proteinGoal;
    const tc = settings.carbsGoal;
    const tf = settings.fatGoal;
    const cal = calcCalories(
      tp != null ? tp : '',
      tc != null ? tc : '',
      tf != null ? tf : ''
    );
    return {
      targetProtein: tp != null ? tp : '',
      targetCarbs: tc != null ? tc : '',
      targetFat: tf != null ? tf : '',
      targetCalories: cal == null ? '' : cal
    };
  }

  function storedHasTargetSnapshot(dateKey) {
    const stored = store.logs[dateKey];
    if (!stored || typeof stored !== 'object') return false;
    return TARGET_KEYS.some((k) => Object.prototype.hasOwnProperty.call(stored, k));
  }

  function resolveTargetsForDay(dateKey) {
    if (storedHasTargetSnapshot(dateKey)) {
      const stored = store.logs[dateKey];
      const tp = stored.targetProtein != null ? stored.targetProtein : '';
      const tc = stored.targetCarbs != null ? stored.targetCarbs : '';
      const tf = stored.targetFat != null ? stored.targetFat : '';
      let tcal = stored.targetCalories;
      if (tcal === undefined || tcal === null || tcal === '') {
        const calc = calcCalories(tp, tc, tf);
        tcal = calc == null ? '' : calc;
      }
      return {
        targetProtein: tp,
        targetCarbs: tc,
        targetFat: tf,
        targetCalories: tcal
      };
    }
    return snapshotTargetsFromSettings();
  }


  function getLog(dateKey) {
    return Object.assign(emptyLog(), store.logs[dateKey] || {});
  }

  function isLogEmpty(log) {
    return FIELD_KEYS.every((k) => {
      if (k === 'sleepDurationManual') return true;
      const v = log[k];
      return v === '' || v == null || v === false;
    });
  }

  function fillScore(log) {
    const tracked = [
      'bodyweight', 'waist', 'water', 'bedtime', 'wakeTime', 'sleepScore',
      'steps', 'cardio', 'protein', 'carbs', 'fat',
      'supplementsMorning', 'supplementsNoon', 'supplementsNight',
      'training', 'desireToTrain', 'energyInGym',
      'energyOutsideGym', 'adherence', 'restingHR', 'bpSystolic', 'notes'
    ];
    let filled = 0;
    for (const k of tracked) {
      const v = log[k];
      if (v !== '' && v != null) filled++;
    }
    return Math.round((filled / tracked.length) * 100);
  }


  // --- Consistency / habit / blend scoring ---
  function isDayLogged(dateKey) {
    const log = store.logs[dateKey];
    return !!(log && !isLogEmpty(log));
  }

  /**
   * Habit checks for one logged day.
   * Returns { passed, applicable } counts. N/A supplements pass; empty fails.
   * Water/steps only applicable when a goal is set in settings.
   */
  function habitChecksForLog(log) {
    let passed = 0;
    let applicable = 0;

    function checkSupp(val) {
      applicable++;
      if (val === 'yes' || val === 'na') passed++;
      // 'no' or empty = fail
    }
    checkSupp(log.supplementsMorning);
    checkSupp(log.supplementsNoon);
    checkSupp(log.supplementsNight);

    // Training: pass if yes/no/rest; fail if empty
    applicable++;
    if (log.training === 'yes' || log.training === 'no' || log.training === 'rest') {
      passed++;
    }

    // Adherence: pass if 1–10 set
    applicable++;
    const adh = Number(log.adherence);
    if (log.adherence !== '' && log.adherence != null && adh >= 1 && adh <= 10) {
      passed++;
    }

    // Water goal (optional)
    if (settings.waterGoal != null && settings.waterGoal > 0) {
      applicable++;
      const water = Number(log.water);
      if (log.water !== '' && log.water != null && water >= settings.waterGoal) {
        passed++;
      }
    }

    // Steps goal (optional)
    if (settings.stepsGoal != null && settings.stepsGoal > 0) {
      applicable++;
      const steps = Number(log.steps);
      if (log.steps !== '' && log.steps != null && steps >= settings.stepsGoal) {
        passed++;
      }
    }

    return { passed, applicable };
  }

  /** Window ending today: last `days` calendar days inclusive of today. */
  function windowDateKeys(days) {
    const today = todayKey();
    const keys = [];
    for (let i = days - 1; i >= 0; i--) {
      keys.push(shiftDate(today, -i));
    }
    return keys;
  }

  function computeWindowStats(days) {
    const keys = windowDateKeys(days);
    let logged = 0;
    let passed = 0;
    let applicable = 0;

    for (const key of keys) {
      if (!isDayLogged(key)) continue;
      logged++;
      const checks = habitChecksForLog(getLog(key));
      passed += checks.passed;
      applicable += checks.applicable;
    }

    const consistencyPct = Math.round((logged / keys.length) * 100);
    const habitAvailable = applicable > 0;
    const habitHitPct = habitAvailable ? Math.round((passed / applicable) * 100) : null;

    let blend;
    let blendMode;
    if (habitAvailable) {
      blend = Math.round(0.4 * consistencyPct + 0.6 * habitHitPct);
      blendMode = 'blend';
    } else {
      blend = consistencyPct;
      blendMode = 'consistency-only';
    }

    return {
      days: keys.length,
      logged,
      passed,
      applicable,
      consistencyPct,
      habitHitPct,
      habitAvailable,
      blend,
      blendMode
    };
  }

  /** Streak: consecutive logged days ending today, or yesterday if today empty. */
  function computeLoggingStreak() {
    const today = todayKey();
    let start = today;
    if (!isDayLogged(today)) {
      const yesterday = shiftDate(today, -1);
      if (!isDayLogged(yesterday)) return 0;
      start = yesterday;
    }
    let streak = 0;
    let key = start;
    while (isDayLogged(key)) {
      streak++;
      key = shiftDate(key, -1);
    }
    return streak;
  }

  function formatPct(n) {
    return n == null ? '—' : `${n}%`;
  }

  function renderScorePanel() {
    const streak = computeLoggingStreak();
    document.getElementById('score-streak').textContent = String(streak);
    const hint = document.getElementById('score-streak-hint');
    if (streak === 0) {
      hint.textContent = 'Log anything today to start a streak';
    } else if (!isDayLogged(todayKey())) {
      hint.textContent = 'Today not logged yet — streak counted through yesterday';
    } else {
      hint.textContent = 'Consecutive days with any log entry';
    }

    [7, 30].forEach((days) => {
      const s = computeWindowStats(days);
      const blendEl = document.getElementById(`score-${days}-blend`);
      const blendLabel = document.getElementById(`score-${days}-blend-label`);
      const consEl = document.getElementById(`score-${days}-consistency`);
      const habitEl = document.getElementById(`score-${days}-habit`);
      const detailEl = document.getElementById(`score-${days}-detail`);

      blendEl.textContent = String(s.blend);
      blendEl.classList.toggle('is-empty', s.logged === 0 && s.blend === 0);
      if (s.blendMode === 'consistency-only') {
        blendLabel.textContent = 'Consistency only (no habit checks yet)';
      } else {
        blendLabel.textContent = 'Blend score (40% consistency + 60% habit)';
      }

      consEl.textContent = formatPct(s.consistencyPct);
      habitEl.textContent = formatPct(s.habitHitPct);

      const habitPart = s.habitAvailable
        ? `${s.passed}/${s.applicable} habit checks passed`
        : 'no habit checks yet';
      detailEl.textContent = `${s.logged} of ${s.days} days logged · ${habitPart}`;
    });
  }

  function openScore() {
    persistCurrent();
    closePanels();
    renderScorePanel();
    document.getElementById('score-panel').hidden = false;
  }


  // --- Waist (Friday morning) ---
  function isFridayKey(dateKey) {
    return parseDateKey(dateKey).getDay() === 5;
  }

  function getLastFridayWaist(beforeKey) {
    // Prefer most recent Friday on or before beforeKey with waist set
    const keys = Object.keys(store.logs)
      .filter((k) => {
        if (!isFridayKey(k)) return false;
        if (beforeKey && k > beforeKey) return false;
        const w = store.logs[k] && store.logs[k].waist;
        return w !== '' && w != null;
      })
      .sort((a, b) => b.localeCompare(a));
    if (!keys.length) return null;
    const key = keys[0];
    return { key, waist: store.logs[key].waist };
  }

  function updateWaistUI(dateKey) {
    const fridayBlock = document.getElementById('waist-friday-block');
    const otherBlock = document.getElementById('waist-other-block');
    const waistInput = document.getElementById('waist');
    if (!fridayBlock || !otherBlock || !waistInput) return;

    if (isFridayKey(dateKey)) {
      fridayBlock.hidden = false;
      otherBlock.hidden = true;
      waistInput.disabled = false;
    } else {
      fridayBlock.hidden = true;
      otherBlock.hidden = false;
      waistInput.disabled = true;
      // Clear visible input so non-Friday days don't accidentally save a typed value;
      // readForm still pulls from store via disabled? No — we keep store waist only on Fridays.
      // Show last Friday waist for context.
      const last = getLastFridayWaist(dateKey);
      const valEl = document.getElementById('last-waist-value');
      const hintEl = document.getElementById('last-waist-hint');
      if (last) {
        valEl.textContent = String(last.waist);
        const d = parseDateKey(last.key);
        hintEl.textContent = `From ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · enter on Fridays only`;
      } else {
        valEl.textContent = '—';
        hintEl.textContent = 'No Friday waist logged yet · enter on Fridays only';
      }
    }
  }

  // --- Charts ---
  function collectSeries(field, opts) {
    opts = opts || {};
    const fridayOnly = !!opts.fridayOnly;
    const points = [];
    const keys = Object.keys(store.logs).sort();
    for (const key of keys) {
      if (fridayOnly && !isFridayKey(key)) continue;
      const log = store.logs[key];
      if (!log) continue;
      const raw = log[field];
      if (raw === '' || raw == null) continue;
      const n = Number(raw);
      if (Number.isNaN(n)) continue;
      points.push({ key, value: n, date: parseDateKey(key) });
    }
    return points;
  }

  function filterSeriesByRange(points, range) {
    if (!points.length) return [];
    if (range === 'all') return points.slice();
    const days = Number(range);
    const end = parseDateKey(todayKey());
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    return points.filter((p) => p.date >= start && p.date <= end);
  }

  function seriesStats(points) {
    if (!points.length) {
      return { latest: null, change: null, low: null, high: null };
    }
    const values = points.map((p) => p.value);
    const latest = points[points.length - 1].value;
    const first = points[0].value;
    const change = Math.round((latest - first) * 10) / 10;
    return {
      latest,
      change,
      low: Math.min(...values),
      high: Math.max(...values)
    };
  }

  function formatSigned(n, digits) {
    if (n == null || Number.isNaN(n)) return '—';
    const fixed = Number(n).toFixed(digits == null ? 1 : digits);
    const num = Number(fixed);
    if (num > 0) return '+' + fixed;
    return fixed;
  }

  function setStat(id, text, extraClass) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('up', 'down');
    if (extraClass) el.classList.add(extraClass);
  }

  function drawLineChart(canvas, points, color) {
    const emptyEl = canvas.parentElement.querySelector('.chart-empty');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 360;
    const cssH = 200;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!points.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const pad = { top: 16, right: 12, bottom: 28, left: 40 };
    const plotW = cssW - pad.left - pad.right;
    const plotH = cssH - pad.top - pad.bottom;

    let minV = Math.min(...points.map((p) => p.value));
    let maxV = Math.max(...points.map((p) => p.value));
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }
    const padV = (maxV - minV) * 0.12;
    minV -= padV;
    maxV += padV;

    const minT = points[0].date.getTime();
    const maxT = points[points.length - 1].date.getTime();
    const spanT = Math.max(maxT - minT, 1);

    function xAt(p) {
      return pad.left + ((p.date.getTime() - minT) / spanT) * plotW;
    }
    function yAt(v) {
      return pad.top + (1 - (v - minV) / (maxV - minV)) * plotH;
    }

    // grid + y labels
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#243041';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || '#5c6b7e';
    ctx.lineWidth = 1;
    ctx.font = '11px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + ((maxV - minV) * i) / ticks;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      const label = (Math.round(v * 10) / 10).toFixed(1);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pad.left - 6, y);
    }

    // x labels: first / mid / last
    const labelIdx = [0];
    if (points.length > 2) labelIdx.push(Math.floor((points.length - 1) / 2));
    if (points.length > 1) labelIdx.push(points.length - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labelIdx.forEach((idx) => {
      const p = points[idx];
      const x = xAt(p);
      const label = p.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      ctx.fillText(label, x, pad.top + plotH + 8);
    });

    // area fill
    const accent = color;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(p);
      const y = yAt(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const last = points[points.length - 1];
    const first = points[0];
    ctx.lineTo(xAt(last), pad.top + plotH);
    ctx.lineTo(xAt(first), pad.top + plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(p);
      const y = yAt(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // points
    points.forEach((p) => {
      const x = xAt(p);
      const y = yAt(p.value);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function renderCharts() {
    const weightAll = collectSeries('bodyweight');
    const waistAll = collectSeries('waist', { fridayOnly: true });
    const sleepAll = collectSeries('sleepDuration');
    const weight = filterSeriesByRange(weightAll, chartRange);
    const waist = filterSeriesByRange(waistAll, chartRange);
    const sleep = filterSeriesByRange(sleepAll, chartRange);

    const wStats = seriesStats(weight);
    setStat('weight-stat-latest', wStats.latest == null ? '—' : Number(wStats.latest).toFixed(1));
    setStat(
      'weight-stat-change',
      formatSigned(wStats.change, 1),
      wStats.change == null ? null : (wStats.change < 0 ? 'down' : wStats.change > 0 ? 'up' : null)
    );
    setStat('weight-stat-low', wStats.low == null ? '—' : Number(wStats.low).toFixed(1));
    setStat('weight-stat-high', wStats.high == null ? '—' : Number(wStats.high).toFixed(1));

    const zStats = seriesStats(waist);
    setStat('waist-stat-latest', zStats.latest == null ? '—' : Number(zStats.latest).toFixed(1));
    setStat(
      'waist-stat-change',
      formatSigned(zStats.change, 1),
      zStats.change == null ? null : (zStats.change < 0 ? 'down' : zStats.change > 0 ? 'up' : null)
    );
    setStat('waist-stat-low', zStats.low == null ? '—' : Number(zStats.low).toFixed(1));
    setStat('waist-stat-high', zStats.high == null ? '—' : Number(zStats.high).toFixed(1));

    const sStats = seriesStats(sleep);
    setStat('sleep-stat-latest', sStats.latest == null ? '—' : Number(sStats.latest).toFixed(2));
    setStat(
      'sleep-stat-change',
      formatSigned(sStats.change, 2),
      sStats.change == null ? null : (sStats.change > 0 ? 'up' : sStats.change < 0 ? 'down' : null)
    );
    setStat('sleep-stat-low', sStats.low == null ? '—' : Number(sStats.low).toFixed(2));
    setStat('sleep-stat-high', sStats.high == null ? '—' : Number(sStats.high).toFixed(2));

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3dd6c6';
    const warn = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#e6c07b';
    const sleepColor = getComputedStyle(document.documentElement).getPropertyValue('--good').trim() || '#7fd99a';
    drawLineChart(document.getElementById('weight-chart'), weight, accent);
    drawLineChart(document.getElementById('waist-chart'), waist, warn);
    const sleepCanvas = document.getElementById('sleep-chart');
    if (sleepCanvas) drawLineChart(sleepCanvas, sleep, sleepColor);

    document.querySelectorAll('[data-chart-range]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.chartRange === chartRange);
    });
  }

  function openCharts() {
    persistCurrent();
    closePanels();
    renderCharts();
    document.getElementById('charts-panel').hidden = false;
  }

  // --- Sleep duration ---
  function calcSleepHours(bedtime, wakeTime) {
    if (!bedtime || !wakeTime) return null;
    const [bh, bm] = bedtime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    let bedMins = bh * 60 + bm;
    let wakeMins = wh * 60 + wm;
    if (wakeMins <= bedMins) wakeMins += 24 * 60;
    const mins = wakeMins - bedMins;
    return Math.round((mins / 60) * 100) / 100;
  }

  // --- UI: scales ---
  function buildScales() {
    document.querySelectorAll('.scale').forEach((scale) => {
      const name = scale.dataset.scale;
      const hidden = scale.querySelector('input[type="hidden"]');
      const btns = scale.querySelector('.scale-btns');
      btns.innerHTML = '';
      for (let i = 1; i <= 10; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(i);
        b.dataset.value = String(i);
        b.setAttribute('aria-label', String(i));
        b.addEventListener('click', () => {
          const cur = hidden.value;
          if (cur === String(i)) {
            hidden.value = '';
          } else {
            hidden.value = String(i);
          }
          syncScaleUI(scale);
          scheduleSave();
        });
        btns.appendChild(b);
      }
      syncScaleUI(scale);
    });
  }

  function syncScaleUI(scale) {
    const hidden = scale.querySelector('input[type="hidden"]');
    const val = hidden.value;
    scale.querySelectorAll('.scale-btns button').forEach((b) => {
      const n = Number(b.dataset.value);
      b.classList.remove('active', 'low', 'mid', 'high');
      if (val !== '' && Number(val) === n) {
        b.classList.add('active');
        if (n <= 3) b.classList.add('low');
        else if (n <= 6) b.classList.add('mid');
        else b.classList.add('high');
      }
    });
  }

  // --- Form load/read ---
  function loadFormForDate(dateKey) {
    const log = getLog(dateKey);
    durationManual = !!log.sleepDurationManual;
    const hadSnapshot = storedHasTargetSnapshot(dateKey);
    currentDayTargets = resolveTargetsForDay(dateKey);
    // Existing logged days without a snapshot: lock current settings onto that day once
    if (!hadSnapshot && store.logs[dateKey] && !isLogEmpty(store.logs[dateKey])) {
      Object.assign(store.logs[dateKey], currentDayTargets);
      saveStore();
    }

    setVal('bodyweight', log.bodyweight);
    setVal('weighInTime', log.weighInTime);
    setVal('bmTiming', log.bmTiming || '');
    syncBmChips();
    setVal('waist', isFridayKey(dateKey) ? log.waist : '');
    setVal('water', log.water);
    setVal('bedtime', log.bedtime);
    setVal('wakeTime', log.wakeTime);
    setVal('sleepDuration', log.sleepDuration);
    setVal('sleepScore', log.sleepScore != null && log.sleepScore !== '' ? log.sleepScore : '');
    setVal('steps', log.steps);
    setVal('cardio', log.cardio);
    setVal('protein', log.protein);
    setVal('carbs', log.carbs);
    setVal('fat', log.fat);
    setVal('desireToTrain', log.desireToTrain);
    setVal('energyInGym', log.energyInGym);
    setVal('energyOutsideGym', log.energyOutsideGym);
    setVal('adherence', log.adherence);
    setVal('restingHR', log.restingHR);
    setVal('bpSystolic', log.bpSystolic);
    setVal('bpDiastolic', log.bpDiastolic);
    setVal('offPlanMeals', log.offPlanMeals);
    setVal('notes', log.notes);

    document.querySelectorAll('input[name="training"]').forEach((r) => {
      r.checked = log.training === r.value;
    });
    ['supplementsMorning', 'supplementsNoon', 'supplementsNight'].forEach((name) => {
      document.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
        r.checked = log[name] === r.value;
      });
    });

    document.querySelectorAll('.scale').forEach(syncScaleUI);
    if (!durationManual) maybeAutoDuration();
    updateDurationHint();
    updateProgressBars();
    updateNutritionUI();
    updateWaistUI(dateKey);
    updateDateNav();
  }

  function syncBmChips() {
    const v = (document.getElementById('bmTiming') || {}).value || '';
    ['pre', 'post'].forEach((k) => {
      const el = document.getElementById('bm-' + k);
      if (el) { el.checked = v === k; el.parentElement.classList.toggle('on', v === k); }
    });
  }

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? '' : value;
  }

  function readForm() {
    const trainingEl = document.querySelector('input[name="training"]:checked');
    // Lock in targets for this day on first save if not already snapshotted
    if (!storedHasTargetSnapshot(currentDate)) {
      currentDayTargets = resolveTargetsForDay(currentDate);
    }
    const existing = store.logs[currentDate] || {};
    const waistValue = isFridayKey(currentDate)
      ? document.getElementById('waist').value
      : (existing.waist != null ? existing.waist : '');
    return {
      bodyweight: document.getElementById('bodyweight').value,
      weighInTime: document.getElementById('weighInTime').value,
      bmTiming: document.getElementById('bmTiming').value,
      waist: waistValue,
      water: document.getElementById('water').value,
      bedtime: document.getElementById('bedtime').value,
      wakeTime: document.getElementById('wakeTime').value,
      sleepDuration: document.getElementById('sleepDuration').value,
      sleepDurationManual: durationManual,
      sleepScore: document.getElementById('sleepScore').value,
      sleepQuality: existing.sleepQuality != null ? existing.sleepQuality : '',
      steps: document.getElementById('steps').value,
      cardio: document.getElementById('cardio').value,
      protein: document.getElementById('protein').value,
      carbs: document.getElementById('carbs').value,
      fat: document.getElementById('fat').value,
      targetProtein: currentDayTargets.targetProtein,
      targetCarbs: currentDayTargets.targetCarbs,
      targetFat: currentDayTargets.targetFat,
      targetCalories: currentDayTargets.targetCalories,
      supplementsMorning: (document.querySelector('input[name="supplementsMorning"]:checked') || {}).value || '',
      supplementsNoon: (document.querySelector('input[name="supplementsNoon"]:checked') || {}).value || '',
      supplementsNight: (document.querySelector('input[name="supplementsNight"]:checked') || {}).value || '',
      training: trainingEl ? trainingEl.value : '',
      desireToTrain: document.getElementById('desireToTrain').value,
      energyInGym: document.getElementById('energyInGym').value,
      energyOutsideGym: document.getElementById('energyOutsideGym').value,
      adherence: document.getElementById('adherence').value,
      restingHR: document.getElementById('restingHR').value,
      bpSystolic: document.getElementById('bpSystolic').value,
      bpDiastolic: document.getElementById('bpDiastolic').value,
      offPlanMeals: document.getElementById('offPlanMeals').value,
      notes: document.getElementById('notes').value,
      updatedAt: new Date().toISOString()
    };
  }

  function scheduleSave() {
    const status = document.getElementById('save-status');
    status.textContent = 'Saving…';
    status.className = 'save-status visible saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistCurrent, 400);
  }

  function persistCurrent() {
    const data = readForm();
    if (isLogEmpty(data)) {
      delete store.logs[currentDate];
    } else {
      store.logs[currentDate] = data;
    }
    saveStore();
    const status = document.getElementById('save-status');
    status.textContent = 'Saved';
    status.className = 'save-status visible saved';
    setTimeout(() => {
      if (status.textContent === 'Saved') status.classList.remove('visible');
    }, 1500);
    updateProgressBars();
  }

  function updateDurationHint() {
    const hint = document.getElementById('duration-hint');
    hint.textContent = durationManual ? '(manual)' : '(auto)';
  }

  function maybeAutoDuration() {
    if (durationManual) return;
    const bed = document.getElementById('bedtime').value;
    const wake = document.getElementById('wakeTime').value;
    const hrs = calcSleepHours(bed, wake);
    if (hrs != null) {
      document.getElementById('sleepDuration').value = String(hrs);
    } else {
      document.getElementById('sleepDuration').value = '';
    }
    updateDurationHint();
  }

  function updateProgressBars() {
    const water = Number(document.getElementById('water').value) || 0;
    const steps = Number(document.getElementById('steps').value) || 0;
    const wWrap = document.getElementById('water-progress');
    const sWrap = document.getElementById('steps-progress');

    if (settings.waterGoal && settings.waterGoal > 0) {
      wWrap.hidden = false;
      const pct = Math.min(100, Math.round((water / settings.waterGoal) * 100));
      const fill = document.getElementById('water-fill');
      fill.style.width = pct + '%';
      fill.classList.toggle('over', water >= settings.waterGoal);
      document.getElementById('water-progress-text').textContent =
        `${water || 0} / ${settings.waterGoal} oz`;
    } else {
      wWrap.hidden = true;
    }

    if (settings.stepsGoal && settings.stepsGoal > 0) {
      sWrap.hidden = false;
      const pct = Math.min(100, Math.round((steps / settings.stepsGoal) * 100));
      const fill = document.getElementById('steps-fill');
      fill.style.width = pct + '%';
      fill.classList.toggle('over', steps >= settings.stepsGoal);
      document.getElementById('steps-progress-text').textContent =
        `${formatNum(steps)} / ${formatNum(settings.stepsGoal)}`;
    } else {
      sWrap.hidden = true;
    }
  }

  function setMacroProgress(kind, actualRaw, targetRaw, unit) {
    const wrap = document.getElementById(kind + '-progress');
    if (!wrap) return;
    const targetNum = targetRaw === '' || targetRaw == null ? null : Number(targetRaw);
    if (targetNum == null || Number.isNaN(targetNum) || targetNum <= 0) {
      wrap.hidden = true;
      return;
    }
    const actualEmpty = actualRaw === '' || actualRaw == null;
    const actual = actualEmpty ? 0 : Number(actualRaw);
    if (Number.isNaN(actual)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const pct = Math.min(100, Math.round((actual / targetNum) * 100));
    const fill = document.getElementById(kind + '-fill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over', actual >= targetNum);
    const shown = actualEmpty ? 0 : actual;
    document.getElementById(kind + '-progress-text').textContent =
      `${shown} / ${targetNum}${unit ? ' ' + unit : ''}`;
  }

  function updateNutritionUI() {
    const proteinEl = document.getElementById('protein');
    const carbsEl = document.getElementById('carbs');
    const fatEl = document.getElementById('fat');
    if (!proteinEl) return;

    const p = proteinEl.value;
    const c = carbsEl.value;
    const f = fatEl.value;
    const cal = calcCalories(p, c, f);
    const calVal = document.getElementById('calories-value');
    calVal.textContent = cal == null ? '—' : String(cal);

    const tp = currentDayTargets.targetProtein;
    const tc = currentDayTargets.targetCarbs;
    const tf = currentDayTargets.targetFat;
    let tcal = currentDayTargets.targetCalories;
    if (tcal === '' || tcal == null) {
      const derived = calcCalories(tp, tc, tf);
      tcal = derived == null ? '' : derived;
    }

    setMacroProgress('protein', p, tp, 'g');
    setMacroProgress('carbs', c, tc, 'g');
    setMacroProgress('fat', f, tf, 'g');
    setMacroProgress('calories', cal == null ? '' : cal, tcal, 'kcal');

    const hint = document.getElementById('nutrition-targets-hint');
    const hasAnyTarget = [tp, tc, tf].some((v) => v !== '' && v != null);
    if (!hasAnyTarget) {
      hint.textContent = 'Set macro targets in Settings to see daily progress bars. Targets lock to each day when you first log it.';
    } else {
      const bits = [];
      if (tp !== '' && tp != null) bits.push(`P ${tp}g`);
      if (tc !== '' && tc != null) bits.push(`C ${tc}g`);
      if (tf !== '' && tf != null) bits.push(`F ${tf}g`);
      if (tcal !== '' && tcal != null) bits.push(`${tcal} kcal`);
      hint.textContent = `This day’s targets: ${bits.join(' · ')}`;
    }

    const calTargetText = document.getElementById('calories-target-text');
    if (tcal !== '' && tcal != null) {
      calTargetText.hidden = false;
      calTargetText.textContent = cal == null ? `target ${tcal}` : `/ ${tcal}`;
    } else {
      calTargetText.hidden = true;
    }
  }

  function updateSettingsMacroCaloriesPreview() {
    const p = document.getElementById('setting-protein-goal').value;
    const c = document.getElementById('setting-carbs-goal').value;
    const f = document.getElementById('setting-fat-goal').value;
    const cal = calcCalories(p, c, f);
    const el = document.getElementById('setting-macro-calories');
    if (el) el.textContent = 'Target calories: ' + (cal == null ? '—' : String(cal));
  }

  function readMacroGoalsFromSettingsForm() {
    function numOrNull(id) {
      const v = document.getElementById(id).value;
      return v === '' ? null : Number(v);
    }
    return {
      proteinGoal: numOrNull('setting-protein-goal'),
      carbsGoal: numOrNull('setting-carbs-goal'),
      fatGoal: numOrNull('setting-fat-goal')
    };
  }

  function saveMacroTargetsFromForm() {
    const macros = readMacroGoalsFromSettingsForm();
    settings.proteinGoal = macros.proteinGoal;
    settings.carbsGoal = macros.carbsGoal;
    settings.fatGoal = macros.fatGoal;
    saveSettings();

    const snap = snapshotTargetsFromSettings();
    const today = todayKey();

    // Changing settings updates today’s snapshot only — never past days
    if (store.logs[today]) {
      Object.assign(store.logs[today], snap);
      saveStore();
    }
    if (currentDate === today) {
      currentDayTargets = snap;
      updateNutritionUI();
    }

    toast('Macro targets saved');
    updateSettingsMacroCaloriesPreview();
  }

  function formatNum(n) {
    return Number(n).toLocaleString();
  }

  function updateDateNav() {
    const { label, sub } = formatDisplayDate(currentDate);
    document.getElementById('date-label').textContent = label;
    document.getElementById('date-sub').textContent = sub;
    const nextBtn = document.getElementById('btn-next-day');
    // Allow going to tomorrow but not far future beyond tomorrow
    const tomorrow = shiftDate(todayKey(), 1);
    nextBtn.disabled = currentDate >= tomorrow;
  }

  function goToDate(dateKey) {
    persistCurrent();
    currentDate = dateKey;
    loadFormForDate(currentDate);
    closePanels();
  }

  // --- History / calendar ---
  function openHistory() {
    persistCurrent();
    closePanels();
    calMonth = parseDateKey(currentDate);
    document.getElementById('history-panel').hidden = false;
    renderCalendar();
    renderHistoryList();
  }

  function openSettings() {
    persistCurrent();
    closePanels();
    document.getElementById('setting-water-goal').value =
      settings.waterGoal != null ? settings.waterGoal : '';
    document.getElementById('setting-steps-goal').value =
      settings.stepsGoal != null ? settings.stepsGoal : '';
    document.getElementById('setting-protein-goal').value =
      settings.proteinGoal != null ? settings.proteinGoal : '';
    document.getElementById('setting-carbs-goal').value =
      settings.carbsGoal != null ? settings.carbsGoal : '';
    document.getElementById('setting-fat-goal').value =
      settings.fatGoal != null ? settings.fatGoal : '';
    updateSettingsMacroCaloriesPreview();
    document.getElementById('settings-panel').hidden = false;
  }

  function closePanels() {
    document.getElementById('history-panel').hidden = true;
    document.getElementById('settings-panel').hidden = true;
    document.getElementById('score-panel').hidden = true;
    const chartsPanel = document.getElementById('charts-panel');
    if (chartsPanel) chartsPanel.hidden = true;
    const photosPanel = document.getElementById('photos-panel');
    if (photosPanel) photosPanel.hidden = true;
  }

  function renderCalendar() {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    document.getElementById('cal-title').textContent =
      calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';

    for (let i = 0; i < startPad; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day empty';
      grid.appendChild(empty);
    }

    const today = todayKey();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = formatDateKey(new Date(y, m, day));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      if (key === today) btn.classList.add('today');
      if (key === currentDate) btn.classList.add('selected');
      const log = store.logs[key];
      if (log && !isLogEmpty(log)) {
        btn.classList.add('has-data');
        const score = fillScore(log);
        if (score >= 70) btn.classList.add('has-full');
      }
      btn.innerHTML = `<span>${day}</span><span class="dot"></span>`;
      btn.addEventListener('click', () => goToDate(key));
      grid.appendChild(btn);
    }
  }

  function renderHistoryList() {
    const list = document.getElementById('history-list');
    const keys = Object.keys(store.logs)
      .filter((k) => store.logs[k] && !isLogEmpty(store.logs[k]))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 60);

    if (!keys.length) {
      list.innerHTML = '<p class="settings-note" style="padding:8px 4px">No logged days yet. Start with today.</p>';
      return;
    }

    list.innerHTML = '';
    keys.forEach((key) => {
      const log = store.logs[key];
      const score = fillScore(log);
      const d = parseDateKey(key);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      const bits = [];
      if (log.bodyweight) bits.push(`${log.bodyweight} lbs${log.bmTiming ? ` (${log.bmTiming} BM)` : ''}`);
      if (log.waist) bits.push(`waist ${log.waist} in`);
      if (log.sleepDuration) bits.push(`${log.sleepDuration} hrs sleep`);
      if (log.sleepScore !== '' && log.sleepScore != null) bits.push(`Sleep Score ${log.sleepScore}`);
      if (log.steps) bits.push(`${formatNum(log.steps)} steps`);
      const dayCal = calcCalories(log.protein, log.carbs, log.fat);
      if (dayCal != null) bits.push(`${dayCal} kcal`);
      if (log.training) bits.push(`train: ${log.training}`);
      btn.innerHTML = `
        <div>
          <div class="hi-date">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div class="hi-meta">${bits.join(' · ') || 'Partial entry'}</div>
        </div>
        <span class="hi-fill">${score}%</span>
      `;
      btn.addEventListener('click', () => goToDate(key));
      list.appendChild(btn);
    });
  }

  // --- Export / Import ---
  function exportJSON() {
    persistCurrent();
    const payload = {
      app: 'FitLog',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      logs: store.logs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitlog-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incomingLogs = (data && data.logs) ? data.logs : data;
        if (!incomingLogs || typeof incomingLogs !== 'object') {
          toast('Invalid backup file');
          return;
        }
        const mode = confirm(
          'OK = Merge with existing days (incoming overwrites same dates).\n\nCancel = Replace ALL local data with this file.'
        );
        // confirm: OK=true (merge), Cancel=false (replace)
        // Actually users often confuse this. Better dual confirm:
        // We'll interpret: first dialog asked merge vs replace via confirm.
        // OK = merge, Cancel opens second confirm for replace.
        if (mode) {
          Object.assign(store.logs, incomingLogs);
          if (data.settings) {
            settings = {
              waterGoal: data.settings.waterGoal ?? settings.waterGoal,
              stepsGoal: data.settings.stepsGoal ?? settings.stepsGoal,
              proteinGoal: data.settings.proteinGoal ?? settings.proteinGoal,
              carbsGoal: data.settings.carbsGoal ?? settings.carbsGoal,
              fatGoal: data.settings.fatGoal ?? settings.fatGoal
            };
            saveSettings();
          }
          saveStore();
          loadFormForDate(currentDate);
          toast('Merged backup');
        } else {
          if (!confirm('Replace ALL FitLog data on this device with the file? This cannot be undone.')) {
            toast('Import cancelled');
            return;
          }
          store.logs = Object.assign({}, incomingLogs);
          if (data.settings) {
            settings = {
              waterGoal: data.settings.waterGoal != null ? data.settings.waterGoal : null,
              stepsGoal: data.settings.stepsGoal != null ? data.settings.stepsGoal : null,
              proteinGoal: data.settings.proteinGoal != null ? data.settings.proteinGoal : null,
              carbsGoal: data.settings.carbsGoal != null ? data.settings.carbsGoal : null,
              fatGoal: data.settings.fatGoal != null ? data.settings.fatGoal : null
            };
            saveSettings();
          }
          saveStore();
          loadFormForDate(currentDate);
          toast('Replaced with backup');
        }
      } catch (e) {
        console.error(e);
        toast('Could not read JSON');
      }
    };
    reader.readAsText(file);
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // --- Events ---
  function bindEvents() {
    document.getElementById('btn-prev-day').addEventListener('click', () => {
      goToDate(shiftDate(currentDate, -1));
    });
    document.getElementById('btn-next-day').addEventListener('click', () => {
      goToDate(shiftDate(currentDate, 1));
    });
    document.getElementById('date-display').addEventListener('click', () => {
      goToDate(todayKey());
    });

    document.getElementById('btn-score').addEventListener('click', openScore);
    document.getElementById('btn-close-score').addEventListener('click', closePanels);
    document.getElementById('btn-charts').addEventListener('click', openCharts);
    document.getElementById('btn-close-charts').addEventListener('click', closePanels);
    document.querySelectorAll('[data-chart-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        chartRange = btn.dataset.chartRange;
        renderCharts();
      });
    });
    document.getElementById('btn-history').addEventListener('click', openHistory);
    document.getElementById('btn-close-history').addEventListener('click', closePanels);
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closePanels);

    document.getElementById('cal-prev').addEventListener('click', () => {
      calMonth.setMonth(calMonth.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      calMonth.setMonth(calMonth.getMonth() + 1);
      renderCalendar();
    });

    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.card').classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', btn.closest('.card').classList.contains('collapsed') ? 'false' : 'true');
      });
    });

    const form = document.getElementById('log-form');
    form.addEventListener('input', (e) => {
      if (e.target.dataset && e.target.dataset.bm) {
        const k = e.target.dataset.bm;
        document.getElementById('bmTiming').value = e.target.checked ? k : '';
        syncBmChips();
      }
      if (e.target.id === 'sleepDuration') {
        durationManual = true;
        updateDurationHint();
      }
      if (e.target.id === 'bedtime' || e.target.id === 'wakeTime') {
        // If user changes bed/wake, resume auto unless they already overrode after
        if (!durationManual) maybeAutoDuration();
        else {
          // If both change and duration was manual, still allow re-auto if duration empty
          if (!document.getElementById('sleepDuration').value) {
            durationManual = false;
            maybeAutoDuration();
          }
        }
      }
      if (e.target.id === 'water' || e.target.id === 'steps') updateProgressBars();
      if (e.target.id === 'protein' || e.target.id === 'carbs' || e.target.id === 'fat') {
        updateNutritionUI();
      }
      scheduleSave();
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'training' ||
          e.target.name === 'supplementsMorning' ||
          e.target.name === 'supplementsNoon' ||
          e.target.name === 'supplementsNight') {
        scheduleSave();
      }
      if (e.target.id === 'bedtime' || e.target.id === 'wakeTime') {
        if (!durationManual) maybeAutoDuration();
        scheduleSave();
      }
    });

    // Double-tap duration hint area to reset to auto
    document.getElementById('duration-hint').addEventListener('click', () => {
      durationManual = false;
      maybeAutoDuration();
      updateDurationHint();
      scheduleSave();
      toast('Duration set to auto');
    });

    document.getElementById('training-clear').addEventListener('click', () => {
      document.querySelectorAll('input[name="training"]').forEach((r) => { r.checked = false; });
      scheduleSave();
    });
    document.querySelectorAll('[data-seg-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.segClear;
        document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = false; });
        scheduleSave();
      });
    });

    document.querySelectorAll('[data-stepper]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.stepper;
        const delta = Number(btn.dataset.delta);
        const input = document.getElementById(id);
        const cur = input.value === '' ? 0 : Number(input.value);
        const next = Math.max(0, cur + delta);
        input.value = String(next);
        scheduleSave();
      });
    });

    document.querySelectorAll('.quick-add').forEach((wrap) => {
      const target = wrap.dataset.target;
      wrap.querySelectorAll('[data-add]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const add = Number(btn.dataset.add);
          const input = document.getElementById(target);
          const cur = input.value === '' ? 0 : Number(input.value);
          input.value = String(Math.max(0, cur + add));
          updateProgressBars();
          scheduleSave();
        });
      });
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const w = document.getElementById('setting-water-goal').value;
      const s = document.getElementById('setting-steps-goal').value;
      settings.waterGoal = w === '' ? null : Number(w);
      settings.stepsGoal = s === '' ? null : Number(s);
      saveSettings();
      updateProgressBars();
      toast('Goals saved');
    });

    ['setting-protein-goal', 'setting-carbs-goal', 'setting-fat-goal'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateSettingsMacroCaloriesPreview);
    });
    document.getElementById('btn-save-macro-targets').addEventListener('click', () => {
      saveMacroTargetsFromForm();
    });
    document.getElementById('btn-apply-targets-today').addEventListener('click', () => {
      // Save settings defaults first, then force today’s snapshot only
      const macros = readMacroGoalsFromSettingsForm();
      settings.proteinGoal = macros.proteinGoal;
      settings.carbsGoal = macros.carbsGoal;
      settings.fatGoal = macros.fatGoal;
      saveSettings();
      const snap = snapshotTargetsFromSettings();
      const today = todayKey();
      if (store.logs[today]) {
        Object.assign(store.logs[today], snap);
        saveStore();
      }
      if (currentDate === today) {
        currentDayTargets = snap;
        const data = readForm();
        if (!isLogEmpty(data)) {
          store.logs[today] = data;
          saveStore();
        }
        updateNutritionUI();
      }
      toast('Applied current targets to today');
      updateSettingsMacroCaloriesPreview();
    });

    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importJSON(file);
      e.target.value = '';
    });

    // Swipe between days on main view
    const main = document.getElementById('main-view');
    main.addEventListener('touchstart', (e) => {
      if (!e.changedTouches[0]) return;
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    main.addEventListener('touchend', (e) => {
      if (!e.changedTouches[0]) return;
      const dx = e.changedTouches[0].screenX - touchStartX;
      const dy = e.changedTouches[0].screenY - touchStartY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0) goToDate(shiftDate(currentDate, -1));
      else {
        const tomorrow = shiftDate(todayKey(), 1);
        const next = shiftDate(currentDate, 1);
        if (next <= tomorrow) goToDate(next);
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistCurrent();
    });
    window.addEventListener('beforeunload', persistCurrent);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Only register when served over http(s)
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed', err);
    });
  }

  function init() {
    loadStore();
    loadSettings();
    buildScales();
    bindEvents();
    loadFormForDate(currentDate);
    if (window.FitLogPhotos) {
      window.FitLogPhotos.init({
        toast: toast,
        todayKey: todayKey,
        persistCurrent: persistCurrent
      });
    }
    registerSW();
  }

  init();
})();
