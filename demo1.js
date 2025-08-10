// demo.js — Fullscreen Echo Tetris demo (fixed duplicate drawBackground)
// This version fixes the 'Identifier drawBackground has already been declared' error
// Assumes demo.html from previous messages (IDs: bgCanvas, gameCanvas, startBtn, pauseBtn, etc.)

/* CONFIG */
const COLS = 10;
const ROWS = 20;
const DROP_INTERVAL_BASE = 700;
const TERRAIN_MAX = 12;
const BG_SPEED = 0.0008;

/* DOM helpers */
const $ = (s) => document.querySelector(s);
const $id = (id) => document.getElementById(id);

/* Canvases and contexts */
let canvas = $id('gameCanvas');
let ctx = canvas.getContext('2d');
let bgCanvas = $id('bgCanvas');
let bgCtx = bgCanvas.getContext('2d');

/* HiDPI */
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let width = 1280, height = 720;
let cellSize = 28;

/* Game state */
let grid = Array.from({length: ROWS}, () => Array(COLS).fill(null));
let terrain = Array.from({length: COLS}, () => 0);
let current = null;
let nextQueue = [];
let score = Number(localStorage.getItem('echotetris_score') || 0);
let engineRunning = false;
let lastTick = performance.now();
let accumulator = 0;
let dropInterval = DROP_INTERVAL_BASE;
let lsystemSeed = Number(localStorage.getItem('echotetris_seed') || Date.now());
let prng = mulberry32(lsystemSeed);
let pulses = [];
let audioCtx = null;

/* Tetrominoes */
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

/* WebAudio helpers */
function ensureAudio(){ if(!audioCtx) try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioCtx=null; } }
function playTone(freq=440,dur=0.06,vol=0.08){ try{ ensureAudio(); if(!audioCtx) return; const g=audioCtx.createGain(); g.gain.value = (Number($id('volume')?.value)||0.6) * vol; const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);}catch(e){} }

/* PRNG */
function mulberry32(a){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } }

/* L-system */
function generateL(axiom='F', rules={'F':'F[+F]F[-F]F'}, depth=3){
  let s = axiom;
  for(let i=0;i<depth;i++){ let ns=''; for(const ch of s){ ns += rules[ch] || ch; } s = ns; }
  return s;
}
function lToPoints(s, step=8, angle=25){
  const rad = d=>d*Math.PI/180;
  let x=0,y=0,ang=-90; const stack=[]; const pts=[{x,y}];
  for(const ch of s){
    if(ch==='F'){ x += Math.cos(rad(ang))*step; y += Math.sin(rad(ang))*step; pts.push({x,y}); }
    else if(ch==='+') ang += angle;
    else if(ch==='-') ang -= angle;
    else if(ch==='[') stack.push({x,y,ang});
    else if(ch===']'){ const st = stack.pop(); if(st){ x=st.x; y=st.y; ang=st.ang; pts.push({x,y}); } }
  }
  return pts;
}
function lToColumns(pts, cols=COLS){
  let minx=Infinity,maxx=-Infinity; for(const p of pts){ if(p.x<minx) minx=p.x; if(p.x>maxx) maxx=p.x; }
  const range = Math.max(1, maxx-minx); const arr = new Array(cols).fill(0);
  for(const p of pts){ const t = (p.x-minx)/range; const idx = Math.min(cols-1, Math.max(0, Math.floor(t*cols))); arr[idx] += 1; }
  const maxv = Math.max(...arr); if(maxv <= 0) return arr.map(()=>0); return arr.map(v=>v/maxv);
}

/* Game helpers */
function fitCanvases(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = Math.max(300, Math.floor(window.innerWidth * dpr));
  const vh = Math.max(240, Math.floor(window.innerHeight * dpr));
  canvas.width = vw; canvas.height = vh; bgCanvas.width = vw; bgCanvas.height = vh;
  canvas.style.width = '100vw'; canvas.style.height = '100vh'; bgCanvas.style.width = '100vw'; bgCanvas.style.height = '100vh';
  width = vw; height = vh;
  const cellH = Math.floor((window.innerHeight) / ROWS);
  const cellW = Math.floor((window.innerWidth) / COLS);
  cellSize = Math.max(10, Math.min(cellH, cellW, 48));
}

