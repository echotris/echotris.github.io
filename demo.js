// demo.js — Echo Tetris standalone demo
// - separate canvas for background (bgCanvas) and game (gameCanvas)
// - automatic falling pieces
// - terrain array per column; L-system influences terrain changes
// - MetaMask connect button: get ETH balance and convert to RUB via CoinGecko API
// - WebAudio for sounds, volume control saved in localStorage
// - No automatic wallet requests; only on user 'Connect Wallet' click

/* =======  CONFIG ======= */
const COLS = 10;
const ROWS = 20;
const DROP_INTERVAL_BASE = 700; // ms base gravity
const SCROLL_INTERVAL_MS = 11000; // L-system/terrain injection interval
const TERRAIN_MAX = 12; // max extra height per column (affects collision)
const BG_SPEED = 0.0008; // background animation speed
/* ======================== */

// Safe DOM helpers
const $ = (s) => document.querySelector(s);
const $id = (id) => document.getElementById(id);
const msg = (t) => { const el = $('#msg'); if (el) el.textContent = t; };

// State
let canvas, ctx, bgCanvas, bgCtx;
let width=800, height=600;
let cellSize = 24;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

let grid = Array.from({length: ROWS}, () => Array(COLS).fill(null));
let terrain = Array.from({length: COLS}, () => 0); // heights added to bottom (0..TERRAIN_MAX)
let current = null;
let nextQueue = [];
let score = Number(localStorage.getItem('echotetris_score') || 0);
let engineRunning = false;
let lastTick = performance.now();
let accumulator = 0;
let dropInterval = DROP_INTERVAL_BASE;
let lsystemSeed = Number(localStorage.getItem('echotetris_seed') || Date.now());
let prng = mulberry32(lsystemSeed);
let pulses = []; // visual pulses {x,y,r,max,color}
let bgTime = 0;

// TETROMINOES
const T = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]]
  ],
  O: [[[0,0,0,0],[0,1,1,0],[0,1,1,0],[0,0,0,0]]],
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
const COLOR = { I:'#00f0f0', O:'#f0f000', T:'#a000f0', S:'#00f000', Z:'#f00000', J:'#0000f0', L:'#f09000' };
const PIECE_KEYS = Object.keys(T);

// WebAudio
let audioCtx = null;
function initAudio(){ try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ audioCtx = null; } }
function playTone(freq=440, dur=0.06, vol=0.08){
  try{
    if(!audioCtx) initAudio();
    if(!audioCtx) return;
    const g = audioCtx.createGain();
    g.gain.value = (Number($('#volume')?.value) || 0.6) * vol;
    const o = audioCtx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }catch(e){}
}

// Utilities
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// L-system generator
function generateL(axiom='F', rules={'F':'F[+F]F[-F]F'}, depth=3){
  let s = axiom;
  for(let i=0;i<depth;i++){
    let ns='';
    for(const ch of s) ns += rules[ch] || ch;
    s = ns;
  }
  return s;
}
function lToPoints(s, step=8, angle=25){
  const rad = (d) => d*Math.PI/180;
  let x=0,y=0,ang=-90;
  const stack=[];
  const pts=[{x,y}];
  for(const ch of s){
    if(ch==='F'){ x += Math.cos(rad(ang))*step; y += Math.sin(rad(ang))*step; pts.push({x,y}); }
    else if(ch==='+') ang += angle;
    else if(ch==='-') ang -= angle;
    else if(ch==='[') stack.push({x,y,ang});
    else if(ch===']'){ const st = stack.pop(); if(st){ x=st.x;y=st.y;ang=st.ang; pts.push({x,y}); } }
  }
  return pts;
}
// Map l-system points to column influence (0..1 per column)
function lToColumns(pts, cols=COLS){
  let minx=Infinity,maxx=-Infinity;
  for(const p of pts){ if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; }
  const range = Math.max(1, maxx-minx);
  const arr = new Array(cols).fill(0);
  for(const p of pts){
    const t = (p.x-minx)/range;
    const idx = Math.min(cols-1, Math.max(0, Math.floor(t*cols)));
    arr[idx] += 1;
  }
  // normalize
  const maxv = Math.max(...arr);
  if(maxv <= 0) return arr.map(()=>0);
  return arr.map(v => v/maxv);
}

/* ===== GAME LOGIC ===== */

// spawn piece
function spawn(){
  if(nextQueue.length < 3){
    // create bag shuffle
    const bag = [...PIECE_KEYS];
    for(let i=bag.length-1;i>0;i--){ const j=Math.floor(prng()* (i+1)); [bag[i],bag[j]]=[bag[j],bag[i]]; }
    nextQueue.push(...bag);
  }
  const key = nextQueue.shift();
  return { key, rot:0, x: Math.floor(COLS/2)-2, y: -2, shapeSet: T[key] };
}

