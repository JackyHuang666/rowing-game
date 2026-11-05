(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const COLORS = ['#7fd6c2', '#f3c26b', '#e98f8f', '#9ab7ff', '#c4a0ef', '#a5d97b'];
const SIG = { ready: '🫶 準備好了', slow: '🐢 慢一點', together: '🤝 一起', steady: '🌊 穩住', breathe: '🍃 深呼吸' };

let ws, me = null, room = null, cfg = { T: 6, INTRO: 8 };
let pendingSize = 2, newSize = 2;
const safe = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
};

// ───────────── 畫面切換 / 提示 ─────────────
function show(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if (id === 'game') { resize(); startLoop(); } else stopLoop(); }
let toastT;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

// ───────────── 連線 ─────────────
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    $('#conn').classList.add('hidden');
    const id = safe.sget('rid'), code = safe.sget('rcode');
    if (id && code) send({ type: 'rejoin', code, id });
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => { $('#conn').classList.remove('hidden'); setTimeout(connect, 1200); };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast('連線中，請稍候…'); }

function handle(m) {
  switch (m.type) {
    case 'joined': me = m.id; safe.sset('rid', m.id); safe.sset('rcode', m.code); break;
    case 'lobby':
      room = m;
      if (m.phase === 'lobby') { show('lobby'); renderLobby(); }
      break;
    case 'reset': show('lobby'); break;
    case 'start': room = m.lobby || room; cfg = m.cfg; beginGame(m.size); break;
    case 'state': onState(m); break;
    case 'signal': onSignal(m); break;
    case 'end': onEnd(m); break;
    case 'error':
      if (m.code === 'rejoin') { safe.sset('rid', null); safe.sset('rcode', null); me = null; show('home'); }
      else toast(m.msg);
      break;
  }
}

// ───────────── 首頁 ─────────────
$('#name').value = safe.get('name') || '';
const qs = new URLSearchParams(location.search); if (qs.get('room')) $('#code').value = qs.get('room').slice(0, 4);
const nameVal = () => { const n = $('#name').value.trim(); safe.set('name', n); return n; };
$$('#newSize button').forEach(b => b.onclick = () => { newSize = +b.dataset.n; $$('#newSize button').forEach(x => x.classList.toggle('on', x === b)); });
$('#btnCreate').onclick = () => { Audio.init(); send({ type: 'create', name: nameVal(), size: newSize }); };
$('#btnJoin').onclick = () => { Audio.init(); const c = $('#code').value.trim(); if (c.length !== 4) return toast('請輸入 4 位數代碼'); send({ type: 'join', name: nameVal(), code: c }); };

// ───────────── 大廳 ─────────────
function renderLobby() {
  $('#lcode').textContent = room.code;
  const isHost = room.hostId === me;
  const rows = room.size / 2;
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<div class="r">';
    for (let s = r * 2; s < r * 2 + 2; s++) {
      const p = room.players[s];
      html += p
        ? `<div class="seat f ${p.id === me ? 'me' : ''} ${p.online ? '' : 'off'}"><i style="background:${COLORS[s]}">${esc(p.name.charAt(0))}</i>${esc(p.name)}${p.id === room.hostId ? ' ★' : ''}</div>`
        : `<div class="seat"><i></i>空位</div>`;
    }
    html += '</div>';
  }
  $('#boatView').innerHTML = html;
  const need = room.size - room.players.length;
  $('#lstatus').textContent = need > 0 ? `還差 ${need} 位船員。把代碼或邀請連結傳給夥伴。` : '船員到齊，可以出發了。';
  $('#hostBox').classList.toggle('hidden', !isHost);
  $$('#lobbySize button').forEach(b => b.classList.toggle('on', +b.dataset.n === room.size));
  $('#btnStart').disabled = need > 0;
  $('#btnBots').textContent = room.players.some(p => p.bot) ? '移除示範夥伴' : '加入示範夥伴';
  $('#btnBots').dataset.mode = room.players.some(p => p.bot) ? 'clear' : 'add';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$$('#lobbySize button').forEach(b => b.onclick = () => send({ type: 'setSize', size: +b.dataset.n }));
