import * as THREE from 'three';
import { AudioSubsystem } from './audio.js?v=4.4.0';
import { PhysicsSubsystem, DEFAULT_PARAMS } from './physics.js?v=4.4.0';
import { RenderingSubsystem } from './rendering.js?v=4.4.0';

// Must match --c-* in style.css
const COLORS = {
  kick:   '#c8553d',
  bass:   '#b08a2e',
  mids:   '#3f7cac',
  treble: '#7d5ba6',
  energy: '#4a8f6a',
};

// Audio features plotted in the dev panel. `threshold` marks where the
// velocity shader switches an effect on (see physics.js).
const SIGNALS = [
  { key: 'kick',   label: 'Kick',   drives: 'scatter' },
  { key: 'bass',   label: 'Bass',   drives: 'separation', threshold: 0.3 },
  { key: 'mids',   label: 'Mids',   drives: 'alignment' },
  { key: 'treble', label: 'Treble', drives: 'flutter',    threshold: 0.3 },
  { key: 'energy', label: 'Energy', drives: 'speed' },
];

// Dev panel sliders. `live` mirrors the shader's audio modulation so the
// readout shows what the GPU is actually using this frame.
const SLIDERS = [
  { group: 'Neighbor radius', probe: true },
  { param: 'sepDist',   label: 'Separation', min: 1, max: 100, step: 1 },
  { param: 'aliDist',   label: 'Alignment',  min: 1, max: 200, step: 1 },
  { param: 'cohDist',   label: 'Cohesion',   min: 1, max: 200, step: 1 },
  { group: 'Strength' },
  { param: 'sepForce',  label: 'Separation', min: 0, max: 100, step: 1,
    live: (v, f) => v * (1 + f.bass * 2) },
  { param: 'aliForce',  label: 'Alignment',  min: 0, max: 5, step: 0.05,
    live: (v, f) => v * (0.3 + f.mids * 3) },
  { param: 'cohForce',  label: 'Cohesion',   min: 0, max: 20, step: 0.1,
    live: (v, f) => v * (1 - Math.min(f.energy * 1.5, 0.6) + 0.4) },
  { group: 'Motion' },
  { param: 'maxSpeed',  label: 'Max speed',  min: 5, max: 60, step: 1,
    live: (v, f, scale) => (v + f.energy * 15) * scale },
  { param: 'kickForce', label: 'Kick force', min: 0, max: 2000, step: 10,
    live: (v, f, scale) => v * scale * f.kick },
];

const HISTORY_LEN = 240;
const PROBE_EVERY = 30; // frames between neighbour-spacing readbacks

let audioSystem;
let physicsSystem;
let renderingSystem;
let clock;

const nowPlayingEl = document.getElementById('now-playing');
const nowPlayingText = document.getElementById('now-playing-text');

let isDevMode = false;
let streamStarted = false;
let frame = 0;
let fps = 60;

const devPanel = document.getElementById('dev-mode-panel');
const devMeta = document.getElementById('dev-meta');
const audioState = document.getElementById('audio-state');
const resetBtn = document.getElementById('reset-btn');
let spectrogram;
const signalRows = [];
const sliderRows = [];
let probeLabel = null;

function init() {
  const canvas = document.getElementById('canvas');

  audioSystem = new AudioSubsystem();
  renderingSystem = new RenderingSubsystem(canvas);
  physicsSystem = new PhysicsSubsystem(renderingSystem.getRenderer());
  clock = new THREE.Clock();

  buildDevPanel();

  const devBtn = document.getElementById('dev-btn');
  const whatsThisBtn = document.getElementById('whats-this-btn');
  const whatsThisPanel = document.getElementById('whats-this-panel');
  const panels = {
    dev: [devPanel, devBtn],
    whatsThis: [whatsThisPanel, whatsThisBtn],
  };

  // Single active panel — only one can be open at a time.
  let activePanel = null;

  function closeAll() {
    for (const [panel, btn] of Object.values(panels)) {
      panel.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
    isDevMode = false;
    activePanel = null;
  }

  function showPanel(name) {
    if (activePanel === name) { closeAll(); return; }
    closeAll();
    activePanel = name;
    const [panel, btn] = panels[name];
    panel.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    if (name === 'dev') {
      isDevMode = true;
      sizeDevCanvases();
    }
  }

  devBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showPanel('dev');
  });

  whatsThisBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showPanel('whatsThis');
  });

  document.addEventListener('click', (e) => {
    if (activePanel === 'whatsThis' &&
        !whatsThisPanel.contains(e.target) &&
        e.target !== whatsThisBtn) {
      closeAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) {
      const [, btn] = panels[activePanel];
      closeAll();
      btn.focus();
    }
  });

  // Mute / play toggle — clicking the note icon also starts the stream the first time
  const muteBtn = document.getElementById('mute-btn');
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!streamStarted) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const streamUrl = isIOS ? '/stream' : 'https://ice2.somafm.com/defcon-128-mp3';
      audioSystem.playUrl(streamUrl);
      streamStarted = true;
      startNowPlaying();
      muteBtn.classList.remove('idle');
    } else {
      const el = audioSystem.audioElement;
      if (!el) return;
      el.muted = !el.muted;
    }
    const muted = audioSystem.audioElement?.muted;
    muteBtn.classList.toggle('muted', !!muted);
    const label = muted ? 'Unmute' : 'Mute';
    muteBtn.title = label;
    muteBtn.setAttribute('aria-label', label);
  });

  window.addEventListener('resize', () => { if (isDevMode) sizeDevCanvases(); });

  // Start animation loop
  animate();
}