// shape access
function shapeOf(piece){
  return piece.shapeSet[piece.rot % piece.shapeSet.length];
}

// collision wrt grid and terrain
function canPlaceAt(shape, x, y){
  for(let sy=0; sy<4; sy++){
    for(let sx=0; sx<4; sx++){
      if(shape[sy][sx]){
        const gx = x + sx;
        const gy = y + sy;
        if(gx < 0 || gx >= COLS) return false;
        // if below visible grid -> collision
        if(gy >= ROWS) return false;
        // terrain: if gy >= ROWS - terrain[gx] -> collision with ground
        if(gy >= ROWS - terrain[gx]) return false;
        if(gy >= 0 && grid[gy][gx]) return false;
      }
    }
  }
  return true;
}

// place piece into grid
function placePiece(piece){
  const shape = shapeOf(piece);
  for(let sy=0; sy<4; sy++){
    for(let sx=0; sx<4; sx++){
      if(shape[sy][sx]){
        const gx = piece.x + sx;
        const gy = piece.y + sy;
        if(gy >= 0 && gy < ROWS && gx>=0 && gx<COLS) grid[gy][gx] = { color: COLOR[piece.key] || '#fff' };
      }
    }
  }
}

// clear lines
function clearLines(){
  let cleared=0;
  for(let r=ROWS-1;r>=0;r--){
    if(grid[r].every(c => c !== null)){
      grid.splice(r,1);
      grid.unshift(Array(COLS).fill(null));
      cleared++;
      r++; // re-evaluate same index after splice
    }
  }
  return cleared;
}

// integrate terrain change: when placing piece, influence terrain heights
function modifyTerrainByPiece(piece){
  // influence columns under the piece; use L-system influence for richer shape
  const s = generateL('F','F[+F]F[-F]F', 2 + Math.floor(prng()*2));
  const pts = lToPoints(s, 6, 20 + Math.floor(prng()*10));
  const colInfluence = lToColumns(pts, COLS);
  const shape = shapeOf(piece);
  for(let sx=0;sx<4;sx++){
    for(let sy=0;sy<4;sy++){
      if(shape[sy][sx]){
        const gx = piece.x + sx;
        if(gx<0||gx>=COLS) continue;
        // compute delta from influence and block vertical position
        const baseDelta = 1;
        const influence = Math.round(colInfluence[gx] * 2);
        terrain[gx] = Math.min(TERRAIN_MAX, Math.max(0, terrain[gx] + baseDelta + influence - (sy)));
      }
    }
  }

  // smooth terrain to avoid impossible cliffs
  for(let i=0;i<COLS;i++){
    if(i>0) terrain[i] = Math.round((terrain[i] + terrain[i-1])/2);
  }
}

// scroll terrain up slightly as runner effect
function scrollTerrain(){
  // rotate terrain array slightly (simulate movement)
  if(prng() > 0.5){
    // shift right with small random change
    const last = terrain.pop();
    terrain.unshift(Math.max(0, Math.min(TERRAIN_MAX, Math.round(last + (prng()-0.5)*2))));
  } else {
    const first = terrain.shift();
    terrain.push(Math.max(0, Math.min(TERRAIN_MAX, Math.round(first + (prng()-0.5)*2))));
  }
}

// main tick step: gravity automatic
function tickStep(dt){
  if(!current) current = spawn();
  accumulator += dt;
  if(accumulator > dropInterval){
    accumulator = 0;
    // try move piece down
    if(canPlaceAt(shapeOf(current), current.x, current.y+1)){
      current.y += 1;
    } else {
      // lock
      placePiece(current);
      modifyTerrainByPiece(current);
      // create pulse for visuals
      const px = (current.x + 2) * cellSize + (cellSize/2);
      const py = (current.y + 2) * cellSize + (cellSize/2);
      pulses.push({x:px, y:py, r:0, max: Math.max(width,height)/2, color: COLOR[current.key] || '#fff'});
      const cleared = clearLines();
      if(cleared>0){
        score += cleared*cleared*100;
        playTone(600 + cleared*80,0.09,0.14);
      } else {
        score += 10;
        playTone(320,0.06,0.08);
      }
      // periodically run an L-system injection event
      if(prng() > 0.4) {
        const row = lToColumns(lToPoints(generateL('F','F[+F]F[-F]F',2 + Math.floor(prng()*2))), COLS).map(v => v > 0.6);
        // apply to terrain or push into grid as small obstacles
        for(let c=0;c<COLS;c++){
          if(row[c]) terrain[c] = Math.min(TERRAIN_MAX, terrain[c] + 1);
        }
      }
      // small runner scroll and maybe add gentle randomization
      scrollTerrain();
      // spawn next
      current = spawn();
      // persist
      localStorage.setItem('echotetris_score', String(score));
      localStorage.setItem('echotetris_seed', String(lsystemSeed));
      $('#scoreBox').textContent = 'Score: ' + score;
      $('#seedBox').textContent = String(lsystemSeed);
    }
  }
}

