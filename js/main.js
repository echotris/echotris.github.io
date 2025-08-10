// js/main.js
// Echo Tetris — client-side landing/demo script
// - canvas is resized to fill .panel.right
// - full Tetris pieces + simple rotation system
// - L-system generator used to produce procedural incoming rows (runner feeling)
// - NFT generation produces preview on page and downloadable JSON with embedded PNG
// - safe: no automatic wallet connections; wallet only via explicit button
// - basic Gamepad API support and WebAudio ping
//
// Usage: include in index.html via <script type="module" src="/js/main.js"></script>

'use strict';

// ---- Safe selectors & helpers ----
const $ = (sel) => document.querySelector(sel) || null;
const $create = (tag, attrs = {}) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

function safeText(el, text) { if (el) el.textContent = text; }

// ---- Global handling for wallet-related noisy errors ----
window.addEventListener('error', (ev) => {
  try {
    const m = ev && ev.message ? ev.message.toString() : '';
    if (/MetaMask|eth_requestAccounts|ethereum|Failed to connect to MetaMask/i.test(m)) {
      console.warn('Wallet/extension error suppressed:', m);
      safeText($('#mintResult'), 'Wallet error intercepted: ' + m);
      ev.preventDefault && ev.preventDefault();
      return;
    }
  } catch (e) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason = ev && ev.reason ? (ev.reason.message || ev.reason).toString() : '';
    if (/MetaMask|eth_requestAccounts|ethereum|Failed to connect to MetaMask/i.test(reason)) {
      console.warn('Unhandled rejection (wallet) suppressed:', reason);
      safeText($('#mintResult'), 'Wallet connection was blocked: ' + reason);
      ev.preventDefault && ev.preventDefault();
      return;
    }
  } catch (e) {}
});

// ---- CountAPI ping (optional) ----
const COUNTER_API = 'https://api.countapi.xyz/hit/echo-tetris/plays';
async function hitCounter() {
  try {
    if (sessionStorage.getItem('echotetris_played')) return;
    sessionStorage.setItem('echotetris_played', '1');
    const r = await fetch(COUNTER_API);
    const j = await r.json();
    safeText($('#playsCounter'), 'Игроков: ' + (j.value ?? '—'));
  } catch (e) {
    console.warn('Counter error', e);
  }
}

// ---- WebAudio simple ping ----
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; console.warn('WebAudio not available', e); }
  }
}
function resumeAudioIfNeeded() {
  try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{}); }
  catch(e){}
}
function playPing(volume = 0.08) {
  try {
    ensureAudio();
    resumeAudioIfNeeded();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880 + Math.random()*220;
    g.gain.value = (Number($('#volume')?.value) || 0.6) * volume;
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch (e) { console.warn('playPing failed', e); }
}

// ---- Canvas resizing to fill .panel.right ----
function fitCanvasToPanel(canvas) {
  const panel = document.querySelector('.panel.right') || document.getElementById('gameContainer');
  if (!panel) return;
  // get computed size of panel
  const rect = panel.getBoundingClientRect();
  // set canvas CSS to fill container
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // set actual pixel buffer size for crisp rendering
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(300, Math.floor(rect.width * dpr));
  canvas.height = Math.max(200, Math.floor(rect.height * dpr));
  canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0); // scale drawing to device px
}

