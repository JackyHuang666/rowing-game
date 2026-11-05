(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const COLORS = ['#4fb5a0', '#d9a441', '#d97b7b', '#6f8fe0', '#a47fd6', '#7fbf55'];   // 每位船員的衣服顏色
const SIG = { ready: '🫶 準備好了', slow: '🐢 慢一點', together: '🤝 一起', steady: '🌊 穩住', breathe: '🍃 深呼吸' };
const MODE_INFO = {
  practice: { n: '第一次練習', s: '約 1 分鐘', d: '節拍全程引導、呼吸放慢、有新手提示，沒有水流。' },
  easy:     { n: '簡單',       s: '約 1.5 分鐘', d: '節拍寬容、引導較晚才淡出，只有微弱水流。' },
  normal:   { n: '普通',       s: '約 2 分鐘', d: '引導中途漸隱，需要看夥伴的槳；水流會輕輕推船。' },
  hard:     { n: '困難',       s: '約 3 分鐘', d: '呼吸較快、容錯很小、引導早早隱去，強水流讓船偏航，要靠默契修正。' },
};
const MODE_ORDER = ['practice', 'easy', 'normal', 'hard'];

let ws, me = null, room = null, cfg = { T: 6, INTRO: 8, edge: 0.06, mode: 'normal', modeName: '普通' };
let newSize = 2, paused = false;
const safe = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp01 = x => Math.max(0, Math.min(1, x));
const isHost = () => room && room.hostId === me;

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
      else if ($('#game').classList.contains('active')) { if (!$('#menu').classList.contains('hidden')) renderMenu(); }
      break;
    case 'reset': paused = false; $('#menu').classList.add('hidden'); show('lobby'); break;
    case 'start': room = m.lobby || room; cfg = m.cfg; beginGame(m.size); break;
    case 'state': onState(m); break;
    case 'pause': setPaused(m.on); break;
    case 'pauseReq': toast(m.from + ' 請求暫停', 3500); break;
    case 'toast': toast(m.msg); break;
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
$('#btnCreate').onclick = () => { Audio.init(); send({ type: 'create', name: nameVal(), size: newSize, mode: safe.get('played') ? 'normal' : 'practice' }); };
$('#btnJoin').onclick = () => { Audio.init(); const c = $('#code').value.trim(); if (c.length !== 4) return toast('請輸入 4 位數代碼'); send({ type: 'join', name: nameVal(), code: c }); };

// ───────────── 大廳 ─────────────
function renderLobby() {
  $('#lcode').textContent = room.code;
  const host = isHost(), rows = room.size / 2;
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
  // 模式卡
  const g = $('#modeGrid'); g.classList.toggle('lock', !host);
  g.innerHTML = MODE_ORDER.map(k => `<button data-m="${k}" class="${room.mode === k ? 'on' : ''}"><b>${MODE_INFO[k].n}</b><span>${MODE_INFO[k].s}</span></button>`).join('');
  $$('#modeGrid button').forEach(b => b.onclick = () => send({ type: 'setMode', mode: b.dataset.m }));
  $('#modeDesc').textContent = MODE_INFO[room.mode].d;
  $('#hostBox').classList.toggle('hidden', !host); $('#guestWait').classList.toggle('hidden', host);
  $$('#lobbySize button').forEach(b => b.classList.toggle('on', +b.dataset.n === room.size));
  $('#btnStart').disabled = need > 0;
  const hasBot = room.players.some(p => p.bot);
  $('#btnBots').textContent = hasBot ? '移除示範夥伴' : '加入示範夥伴'; $('#btnBots').dataset.mode = hasBot ? 'clear' : 'add';
}
$$('#lobbySize button').forEach(b => b.onclick = () => send({ type: 'setSize', size: +b.dataset.n }));
$('#btnBots').onclick = e => send({ type: e.currentTarget.dataset.mode === 'clear' ? 'clearBots' : 'addBots' });
$('#btnStart').onclick = () => { Audio.init(); send({ type: 'start' }); };
$('#btnLeave').onclick = leaveRoom;
$('#btnHome').onclick = leaveRoom;
function leaveRoom() { send({ type: 'leave' }); safe.sset('rid', null); safe.sset('rcode', null); me = null; room = null; paused = false; $('#menu').classList.add('hidden'); show('home'); }
$('#btnShare').onclick = () => {
  const url = location.origin + location.pathname + '?room=' + room.code;
  if (navigator.share) navigator.share({ title: '划船渡河', text: '一起來划船渡河吧', url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('已複製邀請連結'), () => toast(url, 5000));
  else toast(url, 5000);
};

// ───────────── 遊戲狀態 ─────────────
const S = { st: 'intro', ph: 0, cy: -1, p: 0, lat: 0, h: 1, g: 1, sp: 0, env: 0, a: [], da: [], recv: 0, cd: 8, pd: 0 };
let size = 2, myA = 0, pressing = false, lastPh = 0, guideNote = 0, myIndex = 0, lastCy = -9, simT = 0;

function beginGame(n) {
  size = n; S.a = new Array(n).fill(0); S.da = new Array(n).fill(0); S.p = 0; S.pd = 0; S.lat = 0; S.st = 'intro'; S.h = 1; S.g = 1; S.sp = 0; S.env = 0;
  guideNote = 0; myA = 0; lastCy = -9; paused = false; prevIn = []; foam = []; rings = []; drops = [];
  myIndex = Math.max(0, room.players.findIndex(p => p.id === me));
  $('#menu').classList.add('hidden'); $('#steer').classList.remove('show');
  $('#intro').classList.remove('gone'); $('#note').classList.remove('show');
  $('#hudM').textContent = cfg.modeName; $('#prog').style.width = '0'; $('#hudP').textContent = '0%'; $('#hudH').textContent = '同心 100%';
  show('game'); Audio.start();
}

const COACH = {
  0: '按住螢幕任何地方 ＝ 划槳。圓圈縮小時按住',
  1: '放開手指 ＝ 回槳。圓圈變大時，慢慢吸氣',
  2: '看看夥伴的槳，和他們一起動',
  3: '很好。不必用力，只要同時',
  5: '槳入水的聲音，就是你們的節拍',
  7: '船偏了嗎？讓一側的夥伴休息一槳，船頭就會回正',
  9: '做得很好，保持呼吸',
};
function onState(m) {
  S.st = m.st; S.ph = m.ph; S.cy = m.cy; S.p = m.p; S.lat = m.lat; S.h = m.h; S.g = m.g; S.sp = m.sp || 0; S.env = m.env || 0; S.a = m.a; S.cd = m.cd || 0; S.recv = performance.now();
  if (S.da.length !== m.a.length) S.da = m.a.slice();
  if (m.st === 'play') {
    if (!$('#intro').classList.contains('gone')) $('#intro').classList.add('gone');
    $('#prog').style.width = m.p + '%'; $('#hudP').textContent = Math.floor(m.p) + '%'; $('#hudH').textContent = '同心 ' + Math.round(m.h * 100) + '%';
    if (cfg.mode === 'practice' && m.cy !== lastCy && COACH[m.cy]) note(COACH[m.cy], 6500);
    lastCy = m.cy;
    if (cfg.mode !== 'practice') {
      if (m.g < 0.9 && guideNote < 1) { guideNote = 1; note('節拍漸漸隱去…看著夥伴的槳，用心感受'); }
      if (m.g <= 0.3 && guideNote < 2) { guideNote = 2; note('現在只剩默契。一起呼吸。'); }
    }
    if (m.p > 85 && guideNote < 3) { guideNote = 3; note('彼岸的燈火，近了'); }
    steerHint(m.lat);
  } else {
    const c = m.cd;
    $('#introT').innerHTML = c > 5.5 ? '把手機握穩<br>放鬆肩膀' : c > 2.8 ? '跟著圓圈<br>慢慢呼吸' : '按住 = 吐氣・划槳<br>放開 = 吸氣・回槳';
    $('#introC').textContent = Math.ceil(c);
  }
}
let noteT; function note(t, ms = 5000) { const n = $('#note'); n.textContent = t; n.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(() => n.classList.remove('show'), ms); }
function steerHint(lat) {
  const el = $('#steer'), a = Math.abs(lat);
  if (a < 0.38) { el.classList.remove('show'); return; }
  const right = lat > 0, myLeft = myIndex % 2 === 0;
  // 船頭偏右 → 左舷休息一槳；偏左 → 右舷休息一槳
  const restSide = right ? '左舷' : '右舷', rest = right ? myLeft : !myLeft;
  el.textContent = '船頭偏' + (right ? '右' : '左') + ' · ' + (rest ? '你在' + restSide + '：這一槳先休息' : restSide + '夥伴休息一槳，你照常划');
  el.classList.add('show');
}
function onSignal(m) { toast((m.from || '') + '：' + (SIG[m.k] || ''), 1800); Audio.tick(); if (navigator.vibrate) navigator.vibrate(15); }
$$('.chips button').forEach(b => { b.onpointerdown = e => e.stopPropagation(); b.onclick = () => send({ type: 'signal', k: b.dataset.k }); });

// ───────────── 選單 / 暫停 ─────────────
function setPaused(on) {
  paused = !!on; active.clear(); setPress(false);
  if (paused) { renderMenu(); $('#menu').classList.remove('hidden'); } else $('#menu').classList.add('hidden');
}
function renderMenu() {
  const host = isHost();
  $('#menuT').textContent = paused ? '已暫停' : '選單';
  $('#menuS').textContent = paused ? (host ? '深呼吸，準備好了再繼續。' : '船長暫停了航行，等船長繼續。') : '航行仍在繼續。';
  $('#mResume').classList.toggle('hidden', !(paused && host));
  $('#mReq').classList.toggle('hidden', paused || host);
  $('#mRestart').classList.toggle('hidden', !host);
  $('#mLobby').classList.toggle('hidden', !host);
  $('#mClose').classList.toggle('hidden', paused);
}
$('#btnMenu').onpointerdown = e => e.stopPropagation();
$('#btnMenu').onclick = () => {
  if (S.st === 'intro') return toast('船還沒出發，先深呼吸');
  if (isHost()) send({ type: 'pause', on: true });        // 船長：全隊暫停，選單由伺服器通知開啟
  else { renderMenu(); $('#menu').classList.remove('hidden'); active.clear(); setPress(false); }
};
$('#mClose').onclick = () => $('#menu').classList.add('hidden');
$('#mResume').onclick = () => send({ type: 'pause', on: false });
$('#mReq').onclick = () => { send({ type: 'pauseReq' }); $('#menu').classList.add('hidden'); };
function armed(btn, label, fn) {   // 危險操作：按兩次確認
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.onclick = () => {
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; fn(); return; }
    btn.classList.add('armed'); btn.textContent = label;
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 3000);
  };
}
armed($('#mRestart'), '再按一次：重新開始', () => send({ type: 'restart' }));
armed($('#mLobby'), '再按一次：全隊回大廳', () => send({ type: 'again' }));
armed($('#mLeave'), '再按一次：離開船隊', leaveRoom);