// ---------- Dev panel ----------

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function formatValue(v, step) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}

function buildDevPanel() {
  spectrogram = document.getElementById('spectrogram-canvas');

  const signalsEl = document.getElementById('signals');
  for (const s of SIGNALS) {
    const canvas = el('canvas');
    const value = el('span', { className: 'value', textContent: '0.00' });
    const swatch = el('span', { className: 'swatch' });
    swatch.style.background = COLORS[s.key];
    signalsEl.append(el('div', { className: 'signal' }, [
      el('span', { className: 'name' }, [swatch, s.label, el('small', { textContent: s.drives })]),
      canvas,
      value,
    ]));
    signalRows.push({ ...s, canvas, value, history: new Float32Array(HISTORY_LEN), head: 0 });
  }

  const slidersEl = document.getElementById('dev-sliders');
  for (const s of SLIDERS) {
    if (s.group) {
      const group = el('div', { className: 'group', textContent: s.group });
      if (s.probe) {
        probeLabel = el('span', { title: 'Median distance of the 7 neighbours each bird actually finds. Radii beyond this change little.' });
        group.classList.add('with-probe');
        group.append(probeLabel);
      }
      slidersEl.append(group);
      continue;
    }
    const id = `sl-${s.param}`;
    const def = DEFAULT_PARAMS[s.param];
    const input = el('input', { type: 'range', id, min: s.min, max: s.max, step: s.step, value: def });
    input.defaultValue = String(def);
    const base = el('span');
    const liveEl = el('span', { className: 'live' });
    const output = el('output', { htmlFor: id }, [base, liveEl]);
    const label = el('label', { htmlFor: id, textContent: s.label });
    const row = { ...s, input, base, liveEl, label };

    input.addEventListener('input', () => {
      physicsSystem.updateParams({ [s.param]: parseFloat(input.value) });
      syncSlider(row);
    });

    slidersEl.append(label, input, output);
    sliderRows.push(row);
    syncSlider(row);
  }

  resetBtn.addEventListener('click', () => {
    physicsSystem.updateParams(DEFAULT_PARAMS);
    for (const row of sliderRows) {
      row.input.value = DEFAULT_PARAMS[row.param];
      syncSlider(row);
    }
  });
}

function syncSlider(row) {
  const v = parseFloat(row.input.value);
  row.base.textContent = formatValue(v, row.step);
  row.label.classList.toggle('changed', v !== DEFAULT_PARAMS[row.param]);
  resetBtn.disabled = sliderRows.every(r => parseFloat(r.input.value) === DEFAULT_PARAMS[r.param]);
}

// Match canvas backing stores to their CSS size so charts stay crisp on HiDPI.
function sizeDevCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [spectrogram, ...signalRows.map(r => r.canvas)]) {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }
}

function drawSpectrogram() {
  const ctx = spectrogram.getContext('2d');
  const { width: w, height: h } = spectrogram;
  const data = audioSystem.dataArray;
  // 128 kbps MP3 has nothing above ~16 kHz (bin 186); log-scale the rows so
  // the bass and kick region isn't squashed into a few pixels.
  const maxBin = Math.min(186, data.length - 1);

  ctx.drawImage(spectrogram, -1, 0);
  const column = ctx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const frac = 1 - y / (h - 1);
    const bin = Math.round(Math.exp(frac * Math.log(maxBin + 1))) - 1;
    const v = Math.pow(data[bin] / 255, 2.2);
    // Quiet bins wash in as slate blue, loud ones deepen to ink
    const o = y * 4;
    column.data[o]     = 63 + (28 - 63) * v;
    column.data[o + 1] = 124 + (26 - 124) * v;
    column.data[o + 2] = 172 + (34 - 172) * v;
    column.data[o + 3] = Math.round(Math.min(1, v * 1.4) * 190);
  }
  ctx.clearRect(w - 1, 0, 1, h);
  ctx.putImageData(column, w - 1, 0);
}