// ---- TETROMINOES (7 classic pieces) ----
// We'll store each tetromino as array of rotation matrices (4x4 grids)
const TETROMINOES = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]]
  ],
  O: [
    [[0,0,0,0],[0,1,1,0],[0,1,1,0],[0,0,0,0]]
  ],
  T: [
    [[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],
    [[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]],
    [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    [[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]]
  ],
  S: [
    [[0,0,0,0],[0,1,1,0],[1,1,0,0],[0,0,0,0]],
    [[1,0,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]]
  ],
  Z: [
    [[0,0,0,0],[1,1,0,0],[0,1,1,0],[0,0,0,0]],
    [[0,1,0,0],[1,1,0,0],[1,0,0,0],[0,0,0,0]]
  ],
  J: [
    [[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]],
    [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    [[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]]
  ],
  L: [
    [[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],
    [[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
    [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]]
  ]
};
const COLORS = {
  I: '#00f0f0', O: '#f0f000', T: '#a000f0', S: '#00f000', Z: '#f00000', J: '#0000f0', L: '#f09000'
};
const PIECES_KEYS = Object.keys(TETROMINOES);

// ---- L-System generator (simple, limited depth) ----
function generateLSystem(axiom = 'F', rules = { 'F': 'F[+F]F[-F]F' }, depth = 3) {
  let s = axiom;
  for (let i = 0; i < depth; i++) {
    let ns = '';
    for (const ch of s) {
      ns += rules[ch] || ch;
    }
    s = ns;
  }
  return s;
}
// Convert L-system string to 2D points (turtle) for visualization or mapping to columns
function lsystemToPoints(s, step = 10, angleDeg = 25) {
  const rad = (deg) => deg * Math.PI / 180;
  let x = 0, y = 0, angle = -90;
  const stack = [];
  const pts = [{x, y}];
  for (const ch of s) {
    if (ch === 'F') {
      x += Math.cos(rad(angle)) * step;
      y += Math.sin(rad(angle)) * step;
      pts.push({x, y});
    } else if (ch === '+') {
      angle += angleDeg;
    } else if (ch === '-') {
      angle -= angleDeg;
    } else if (ch === '[') {
      stack.push({x, y, angle});
    } else if (ch === ']') {
      const st = stack.pop();
      if (st) { x = st.x; y = st.y; angle = st.angle; pts.push({x, y}); }
    }
  }
  return pts;
}

// Map L-system points to a procedural row (10 columns): returns an array of booleans length 10 where true marks a "platform"/occupied cell
function lsystemToRow(pts, cols = 10) {
  if (!pts || !pts.length) return Array(cols).fill(false);
  // compute bounding box
  let minx = Infinity, maxx = -Infinity;
  for (const p of pts) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; }
  const range = Math.max(1, maxx - minx);
  const row = Array(cols).fill(false);
  for (const p of pts) {
    const t = (p.x - minx) / range;
    const idx = Math.floor(t * (cols - 1));
    row[idx] = true;
  }
  return row;
}

// ---- Game state ----
const GRID_COLS = 10;
const GRID_ROWS = 20; // visible rows
let grid = Array.from({length: GRID_ROWS}, () => Array(GRID_COLS).fill(null)); // null or {color}
let current = null; // {key, rotIndex, x, y}
let nextQueue = [];
let dropInterval = 800; // ms
let dropAccumulator = 0;
let lastTime = performance.now();
let score = Number(localStorage.getItem('echotetris_score') || 0);
let combo = 1;
let lsystemSeed = Number(localStorage.getItem('echotetris_seed') || Date.now());
let pulses = []; // resonance pulses {x,y,r,max,color,created}

// Helpers for grid checks
function canPlace(shape, x, y) {
  // shape: 4x4 grid array numbers 0/1
  for (let sy=0; sy<4; sy++){
    for (let sx=0; sx<4; sx++){
      if (shape[sy][sx]) {
        const gx = x + sx;
        const gy = y + sy;
        if (gx < 0 || gx >= GRID_COLS || gy >= GRID_ROWS) return false;
        if (gy >= 0 && grid[gy][gx]) return false;
      }
    }
  }
  return true;
}
function placeShape(shape, x, y, color) {
  for (let sy=0; sy<4; sy++){
    for (let sx=0; sx<4; sx++){
      if (shape[sy][sx]) {
        const gx = x + sx;
        const gy = y + sy;
        if (gy >= 0 && gy < GRID_ROWS && gx >= 0 && gx < GRID_COLS) {
          grid[gy][gx] = {color};
        }
      }
    }
  }
}
function clearLines() {
  let cleared = 0;
  for (let r = GRID_ROWS - 1; r >= 0; r--) {
    if (grid[r].every(cell => cell !== null)) {
      grid.splice(r, 1);
      grid.unshift(Array(GRID_COLS).fill(null));
      cleared++;
      r++; // recheck same index after splice
    }
  }
  return cleared;
}

// Create next piece
function spawnPiece() {
  if (nextQueue.length < 3) {
    // refill with random bag
    const bag = [...PIECES_KEYS].sort(()=>Math.random()-0.5);
    nextQueue.push(...bag);
  }
  const key = nextQueue.shift();
  const rotations = TETROMINOES[key];
  const rotIndex = 0;
  // initial position centered horizontally, y negative to spawn above
  const x = Math.floor((GRID_COLS / 2) - 2);
  const y = -2;
  return { key, rotIndex, x, y, rotations };
}

// Rotate helper with wall-kick naive
function rotateCurrent(dir) {
  if (!current) return;
  const rots = current.rotations;
  const newIndex = (current.rotIndex + dir + rots.length) % rots.length;
  const shape = rots[newIndex];
  // try offsets (0, -1, +1, -2, +2)
  const offsets = [0, -1, 1, -2, 2];
  for (const ox of offsets) {
    if (canPlace(shape, current.x + ox, current.y)) {
      current.rotIndex = newIndex;
      current.x += ox;
      return;
    }
  }
}

// integrate L-system to generate a new incoming row (procedural)
function generateIncomingRowFromLsystem() {
  // use seed to randomize rules/angle/depth slightly
  const rand = mulberry32(lsystemSeed = (lsystemSeed + 1));
  // choose depth 2..4
  const depth = 2 + Math.floor(rand()*2);
  const axiom = 'F';
  const rules = { 'F': 'F[+F]F[-F]F' };
  const s = generateLSystem(axiom, rules, depth);
  const pts = lsystemToPoints(s, 8, 25 + Math.floor(rand()*10));
  const row = lsystemToRow(pts, GRID_COLS);
  return row;
}

// PRNG helper for seedable randomness
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// shift grid up (runner) and append new bottom row procedurally; returns removed top row
function scrollGridUpAndAppend(rowBoolArray) {
  // remove top
  const top = grid.shift();
  // convert rowBoolArray into objects or null
  const newRow = rowBoolArray.map(b => b ? {color: '#333' } : null);
  grid.push(newRow);
  return top;
}

// Initialize game loop and rendering
function initGame(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  // determine cell size based on canvas height and width
  function computeCellSize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // each cell size so grid fits height
    const cellH = Math.floor((height) / GRID_ROWS);
    const cellW = Math.floor((width) / GRID_COLS);
    return Math.max(8, Math.min(cellH, cellW));
  }

  let cellSize = computeCellSize();

  function resize() {
    fitCanvasToPanel(canvas);
    // recompute cell size after panel fit
    cellSize = computeCellSize();
  }
  window.addEventListener('resize', resize);
  resize();

  // initial pieces
  if (!current) current = spawnPiece();
  // seed next queue
  while (nextQueue.length < 5) nextQueue.push(PIECES_KEYS[Math.floor(Math.random()*PIECES_KEYS.length)]);

  // input handlers
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'ArrowLeft') {
      if (canPlace(current.rotations[current.rotIndex], current.x - 1, current.y)) current.x -= 1;
    } else if (e.key === 'ArrowRight') {
      if (canPlace(current.rotations[current.rotIndex], current.x + 1, current.y)) current.x += 1;
    } else if (e.key === 'ArrowDown') {
      // soft drop
      if (canPlace(current.rotations[current.rotIndex], current.x, current.y + 1)) current.y += 1;
    } else if (e.key === ' ') {
      rotateCurrent(1);
    } else if (e.key === 'Enter') {
      // hard drop
      while (canPlace(current.rotations[current.rotIndex], current.x, current.y + 1)) current.y += 1;
      lockCurrent();
    }
  });

  // gamepad polling
  function pollGamepad() {
    try {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const g of gps) {
        if (!g) continue;
        // dpad: axes/buttons mapping may vary; using typical mapping
        if (g.buttons[14] && g.buttons[14].pressed) {
          if (canPlace(current.rotations[current.rotIndex], current.x - 1, current.y)) current.x -= 1;
        }
        if (g.buttons[15] && g.buttons[15].pressed) {
          if (canPlace(current.rotations[current.rotIndex], current.x + 1, current.y)) current.x += 1;
        }
        if (g.buttons[0] && g.buttons[0].pressed) {
          // A button -> rotate
          rotateCurrent(1);
        }
        if (g.buttons[1] && g.buttons[1].pressed) {
          // B button -> soft drop
          if (canPlace(current.rotations[current.rotIndex], current.x, current.y + 1)) current.y += 1;
        }
      }
    } catch (e) {}
    requestAnimationFrame(pollGamepad);
  }
  requestAnimationFrame(pollGamepad);

  // lock current piece
  function lockCurrent() {
    const shape = current.rotations[current.rotIndex];
    placeShape(shape, current.x, current.y, COLORS[current.key] || '#fff');
    // create a pulse centered on the placed piece (visual resonance)
    const centerX = Math.floor((current.x + 2) * cellSize);
    const centerY = Math.floor((current.y + 2) * cellSize);
    pulses.push({x: centerX, y: centerY, r: 0, max: Math.max(canvas.width, canvas.height)/2, color: COLORS[current.key] || '#fff', created: performance.now() });
    const cleared = clearLines();
    if (cleared > 0) {
      score += cleared * cleared * 100 * combo;
      combo = Math.min(5, combo + cleared*0.5);
      playPing(0.12 + cleared*0.02);
    } else {
      score += 10 * combo;
      combo = Math.max(1, combo - 0.05);
      playPing(0.06);
    }
    // save score
    localStorage.setItem('echotetris_score', String(score));
    safeText($('#score'), score);
    // spawn new piece
    current = spawnPiece();
  }

  // update loop
  function update(dt) {
    dropAccumulator += dt;
    if (dropAccumulator > dropInterval) {
      dropAccumulator = 0;
      // gravity drop; if cannot drop, lock
      if (canPlace(current.rotations[current.rotIndex], current.x, current.y + 1)) {
        current.y += 1;
      } else {
        lockCurrent();
      }
    }

    // pulses expansion
    for (const p of pulses) p.r += 300 * dt;
    // remove old pulses
    pulses = pulses.filter(p => p.r < p.max);

    // occasionally scroll grid up and append l-system row to create runner feeling
    // every ~12 seconds
    const t = performance.now();
    if (!update._lastScroll) update._lastScroll = t;
    if (t - update._lastScroll > 12000) {
      update._lastScroll = t;
      const row = generateIncomingRowFromLsystem();
      scrollGridUpAndAppend(row);
      // small reward for surviving scroll
      score += 50;
      localStorage.setItem('echotetris_score', String(score));
      safeText($('#score'), score);
    }
  }

  // render loop
  function render() {
    // clear
    ctx.clearRect(0,0,canvas.width,canvas.height);
    // background
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);

    // compute offset to center grid
    const gridW = GRID_COLS * cellSize;
    const gridH = GRID_ROWS * cellSize;
    const offsetX = (canvas.clientWidth - gridW) / 2;
    const offsetY = (canvas.clientHeight - gridH) / 2;

    // draw grid cells
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = grid[r][c];
        const x = offsetX + c*cellSize;
        const y = offsetY + r*cellSize;
        if (cell) {
          ctx.fillStyle = cell.color || '#888';
          roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4);
          ctx.fill();
          // outline
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.strokeRect(x+1, y+1, cellSize-2, cellSize-2);
        } else {
          // empty cell subtle grid
          ctx.strokeStyle = 'rgba(255,255,255,0.02)';
          ctx.strokeRect(x+1, y+1, cellSize-2, cellSize-2);
        }
      }
    }

    // draw current piece
    if (current) {
      const shape = current.rotations[current.rotIndex];
      const color = COLORS[current.key] || '#fff';
      for (let sy=0; sy<4; sy++){
        for (let sx=0; sx<4; sx++){
          if (shape[sy][sx]) {
            const gx = current.x + sx;
            const gy = current.y + sy;
            const x = offsetX + gx*cellSize;
            const y = offsetY + gy*cellSize;
            // only draw visible cells (gy >= 0)
            if (gy >= 0) {
              ctx.fillStyle = color;
              roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4);
              ctx.fill();
              ctx.strokeStyle = 'rgba(255,255,255,0.06)';
              ctx.strokeRect(x+1, y+1, cellSize-2, cellSize-2);
            }
          }
        }
      }
    }

    // draw pulses (resonance)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of pulses) {
      const grad = ctx.createRadialGradient(p.x, p.y, p.r*0.02, p.x, p.y, p.r);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x + offsetX, p.y + offsetY, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // HUD small overlay: next piece and score
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(10,10,120,70);
    ctx.fillStyle = '#fff';
    ctx.font = '14px system-ui, Arial';
    ctx.fillText('Score: ' + score, 18, 30);
    ctx.fillText('Combo: x' + combo.toFixed(1), 18, 52);
    ctx.fillText('Next:', 18, 74);
    // draw next miniature
    if (nextQueue && nextQueue.length) {
      const nk = nextQueue[0];
      const rot = TETROMINOES[nk][0];
      const miniX = 70, miniY = 52, miniCell = 8;
      for (let sy=0; sy<4; sy++){
        for (let sx=0; sx<4; sx++){
          if (rot[sy][sx]) {
            ctx.fillStyle = COLORS[nk] || '#fff';
            ctx.fillRect(miniX + sx*miniCell, miniY + sy*miniCell, miniCell-1, miniCell-1);
          }
        }
      }
    }
  }

  // util: rounded rect path
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // frame loop
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime)/1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  lastTime = performance.now();
  requestAnimationFrame(frame);

  return {
    getScore: () => score,
    forceSpawn: () => { current = spawnPiece(); }
  };
}