/* Tetris logic: spawn, collision, placement, clear */
function spawn(){ if(nextQueue.length < 3){ const bag = [...PIECE_KEYS]; for(let i=bag.length-1;i>0;i--){ const j=Math.floor(prng()*(i+1)); [bag[i],bag[j]]=[bag[j],bag[i]]; } nextQueue.push(...bag); } const key = nextQueue.shift(); return { key, rot:0, x: Math.floor(COLS/2)-2, y: -2, shapeSet:T[key] }; }
function shapeOf(p){ return p.shapeSet[p.rot % p.shapeSet.length]; }
function canPlaceAt(shape,x,y){
  for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++) if(shape[sy][sx]){
    const gx = x+sx, gy = y+sy;
    if(gx<0||gx>=COLS) return false;
    if(gy>=ROWS) return false;
    if(gy >= ROWS - terrain[gx]) return false;
    if(gy>=0 && grid[gy][gx]) return false;
  }
  return true;
}
function placePiece(p){
  const shape = shapeOf(p);
  for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++) if(shape[sy][sx]){
    const gx=p.x+sx, gy=p.y+sy;
    if(gy>=0 && gy<ROWS && gx>=0 && gx<COLS) grid[gy][gx] = {color: COLOR[p.key] || '#fff'};
  }
}
function clearLines(){
  let cleared=0;
  for(let r=ROWS-1;r>=0;r--){
    if(grid[r].every(c=>c!==null)){ grid.splice(r,1); grid.unshift(Array(COLS).fill(null)); cleared++; r++; }
  }
  return cleared;
}
function modifyTerrainByPiece(piece){
  const s = generateL('F','F[+F]F[-F]F', 2 + Math.floor(prng()*2));
  const pts = lToPoints(s,6,20 + Math.floor(prng()*10));
  const inf = lToColumns(pts, COLS);
  const shape = shapeOf(piece);
  for(let sx=0;sx<4;sx++) for(let sy=0;sy<4;sy++) if(shape[sy][sx]){
    const gx = piece.x + sx; if(gx<0||gx>=COLS) continue;
    const base = 1; const influence = Math.round(inf[gx]*2);
    terrain[gx] = Math.min(TERRAIN_MAX, Math.max(0, terrain[gx] + base + influence - sy));
  }
  for(let i=1;i<COLS;i++) terrain[i] = Math.round((terrain[i]+terrain[i-1])/2);
}
function scrollTerrain(){
  if(prng() > 0.5){ const last = terrain.pop(); terrain.unshift(Math.max(0, Math.min(TERRAIN_MAX, Math.round(last + (prng()-0.5)*2)))); }
  else { const first = terrain.shift(); terrain.push(Math.max(0, Math.min(TERRAIN_MAX, Math.round(first + (prng()-0.5)*2)))); }
}

/* Tick/lock logic */
function lockCurrent(){
  placePiece(current);
  modifyTerrainByPiece(current);
  const px = (current.x + 2) * cellSize + (cellSize/2);
  const py = (current.y + 2) * cellSize + (cellSize/2);
  pulses.push({x:px, y:py, r:0, max: Math.max(width,height)/2, color: COLOR[current.key] || '#fff'});
  const cleared = clearLines();
  if(cleared>0){ score += cleared*cleared*100; playTone(600+cleared*80,0.09,0.14); } else { score += 10; playTone(320,0.06,0.08); }
  if(prng()>0.4){
    const row = lToColumns(lToPoints(generateL('F','F[+F]F[-F]F',2 + Math.floor(prng()*2))), COLS).map(v=>v>0.6);
    for(let c=0;c<COLS;c++) if(row[c]) terrain[c] = Math.min(TERRAIN_MAX, terrain[c] + 1);
  }
  scrollTerrain();
  current = spawn();
  localStorage.setItem('echotetris_score', String(score));
  localStorage.setItem('echotetris_seed', String(lsystemSeed));
  $id('scoreBox').textContent = 'Score: ' + score;
  $id('seedBox').textContent = String(lsystemSeed);
}

/* Tick step */
function tickStep(dt){
  if(!current) current = spawn();
  accumulator += dt;
  if(accumulator > dropInterval){
    accumulator = 0;
    if(canPlaceAt(shapeOf(current), current.x, current.y+1)) current.y += 1;
    else { lockCurrent(); }
  }
}