$('#btnBots').onclick = e => send({ type: e.currentTarget.dataset.mode === 'clear' ? 'clearBots' : 'addBots' });
$('#btnStart').onclick = () => { Audio.init(); send({ type: 'start' }); };
$('#btnLeave').onclick = leaveRoom;
$('#btnHome').onclick = leaveRoom;
function leaveRoom() { send({ type: 'leave' }); safe.sset('rid', null); safe.sset('rcode', null); me = null; room = null; show('home'); }
$('#btnShare').onclick = () => {
  const url = location.origin + location.pathname + '?room=' + room.code;
  if (navigator.share) navigator.share({ title: '划船渡河', text: '一起來划船渡河吧', url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('已複製邀請連結'), () => toast(url, 5000));
  else toast(url, 5000);
};

// ───────────── 遊戲狀態 ─────────────
const S = { st: 'intro', ph: 0, cy: -1, p: 0, lat: 0, h: 1, g: 1, a: [], da: [], recv: 0, cd: 8, pd: 0, hd: 1 };
let size = 2, myA = 0, pressing = false, running = false, lastPh = 0, guideNote = 0, myIndex = 0;

function beginGame(n) {
  size = n; S.a = new Array(n).fill(0); S.da = new Array(n).fill(0); S.p = 0; S.pd = 0; S.lat = 0; S.st = 'intro'; S.h = 1; S.hd = 1; S.g = 1; guideNote = 0; myA = 0;
  myIndex = Math.max(0, room.players.findIndex(p => p.id === me));
  $('#intro').classList.remove('gone'); $('#note').classList.remove('show');
  show('game'); Audio.start();
}

function onState(m) {
  S.st = m.st; S.ph = m.ph; S.cy = m.cy; S.p = m.p; S.lat = m.lat; S.h = m.h; S.g = m.g; S.a = m.a; S.cd = m.cd || 0; S.recv = performance.now();
  if (S.da.length !== m.a.length) S.da = m.a.slice();
  if (m.st === 'play') {
    if ($('#intro') && !$('#intro').classList.contains('gone')) $('#intro').classList.add('gone');
    $('#prog').style.width = m.p + '%'; $('#hudP').textContent = Math.floor(m.p) + '%'; $('#hudH').textContent = '同心 ' + Math.round(m.h * 100) + '%';
    if (m.g < 0.9 && guideNote < 1) { guideNote = 1; note('節拍漸漸隱去…看著夥伴的槳，用心感受'); }
    if (m.g <= 0.2 && guideNote < 2) { guideNote = 2; note('現在只剩默契。一起呼吸。'); }
    if (m.p > 85 && guideNote < 3) { guideNote = 3; note('彼岸的燈火，近了'); }
  } else {
    const c = m.cd;
    $('#introT').innerHTML = c > 5.5 ? '把手機握穩<br>放鬆肩膀' : c > 2.8 ? '跟著圓圈<br>慢慢呼吸' : '按住 = 吐氣・划槳<br>放開 = 吸氣・回槳';
    $('#introC').textContent = Math.ceil(c);
  }
}
let noteT; function note(t) { const n = $('#note'); n.textContent = t; n.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(() => n.classList.remove('show'), 5000); }

function onSignal(m) {
  toast((m.from || '') + '：' + (SIG[m.k] || ''), 1800);
  Audio.tick(); if (navigator.vibrate) navigator.vibrate(15);
}
$$('.chips button').forEach(b => { b.onpointerdown = e => e.stopPropagation(); b.onclick = () => send({ type: 'signal', k: b.dataset.k }); });

const QUOTES = {
  sync: ['你們的槳聲，幾乎成了同一次呼吸。', '「一個人走得快，一群人划得遠，也划得靜。」'],
  flow: ['節奏漸漸合上了，水也變得溫柔。', '「慢一點，反而更近。」'],
  together: ['有些時候亂了拍子，但你們沒有放棄彼此。', '「同舟，本身就是答案。」'],
  drift: ['沒關係，河水不趕時間。重要的是你們一起在這裡。', '「不必划得完美，只要記得回到呼吸。」'],
};
function onEnd(m) {
  $('#rKick').textContent = m.arrived ? '靠岸了' : '時間到，小船輕輕停靠';
  const T = { sync: '心有靈犀', flow: '漸入佳境', together: '同舟共濟', drift: '隨波漂流' }[m.title];
  $('#rTitle').textContent = T;
  const q = QUOTES[m.title]; $('#rText').textContent = q[0]; $('#rQuote').textContent = q[1];
  $('#sR').textContent = m.rhythm; $('#sH').textContent = m.harmony; $('#sC').textContent = m.calm;
  const mm = Math.floor(m.time / 60), ss = m.time % 60;
  $('#rTime').textContent = (m.arrived ? '渡河用時 ' : '航行 ') + mm + ' 分 ' + ss + ' 秒' + (m.arrived ? '' : '（抵達 ' + m.progress + '%）');
  const host = m.hostId === me; $('#btnAgain').classList.toggle('hidden', !host); $('#rWait').classList.toggle('hidden', host);
  Audio.finish(); show('result');
}
$('#btnAgain').onclick = () => send({ type: 'again' });

// ───────────── 輸入：按住 = 划槳 ─────────────
const stage = $('#stage'), active = new Set();
function setPress(d) { if (d === pressing) return; pressing = d; send({ type: 'press', d: d ? 1 : 0 }); if (d) Audio.dip(); }
stage.addEventListener('pointerdown', e => { e.preventDefault(); active.add(e.pointerId); try { stage.setPointerCapture(e.pointerId); } catch (x) {} setPress(true); });
const up = e => { active.delete(e.pointerId); if (!active.size) setPress(false); };
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
stage.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && $('#game').classList.contains('active')) { e.preventDefault(); setPress(true); } });
addEventListener('keyup', e => { if (e.code === 'Space') setPress(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { active.clear(); setPress(false); } });

// ───────────── 繪圖 ─────────────
const cv = $('#cv'), c = cv.getContext('2d');
let W = 360, H = 640, SC = 1, raf = 0, ripples = [];
for (let i = 0; i < 46; i++) ripples.push({ x: Math.random() * 360, y: Math.random() * 760, w: 16 + Math.random() * 30, s: Math.random() * 6 });
function resize() {
  const r = $('#stage').getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = r.width * dpr; cv.height = r.height * dpr; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  SC = r.width * dpr / 360; W = 360; H = r.height / (r.width / 360);
}
addEventListener('resize', () => { if ($('#game').classList.contains('active')) resize(); });
function startLoop() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

const zoneOf = ph => ph >= 0.06 && ph < 0.44 ? 1 : ph >= 0.56 && ph < 0.94 ? -1 : 0;
let lastT = 0;
function frame(t) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  // 本機即時槳位（零延遲），其他人平滑跟隨
  myA += ((pressing ? 1 : 0) - myA) * Math.min(1, dt * 12);
  for (let i = 0; i < S.da.length; i++) S.da[i] += ((S.a[i] || 0) - S.da[i]) * Math.min(1, dt * 14);
  S.da[myIndex] = myA;
  S.pd += (S.p - S.pd) * Math.min(1, dt * 4);
  // 以最近一次伺服器相位向前推算，讓呼吸圈順暢
  const ph = (S.ph + (t - S.recv) / (cfg.T * 1000)) % 1;
  cues(ph);
  draw(t / 1000, ph);
}