// ---- NFT generation: create on-page preview and download JSON ----
async function generateNFTOnPage() {
  try {
    const gameCanvas = document.getElementById('gameCanvas');
    if (!gameCanvas) { alert('Нет игрового холста'); return; }
    // create an offscreen canvas to compose badge + snapshot
    const w = 800, h = 800;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const g = off.getContext('2d');
    // background gradient
    const lg = g.createLinearGradient(0,0,w,h);
    lg.addColorStop(0, '#0b1220');
    lg.addColorStop(1, '#061018');
    g.fillStyle = lg; g.fillRect(0,0,w,h);

    // draw snapshot of the current game area centered (scaled)
    const snapScale = 0.7;
    const targetW = Math.floor(w * snapScale);
    const targetH = Math.floor(h * 0.45);
    // use gameCanvas as image source
    g.drawImage(gameCanvas, (w - targetW)/2, 80, targetW, targetH);

    // overlay L-system thumbnail: render a tiny L-system based on seed
    const s = generateLSystem('F', {F:'F[+F]F[-F]F'}, 3);
    const pts = lsystemToPoints(s, 6, 25);
    g.save();
    g.translate(w/2, targetH + 150);
    g.strokeStyle = '#00e6ff'; g.lineWidth = 2;
    g.beginPath();
    for (let i=0;i<pts.length;i++){
      const p = pts[i];
      if (i===0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();
    g.restore();

    // text metadata
    g.fillStyle = '#fff';
    g.font = '24px system-ui';
    g.fillText('Echo Tetris • Resonant Fragment', 40, 40);
    g.font = '16px system-ui';
    const now = new Date().toISOString();
    g.fillText('Created: ' + now, 40, h - 40);

    // create dataURL
    const dataURL = off.toDataURL('image/png');

    // show preview on page
    let preview = $('#nftPreview');
    if (!preview) {
      preview = $create('img', { id: 'nftPreview', alt: 'NFT Preview' });
      preview.style.maxWidth = '320px';
      preview.style.border = '1px solid rgba(255,255,255,0.06)';
      preview.style.display = 'block';
      preview.style.marginTop = '12px';
      $('#mintResult')?.appendChild(preview);
    }
    preview.src = dataURL;

    // prepare JSON
    const meta = {
      title: 'EchoTetris Fragment',
      score: Number(localStorage.getItem('echotetris_score') || 0),
      seed: lsystemSeed,
      created: now
    };
    const payload = { meta, png: dataURL };
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const url = URL.createObjectURL(blob);

    // create download button
    let dl = $('#nftDownloadBtn');
    if (!dl) {
      dl = $create('a', { id: 'nftDownloadBtn', href: url, download: `echotetris_nft_${Date.now()}.json` });
      dl.textContent = 'Скачать NFT (JSON + PNG)';
      dl.style.display = 'inline-block';
      dl.style.marginLeft = '12px';
      dl.style.padding = '8px 12px';
      dl.style.background = 'linear-gradient(90deg,#00e6ff,#ff6ad5)';
      dl.style.color = '#021';
      dl.style.borderRadius = '8px';
      $('#mintResult')?.appendChild(dl);
    } else {
      dl.href = url;
    }

    safeText($('#mintResult'), 'NFT сгенерирован на странице. Превью ниже.');
    playPing(0.12);
  } catch (e) {
    console.warn('generateNFTOnPage fail', e);
    safeText($('#mintResult'), 'Ошибка генерации NFT: ' + (e.message || e));
  }
}

// ---- Storage clearing ----
async function clearAllGameData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('echotetris')) localStorage.removeItem(k);
    if (window.indexedDB) {
      const req = indexedDB.deleteDatabase('echotetris-db');
      req.onerror = ()=>console.warn('db delete error');
    }
    alert('Локальные данные очищены');
  } catch (e) { console.warn('clearAllGameData', e); alert('Ошибка при очистке: ' + (e.message || e)); }
}