// ───────────── 結算 ─────────────
const QUOTES = {
  sync: ['你們的槳聲，幾乎成了同一次呼吸。', '「一個人走得快，一群人划得遠，也划得靜。」'],
  flow: ['節奏漸漸合上了，水也變得溫柔。', '「慢一點，反而更近。」'],
  together: ['有些時候亂了拍子，但你們沒有放棄彼此。', '「同舟，本身就是答案。」'],
  drift: ['沒關係，河水不趕時間。重要的是你們一起在這裡。', '「不必划得完美，只要記得回到呼吸。」'],
};
function onEnd(m) {
  safe.set('played', '1'); paused = false; $('#menu').classList.add('hidden');
  $('#rKick').textContent = m.arrived ? '靠岸了' : '時間到，小船輕輕停靠';
  $('#rTitle').textContent = { sync: '心有靈犀', flow: '漸入佳境', together: '同舟共濟', drift: '隨波漂流' }[m.title];
  $('#rMode').textContent = m.modeName;
  const q = QUOTES[m.title];
  $('#rText').textContent = m.mode === 'practice' && m.arrived ? '練習完成。準備好了，就換更高的航線吧。' : q[0]; $('#rQuote').textContent = q[1];
  $('#sR').textContent = m.rhythm; $('#sH').textContent = m.harmony; $('#sC').textContent = m.calm;
  const mm = Math.floor(m.time / 60), ss = m.time % 60;
  $('#rTime').textContent = (m.arrived ? '渡河用時 ' : '航行 ') + mm + ' 分 ' + ss + ' 秒' + (m.arrived ? '' : '（抵達 ' + m.progress + '%）');
  const host = m.hostId === me; $('#rHost').classList.toggle('hidden', !host); $('#rWait').classList.toggle('hidden', host);
  Audio.finish(); show('result');
}
$('#btnRestart').onclick = () => send({ type: 'restart' });
$('#btnAgain').onclick = () => send({ type: 'again' });