// Draw background (procedural moving 'relief')
function drawBackground(now){
  bgTime += (now*BG_SPEED);
  const w = bgCanvas.width;
  const h = bgCanvas.height;
  bgCtx.clearRect(0,0,w,h);

  // multi-layer sine waves with moving offsets and subtle noise
  const layers = 4;
  for(let L=0; L < layers; L++){
    const amp = 6 + L*6;
    const freq = 0.002 + L*0.0012;
    const speed = 0.06 + L*0.02;
    bgCtx.beginPath();
    for(let x=0;x<w;x+=2){
      const y = h*0.5 + Math.sin((x*freq) + bgTime*speed + L) * amp * (1 + Math.sin(bgTime*0.002 + L));
      if(x===0) bgCtx.moveTo(x,y); else bgCtx.lineTo(x,y);
    }
    const grd = bgCtx.createLinearGradient(0,0,0,h);
    const c1 = `rgba(${20+L*10},${30+L*20},${80+L*10},${0.03 + L*0.02})`;
    const c2 = `rgba(${10+L*5},${12+L*5},${22+L*5},${0})`;
    grd.addColorStop(0, c1);
    grd.addColorStop(1, c2);
    bgCtx.strokeStyle = grd;
    bgCtx.lineWidth = 1 + L*0.5;
    bgCtx.stroke();
  }
}

// render game grid, terrain and piece
function render(){
  ctx.clearRect(0,0,width,height);
  // background fill
  ctx.fillStyle = '#02030a';
  ctx.fillRect(0,0,width,height);

  // compute area for grid (centered)
  const gridW = COLS * cellSize;
  const gridH = ROWS * cellSize;
  const offsetX = (width - gridW)/2;
  const offsetY = (height - gridH)/2;

  // draw terrain as bottom overlay
  for(let c=0;c<COLS;c++){
    const th = terrain[c];
    for(let t=0;t<th;t++){
      const gx = offsetX + c*cellSize;
      const gy = offsetY + (ROWS - 1 - t)*cellSize;
      ctx.fillStyle = 'rgba(60,60,60,0.9)';
      ctx.fillRect(gx+2, gy+2, cellSize-4, cellSize-4);
    }
  }

  // draw grid cells
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const cell = grid[r][c];
      const x = offsetX + c*cellSize;
      const y = offsetY + r*cellSize;
      if(cell){
        ctx.fillStyle = cell.color;
        roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
      }
    }
  }

  // draw current piece
  if(current){
    const shape = shapeOf(current);
    const color = COLOR[current.key] || '#fff';
    for(let sy=0; sy<4; sy++){
      for(let sx=0; sx<4; sx++){
        if(shape[sy][sx]){
          const gx = current.x + sx;
          const gy = current.y + sy;
          if(gy >= 0){
            const x = offsetX + gx*cellSize;
            const y = offsetY + gy*cellSize;
            ctx.fillStyle = color;
            roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
          }
        }
      }
    }
  }

  // pulses visual
  ctx.globalCompositeOperation = 'lighter';
  for(const p of pulses){
    p.r += 180 * (1/60); // grow some each frame
    const grad = ctx.createRadialGradient(p.x, p.y, p.r*0.05, p.x, p.y, p.r);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();
  }
  pulses = pulses.filter(p => p.r < p.max);
  ctx.globalCompositeOperation = 'source-over';

  // HUD overlay
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(8,8,180,72);
  ctx.fillStyle = '#fff';
  ctx.font = '16px system-ui';
  ctx.fillText('Score: ' + score, 16, 30);
  ctx.fillText('Seed: ' + lsystemSeed, 16, 54);
}

// util: rounded rect
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// resize canvas to fill container
function fitCanvases(){
  const panel = $('#game-area');
  if(!panel) return;
  const rect = panel.getBoundingClientRect();
  width = Math.max(320, Math.floor(rect.width * dpr));
  height = Math.max(240, Math.floor(rect.height * dpr));
  // set canvas internal size
  canvas.width = width; canvas.height = height;
  bgCanvas.width = width; bgCanvas.height = height;
  // set CSS size to 100% so it visually fills panel
  canvas.style.width = '100%'; canvas.style.height = '100%';
  bgCanvas.style.width = '100%'; bgCanvas.style.height = '100%';
  // recompute cell size from layout
  const cellH = Math.floor((rect.height) / ROWS);
  const cellW = Math.floor((rect.width) / COLS);
  cellSize = Math.max(12, Math.min(cellH, cellW));
}