function cues(ph) {
  if (S.st === 'intro' && S.cd > 7.5) { lastPh = ph; return; }
  const v = S.g;
  if (ph < lastPh) { Audio.bowl(392, 0.10 * v); if (v > 0.3 && navigator.vibrate) navigator.vibrate(12); }
  else if (lastPh < 0.5 && ph >= 0.5) { Audio.bowl(294, 0.06 * v); }
  lastPh = ph;
}

function draw(t, ph) {
  c.setTransform(SC, 0, 0, SC, 0, 0);
  const rows = size / 2, Lb = 70 + rows * 54, boatY = H * 0.40, pd = S.pd;
  // 河水
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#16505a'); g.addColorStop(1, '#0c2f3a');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const off = pd * 14, span = H + 80;
  for (const r of ripples) {
    const y = ((r.y + off) % span) - 40; const a = 0.06 + 0.05 * Math.sin(t * 0.8 + r.s);
    c.strokeStyle = 'rgba(200,240,235,' + a + ')'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(r.x, y, r.w, 2.6, 0, 0, 6.3); c.stroke();
  }
  // 此岸 / 彼岸
  const startY = boatY + Lb / 2 + 24 + pd * 16;
  if (startY < H) bank(startY, H, false);
  const farB = boatY - Lb / 2 - 34 - (100 - pd) * 16;
  if (farB > 0) { bank(0, farB, true); lantern(W / 2, farB - 8, t, pd); }

  // 船
  c.save();
  c.translate(W / 2 + S.lat * 22, boatY + Math.sin(t * 0.9) * 2);
  c.rotate(S.lat * 0.1 + Math.sin(t * 0.7) * 0.012);
  wake(rows, Lb);
  hull(Lb);
  const zone = zoneOf(ph);
  for (let s = 0; s < size; s++) {
    const side = s % 2 ? 1 : -1, y = -Lb / 2 + 62 + Math.floor(s / 2) * 54, a = S.da[s] || 0, mine = s === myIndex;
    oar(side, y, a, mine, zone);
    seat(side, y, s, mine, room && room.players[s]);
  }
  c.restore();

  breathRing(ph, zone, t);
}