// ───────────── 輸入：按住 = 划槳 ─────────────
const stage = $('#stage'), active = new Set();
function setPress(d) { if (d === pressing) return; pressing = d; send({ type: 'press', d: d ? 1 : 0 }); if (d) Audio.dip(); }
stage.addEventListener('pointerdown', e => { if (paused) return; e.preventDefault(); active.add(e.pointerId); try { stage.setPointerCapture(e.pointerId); } catch (x) {} setPress(true); });
const up = e => { active.delete(e.pointerId); if (!active.size) setPress(false); };
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
stage.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && $('#game').classList.contains('active') && !paused) { e.preventDefault(); setPress(true); } });
addEventListener('keyup', e => { if (e.code === 'Space') setPress(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { active.clear(); setPress(false); } });

// ═════════════ 擬真繪圖 ═════════════
const cv = $('#cv'), c = cv.getContext('2d');
let W = 360, H = 640, SC = 1, raf = 0;
let prevIn = [], foam = [], rings = [], drops = [], leaves = [], lastT = 0, lastPd = 0, scrollV = 0, flowX = 0;
function resize() {
  const r = $('#stage').getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = r.width * dpr; cv.height = r.height * dpr; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  SC = r.width * dpr / 360; W = 360; H = r.height / (r.width / 360);
}
addEventListener('resize', () => { if ($('#game').classList.contains('active')) resize(); });
function startLoop() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

// ---- 程序化材質（只生成一次）----
const mk = (w, h) => { const k = document.createElement('canvas'); k.width = w; k.height = h; return k; };
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function tileNoise(size, cells, rand) {
  const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = y / size * cells, iy = gy | 0, fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = x / size * cells, ix = gx | 0, fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
      const a = g[(iy % cells) * cells + (ix % cells)], b = g[(iy % cells) * cells + ((ix + 1) % cells)];
      const c2 = g[((iy + 1) % cells) * cells + (ix % cells)], d = g[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
      out[y * size + x] = a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
    }
  }
  return out;
}
function fbm(size, rand, oct) { const out = new Float32Array(size * size); for (const [cells, w] of oct) { const n = tileNoise(size, cells, rand); for (let i = 0; i < out.length; i++) out[i] += n[i] * w; } return out; }

const TEX = {};
function buildTextures() {
  const R = rng(11), N = 256;
  // 水面亮紋（焦散）
  let n = fbm(N, R, [[3, .5], [6, .3], [12, .2]]), cl = mk(N, N), ctx = cl.getContext('2d'), id = ctx.createImageData(N, N);
  for (let i = 0; i < n.length; i++) { const v = 1 - Math.abs(2 * n[i] - 1); id.data[i * 4] = 205; id.data[i * 4 + 1] = 245; id.data[i * 4 + 2] = 238; id.data[i * 4 + 3] = Math.pow(v, 7) * 255; }
  ctx.putImageData(id, 0, 0); TEX.light = cl;
  // 水面深淺變化
  n = fbm(N, R, [[2, .5], [4, .3], [8, .2]]); const cd = mk(N, N); ctx = cd.getContext('2d'); id = ctx.createImageData(N, N);
  for (let i = 0; i < n.length; i++) { id.data[i * 4] = 2; id.data[i * 4 + 1] = 22; id.data[i * 4 + 2] = 30; id.data[i * 4 + 3] = Math.pow(n[i], 2.2) * 230; }
  ctx.putImageData(id, 0, 0); TEX.dark = cd;
  // 木紋（船身）：沿船長方向的木板
  const wd = mk(96, 256); ctx = wd.getContext('2d'); const pw = 16;
  for (let i = 0; i < 96 / pw; i++) {
    const hue = 26 + R() * 8, lig = 30 + R() * 9;
    ctx.fillStyle = `hsl(${hue},48%,${lig}%)`; ctx.fillRect(i * pw, 0, pw, 256);
    for (let k = 0; k < 46; k++) { const x = i * pw + R() * pw, y0 = R() * 256, l = 20 + R() * 90; ctx.strokeStyle = R() > .5 ? `rgba(40,20,5,${.06 + R() * .14})` : `rgba(255,220,170,${.04 + R() * .08})`; ctx.lineWidth = .6 + R() * .8; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (R() - .5) * 2, y0 + l); ctx.stroke(); }
    ctx.fillStyle = 'rgba(20,10,0,.55)'; ctx.fillRect(i * pw, 0, 1.6, 256); ctx.fillStyle = 'rgba(255,230,190,.14)'; ctx.fillRect(i * pw + 1.6, 0, 1, 256);
  }
  TEX.wood = wd; TEX.woodPat = c.createPattern(wd, 'repeat');
  // 樹冠（俯視）
  TEX.trees = [0, 1, 2, 3].map(k => { const r = 16 + k * 3, cvs = mk(r * 3, r * 3), x = cvs.getContext('2d'), rr = rng(50 + k); x.translate(r * 1.5, r * 1.5);
    x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 8; x.shadowOffsetX = 5; x.shadowOffsetY = 6; x.fillStyle = '#1c3d26'; x.beginPath(); x.arc(0, 0, r * .85, 0, 6.3); x.fill(); x.shadowColor = 'transparent';
    for (let i = 0; i < 16; i++) { const a = rr() * 6.3, d = rr() * r * .7, rad = r * (.25 + rr() * .3); const gr = x.createRadialGradient(Math.cos(a) * d - rad * .3, Math.sin(a) * d - rad * .3, 1, Math.cos(a) * d, Math.sin(a) * d, rad);
      gr.addColorStop(0, `hsl(${100 + rr() * 30},45%,${38 + rr() * 14}%)`); gr.addColorStop(1, `hsl(${120 + rr() * 20},42%,${16 + rr() * 8}%)`); x.fillStyle = gr; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, rad, 0, 6.3); x.fill(); }
    return cvs; });
  for (let i = 0; i < 14; i++) leaves.push({ x: Math.random() * 360, y: Math.random() * 700, r: Math.random() * 6.3, s: 3 + Math.random() * 3, h: 60 + Math.random() * 40 });
}
buildTextures();