// main loop
function loop(now){
  if(!engineRunning){ requestAnimationFrame(loop); return; }
  const tnow = performance.now();
  const dt = tnow - lastTick;
  lastTick = tnow;
  tickStep(dt);
  drawBackgroundFrame(tnow);
  render();
  requestAnimationFrame(loop);
}

// draw BG frame (call drawBackground)
function drawBackgroundFrame(now){
  try{
    drawBackground(now);
  }catch(e){ /* ignore */ }
  // paint bgCanvas from bgCtx drawing
  // bg drawing done in drawBackground()
  // no further steps here
}

// event hookups
function setupUI(){
  $('#startBtn').addEventListener('click', ()=> {
    if(!engineRunning){
      engineRunning = true;
      lastTick = performance.now();
      requestAnimationFrame(loop);
      $('#startBtn').textContent = 'Running';
    }
  });
  $('#pauseBtn').addEventListener('click', ()=> {
    engineRunning = !engineRunning;
    $('#pauseBtn').textContent = engineRunning ? 'Pause' : 'Resume';
    if(engineRunning){
      lastTick = performance.now(); requestAnimationFrame(loop);
    }
  });
  $('#resetBtn').addEventListener('click', ()=> {
    if(confirm('Reset game data (score/seed)?')){
      localStorage.removeItem('echotetris_score');
      localStorage.removeItem('echotetris_seed');
      location.reload();
    }
  });
  $('#genNFT').addEventListener('click', ()=> generateNFT());
  $('#volume').addEventListener('input', ()=> localStorage.setItem('echotetris_volume', $('#volume').value));
  $('#connectWallet').addEventListener('click', ()=> connectWallet());
}

// connect wallet and display balance in RUB (via CoinGecko)
async function connectWallet(){
  try{
    if(!window.ethereum){ alert('MetaMask / Ethereum provider not found.'); return; }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const addr = accounts && accounts[0];
    if(!addr) { msg('No account found'); return; }
    $('#msg').textContent = 'Connected: ' + addr.slice(0,8) + '…';
    // get balance in wei
    const balHex = await window.ethereum.request({ method: 'eth_getBalance', params: [addr, 'latest'] });
    const balWei = BigInt(balHex);
    const ethBalance = Number(balWei) / 1e18;
    // fetch ETH->RUB rate from CoinGecko
    let rubRate = null;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=rub');
      const j = await r.json();
      if(j && j.ethereum && j.ethereum.rub) rubRate = j.ethereum.rub;
    } catch(e){
      console.warn('rate fetch fail', e);
    }
    let rubText = '—';
    if(rubRate !== null) rubText = (ethBalance * rubRate).toFixed(2) + ' ₽';
    else rubText = ethBalance.toFixed(6) + ' ETH';
    $('#balanceBox').textContent = 'Wallet: ' + rubText;
  } catch(e){
    console.warn('wallet connect fail', e);
    $('#msg').textContent = 'Wallet error: ' + (e && e.message ? e.message : e);
  }
}

// NFT generation: compose on-page PNG and allow download
function generateNFT(){
  try{
    // compose offscreen canvas
    const off = document.createElement('canvas');
    off.width = 800; off.height = 800;
    const g = off.getContext('2d');
    // bg gradient
    const grd = g.createLinearGradient(0,0,0,800);
    grd.addColorStop(0,'#071021'); grd.addColorStop(1,'#02030a');
    g.fillStyle = grd; g.fillRect(0,0,800,800);
    // draw snapshot of visible game
    g.drawImage(canvas, 100, 60, 600, 320);
    // draw seed l-system small
    const s = generateL('F','F[+F]F[-F]F', 3);
    const pts = lToPoints(s,6,20);
    g.save(); g.translate(400,420);
    g.strokeStyle = '#00e6ff'; g.lineWidth = 2;
    g.beginPath();
    for(let i=0;i<pts.length;i++){
      const p = pts[i];
      if(i===0) g.moveTo(p.x,p.y); else g.lineTo(p.x,p.y);
    }
    g.stroke(); g.restore();
    // title
    g.fillStyle = '#fff'; g.font = '26px system-ui';
    g.fillText('Echo Tetris — Fragment', 30, 40);
    // meta
    const meta = { score:score, seed:lsystemSeed, created: (new Date()).toISOString() };
    // show preview
    const dataURL = off.toDataURL('image/png');
    let img = $('#nftPreview');
    if(!img){ img = document.createElement('img'); img.id='nftPreview'; img.style.display='block'; img.style.marginTop='12px'; $('#msg').appendChild(img); }
    img.src = dataURL;
    // prepare JSON
    const payload = { meta, png: dataURL };
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `echotetris_fragment_${Date.now()}.json`;
    a.textContent = 'Download NFT JSON';
    a.style.display='inline-block'; a.style.marginLeft='12px'; a.style.padding='8px 12px';
    a.style.background='linear-gradient(90deg,#00e6ff,#ff6ad5)'; a.style.color='#021'; a.style.borderRadius='8px';
    $('#msg').appendChild(a);
    $('#msg').textContent = 'NFT generated locally. Preview below.';
    playTone(780,0.12,0.14);
  }catch(e){ console.warn('nft gen fail', e); $('#msg').textContent = 'NFT generation failed: ' + (e.message||e); }
}