/* Unified drawBackground (single definition) */
function drawBackground(now){
  // optional now param — we use performance inside
  if(!bgCtx) return;
  bgCtx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
  const w = bgCanvas.width, h = bgCanvas.height;
  const t = (now || performance.now()) * BG_SPEED;
  // layered moving ridges
  for(let i=0;i<5;i++){
    const amp = 6 + 8*i, freq = 0.006 + 0.004*i, phase = t * (0.4 + i*0.2) + i;
    bgCtx.beginPath();
    for(let x=0;x<w;x+=2){
      const y = h*0.5 + Math.sin((x*freq)+phase) * amp * (1 + Math.sin(t*0.001 + i));
      if(x===0) bgCtx.moveTo(x,y); else bgCtx.lineTo(x,y);
    }
    const grad = bgCtx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, `rgba(${10+i*8},${20+i*5},${40+i*6},${0.06 + i*0.02})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    bgCtx.strokeStyle = grad; bgCtx.lineWidth = 1 + i*0.5; bgCtx.stroke();
  }
}

/* Rendering */
function render(){
  if(!ctx) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // center grid (account for CSS scaling — use css pixels)
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const gridW = COLS * cellSize, gridH = ROWS * cellSize;
  const offsetX = (cssW - gridW) / 2;
  const offsetY = (cssH - gridH) / 2;

  // draw terrain
  for(let c=0;c<COLS;c++){
    const th = terrain[c];
    for(let t=0;t<th;t++){
      const gx = offsetX + c*cellSize;
      const gy = offsetY + (ROWS - 1 - t)*cellSize;
      ctx.fillStyle = 'rgba(60,60,60,0.9)';
      ctx.fillRect(gx+1, gy+1, cellSize-2, cellSize-2);
    }
  }

  // grid cells
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const cell = grid[r][c];
      const x = offsetX + c*cellSize;
      const y = offsetY + r*cellSize;
      if(cell){
        ctx.fillStyle = cell.color;
        roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.02)'; ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
      }
    }
  }

  // current piece
  if(current){
    const shape = shapeOf(current);
    const color = COLOR[current.key] || '#fff';
    for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++) if(shape[sy][sx]){
      const gx = current.x + sx, gy = current.y + sy;
      if(gy >= 0){
        const x = offsetX + gx*cellSize, y = offsetY + gy*cellSize;
        ctx.fillStyle = color; roundRect(ctx, x+1, y+1, cellSize-2, cellSize-2, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.strokeRect(x+1,y+1,cellSize-2,cellSize-2);
      }
    }
  }

  // pulses
  ctx.globalCompositeOperation = 'lighter';
  for(const p of pulses){ p.r += 180*(1/60); const grad = ctx.createRadialGradient(p.x, p.y, p.r*0.05, p.x, p.y, p.r); grad.addColorStop(0,p.color); grad.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill(); }
  pulses = pulses.filter(p => p.r < p.max);
  ctx.globalCompositeOperation = 'source-over';
}

/* util */
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

/* Main loop */
function loop(){
  if(!engineRunning){ requestAnimationFrame(loop); return; }
  const now = performance.now();
  const dt = now - lastTick; lastTick = now;
  tickStep(dt);
  drawBackground(now);
  render();
  requestAnimationFrame(loop);
}

/* Input */
function setupInput(){
  window.addEventListener('keydown', (e)=>{
    if(!current) return;
    if(e.key === 'ArrowLeft'){ if(canPlaceAt(shapeOf(current), current.x-1, current.y)) current.x--; }
    else if(e.key === 'ArrowRight'){ if(canPlaceAt(shapeOf(current), current.x+1, current.y)) current.x++; }
    else if(e.key === 'ArrowDown'){ if(canPlaceAt(shapeOf(current), current.x, current.y+1)) current.y++; }
    else if(e.key === ' '){
      const nextRot = (current.rot+1) % current.shapeSet.length;
      const shapet = current.shapeSet[nextRot];
      const kicks = [0,-1,1,-2,2];
      for(const off of kicks){ if(canPlaceAt(shapet, current.x + off, current.y)){ current.rot = nextRot; current.x += off; break; } }
    } else if(e.key === 'Enter'){ while(canPlaceAt(shapeOf(current), current.x, current.y+1)) current.y++; }
  });
}

/* UI wiring */
function setupUI(){
  $id('startBtn').addEventListener('click', ()=>{
    if(!engineRunning){ engineRunning = true; lastTick = performance.now(); requestAnimationFrame(loop); $id('startBtn').textContent = 'Running'; }
  });
  $id('pauseBtn').addEventListener('click', ()=>{
    engineRunning = !engineRunning; $id('pauseBtn').textContent = engineRunning ? 'Pause' : 'Resume'; if(engineRunning){ lastTick = performance.now(); requestAnimationFrame(loop); }
  });
  $id('resetBtn').addEventListener('click', ()=>{ if(confirm('Reset game data?')){ localStorage.removeItem('echotetris_score'); localStorage.removeItem('echotetris_seed'); location.reload(); } });
  $id('genNFT').addEventListener('click', ()=> generateNFT());
  $id('connectWallet').addEventListener('click', ()=> connectWallet());
  const vol = localStorage.getItem('echotetris_volume'); if(vol) $id('volume').value = vol;
  $id('volume').addEventListener('input', ()=> localStorage.setItem('echotetris_volume', $id('volume').value));
}

/* Wallet integration (explicit) */
async function connectWallet(){
  try{
    if(!window.ethereum){ alert('MetaMask not found'); return; }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const addr = accounts && accounts[0];
    if(!addr) { $id('msg').textContent = 'No account'; return; }
    $id('msg').textContent = 'Connected: ' + addr.slice(0,8) + '…';
    const balHex = await window.ethereum.request({ method:'eth_getBalance', params:[addr,'latest'] });
    const balWei = BigInt(balHex); const eth = Number(balWei) / 1e18;
    let rub = null;
    try{ const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=rub'); const j = await r.json(); if(j.ethereum && j.ethereum.rub) rub = j.ethereum.rub; }catch(e){}
    const text = rub ? (eth * rub).toFixed(2) + ' ₽' : eth.toFixed(6) + ' ETH';
    $id('balanceBox').textContent = 'Wallet: ' + text;
  } catch(e){ console.warn('wallet',e); $id('msg').textContent = 'Wallet error: ' + (e.message||e); }
}

/* NFT creation (on-page preview + download JSON) */
function generateNFT(){
  try{
    const off = document.createElement('canvas'); off.width = 800; off.height = 800; const g = off.getContext('2d');
    const grd = g.createLinearGradient(0,0,0,800); grd.addColorStop(0,'#071021'); grd.addColorStop(1,'#02030a'); g.fillStyle = grd; g.fillRect(0,0,800,800);
    g.drawImage(canvas, 100, 60, 600, 320);
    const s = generateL('F','F[+F]F[-F]F',3); const pts = lToPoints(s,6,20);
    g.save(); g.translate(400,420); g.strokeStyle = '#00e6ff'; g.lineWidth = 2; g.beginPath();
    for(let i=0;i<pts.length;i++){ const p=pts[i]; if(i===0) g.moveTo(p.x,p.y); else g.lineTo(p.x,p.y); } g.stroke(); g.restore();
    g.fillStyle = '#fff'; g.font = '26px system-ui'; g.fillText('Echo Tetris — Fragment', 30, 40);
    const meta = { score, seed: lsystemSeed, created: (new Date()).toISOString() };
    const dataURL = off.toDataURL('image/png');
    const img = $id('nftPreview'); img.src = dataURL; img.style.display = 'block';
    const payload = { meta, png:dataURL };
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    let a = document.getElementById('nftDownloadLink');
    if(!a){ a = document.createElement('a'); a.id='nftDownloadLink'; a.style.display='inline-block'; a.style.marginTop='8px'; a.style.padding='8px 10px'; a.style.background='linear-gradient(90deg,#00e6ff,#ff6ad5)'; a.style.color='#021'; a.style.borderRadius='8px'; $id('msg').appendChild(a); }
    a.href = url; a.download = `echotetris_fragment_${Date.now()}.json`; a.textContent = 'Download NFT JSON';
    $id('msg').textContent = 'NFT generated locally. Use the download link below.';
    playTone(780,0.12,0.14);
  }catch(e){ console.warn('nft',e); $id('msg').textContent = 'NFT gen failed: ' + (e.message||e); }
}

/* Boot */
function init(){
  fitCanvases();
  window.addEventListener('resize', ()=>{ fitCanvases(); });
  setupInput();
  setupUI();
  while(nextQueue.length < 5) nextQueue.push(PIECE_KEYS[Math.floor(prng()*PIECE_KEYS.length)]);
  current = spawn();
  $id('scoreBox').textContent = 'Score: ' + score;
  $id('seedBox').textContent = String(lsystemSeed);
  (function bgLoop(){ drawBackground(); requestAnimationFrame(bgLoop); })();
  requestAnimationFrame(loop);
  window._Echo = { grid, terrain, spawn, generateL };
}

init();
