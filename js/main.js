// main.js - interactive landing features (defensive, no automatic wallet connection)
// NOTE: this file is written defensively: wallet calls are only on user action.
// We also add global handlers to catch wallet-related failures from extensions.

'use strict';

const COUNTER_API = 'https://api.countapi.xyz/hit/echo-tetris/plays';

// Safe selectors: returns a real element or a harmless stub to avoid errors during tests
function $(s){
  const el = document.querySelector(s);
  if (el) return el;
  // harmless stub for safety in test environments
  return {
    textContent: '',
    value: '',
    addEventListener: ()=>{},
    removeEventListener: ()=>{},
    setAttribute: ()=>{},
    getBoundingClientRect: ()=>({}),
    click: ()=>{},
  };
}
function $all(s){ return Array.from(document.querySelectorAll(s)); }

// Global error/unhandledrejection handlers — suppress or gracefully handle wallet-related errors
window.addEventListener('error', (ev) => {
  try {
    const msg = ev && ev.message ? ev.message.toString() : '';
    if (/MetaMask|eth_requestAccounts|ethereum|Failed to connect to MetaMask/i.test(msg)) {
      console.warn('Wallet/extension error suppressed:', msg);
      const el = $('#mintResult'); if (el) el.textContent = 'Wallet error intercepted: ' + msg;
      // don't rethrow
      return;
    }
  } catch(e) {
    // swallow
  }
  // otherwise allow default behaviour (will still show in console)
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason = ev && ev.reason ? (ev.reason.message || ev.reason).toString() : '';
    if (/MetaMask|eth_requestAccounts|ethereum|Failed to connect to MetaMask/i.test(reason)) {
      console.warn('Unhandled rejection (wallet) suppressed:', reason);
      const el = $('#mintResult'); if (el) el.textContent = 'Wallet connection was blocked: ' + reason;
      ev.preventDefault && ev.preventDefault();
      return;
    }
  } catch(e) {
    // swallow
  }
  // otherwise leave it (it will report to console)
});

// --- Utilities / features ---

// Hit counter (only once per browser session)
async function hitCounter(){
  try {
    if (sessionStorage.getItem('echotetris_played')) return;
    sessionStorage.setItem('echotetris_played','1');
    const res = await fetch(COUNTER_API);
    const j = await res.json();
    $('#playsCounter').textContent = 'Игроков: ' + (j.value ?? '—');
  } catch (e) {
    console.warn('Counter fail', e);
  }
}

// Background fractal-ish animation using Three.js (defensive)
function initBackground(){
  try {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, innerWidth/ (innerHeight||1), 0.1, 1000);
    camera.position.z = 50;

    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(50,50,50);
    scene.add(light);

    // fractal branch generation (simple)
    function makeBranch(depth, length, pos, dir, geom){
      if (depth===0) return;
      const segments = Math.max(3, Math.floor(length/2));
      for (let i=0;i<segments;i++){
        const point = new THREE.Vector3(
          pos.x + dir.x*(i/segments)*length + (Math.random()-0.5)*1.2,
          pos.y + dir.y*(i/segments)*length + (Math.random()-0.5)*1.2,
          pos.z + dir.z*(i/segments)*length + (Math.random()-0.5)*1.2
        );
        geom.vertices.push(point);
      }
      const newPos = geom.vertices[geom.vertices.length-1];
      for (let k=0;k< (depth>1?2:1);k++){
        const nDir = new THREE.Vector3(dir.x + (Math.random()-0.5)*0.6, dir.y + (Math.random()-0.5)*0.6, dir.z*0.2).normalize();
        makeBranch(depth-1, length*0.6, newPos, nDir, geom);
      }
    }

    // fallback for older three versions: THREE.Geometry may be deprecated; guard it
    let geom;
    try {
      geom = new THREE.Geometry();
      makeBranch(4, 40, new THREE.Vector3(0,-10,0), new THREE.Vector3(0,1,0), geom);
      const mat = new THREE.LineBasicMaterial({color:0x00e6ff, transparent:true, opacity:0.12});
      const line = new THREE.Line(geom, mat);
      scene.add(line);
    } catch(e){
      // ignore geometry creation errors (older/newer three builds)
    }

    // particles
    try {
      const pGeom = new THREE.BufferGeometry();
      const count = 200;
      const positions = new Float32Array(count*3);
      for (let i=0;i<count;i++){
        positions[i*3] = (Math.random()-0.5)*60;
        positions[i*3+1] = (Math.random()-0.5)*30;
        positions[i*3+2] = (Math.random()-0.5)*10;
      }
      pGeom.setAttribute('position', new THREE.BufferAttribute(positions,3));
      const pMat = new THREE.PointsMaterial({size:1.6, color:0xff6ad5, transparent:true, opacity:0.7});
      const points = new THREE.Points(pGeom, pMat);
      scene.add(points);

      function onResize(){
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
      }
      window.addEventListener('resize', onResize);
      onResize();

      let t=0;
      function animate(){
        t += 0.01;
        if (scene.children.length) {
          // small breathing animation
          scene.traverse(obj => {
            if (obj.material && obj.material.opacity !== undefined) {
              obj.material.opacity = 0.06 + 0.03*Math.sin(t*1.2);
            }
          });
        }
        points.rotation.y += 0.0008;
        points.material.size = 1.2 + Math.sin(t*2.2)*0.4;
        camera.position.x = Math.sin(t*0.2)*4;
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }
      animate();
    } catch(e) {
      console.warn('Background scene failed safely', e);
    }
  } catch(e){
    console.warn('initBackground failed', e);
  }
}

