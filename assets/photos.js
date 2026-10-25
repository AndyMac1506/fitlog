/* FitLog progress photos — IndexedDB storage, capture, compare, bot-review pack */
(function (global) {
  'use strict';

  const DB_NAME = 'fitlog-photos';
  const DB_VERSION = 1;
  const STORE = 'photos';
  const ANGLES = ['front', 'side', 'rear'];
  const ANGLE_LABELS = { front: 'Front', side: 'Side', rear: 'Rear' };
  const MAX_EDGE = 1600;
  const JPEG_QUALITY = 0.82;
  const THUMB_EDGE = 320;
  const THUMB_QUALITY = 0.72;

  /** @type {IDBDatabase|null} */
  let db = null;
  /** @type {{ toast: Function, todayKey: Function, formatDisplayDate?: Function }} */
  let api = { toast: () => {}, todayKey: () => '' };

  let photoDate = '';
  let compareA = '';
  let compareB = '';
  let overlayAngle = 'front';
  let activeTab = 'capture';
  /** @type {Record<string, string>} object URLs to revoke */
  const objectUrls = {};

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const os = database.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('dateKey', 'dateKey', { unique: false });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function txStore(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function photoId(dateKey, angle) {
    return `${dateKey}:${angle}`;
  }

  function getPhoto(dateKey, angle) {
    return new Promise((resolve, reject) => {
      const req = txStore('readonly').get(photoId(dateKey, angle));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function putPhoto(record) {
    return new Promise((resolve, reject) => {
      const req = txStore('readwrite').put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function deletePhoto(dateKey, angle) {
    return new Promise((resolve, reject) => {
      const req = txStore('readwrite').delete(photoId(dateKey, angle));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function getAllPhotos() {
    return new Promise((resolve, reject) => {
      const req = txStore('readonly').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function listPhotoDates() {
    const all = await getAllPhotos();
    /** @type {Record<string, Set<string>>} */
    const map = {};
    for (const rec of all) {
      if (!map[rec.dateKey]) map[rec.dateKey] = new Set();
      map[rec.dateKey].add(rec.angle);
    }
    return Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => {
        const angles = map[dateKey];
        const count = ANGLES.filter((a) => angles.has(a)).length;
        return { dateKey, count, full: count === 3, angles: [...angles] };
      });
  }

  async function dayHasAny(dateKey) {
    for (const angle of ANGLES) {
      if (await getPhoto(dateKey, angle)) return true;
    }
    return false;
  }

  function revokeUrl(key) {
    if (objectUrls[key]) {
      URL.revokeObjectURL(objectUrls[key]);
      delete objectUrls[key];
    }
  }

  function blobUrl(key, blob) {
    revokeUrl(key);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    objectUrls[key] = url;
    return url;
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    });
  }

  async function compressToJpeg(fileOrBlob, maxEdge, quality) {
    let bitmap = null;
    let img = null;
    let w, h;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(fileOrBlob);
        w = bitmap.width;
        h = bitmap.height;
      } catch (_) {
        bitmap = null;
      }
    }
    if (!bitmap) {
      img = await loadImageFromBlob(fileOrBlob);
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
    }
    let tw = w;
    let th = h;
    const edge = Math.max(w, h);
    if (edge > maxEdge) {
      const scale = maxEdge / edge;
      tw = Math.round(w * scale);
      th = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, tw, th);
      bitmap.close();
    } else {
      ctx.drawImage(img, 0, 0, tw, th);
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality
      );
    });
    return { blob, width: tw, height: th };
  }

  async function saveAngleFromFile(dateKey, angle, file) {
    const full = await compressToJpeg(file, MAX_EDGE, JPEG_QUALITY);
    const thumb = await compressToJpeg(full.blob, THUMB_EDGE, THUMB_QUALITY);
    const now = new Date().toISOString();
    const existing = await getPhoto(dateKey, angle);
    await putPhoto({
      id: photoId(dateKey, angle),
      dateKey,
      angle,
      blob: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    });
  }

  // --- Minimal ZIP (store / no compression) for already-JPEG blobs ---
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
    }
    return ~c >>> 0;
  }

  function u16(n) {
    const b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function concatBytes(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function encodeUtf8(str) {
    return new TextEncoder().encode(str);
  }

  async function blobToUint8(blob) {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * @param {{ name: string, data: Uint8Array }[]} files
   */
  function buildZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encodeUtf8(file.name);
      const data = file.data;
      const crc = crc32(data);
      const localHeader = concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes
      ]);
      localParts.push(localHeader, data);
      const central = concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ]);
      centralParts.push(central);
      offset += localHeader.length + data.length;
    }

    const centralDir = concatBytes(centralParts);
    const end = concatBytes([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0)
    ]);
    return concatBytes([...localParts, centralDir, end]);
  }

  function downloadBytes(bytes, filename, mime) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function shiftDate(key, days) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + days);
    return formatDateKey(d);
  }

  function shiftMonth(key, months) {
    const d = parseDateKey(key);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return formatDateKey(d);
  }

  function beginOfMonth(key) {
    const d = parseDateKey(key);
    return formatDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function beginOfYear(key) {
    const d = parseDateKey(key);
    return formatDateKey(new Date(d.getFullYear(), 0, 1));
  }

  async function nearestEarlierWithPhotos(targetKey, excludeKey) {
    const dates = await listPhotoDates();
    for (const item of dates) {
      if (item.dateKey >= targetKey) continue;
      if (excludeKey && item.dateKey === excludeKey) continue;
      return item.dateKey;
    }
    // If exact target has photos and we want that date itself
    const exact = dates.find((d) => d.dateKey === targetKey);
    if (exact && (!excludeKey || exact.dateKey !== excludeKey)) return exact.dateKey;
    return null;
  }

  async function resolvePreset(preset, dateA) {
    let candidate;
    if (preset === 'last-week') candidate = shiftDate(dateA, -7);
    else if (preset === 'last-month') candidate = shiftMonth(dateA, -1);
    else if (preset === 'month-start') candidate = beginOfMonth(dateA);
    else if (preset === 'year-start') candidate = beginOfYear(dateA);
    else if (preset === 'previous') {
      return nearestEarlierWithPhotos(dateA, dateA);
    } else {
      return null;
    }

    if (await dayHasAny(candidate)) return candidate;
    // Snap to nearest earlier with photos (including candidate if somehow missed)
    const snapped = await nearestEarlierWithPhotos(
      shiftDate(candidate, 1), // search dates < candidate+1, i.e. <= candidate
      dateA
    );
    // Prefer exact or earlier than candidate
    if (snapped && snapped <= candidate) return snapped;
    // If snapped is after candidate somehow, still use nearest earlier than A
    return nearestEarlierWithPhotos(dateA, dateA);
  }

  function setTab(name) {
    activeTab = name;
    document.querySelectorAll('.photos-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.photosTab === name);
    });
    document.querySelectorAll('.photos-section').forEach((sec) => {
      sec.classList.toggle('active', sec.dataset.photosSection === name);
    });
  }

  async function renderCapture() {
    const dateInput = document.getElementById('photo-date');
    if (dateInput && dateInput.value !== photoDate) dateInput.value = photoDate;

    for (const angle of ANGLES) {
      const preview = document.getElementById(`photo-preview-${angle}`);
      if (!preview) continue;
      const rec = await getPhoto(photoDate, angle);
      if (rec && rec.blob) {
        const url = blobUrl(`cap-${angle}`, rec.thumb || rec.blob);
        preview.innerHTML = `<img src="${url}" alt="${ANGLE_LABELS[angle]}" />`;
      } else {
        revokeUrl(`cap-${angle}`);
        preview.innerHTML = `<div class="photo-empty">No ${ANGLE_LABELS[angle].toLowerCase()} photo<br/><span style="font-weight:500;font-size:0.75rem">Tap Add or use camera</span></div>`;
      }
    }
    await renderDaysList();
  }

  async function renderDaysList() {
    const list = document.getElementById('photo-days-list');
    if (!list) return;
    const dates = await listPhotoDates();
    if (!dates.length) {
      list.innerHTML = '<p class="photos-note">No progress photos yet. Pick a date and add Front, Side, and Rear.</p>';
      return;
    }
    list.innerHTML = '';
    dates.forEach((item) => {
      const d = parseDateKey(item.dateKey);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'photo-day-item' + (item.dateKey === photoDate ? ' selected' : '');
      const badgeClass = item.full ? 'full' : 'partial';
      const badgeText = item.full ? '3/3' : `${item.count}/3`;
      btn.innerHTML = `
        <div>
          <div class="hi-date">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div class="photo-day-meta">${item.angles.map((a) => ANGLE_LABELS[a]).join(' · ')}</div>
        </div>
        <span class="photo-day-badge ${badgeClass}">${badgeText}</span>
      `;
      btn.addEventListener('click', () => {
        photoDate = item.dateKey;
        renderCapture();
      });
      list.appendChild(btn);
    });
  }

  async function renderCompare() {
    const aInput = document.getElementById('compare-date-a');
    const bInput = document.getElementById('compare-date-b');
    if (aInput) aInput.value = compareA || '';
    if (bInput) bInput.value = compareB || '';

    const grid = document.getElementById('compare-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!compareA || !compareB) {
      grid.innerHTML = '<p class="photos-note">Pick Date A and Date B (or use a preset) to compare.</p>';
      await renderOverlay();
      return;
    }

    for (const angle of ANGLES) {
      const wrap = document.createElement('div');
      wrap.className = 'compare-angle';
      wrap.innerHTML = `<div class="compare-angle-title">${ANGLE_LABELS[angle]}</div>`;
      const pair = document.createElement('div');
      pair.className = 'compare-pair';

      for (const [slotKey, dateKey, label] of [
        ['a', compareA, 'A'],
        ['b', compareB, 'B']
      ]) {
        const slot = document.createElement('div');
        slot.className = 'compare-slot';
        const rec = await getPhoto(dateKey, angle);
        if (rec && rec.blob) {
          const url = blobUrl(`cmp-${slotKey}-${angle}`, rec.blob);
          slot.innerHTML = `<img src="${url}" alt="${label} ${ANGLE_LABELS[angle]}" /><span class="slot-label">${label}: ${dateKey}</span>`;
        } else {
          revokeUrl(`cmp-${slotKey}-${angle}`);
          slot.innerHTML = `<div class="slot-empty">No ${ANGLE_LABELS[angle].toLowerCase()}<br/>${dateKey}</div>`;
        }
        pair.appendChild(slot);
      }
      wrap.appendChild(pair);
      grid.appendChild(wrap);
    }
    await renderOverlay();
  }

  async function renderOverlay() {
    const stage = document.getElementById('overlay-stage');
    const slider = document.getElementById('overlay-slider');
    if (!stage) return;

    document.querySelectorAll('.overlay-angle-select button').forEach((b) => {
      b.classList.toggle('active', b.dataset.overlayAngle === overlayAngle);
    });

    if (!compareA || !compareB) {
      stage.innerHTML = '<div class="overlay-empty">Select two dates to overlay</div>';
      return;
    }
    const recA = await getPhoto(compareA, overlayAngle);
    const recB = await getPhoto(compareB, overlayAngle);
    if (!recA || !recB) {
      stage.innerHTML = `<div class="overlay-empty">Need ${ANGLE_LABELS[overlayAngle]} on both dates</div>`;
      return;
    }
    const urlA = blobUrl('ov-a', recA.blob);
    const urlB = blobUrl('ov-b', recB.blob);
    const opacity = slider ? Number(slider.value) / 100 : 0.5;
    stage.innerHTML = `
      <img src="${urlA}" alt="A" />
      <img class="overlay-top" src="${urlB}" alt="B" style="opacity:${opacity}" />
    `;
  }

  async function pickLatestPhotoDate() {
    const dates = await listPhotoDates();
    if (dates.length) return dates[0].dateKey;
    return api.todayKey();
  }

  async function openPhotos() {
    if (!db) {
      try {
        await openDb();
      } catch (e) {
        console.error(e);
        api.toast('Photos unavailable (IndexedDB)');
        return;
      }
    }
    if (typeof api.persistCurrent === 'function') api.persistCurrent();
    // Close sibling panels
    ['history-panel', 'settings-panel', 'score-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    photoDate = photoDate || (await pickLatestPhotoDate());
    compareA = compareA || photoDate;
    if (!compareB) {
      compareB = (await nearestEarlierWithPhotos(compareA, compareA)) || '';
    }
    document.getElementById('photos-panel').hidden = false;
    setTab(activeTab || 'capture');
    await renderCapture();
    await renderCompare();
  }

  function closePhotos() {
    document.getElementById('photos-panel').hidden = true;
  }

  function triggerFilePick(angle, useCamera) {
    const input = document.getElementById('photo-file-input');
    if (!input) return;
    input.dataset.angle = angle;
    if (useCamera) {
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
    }
    input.value = '';
    input.click();
  }

  async function onFileChosen(file, angle) {
    if (!file || !angle) return;
    if (!file.type.startsWith('image/')) {
      api.toast('Please choose an image');
      return;
    }
    try {
      api.toast('Saving…');
      await saveAngleFromFile(photoDate, angle, file);
      api.toast(`${ANGLE_LABELS[angle]} saved`);
      await renderCapture();
      if (activeTab === 'compare') await renderCompare();
    } catch (e) {
      console.error(e);
      api.toast('Could not save photo');
    }
  }

  async function deleteAngle(angle) {
    if (!confirm(`Delete ${ANGLE_LABELS[angle]} photo for ${photoDate}?`)) return;
    await deletePhoto(photoDate, angle);
    revokeUrl(`cap-${angle}`);
    api.toast('Deleted');
    await renderCapture();
  }

  async function deleteDay() {
    if (!confirm(`Delete all progress photos for ${photoDate}?`)) return;
    for (const angle of ANGLES) {
      await deletePhoto(photoDate, angle);
      revokeUrl(`cap-${angle}`);
    }
    api.toast('Day photos deleted');
    const dates = await listPhotoDates();
    photoDate = dates.length ? dates[0].dateKey : api.todayKey();
    await renderCapture();
  }

  async function applyPreset(preset) {
    if (!compareA) {
      compareA = photoDate || (await pickLatestPhotoDate());
    }
    let ideal = null;
    if (preset === 'last-week') ideal = shiftDate(compareA, -7);
    else if (preset === 'last-month') ideal = shiftMonth(compareA, -1);
    else if (preset === 'month-start') ideal = beginOfMonth(compareA);
    else if (preset === 'year-start') ideal = beginOfYear(compareA);
    else if (preset === 'previous') ideal = null;

    const resolved = await resolvePreset(preset, compareA);
    if (!resolved) {
      api.toast('No earlier photo day found');
      compareB = '';
    } else {
      compareB = resolved;
      if (ideal && resolved !== ideal) {
        api.toast(`No photos on ${ideal} — snapped to ${resolved}`);
      }
    }
    await renderCompare();
  }

  async function prepareBotReview() {
    const dateNew = compareA || photoDate;
    let dateOld = compareB;
    if (!dateOld) {
      dateOld = await nearestEarlierWithPhotos(dateNew, dateNew);
    }
    if (!dateNew) {
      api.toast('Pick a current photo day first');
      return;
    }
    if (!dateOld) {
      api.toast('Need a previous photo day to compare');
      return;
    }

    const files = [];
    let count = 0;
    for (const angle of ANGLES) {
      const recNew = await getPhoto(dateNew, angle);
      const recOld = await getPhoto(dateOld, angle);
      if (recNew && recNew.blob) {
        files.push({
          name: `${dateNew}-${angle}.jpg`,
          data: await blobToUint8(recNew.blob)
        });
        count++;
      }
      if (recOld && recOld.blob) {
        files.push({
          name: `${dateOld}-${angle}.jpg`,
          data: await blobToUint8(recOld.blob)
        });
        count++;
      }
    }
    if (!count) {
      api.toast('No photos found for those dates');
      return;
    }

    const readme = `FitLog progress photo review pack
================================
Current week (Date A): ${dateNew}
Comparison week (Date B): ${dateOld}

Files are named YYYY-MM-DD-{front|side|rear}.jpg

How to get a bot review
-----------------------
1. Open your FitLog / App Builder chat with Grok Bot.
2. Attach the images from this zip (or the whole zip if the chat accepts it).
3. Ask for a week-over-week progress summary comparing ${dateNew} to ${dateOld}.
   Mention Front / Side / Rear angles.

Tips
----
- Same lighting, pose, distance, and time of day make comparisons more useful.
- Photos stay on your device; this pack is only what you choose to share in chat.
`;
    files.push({ name: 'README.txt', data: encodeUtf8(readme) });

    try {
      const zipBytes = buildZip(files);
      downloadBytes(zipBytes, `fitlog-photos-${dateNew}-vs-${dateOld}.zip`, 'application/zip');
      api.toast('Review pack downloaded');
    } catch (e) {
      console.error(e);
      // Fallback: download individually
      for (const f of files) {
        if (f.name.endsWith('.txt')) {
          downloadBytes(f.data, f.name, 'text/plain');
        } else {
          downloadBytes(f.data, f.name, 'image/jpeg');
        }
      }
      api.toast('Downloaded files (zip failed)');
    }
  }

  function bindUi() {
    document.getElementById('btn-photos')?.addEventListener('click', () => {
      openPhotos();
    });
    document.getElementById('btn-close-photos')?.addEventListener('click', closePhotos);

    document.querySelectorAll('.photos-tab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        setTab(btn.dataset.photosTab);
        if (btn.dataset.photosTab === 'capture') await renderCapture();
        if (btn.dataset.photosTab === 'compare') await renderCompare();
      });
    });

    document.getElementById('photo-date')?.addEventListener('change', async (e) => {
      photoDate = e.target.value || api.todayKey();
      await renderCapture();
    });

    document.getElementById('btn-photo-today')?.addEventListener('click', async () => {
      photoDate = api.todayKey();
      await renderCapture();
    });

    ANGLES.forEach((angle) => {
      document.getElementById(`btn-photo-add-${angle}`)?.addEventListener('click', () => {
        triggerFilePick(angle, false);
      });
      document.getElementById(`btn-photo-camera-${angle}`)?.addEventListener('click', () => {
        triggerFilePick(angle, true);
      });
      document.getElementById(`btn-photo-del-${angle}`)?.addEventListener('click', () => {
        deleteAngle(angle);
      });
    });

    document.getElementById('photo-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const angle = e.target.dataset.angle;
      if (file) await onFileChosen(file, angle);
      e.target.value = '';
    });

    document.getElementById('btn-photo-delete-day')?.addEventListener('click', deleteDay);

    document.getElementById('compare-date-a')?.addEventListener('change', async (e) => {
      compareA = e.target.value;
      await renderCompare();
    });
    document.getElementById('compare-date-b')?.addEventListener('change', async (e) => {
      compareB = e.target.value;
      await renderCompare();
    });

    document.querySelectorAll('[data-compare-preset]').forEach((btn) => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.comparePreset));
    });

    document.querySelectorAll('[data-overlay-angle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        overlayAngle = btn.dataset.overlayAngle;
        await renderOverlay();
      });
    });

    document.getElementById('overlay-slider')?.addEventListener('input', () => {
      const top = document.querySelector('#overlay-stage .overlay-top');
      const slider = document.getElementById('overlay-slider');
      if (top && slider) top.style.opacity = String(Number(slider.value) / 100);
    });

    document.getElementById('btn-bot-review')?.addEventListener('click', prepareBotReview);

    // Sync compare A from capture date when switching tabs
    document.querySelector('.photos-tab[data-photos-tab="compare"]')?.addEventListener('click', () => {
      if (photoDate) compareA = photoDate;
    });
  }

  async function init(options) {
    api = Object.assign(api, options || {});
    photoDate = api.todayKey();
    try {
      await openDb();
    } catch (e) {
      console.warn('FitLog photos DB unavailable', e);
    }
    bindUi();
  }

  function isOpen() {
    const panel = document.getElementById('photos-panel');
    return panel && !panel.hidden;
  }

  global.FitLogPhotos = {
    init,
    open: openPhotos,
    close: closePhotos,
    isOpen
  };
})(window);