function tile(tex, ox, oy, sc, alpha, comp) {
  const sz = 256 * sc; c.globalAlpha = alpha; c.globalCompositeOperation = comp || 'source-over';
  const x0 = ((ox % sz) + sz) % sz - sz, y0 = ((oy % sz) + sz) % sz - sz;
  for (let y = y0; y < H; y += sz) for (let x = x0; x < W; x += sz) c.drawImage(tex, x, y, sz + 1, sz + 1);
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
}
const hash = k => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };
const zoneOf = ph => { const e = cfg.edge; return ph >= e && ph < .5 - e ? 1 : ph >= .5 + e && ph < 1 - e ? -1 : 0; };

let lastPh2 = 0;
function frame(t) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (!paused) simT += dt;
  myA += ((pressing ? 1 : 0) - myA) * Math.min(1, dt * 12);
  for (let i = 0; i < S.da.length; i++) S.da[i] += ((S.a[i] || 0) - S.da[i]) * Math.min(1, dt * 14);
  S.da[myIndex] = myA;
  S.pd += (S.p - S.pd) * Math.min(1, dt * 4);
  scrollV = paused ? 0 : (S.pd - lastPd) / Math.max(dt, .001) * 16; lastPd = S.pd;
  flowX += S.env * 30 * (paused ? 0 : dt);
  const ph = paused ? S.ph : (S.ph + (t - S.recv) / (cfg.T * 1000)) % 1;
  if (!paused) cues(ph);
  draw(simT, ph, dt);
}

function cues(ph) {
  if (S.st === 'intro' && S.cd > 7.5) { lastPh = ph; return; }
  const v = S.g;
  if (ph < lastPh) { Audio.bowl(392, 0.10 * v); if (v > 0.3 && navigator.vibrate) navigator.vibrate(12); }
  else if (lastPh < 0.5 && ph >= 0.5) Audio.bowl(294, 0.06 * v);
  lastPh = ph;
}