// keyboard controls for rotate/move/hard drop
function setupInput(){
  window.addEventListener('keydown', (e)=>{
    if(!current) return;
    if(e.key === 'ArrowLeft'){ if(canPlaceAt(shapeOf(current), current.x-1, current.y)) current.x--; }
    else if(e.key === 'ArrowRight'){ if(canPlaceAt(shapeOf(current), current.x+1, current.y)) current.x++; }
    else if(e.key === 'ArrowDown'){ if(canPlaceAt(shapeOf(current), current.x, current.y+1)) current.y++; }
    else if(e.key === ' '){ // rotate
      const nextRot = (current.rot+1) % current.shapeSet.length;
      const shapet = current.shapeSet[nextRot];
      // try wall kicks
      const tries = [0,-1,1,-2,2];
      for(const off of tries){
        if(canPlaceAt(shapet, current.x + off, current.y)){ current.rot = nextRot; current.x += off; break; }
      }
    } else if(e.key === 'Enter'){
      while(canPlaceAt(shapeOf(current), current.x, current.y+1)) current.y++;
      // lock immediately in next tick
    }
  });
}

// init everything
function init(){
  // nodes
  canvas = $('#gameCanvas'); ctx = canvas.getContext('2d');
  bgCanvas = $('#bgCanvas'); bgCtx = bgCanvas.getContext('2d');

  // initial size
  fitCanvases();
  window.addEventListener('resize', ()=> { dpr = Math.min(window.devicePixelRatio || 1, 2); fitCanvases(); });

  // restore volume
  const v = localStorage.getItem('echotetris_volume'); if(v) $('#volume').value = v;

  // seed
  prng = mulberry32(lsystemSeed);
  $('#seedBox').textContent = String(lsystemSeed);
  $('#scoreBox').textContent = 'Score: ' + score;

  // preload next
  while(nextQueue.length < 5) nextQueue.push(PIECE_KEYS[Math.floor(prng()*PIECE_KEYS.length)]);

  // initial current
  current = spawn();

  // set intervals
  lastTick = performance.now();
  engineRunning = false;

  // UI
  setupUI();
  setupInput();

  // start BG animation loop independent of engine
  (function bgLoop(now){
    drawBackground(now);
    requestAnimationFrame(bgLoop);
  })();

  // start engine loop only after Start pressed
  requestAnimationFrame(loop);
}

// draw background on bgCtx (procedural)
function drawBackground(now){
  if(!bgCtx) return;
  bgCtx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
  const w = bgCanvas.width, h = bgCanvas.height;
  const t = performance.now() * BG_SPEED;
  // layered moving ridges
  for(let i=0;i<5;i++){
    const amp = 6 + 8*i;
    const freq = 0.006 + 0.004*i;
    const phase = t * (0.4 + i*0.2) + i;
    bgCtx.beginPath();
    for(let x=0;x<w;x+=2){
      const y = h*0.5 + Math.sin((x*freq)+phase) * amp * (1 + Math.sin(t*0.001 + i));
      if(x===0) bgCtx.moveTo(x,y); else bgCtx.lineTo(x,y);
    }
    const grad = bgCtx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, `rgba(${10+i*8},${20+i*5},${40+i*6},${0.06 + i*0.02})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    bgCtx.strokeStyle = grad; bgCtx.lineWidth = 1 + i*0.5;
    bgCtx.stroke();
  }
}

// start initialization
init();

// expose for debug
window._EchoDemo = { grid, terrain, spawn, generateL };

/* ===== END demo.js ===== */