// Mini game — safe, simple visual demo
function initMiniGame(){
  try {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return {getScore: ()=>0};
    const ctx = canvas.getContext('2d');
    if (!ctx) return {getScore: ()=>0};

    let score = Number(localStorage.getItem('echotetris_score') || 0);
    $('#score').textContent = score;

    const W = canvas.width; const H = canvas.height;
    const pieces = [
      {w:2,h:2,color:'#00e6ff'},
      {w:3,h:1,color:'#ff6ad5'},
      {w:1,h:4,color:'#ffd166'},
      {w:4,h:1,color:'#4ade80'}
    ];

    let active = null; let tick=0; let combo=1;

    function spawn(){
      active = {...pieces[Math.floor(Math.random()*pieces.length)], x:Math.floor(Math.random()*(W-80))+40, y:-40, vy:0};
    }
    spawn();

    const pulses = [];

    function update(dt){
      tick += dt;
      if (!active) spawn();
      active.vy += 600*dt;
      active.y += active.vy*dt;
      if (active.y + active.h*20 > H){
        playPing();
        pulses.push({x:active.x + (active.w*20)/2, y:H-10, r:0, max:200, color:active.color});
        score += 10 * combo; localStorage.setItem('echotetris_score', score);
        $('#score').textContent = score;
        combo = Math.min(5, combo+0.2);
        active = null;
      }
      for (let p of pulses) p.r += 300*dt;
      while (pulses.length && pulses[0].r > pulses[0].max) pulses.shift();
    }

    function draw(){
      ctx.clearRect(0,0,W,H);
      ctx.fillStyle = '#02030a'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      for (let gx=0;gx<W;gx+=20){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,H);ctx.stroke()}
      for (let gy=0;gy<H;gy+=20){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(W,gy);ctx.stroke()}

      for (let p of pulses){
        const g = ctx.createRadialGradient(p.x,p.y,Math.max(2,p.r*0.05), p.x,p.y,p.r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
      }

      if (active){
        ctx.fillStyle = active.color;
        const pw = active.w*20; const ph = active.h*20;
        ctx.fillRect(active.x, active.y, pw, ph);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.strokeRect(active.x, active.y, pw, ph);
      }
    }

    let last = performance.now();
    function loop(now){
      const dt = Math.min(0.04, (now-last)/1000);
      update(dt);
      draw();
      last = now;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // keyboard
    window.addEventListener('keydown', (e)=>{
      if (!active) return;
      if (e.key === 'ArrowLeft'){ active.x -= 28 }
      if (e.key === 'ArrowRight'){ active.x += 28 }
      if (e.key === 'ArrowDown'){ active.vy += 600 }
      if (e.key === ' '){
        active.color = pieces[Math.floor(Math.random()*pieces.length)].color;
        combo = Math.max(1, combo-0.2);
        $('#combo').textContent = 'x' + combo.toFixed(1);
      }
    });

    // gamepad polling
    let gpIndex = null;
    function pollGamepad(){
      try {
        const gps = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i=0;i<gps.length;i++){
          const g = gps[i]; if (!g) continue;
          if (gpIndex===null) gpIndex = i;
          $('#gamepadStatus').textContent = 'Gamepad: ' + g.id;
          if (g.buttons[14] && g.buttons[14].pressed){ if (active) active.x -= 28 }
          if (g.buttons[15] && g.buttons[15].pressed){ if (active) active.x += 28 }
          if (g.buttons[0] && g.buttons[0].pressed){ if (active) active.vy += 600 }
        }
      } catch(e){
        // swallow gamepad read errors
      } finally {
        requestAnimationFrame(pollGamepad);
      }
    }
    requestAnimationFrame(pollGamepad);

    return { getScore: ()=>score };
  } catch(e){
    console.warn('initMiniGame failed', e);
    return { getScore: ()=>0 };
  }
}

// WebAudio synth for ping; resume context on user gesture if needed
let audioCtx = null;
function ensureAudio(){
  try {
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  } catch(e){
    console.warn('WebAudio not available', e);
  }
}
function resumeAudioIfNeeded(){
  try {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(()=>{});
    }
  } catch(e){}
}
function playPing(){
  try{
    ensureAudio();
    resumeAudioIfNeeded();
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 880 + Math.random()*220;
    const volEl = document.getElementById('volume');
    let vol = 0.6;
    if (volEl && typeof volEl.value !== 'undefined') vol = Number(volEl.value) || vol;
    g.gain.value = vol * 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.08);
  }catch(e){console.warn('Audio fail',e)}
}