function draw(t, ph, dt) {
  c.setTransform(SC, 0, 0, SC, 0, 0);
  const rows = size / 2, Lb = 70 + rows * 54, boatY = H * 0.40, pd = S.pd, k = pd / 100;
  const sx = pd * 16;                                  // 場景捲動量
  // 1. 水：深淺漸層 → 深淺斑塊 → 亮紋
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a5a62'); g.addColorStop(.6, '#12424d'); g.addColorStop(1, '#0d3340');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  tile(TEX.dark, flowX + t * 2, sx * .9 + t * 3, 1.5, .55);
  tile(TEX.light, flowX * 1.3 + t * 6, sx * 1.05 + t * 9, 1.25, .22, 'lighter');
  tile(TEX.light, -flowX + 90 - t * 5, sx * .8 - t * 6 + 40, .8, .12, 'lighter');
  // 近岸淺水：偏綠、較亮
  const sh = c.createLinearGradient(0, 0, W, 0); sh.addColorStop(0, 'rgba(120,150,90,.42)'); sh.addColorStop(.2, 'rgba(120,150,90,0)'); sh.addColorStop(.8, 'rgba(120,150,90,0)'); sh.addColorStop(1, 'rgba(120,150,90,.42)');
  c.fillStyle = sh; c.fillRect(0, 0, W, H);

  // 2. 漂浮的落葉（隨水流偏移）
  for (const l of leaves) {
    if (!paused) { l.y += (scrollV + 5) * dt; l.x += (S.env * 40 + Math.sin(t + l.s) * 4) * dt; l.r += dt * .3; }
    if (l.y > H + 20) { l.y = -20; l.x = 30 + Math.random() * 300; } if (l.x < 10) l.x = 350; if (l.x > 350) l.x = 10;
    c.save(); c.translate(l.x, l.y); c.rotate(l.r); c.fillStyle = `hsla(${l.h},50%,38%,.8)`; c.beginPath(); c.ellipse(0, 0, l.s, l.s * .45, 0, 0, 6.3); c.fill(); c.restore();
  }
  // 3. 兩岸：地面、沙岸、蘆葦、樹冠（隨前進捲動）
  sideBanks(sx);
  // 4. 此岸 / 彼岸（含碼頭）
  const startY = boatY + Lb / 2 + 24 + sx;
  if (startY < H) bank(startY, H, false, t);
  const farB = boatY - Lb / 2 - 34 - (100 - pd) * 16;
  if (farB > 0) { bank(0, farB, true, t); lantern(W / 2, farB - 4, t, pd); }

  // 5. 水中粒子：漣漪與尾跡泡沫
  for (const r of rings) { r.life -= dt * 1.1; r.y += scrollV * dt; r.r += dt * 22; if (r.life > 0) { c.strokeStyle = `rgba(225,248,244,${r.life * .45 * r.a})`; c.lineWidth = 1.3; c.beginPath(); c.ellipse(r.x, r.y, r.r, r.r * .55, 0, 0, 6.3); c.stroke(); } }
  rings = rings.filter(r => r.life > 0);
  for (const f of foam) { f.life -= dt * .45; f.y += (scrollV + 8) * dt; f.x += f.vx * dt; f.r += dt * 1.2; if (f.life > 0) { c.fillStyle = `rgba(235,250,248,${f.life * .17})`; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.3); c.fill(); } }
  foam = foam.filter(f => f.life > 0);

  // 6. 船
  const bx = W / 2 + S.lat * 22, by = boatY + Math.sin(t * .9) * 1.8;
  let imbA = 0; for (let s = 0; s < size; s++) imbA += (s % 2 ? -1 : 1) * (S.da[s] || 0); imbA /= Math.max(1, size / 2);
  const rot = S.lat * .1 + Math.sin(t * .7) * .012 + imbA * .015;
  c.save(); c.translate(bx, by); c.rotate(rot);
  bowWave(Lb); hullShadow(Lb); hull(Lb);
  const zone = zoneOf(ph);
  for (let s = 0; s < size; s++) rowerAndOar(s, Lb, zone, dt);
  c.restore();
  // 尾跡泡沫：從船尾兩側冒出
  if (!paused && S.st === 'play') {
    const n = Math.min(3, Math.round(S.sp * 7 * dt * 60 / 8)); const sn = Math.sin(rot), cs = Math.cos(rot);
    for (let i = 0; i < n && foam.length < 180; i++) { const lx = (Math.random() - .5) * 26, ly = Lb / 2 + 4; foam.push({ x: bx + cs * lx - sn * ly, y: by + sn * lx + cs * ly, vx: lx * .5, r: 1 + Math.random() * 1.8, life: .8 + Math.random() * .5 }); }
  }
  // 水花飛沫
  for (const d of drops) { d.life -= dt * 2.2; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 90 * dt; if (d.life > 0) { c.fillStyle = `rgba(235,252,250,${d.life * .8})`; c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.3); c.fill(); } }
  drops = drops.filter(d => d.life > 0);

  // 7. 大氣：霧、晨光、偏航警示、暗角
  const fogA = (cfg.mode === 'hard' ? .15 : cfg.mode === 'normal' ? .1 : .07) * (1 - clamp01((pd - 70) / 30));
  for (let i = 0; i < 3; i++) {
    const fx = W * (.15 + .35 * i) + Math.sin(t * .05 + i * 2) * 70, fy = H * (.12 + .3 * i) + Math.cos(t * .04 + i) * 40;
    const fg = c.createRadialGradient(fx, fy, 10, fx, fy, 210); fg.addColorStop(0, `rgba(225,238,238,${fogA})`); fg.addColorStop(1, 'rgba(225,238,238,0)'); c.fillStyle = fg; c.fillRect(0, 0, W, H);
  }
  const tr = 30 + (255 - 30) * k, tg = 60 + (180 - 60) * k, tb = 110 + (100 - 110) * k; c.fillStyle = `rgba(${tr | 0},${tg | 0},${tb | 0},${.2 - .06 * k})`; c.fillRect(0, 0, W, H);  // 由黎明藍到金色晨光
  if (k > .5) { const gl = c.createLinearGradient(0, 0, 0, H * .55); gl.addColorStop(0, `rgba(255,205,130,${.3 * (k - .5) * 2})`); gl.addColorStop(1, 'rgba(255,205,130,0)'); c.globalCompositeOperation = 'lighter'; c.fillStyle = gl; c.fillRect(0, 0, W, H * .55); c.globalCompositeOperation = 'source-over'; }
  const wa = clamp01((Math.abs(S.lat) - .6) / .6) * .35;
  if (wa > 0) { const wg = c.createLinearGradient(S.lat > 0 ? W : 0, 0, S.lat > 0 ? W - 110 : 110, 0); wg.addColorStop(0, `rgba(255,90,70,${wa})`); wg.addColorStop(1, 'rgba(255,90,70,0)'); c.fillStyle = wg; c.fillRect(0, 0, W, H); }
  const vg = c.createRadialGradient(W / 2, H * .45, H * .25, W / 2, H * .5, H * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,12,18,.45)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);

  breathRing(ph, zone, t);
}

function sideBanks(sx) {
  const edgeL = wy => 22 + 6 * Math.sin(wy * .021 + 1) + 4 * Math.sin(wy * .055);
  const edgeR = wy => W - 22 - 6 * Math.sin(wy * .018 + 3) - 4 * Math.sin(wy * .047 + 2);
  for (const side of [0, 1]) {
    c.beginPath(); c.moveTo(side ? W : 0, -20);
    for (let y = -20; y <= H + 20; y += 12) c.lineTo(side ? edgeR(y - sx) : edgeL(y - sx), y);
    c.lineTo(side ? W : 0, H + 20); c.closePath();
    const gr = c.createLinearGradient(side ? W : 0, 0, side ? W - 50 : 50, 0); gr.addColorStop(0, '#1b3a27'); gr.addColorStop(1, '#2c5a38'); c.fillStyle = gr; c.fill();
    c.strokeStyle = 'rgba(205,190,140,.55)'; c.lineWidth = 3; c.stroke();            // 沙岸
    c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 1; c.stroke();
  }
  // 蘆葦與樹
  const k0 = Math.floor((-sx - 80) / 23), k1 = Math.ceil((-sx + H + 80) / 23);
  c.lineCap = 'round';
  for (let k = k0; k <= k1; k++) {
    const wy = k * 23 + hash(k) * 10, y = wy + sx;
    for (const side of [0, 1]) {
      const ex = side ? edgeR(wy) : edgeL(wy), dir = side ? 1 : -1;
      if (hash(k * 3 + side) > .35) { c.strokeStyle = `hsla(${70 + hash(k + side) * 30},45%,${34 + hash(k) * 14}%,.9)`; c.lineWidth = 1.3; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(ex + dir * (i * 1.4 - 2), y); c.quadraticCurveTo(ex + dir * (i * 2 + 1), y - 8, ex + dir * (i * 3 - 1) - dir * 3, y - 14 - hash(k + i) * 8); c.stroke(); } }
    }
  }
  const t0 = Math.floor((-sx - 90) / 58), t1 = Math.ceil((-sx + H + 90) / 58);
  for (let k = t0; k <= t1; k++) {
    const wy = k * 58 + hash(k * 7) * 24, y = wy + sx, v = TEX.trees[Math.floor(hash(k * 5) * 4)], r = v.width / 2;
    c.drawImage(v, -r * .55 + hash(k * 2) * 8 - 6 - r + 12, y - r, v.width, v.height);          // 左岸
    c.drawImage(v, W - r - 14 - hash(k * 3) * 8 + 6, y - r + 20, v.width, v.height);              // 右岸
  }
}