function bank(y0, y1, far) {
  const edge = far ? y1 : y0, dir = far ? -1 : 1;       // dir：往陸地的方向
  c.beginPath(); c.moveTo(0, far ? 0 : H);
  for (let x = 0; x <= W; x += 10) c.lineTo(x, edge - dir * (4 + 3 * Math.sin(x * 0.07)));
  c.lineTo(W, far ? 0 : H); c.closePath();
  c.fillStyle = '#244a36'; c.fill();
  c.strokeStyle = 'rgba(214,200,150,.35)'; c.lineWidth = 2; c.stroke();
  c.strokeStyle = 'rgba(140,200,120,.55)'; c.lineWidth = 1.5;
  for (let x = 8; x < W; x += 16) { const h = 12 + ((x * 7) % 14); c.beginPath(); c.moveTo(x, edge + dir * 2); c.lineTo(x + 3, edge + dir * (2 + h)); c.stroke(); }
}
function lantern(x, y, t, pd) {
  const k = clamp01((pd - 60) / 30); if (k <= 0) return;
  const r = 40 + 6 * Math.sin(t * 2), gr = c.createRadialGradient(x, y, 2, x, y, r);
  gr.addColorStop(0, 'rgba(255,214,130,' + 0.9 * k + ')'); gr.addColorStop(1, 'rgba(255,214,130,0)');
  c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); c.fillStyle = 'rgba(255,236,190,' + k + ')'; c.beginPath(); c.arc(x, y, 4, 0, 6.3); c.fill();
}
const clamp01 = x => Math.max(0, Math.min(1, x));

function hullPath(L, Wd) {
  c.beginPath(); c.moveTo(0, -L / 2);
  c.bezierCurveTo(Wd * 0.62, -L * 0.25, Wd * 0.55, L * 0.3, Wd * 0.42, L / 2);
  c.lineTo(-Wd * 0.42, L / 2);
  c.bezierCurveTo(-Wd * 0.55, L * 0.3, -Wd * 0.62, -L * 0.25, 0, -L / 2); c.closePath();
}
function hull(L) {
  c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 14; c.shadowOffsetY = 5;
  hullPath(L, 58); const g = c.createLinearGradient(-30, 0, 30, 0); g.addColorStop(0, '#6e5238'); g.addColorStop(.5, '#9a774f'); g.addColorStop(1, '#6e5238');
  c.fillStyle = g; c.fill(); c.restore();
  c.strokeStyle = '#b8956a'; c.lineWidth = 2; hullPath(L, 58); c.stroke();
  c.save(); c.scale(0.76, 0.9); c.translate(0, L * 0.03); hullPath(L, 58); c.fillStyle = 'rgba(40,24,10,.45)'; c.fill(); c.restore();
}
function seat(side, y, s, mine, p) {
  const x = side * 15;
  c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x, y + 1, 13, 9, 0, 0, 6.3); c.fill();
  c.fillStyle = COLORS[s]; c.beginPath(); c.arc(x, y, 9.5, 0, 6.3); c.fill();
  if (mine) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 12.5, 0, 6.3); c.stroke(); }
  c.fillStyle = '#0b242c'; c.font = '600 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(p ? p.name.charAt(0) : '', x, y + 0.5);
}
function oar(side, y, a, mine, zone) {
  const len = 84, th = -0.65 + 1.3 * a, ox = side * 28;
  const ex = ox + side * Math.cos(th) * len, ey = y + Math.sin(th) * len;
  const bx = ox + side * Math.cos(th) * len * 0.74, by = y + Math.sin(th) * len * 0.74;
  const splash = zone < 0 && a > 0.5;
  if (a > 0.15) { // 入水的漣漪
    c.strokeStyle = splash ? 'rgba(255,150,130,' + 0.55 * a + ')' : 'rgba(210,245,240,' + 0.4 * a + ')'; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(ex, ey, 10 + 8 * a, 5 + 4 * a, 0, 0, 6.3); c.stroke();
  }
  if (mine) { c.strokeStyle = 'rgba(243,194,107,.35)'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(ox, y); c.lineTo(ex, ey); c.stroke(); }
  c.lineCap = 'round'; c.strokeStyle = '#d8c3a0'; c.lineWidth = 3; c.beginPath(); c.moveTo(ox, y); c.lineTo(bx, by); c.stroke();
  c.strokeStyle = mine ? '#ffe3a3' : '#efe2c8'; c.lineWidth = 8; c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke();
}
function wake(rows, L) {
  c.strokeStyle = 'rgba(220,245,240,.16)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-26, -L / 2 + 14); c.quadraticCurveTo(-48, 0, -40, L / 2 + 30); c.moveTo(26, -L / 2 + 14); c.quadraticCurveTo(48, 0, 40, L / 2 + 30); c.stroke();
}