// NFT snapshot (client-only) — defensive
async function generateNFTSnapshot(score){
  try {
    const stamp = Date.now();
    const meta = {title:'EchoTetris Fragment',score,seed:Math.floor(Math.random()*1e9),created:stamp};
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
      $('#mintResult').textContent = 'Нет игрового холста для снимка.';
      return;
    }
    const png = canvas.toDataURL('image/png');
    const blob = new Blob([JSON.stringify({meta, png})], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `echotetris_nft_${stamp}.json`; a.click();
    $('#mintResult').textContent = 'NFT snapshot сгенерирован (клиентская симуляция).';
  } catch(e){
    console.warn('generateNFTSnapshot failed', e);
    $('#mintResult').textContent = 'Ошибка генерации снимка: ' + (e.message || e);
  }
}

// CBDC conversion (simulated local wallet)
function convertToCBDC(amount){
  try {
    const wallet = JSON.parse(localStorage.getItem('echotetris_wallet')||'{"balance":0}');
    wallet.balance = (wallet.balance||0) + amount;
    localStorage.setItem('echotetris_wallet', JSON.stringify(wallet));
    $('#mintResult').textContent = `Симуляция: конвертировано ${amount} единиц в локальный кошелёк.`;
  } catch(e){
    console.warn('convertToCBDC failed', e);
    $('#mintResult').textContent = 'Ошибка конвертации: ' + (e.message || e);
  }
}

// Clear local data safely
async function clearAllGameData(){
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('echotetris')) localStorage.removeItem(k);
    if (window.indexedDB) {
      const delReq = indexedDB.deleteDatabase('echotetris-db');
      delReq.onsuccess = ()=>{ console.log('DB deleted') };
      delReq.onerror = ()=>{ console.warn('DB delete error') };
    }
    alert('Локальные данные игры очищены');
  } catch(e){
    console.warn('clearAllGameData failed', e);
    alert('Ошибка при очистке данных: ' + (e.message || e));
  }
}

// Connect to wallet — only on explicit user click
async function connectWallet(){
  try {
    if (!window.ethereum) {
      alert('Не найден кошелёк (MetaMask/ethereum). Демо работает и без кошелька.');
      return;
    }
    // user-initiated request - catch any failure
    const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
    $('#mintResult').textContent = 'Wallet connected: ' + (accs && accs[0] ? accs[0] : '—');
  } catch (e) {
    console.warn('connectWallet failed', e);
    $('#mintResult').textContent = 'Не удалось подключить кошелёк: ' + (e && e.message ? e.message : e);
  }
}

// --- Hook up UI on load ---
window.addEventListener('load', ()=>{
  hitCounter();
  initBackground();
  const mini = initMiniGame();

  $('#startButton').addEventListener('click', ()=>{ document.getElementById('hero').scrollIntoView({behavior:'smooth'}); });
  $('#playDemo').addEventListener('click', ()=>{ document.getElementById('play').scrollIntoView({behavior:'smooth'}); });
  $('#howTo').addEventListener('click', ()=>{ alert('Управление: стрелки влево/вправо, пробел — смена/ротация, джойстик поддерживается (Gamepad API).') });

  $('#resetStorage').addEventListener('click', ()=>{ if (confirm('Удалить все данные игры?')) clearAllGameData() });

  $('#generateNFT').addEventListener('click', ()=>{
    const s = Number(localStorage.getItem('echotetris_score')||0);
    if (s<50) return alert('Нужно минимум 50 очков для генерации.');
    generateNFTSnapshot(s);
  });

  $('#convertCBDC').addEventListener('click', ()=>{
    const s = Number(localStorage.getItem('echotetris_score')||0);
    if (s<20) return alert('Нужно минимум 20 очков для конвертации.');
    convertToCBDC(Math.floor(s/10));
  });

  // volume control
  try {
    const volEl = document.getElementById('volume');
    if (volEl) {
      volEl.addEventListener('input', (e)=>{ localStorage.setItem('echotetris_volume', e.target.value); });
      const vol = localStorage.getItem('echotetris_volume'); if (vol) volEl.value = vol;
    }
  } catch(e){}

  // explicit wallet connect (optional)
  const walletBtn = document.getElementById('connectWallet');
  if (walletBtn) {
    walletBtn.addEventListener('click', async ()=>{
      // explicit user gesture -> resume audio (if suspended) for UX
      try { ensureAudio(); resumeAudioIfNeeded(); } catch(e){}
      await connectWallet();
    });
  }

  // quick gamepad connectivity note
  window.addEventListener('gamepadconnected', (e)=>{
    $('#gamepadStatus').textContent = 'Gamepad connected: ' + (e && e.gamepad && e.gamepad.id ? e.gamepad.id : '—');
  });
});