function bank(y0, y1, far, t) {
  const edge = far ? y1 : y0, dir = far ? -1 : 1, r = rng(far ? 5 : 9);
  c.beginPath(); c.moveTo(0, far ? 0 : H);
  for (let x = 0; x <= W; x += 10) c.lineTo(x, edge - dir * (4 + 3 * Math.sin(x * .07)));
  c.lineTo(W, far ? 0 : H); c.closePath();
  const gr = c.createLinearGradient(0, edge, 0, edge + dir * 90); gr.addColorStop(0, '#34603d'); gr.addColorStop(1, '#1f4029'); c.fillStyle = gr; c.fill();
  c.strokeStyle = 'rgba(214,200,150,.6)'; c.lineWidth = 4; c.stroke();
  for (let i = 0; i < 70; i++) { const x = r() * W, d = 8 + r() * 80; c.fillStyle = r() > .5 ? 'rgba(20,50,25,.35)' : 'rgba(120,170,90,.22)'; c.beginPath(); c.arc(x, edge + dir * d, 1.5 + r() * 4, 0, 6.3); c.fill(); }
  for (let i = 0; i < 9; i++) { const x = r() * W, d = 4 + r() * 12; c.fillStyle = 'rgba(150,150,140,.7)'; c.beginPath(); c.ellipse(x, edge - dir * d, 3 + r() * 4, 2 + r() * 3, 0, 0, 6.3); c.fill(); }
  c.strokeStyle = 'rgba(140,200,120,.6)'; c.lineWidth = 1.5; c.lineCap = 'round';
  for (let x = 6; x < W; x += 12) { const h = 10 + ((x * 7) % 14); c.beginPath(); c.moveTo(x, edge + dir * 2); c.quadraticCurveTo(x + 4, edge + dir * (2 + h / 2), x + 2, edge + dir * (2 + h)); c.stroke(); }
  // 碼頭（木棧橋，伸入水中）
  const px = W / 2 - 17, pl = 54, py = far ? edge : edge - pl;
  c.fillStyle = TEX.woodPat; c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 8; c.shadowOffsetY = 4; c.fillRect(px, py, 34, pl); c.restore();
  c.strokeStyle = 'rgba(30,15,0,.5)'; c.lineWidth = 1; for (let y = py + 6; y < py + pl; y += 7) { c.beginPath(); c.moveTo(px, y); c.lineTo(px + 34, y); c.stroke(); }
  c.fillStyle = '#3a2a1a'; for (const x of [px - 2, px + 36]) for (const y of [py + 3, py + pl - 3]) { c.beginPath(); c.arc(x, y, 3.2, 0, 6.3); c.fill(); }
}
function lantern(x, y, t, pd) {
  const kk = clamp01((pd - 55) / 35); if (kk <= 0) return;
  for (const dx of [-24, 24]) {
    const lx = x + dx, r = 38 + 5 * Math.sin(t * 2 + dx), gr = c.createRadialGradient(lx, y, 1, lx, y, r);
    gr.addColorStop(0, `rgba(255,214,130,${.85 * kk})`); gr.addColorStop(1, 'rgba(255,214,130,0)');
    c.globalCompositeOperation = 'lighter'; c.fillStyle = gr; c.fillRect(lx - r, y - r, r * 2, r * 2); c.globalCompositeOperation = 'source-over';
    c.fillStyle = `rgba(255,238,200,${kk})`; c.beginPath(); c.arc(lx, y, 3.5, 0, 6.3); c.fill();
  }
}