function drawSignal(row, value) {
  row.history[row.head] = value;
  row.head = (row.head + 1) % HISTORY_LEN;
  row.value.textContent = value.toFixed(2);
  row.value.style.color = value > 0.3 ? COLORS[row.key] : '';

  const ctx = row.canvas.getContext('2d');
  const { width: w, height: h } = row.canvas;
  const pad = 2;
  const yOf = (v) => h - pad - Math.min(1, Math.max(0, v)) * (h - pad * 2);
  ctx.clearRect(0, 0, w, h);

  if (row.threshold !== undefined) {
    ctx.strokeStyle = 'rgba(28, 26, 34, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yOf(row.threshold)) + 0.5);
    ctx.lineTo(w, Math.round(yOf(row.threshold)) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  for (let i = 0; i < HISTORY_LEN; i++) {
    const v = row.history[(row.head + i) % HISTORY_LEN];
    const x = (i / (HISTORY_LEN - 1)) * w;
    if (i === 0) ctx.moveTo(x, yOf(v)); else ctx.lineTo(x, yOf(v));
  }
  ctx.strokeStyle = COLORS[row.key];
  ctx.lineWidth = 1.25 * (w / row.canvas.clientWidth || 1);
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = COLORS[row.key] + '22';
  ctx.fill();
}

function updateDevPanel(features) {
  devMeta.textContent = `${physicsSystem.boidsCount.toLocaleString()} birds, ${Math.round(fps)} fps`;

  const playing = audioSystem.isPlaying;
  audioState.textContent = !streamStarted && !playing ? 'waiting for ♪'
    : audioSystem.audioElement?.muted ? 'muted'
    : playing ? 'live' : 'connecting…';

  if (audioSystem.analyser) drawSpectrogram();
  for (const row of signalRows) drawSignal(row, features[row.key]);

  const scale = physicsSystem.worldScale;
  for (const row of sliderRows) {
    if (!row.live) continue;
    const v = row.live(parseFloat(row.input.value), features, scale);
    row.liveEl.textContent = playing ? ` → ${formatValue(v, row.step)}` : '';
  }

  if (probeLabel && frame % PROBE_EVERY === 0) {
    const spacing = physicsSystem.probeNeighborSpacing();
    probeLabel.textContent = `neighbors found at ≈ ${spacing.toFixed(0)}`;
  }
}

// ---------- Now playing ----------

async function fetchNowPlaying() {
  try {
    const res = await fetch('https://api.somafm.com/songs/defcon.json');
    if (!res.ok) return;
    const data = await res.json();
    const song = data.songs?.[0];
    if (!song) return;
    const label = `${song.artist} — ${song.title}`;
    if (nowPlayingText.textContent !== label) {
      nowPlayingEl.style.opacity = '0';
      setTimeout(() => {
        nowPlayingText.textContent = label;
        nowPlayingText.title = label;
        nowPlayingEl.classList.remove('hidden');
        nowPlayingEl.style.opacity = '';
      }, 400);
    }
  } catch (_) {
    // silently ignore network errors
  }
}

function startNowPlaying() {
  fetchNowPlaying();
  setInterval(fetchNowPlaying, 30_000);
}

// ---------- Loop ----------

function animate() {
  requestAnimationFrame(animate);
  frame++;

  const rawDelta = clock.getDelta();
  if (rawDelta > 0) fps = fps * 0.95 + (1 / rawDelta) * 0.05;
  // Clamp delta: after tab-away rAF pauses and getDelta() returns a huge value,
  // which would teleport all boids. Cap at ~33ms (30fps) for smooth resume.
  const delta = Math.min(rawDelta, 0.033);
  const time = clock.getElapsedTime();

  audioSystem.update();
  const audioFeatures = {
    energy: audioSystem.energy,
    bass: audioSystem.bass,
    mids: audioSystem.mids,
    treble: audioSystem.treble,
    kick: audioSystem.kick
  };

  physicsSystem.update(delta, time, audioFeatures);
  renderingSystem.update(physicsSystem, audioFeatures);

  if (isDevMode) updateDevPanel(audioFeatures);
}

// Start app
init();