function breathRing(ph, zone, t) {
  const cx = W / 2, cy = H - 128, g = S.g, mine = Math.min(1, myA);
  const u = ph < 0.5 ? ph / 0.5 : (ph - 0.5) / 0.5, e = 0.5 - 0.5 * Math.cos(Math.PI * u), b = ph < 0.5 ? 1 - e : e;
  const r = 36 + 30 * b;
  c.save();
  // 固定的小圈：呼氣到底的位置
  c.strokeStyle = 'rgba(255,255,255,' + 0.12 + ')'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 36, 0, 6.3); c.stroke();
  // 呼吸圈
  const col = zone > 0 ? '127,214,194' : zone < 0 ? '243,194,107' : '220,230,230';
  c.strokeStyle = 'rgba(' + col + ',' + (0.85 * g) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r, 0, 6.3); c.stroke();
  c.fillStyle = 'rgba(' + col + ',' + (0.06 * g) + ')'; c.fill();
  // 你的手：按住時內圈亮起
  const ir = 30; c.fillStyle = 'rgba(127,214,194,' + (0.12 + 0.5 * mine) + ')'; c.beginPath(); c.arc(cx, cy, ir * (0.85 + 0.15 * mine), 0, 6.3); c.fill();
  c.fillStyle = 'rgba(232,243,241,' + (0.35 + 0.65 * g) + ')'; c.font = '500 14px "Noto Sans TC",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const label = g < 0.35 ? '感受' : zone > 0 ? '吐氣・划' : zone < 0 ? '吸氣・回' : '…';
  c.fillText(label, cx, cy);
  c.restore();
}

// ───────────── 聲音（WebAudio，全部即時合成） ─────────────
const Audio = (() => {
  let ctx, master, water, on = true, started = false;
  const api = {
    init() { if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; } try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination); } catch (e) { ctx = null; } },
    start() {
      api.init(); if (!ctx || started) return; started = true;
      // 流水：低通白噪音 + 緩慢起伏
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 6; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      water = ctx.createGain(); water.gain.value = 0.22;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 0.06; lfo.connect(lg); lg.connect(water.gain); lfo.start();
      src.connect(lp); lp.connect(water); water.connect(master); src.start();
      // 低低的和弦墊
      [110, 164.8, 220].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.018 - i * 0.004; o.connect(g); g.connect(master); o.start(); });
    },
    bowl(f, v) { if (!ctx || !on || v < 0.01) return; const t = ctx.currentTime; [1, 2.76, 5.4].forEach((m, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v / (i + 1), t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + 3.2 - i * 0.6); o.connect(g); g.connect(master); o.start(t); o.stop(t + 3.4); }); },
    dip() { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.18); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25); },
    tick() { api.bowl(660, 0.05); },
    finish() { api.bowl(392, 0.12); setTimeout(() => api.bowl(523, 0.1), 500); setTimeout(() => api.bowl(784, 0.08), 1000); },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.9 : 0; return on; },
  };
  return api;
})();
$('#btnMute').onclick = e => { e.stopPropagation(); $('#btnMute').classList.toggle('off', !Audio.toggle()); };
$('#btnMute').onpointerdown = e => e.stopPropagation();

connect();
})();