// ---- 船身 ----
function hullPath(L, Wd) {
  c.beginPath(); c.moveTo(0, -L / 2);
  c.bezierCurveTo(Wd * .62, -L * .25, Wd * .55, L * .3, Wd * .42, L / 2);
  c.lineTo(-Wd * .42, L / 2);
  c.bezierCurveTo(-Wd * .55, L * .3, -Wd * .62, -L * .25, 0, -L / 2); c.closePath();
}
function bowWave(L) {
  const a = clamp01(S.sp * 1.6); if (a < .05) return;
  c.strokeStyle = `rgba(235,250,248,${.3 * a})`; c.lineWidth = 2.2; c.lineCap = 'round';
  for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 5, -L / 2 - 2); c.quadraticCurveTo(s * 26, -L / 2 + 22, s * 44, -L / 2 + 70); c.stroke(); }
}
function hullShadow(L) {
  c.save(); c.translate(7, 9); hullPath(L, 62); c.fillStyle = 'rgba(0,10,15,.42)'; c.filter = 'blur(4px)'; c.fill(); c.restore();
}
function hull(L) {
  const Wd = 60;
  hullPath(L, Wd); c.fillStyle = TEX.woodPat; c.fill();
  const sg = c.createLinearGradient(-Wd / 2, 0, Wd / 2, 0); sg.addColorStop(0, 'rgba(0,0,0,.45)'); sg.addColorStop(.25, 'rgba(0,0,0,0)'); sg.addColorStop(.75, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.45)');
  hullPath(L, Wd); c.fillStyle = sg; c.fill();
  c.strokeStyle = '#3d2814'; c.lineWidth = 3; hullPath(L, Wd); c.stroke();
  c.strokeStyle = 'rgba(255,225,170,.35)'; c.lineWidth = 1; c.save(); c.scale(.97, .985); hullPath(L, Wd); c.stroke(); c.restore();
  // 艙內：較暗的木面、肋骨、內側陰影
  c.save(); c.scale(.74, .9); c.translate(0, L * .028); hullPath(L, Wd); c.clip();
  c.fillStyle = TEX.woodPat; c.fillRect(-60, -L, 120, L * 2); c.fillStyle = 'rgba(25,12,2,.5)'; c.fillRect(-60, -L, 120, L * 2);
  c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2; for (let y = -L / 2; y < L / 2; y += 16) { c.beginPath(); c.moveTo(-40, y); c.lineTo(40, y); c.stroke(); }
  const ig = c.createLinearGradient(-Wd * .4, 0, Wd * .4, 0); ig.addColorStop(0, 'rgba(0,0,0,.55)'); ig.addColorStop(.3, 'rgba(0,0,0,0)'); ig.addColorStop(.7, 'rgba(0,0,0,0)'); ig.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = ig; c.fillRect(-60, -L, 120, L * 2);
  c.restore();
  c.save(); c.scale(.74, .9); c.translate(0, L * .028); c.strokeStyle = 'rgba(70,40,15,.9)'; c.lineWidth = 3; hullPath(L, Wd); c.stroke(); c.restore();
  // 船首甲板
  c.fillStyle = TEX.woodPat; c.beginPath(); c.moveTo(0, -L / 2 + 1); c.quadraticCurveTo(13, -L / 2 + 18, 9, -L / 2 + 32); c.lineTo(-9, -L / 2 + 32); c.quadraticCurveTo(-13, -L / 2 + 18, 0, -L / 2 + 1); c.fill(); c.strokeStyle = '#3d2814'; c.lineWidth = 1.5; c.stroke();
  // 座板（橫木）
  for (let r = 0; r < size / 2; r++) {
    const y = -L / 2 + 62 + r * 54 + 8; c.fillStyle = TEX.woodPat; c.fillRect(-21, y - 4, 42, 8);
    c.fillStyle = 'rgba(255,225,170,.2)'; c.fillRect(-21, y - 4, 42, 1.5); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-21, y + 3, 42, 1.5);
  }
}

let rowerCache = {};
function rowerAndOar(s, L, zone, dt) {
  const side = s % 2 ? 1 : -1, y = -L / 2 + 62 + Math.floor(s / 2) * 54, a = S.da[s] || 0, mine = s === myIndex;
  const th = -.65 + 1.3 * a, ox = side * 29, len = 86, cth = Math.cos(th), sth = Math.sin(th);
  const ex = ox + side * cth * len, ey = y + sth * len;              // 槳尖
  const hx = ox - side * cth * 20, hy = y - sth * 20;                // 握把（船內）
  const inWater = a > .32, was = prevIn[s];
  // 槳葉入水 / 出水：漣漪與水花
  if (was !== undefined && inWater !== was && !paused) {
    const m = c.getTransform(), p = m.transformPoint(new DOMPoint(ex, ey)), wx = p.x / SC, wy = p.y / SC;
    rings.push({ x: wx, y: wy, r: 4, life: 1, a: 1 });
    for (let i = 0; i < (inWater ? 7 : 4); i++) drops.push({ x: wx + (Math.random() - .5) * 8, y: wy, vx: (Math.random() - .5) * 40, vy: -20 - Math.random() * 40, r: 1 + Math.random() * 1.6, life: 1 });
    if (inWater && zone < 0 && mine) { if (navigator.vibrate) navigator.vibrate(20); }
  }
  prevIn[s] = inWater;
  const splash = zone < 0 && a > .5;
  // 槳在空中時，水面有偏移的影子
  if (!inWater) { c.strokeStyle = 'rgba(0,15,20,.25)'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(ox + 6, y + 9); c.lineTo(ex + 7, ey + 11); c.stroke(); }
  if (inWater) { c.strokeStyle = splash ? 'rgba(255,150,130,.5)' : 'rgba(215,245,240,.4)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(ex, ey, 9 + 7 * a, 4.5 + 3 * a, 0, 0, 6.3); c.stroke(); }
  // 自己的槳：暖色光暈
  if (mine) { c.strokeStyle = 'rgba(255,214,120,.3)'; c.lineWidth = 11; c.lineCap = 'round'; c.beginPath(); c.moveTo(ox, y); c.lineTo(ex, ey); c.stroke(); }
  // 槳身
  c.lineCap = 'round';
  c.strokeStyle = '#2f2012'; c.lineWidth = 4.6; c.beginPath(); c.moveTo(hx, hy); c.lineTo(ex, ey); c.stroke();
  c.strokeStyle = '#cfb48a'; c.lineWidth = 2.8; c.beginPath(); c.moveTo(hx, hy); c.lineTo(ex, ey); c.stroke();
  c.strokeStyle = '#6a4727'; c.lineWidth = 5.5; c.beginPath(); c.moveTo(ox - side * cth * 5, y - sth * 5); c.lineTo(ox + side * cth * 9, y + sth * 9); c.stroke();   // 皮套
  // 槳葉
  c.save(); c.translate(ox + side * cth * len * .72, y + sth * len * .72); c.rotate(Math.atan2(sth, side * cth));
  const bl = len * .28, bg = c.createLinearGradient(0, -5, 0, 5);
  bg.addColorStop(0, mine ? '#ffe9b0' : '#f0e2c4'); bg.addColorStop(.5, mine ? '#f2cd7a' : '#d8c299'); bg.addColorStop(1, mine ? '#d2a850' : '#b89a6c');
  c.fillStyle = bg; c.strokeStyle = '#6e5232'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -2); c.lineTo(bl * .3, -5.2); c.quadraticCurveTo(bl, -6, bl, 0); c.quadraticCurveTo(bl, 6, bl * .3, 5.2); c.lineTo(0, 2); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(80,50,20,.35)'; c.beginPath(); c.moveTo(bl * .2, 0); c.lineTo(bl * .95, 0); c.stroke();
  if (inWater) { c.fillStyle = 'rgba(30,110,120,.38)'; c.beginPath(); c.moveTo(0, -2); c.lineTo(bl * .3, -5.2); c.quadraticCurveTo(bl, -6, bl, 0); c.quadraticCurveTo(bl, 6, bl * .3, 5.2); c.lineTo(0, 2); c.fill(); }
  c.restore();
  // 槳手（俯視）：身體、手臂、斗笠
  const x = side * 15, by = y + 2.5 * a - 1, col = COLORS[s];
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x + 2, by + 3, 14, 9, 0, 0, 6.3); c.fill();
  c.strokeStyle = shade(col, -25); c.lineWidth = 4.2; c.beginPath(); c.moveTo(x - 8, by); c.lineTo(hx, hy + 1.5); c.moveTo(x + 8, by); c.lineTo(hx, hy - 1.5); c.stroke();
  c.fillStyle = '#e2b590'; c.beginPath(); c.arc(hx, hy, 2.6, 0, 6.3); c.fill();
  const sg = c.createRadialGradient(x - 3, by - 3, 1, x, by, 14); sg.addColorStop(0, col); sg.addColorStop(1, shade(col, -35)); c.fillStyle = sg; c.beginPath(); c.ellipse(x, by, 13, 7.5, 0, 0, 6.3); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
  const hy2 = by + 1 * a, hg = c.createRadialGradient(x - 2, hy2 - 2, 1, x, hy2, 10); hg.addColorStop(0, '#eadba8'); hg.addColorStop(1, '#bba46c');
  c.fillStyle = hg; c.beginPath(); c.arc(x, hy2, 9, 0, 6.3); c.fill(); c.strokeStyle = 'rgba(90,70,30,.55)'; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.arc(x, hy2, 5.5, 0, 6.3); c.stroke();
  c.fillStyle = col; c.beginPath(); c.arc(x, hy2, 2.4, 0, 6.3); c.fill();
  if (mine) { c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 2; c.beginPath(); c.arc(x, hy2, 12.5, 0, 6.3); c.stroke(); }
}
function shade(hex, d) { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, v + d)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }

function breathRing(ph, zone, t) {
  const cx = W / 2, cy = H - 128, g = S.g, mine = Math.min(1, myA);
  const u = ph < .5 ? ph / .5 : (ph - .5) / .5, e = .5 - .5 * Math.cos(Math.PI * u), b = ph < .5 ? 1 - e : e, r = 36 + 30 * b;
  c.save();
  c.fillStyle = 'rgba(5,25,32,.35)'; c.beginPath(); c.arc(cx, cy, 72, 0, 6.3); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 36, 0, 6.3); c.stroke();
  const col = zone > 0 ? '127,214,194' : zone < 0 ? '243,194,107' : '220,230,230';
  const rg = c.createRadialGradient(cx, cy, r * .6, cx, cy, r); rg.addColorStop(0, `rgba(${col},0)`); rg.addColorStop(1, `rgba(${col},${.22 * g})`); c.fillStyle = rg; c.beginPath(); c.arc(cx, cy, r, 0, 6.3); c.fill();
  c.strokeStyle = `rgba(${col},${.9 * g})`; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r, 0, 6.3); c.stroke();
  c.fillStyle = `rgba(127,214,194,${.12 + .5 * mine})`; c.beginPath(); c.arc(cx, cy, 30 * (.85 + .15 * mine), 0, 6.3); c.fill();
  c.fillStyle = `rgba(232,243,241,${.35 + .65 * g})`; c.font = '500 14px "Noto Sans TC",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(g < .35 ? '感受' : zone > 0 ? '吐氣・划' : zone < 0 ? '吸氣・回' : '…', cx, cy);
  c.restore();
}

// ───────────── 聲音（WebAudio，全部即時合成） ─────────────
const Audio = (() => {
  let ctx, master, on = true, started = false;
  const api = {
    init() { if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; } try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = on ? .9 : 0; master.connect(ctx.destination); } catch (e) { ctx = null; } },
    start() {
      api.init(); if (!ctx || started) return; started = true;
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .04 * w) / 1.04; d[i] = last * 6; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const water = ctx.createGain(); water.gain.value = .22;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .12; lg.gain.value = .06; lfo.connect(lg); lg.connect(water.gain); lfo.start();
      src.connect(lp); lp.connect(water); water.connect(master); src.start();
      [110, 164.8, 220].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = .018 - i * .004; o.connect(g); g.connect(master); o.start(); });
    },
    bowl(f, v) { if (!ctx || !on || v < .01) return; const t = ctx.currentTime; [1, 2.76, 5.4].forEach((m, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v / (i + 1), t + .02); g.gain.exponentialRampToValueAtTime(.0008, t + 3.2 - i * .6); o.connect(g); g.connect(master); o.start(t); o.stop(t + 3.4); }); },
    dip() { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(130, t + .18); g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.001, t + .22); o.connect(g); g.connect(master); o.start(t); o.stop(t + .25); },
    tick() { api.bowl(660, .05); },
    finish() { api.bowl(392, .12); setTimeout(() => api.bowl(523, .1), 500); setTimeout(() => api.bowl(784, .08), 1000); },
    toggle() { on = !on; if (master) master.gain.value = on ? .9 : 0; return on; },
  };
  return api;
})();
$('#btnMute').onclick = e => { e.stopPropagation(); $('#btnMute').classList.toggle('off', !Audio.toggle()); };
$('#btnMute').onpointerdown = e => e.stopPropagation();

connect();
})();