// ---- Safe wallet connect (only on user click) ----
async function connectWallet() {
  if (!window.ethereum) {
    alert('Кошелёк (MetaMask) не обнаружен в браузере.');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    safeText($('#mintResult'), 'Wallet connected: ' + (accounts && accounts[0] ? accounts[0] : '—'));
  } catch (e) {
    console.warn('connectWallet fail', e);
    safeText($('#mintResult'), 'Не удалось подключить кошелёк: ' + (e.message || e));
  }
}

// ---- Init everything on load ----
window.addEventListener('load', () => {
  hitCounter();
  // canvas setup: ensure the element exists and fits panel
  let canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    canvas = $create('canvas', { id: 'gameCanvas', width: '640', height: '360' });
    const container = document.getElementById('gameContainer') || document.querySelector('.panel.right') || document.body;
    container.appendChild(canvas);
  }
  // make sure canvas fills container
  fitCanvasToPanel(canvas);

  // small UI hookups
  $('#startButton')?.addEventListener('click', ()=> document.getElementById('play')?.scrollIntoView({behavior:'smooth'}));
  $('#playDemo')?.addEventListener('click', ()=> document.getElementById('play')?.scrollIntoView({behavior:'smooth'}));
  $('#howTo')?.addEventListener('click', ()=> alert('Управление: стрелки влево/вправо, пробел — вращение, Enter — харддроп. Поддерживается геймпад.'));

  $('#resetStorage')?.addEventListener('click', ()=> { if (confirm('Удалить все данные игры?')) clearAllGameData(); });

  $('#generateNFT')?.addEventListener('click', ()=> {
    const s = Number(localStorage.getItem('echotetris_score')||0);
    if (s < 10) return alert('Нужно минимум 10 очков для генерации NFT (демо).');
    generateNFTOnPage();
  });

  $('#convertCBDC')?.addEventListener('click', ()=> {
    const s = Number(localStorage.getItem('echotetris_score')||0);
    if (s < 20) return alert('Нужно минимум 20 очков для конвертации (демо).');
    // simulate conversion
    const wallet = JSON.parse(localStorage.getItem('echotetris_wallet') || '{"balance":0}');
    wallet.balance = (wallet.balance || 0) + Math.floor(s / 10);
    localStorage.setItem('echotetris_wallet', JSON.stringify(wallet));
    safeText($('#mintResult'), `Симуляция: в локальный кошелёк зачислено ${Math.floor(s/10)} единиц (demo).`);
  });

  // wallet connect explicit button
  $('#connectWallet')?.addEventListener('click', async () => {
    ensureAudio(); resumeAudioIfNeeded();
    await connectWallet();
  });

  // volume restore
  try {
    const volEl = $('#volume');
    if (volEl) {
      const v = localStorage.getItem('echotetris_volume');
      if (v) volEl.value = v;
      volEl.addEventListener('input', (e) => localStorage.setItem('echotetris_volume', e.target.value));
    }
  } catch (e) {}

  // create and start game
  const engine = initGame(canvas);
  // expose in window for debugging
  window._EchoTetris = { engine, grid, generateLSystem, lsystemToPoints };
});
