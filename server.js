'use strict';
// 06 划船渡河 —— 冥想合作小遊戲伺服器
// 伺服器是唯一的裁判：收各手機的「按住 / 放開」，計算槳位、同心度、船速與偏航，再廣播給所有人。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./wslite');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// ---- 遊戲參數 ----
const T = 6;            // 一次呼吸 / 一次划槳循環（秒）：前半吐氣划、後半吸氣回槳
const INTRO = 8;        // 開船前的呼吸引導（秒）
const MAX_TIME = 420;   // 最長航行時間（秒），超時就「靠岸」
const TICK = 50;        // 伺服器節拍（毫秒）
const RATE = +process.env.RATE || 2.0;       // 速度 → 進度 換算
const SIZES = [2, 4, 6];
const BOT_NAMES = ['小舟', '青蘆', '晨霧', '月影', '溪風', '白鷺'];
const SIGNALS = new Set(['ready', 'slow', 'together', 'steady', 'breathe']);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rooms = new Map();

// ---- 靜態檔案 ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

// ---- 工具 ----
const uid = () => Math.random().toString(36).slice(2, 10);
function newCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }
function send(ws, o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function bcast(r, o) { const s = JSON.stringify(o); for (const p of r.players) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }
function cleanName(n) { return String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 8) || '船員'; }
function lobbyMsg(r) {
  return {
    type: 'lobby', code: r.code, size: r.size, hostId: r.hostId, phase: r.phase,
    players: r.players.map((p, i) => ({ id: p.id, name: p.name, seat: i, bot: p.bot && !p.away, online: p.bot || !!p.ws })),
  };
}
function pushLobby(r) { bcast(r, lobbyMsg(r)); }
function humans(r) { return r.players.filter(p => !p.bot || p.away); }

function makePlayer(name, ws, bot) {
  return { id: uid(), name, ws, bot: !!bot, away: false, pressing: false, a: 0, bo: (Math.random() - 0.5) * 0.08, bnext: 0, lastSig: 0 };
}

function deleteRoom(r) { if (r.timer) clearInterval(r.timer); rooms.delete(r.code); }

function removePlayer(r, p) {
  r.players = r.players.filter(x => x !== p);
  if (!humans(r).length) { deleteRoom(r); return; }
  if (r.hostId === p.id) r.hostId = humans(r)[0].id;
  pushLobby(r);
}

// ---- 遊戲流程 ----
function startGame(r) {
  r.phase = 'playing';
  r.t0 = Date.now(); r.progress = 0; r.lat = 0; r.h = 1;
  r.stats = { pullT: 0, pullA: 0, hT: 0, hS: 0, recT: 0, splash: 0 };
  r.guideSeen = 1;
  for (const p of r.players) { p.a = 0; p.pressing = false; p.bnext = 0; }
  bcast(r, { type: 'start', size: r.size, cfg: { T, INTRO }, lobby: lobbyMsg(r) });
  r.timer = setInterval(() => tick(r), TICK);
}

// 1 = 划槳區（吐氣），-1 = 回槳區（吸氣），0 = 緩衝（容許手機延遲）
function zone(ph) { if (ph >= 0.06 && ph < 0.44) return 1; if (ph >= 0.56 && ph < 0.94) return -1; return 0; }
// 節拍引導：前段清楚，中段漸隱，後段只剩淡淡的光（靠隊友與默契）
function guideAt(p) { return p < 25 ? 1 : Math.max(0.18, 1 - (p - 25) / 30); }

function tick(r) {
  const dt = TICK / 1000, now = Date.now();
  const gt = (now - r.t0) / 1000 - INTRO;
  const N = r.players.length;
  const ph = (((gt / T) % 1) + 1) % 1;

  for (const p of r.players) {
    let target;
    if (p.bot) {
      const bph = ((((gt / T) + p.bo) % 1) + 1) % 1;
      target = bph < 0.5 ? 1 : 0;
      if (now > p.bnext) { p.bo = clamp(p.bo + (Math.random() - 0.5) * 0.03, -0.07, 0.07); p.bnext = now + T * 1000; }
    } else target = p.pressing ? 1 : 0;
    p.a += (target - p.a) * Math.min(1, dt * 9);
  }
  const as = r.players.map(p => p.a);
  const base = { type: 'state', ph: +ph.toFixed(4), a: as.map(x => +x.toFixed(2)) };

  if (gt < 0) { bcast(r, Object.assign(base, { st: 'intro', cd: +(-gt).toFixed(2), cy: -1, p: 0, lat: 0, h: 1, g: 1 })); return; }

  const z = zone(ph);
  const mean = as.reduce((s, x) => s + x, 0) / N;
  const sd = Math.sqrt(as.reduce((s, x) => s + (x - mean) ** 2, 0) / N);
  r.h += (clamp(1 - sd / 0.3, 0, 1) - r.h) * Math.min(1, dt * 2.5);

  const es = as.map(a => z > 0 ? a : z < 0 ? -0.5 * a : 0);
  const me = es.reduce((s, x) => s + x, 0) / N;
  let speed = 0.05 + Math.max(0, me) * (0.35 + 0.65 * r.h);

  // 左右槳力不均 → 船頭偏航（偶數座位在左、奇數在右）
  let L = 0, R = 0;
  es.forEach((e, i) => { if (i % 2 === 0) L += e; else R += e; });
  const imb = (L - R) / (N / 2);
  r.lat = clamp((r.lat + imb * 0.9 * dt) * (1 - 0.2 * dt), -1.3, 1.3);
  if (Math.abs(r.lat) > 0.8) speed *= 0.65;
  r.progress = Math.min(100, r.progress + speed * dt * RATE);

  const s = r.stats;
  if (z > 0) { s.pullT += dt; s.pullA += mean; s.hT += dt; s.hS += r.h * dt; }
  else if (z < 0) { s.recT += dt; s.splash += mean; }

  const g = guideAt(r.progress);
  bcast(r, Object.assign(base, { st: 'play', cy: Math.floor(gt / T), p: +r.progress.toFixed(2), lat: +r.lat.toFixed(3), h: +r.h.toFixed(3), sp: +speed.toFixed(3), g: +g.toFixed(3) }));

  if (r.progress >= 100 || gt > MAX_TIME) endGame(r, r.progress >= 100, gt);
}

function endGame(r, arrived, gt) {
  clearInterval(r.timer); r.timer = null; r.phase = 'done';
  const s = r.stats;
  const rhythm = s.pullT ? clamp(s.pullA / s.pullT, 0, 1) : 0;
  const harmony = s.hT ? clamp(s.hS / s.hT, 0, 1) : 0;
  const calm = s.recT ? clamp(1 - s.splash / s.recT, 0, 1) : 1;
  const score = (rhythm + harmony + calm) / 3;
  const title = score >= 0.85 ? 'sync' : score >= 0.7 ? 'flow' : score >= 0.5 ? 'together' : 'drift';
  bcast(r, { type: 'end', arrived, time: Math.round(gt), progress: +r.progress.toFixed(1), rhythm: Math.round(rhythm * 100), harmony: Math.round(harmony * 100), calm: Math.round(calm * 100), title, hostId: r.hostId });
  pushLobby(r);
}

// ---- 連線處理 ----
attach(server, ws => {
  let room = null, player = null;

  function joined(r, p) { room = r; player = p; p.ws = ws; send(ws, { type: 'joined', id: p.id, code: r.code }); }

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;

    // 不需要房間的訊息
    if (m.type === 'create') {
      const size = SIZES.includes(m.size) ? m.size : 2;
      const r = { code: newCode(), size, players: [], hostId: null, phase: 'lobby', timer: null, progress: 0, lat: 0, h: 1 };
      const p = makePlayer(cleanName(m.name), ws, false);
      r.players.push(p); r.hostId = p.id; rooms.set(r.code, r);
      joined(r, p); pushLobby(r); return;
    }
    if (m.type === 'join') {
      const r = rooms.get(String(m.code || ''));
      if (!r) return send(ws, { type: 'error', msg: '找不到這個船隊代碼' });
      if (r.phase !== 'lobby') return send(ws, { type: 'error', msg: '這艘船已經出發了' });
      if (r.players.length >= r.size) return send(ws, { type: 'error', msg: '船上已經坐滿了' });
      const p = makePlayer(cleanName(m.name), ws, false);
      r.players.push(p); joined(r, p); pushLobby(r); return;
    }
    if (m.type === 'rejoin') {
      const r = rooms.get(String(m.code || '')); const p = r && r.players.find(x => x.id === m.id && !x.ws);
      if (!p) return send(ws, { type: 'error', code: 'rejoin', msg: '無法回到原本的船' });
      clearTimeout(p.dropTimer); p.away = false; p.bot = false;
      joined(r, p);
      if (r.phase === 'playing') send(ws, { type: 'start', size: r.size, cfg: { T, INTRO }, lobby: lobbyMsg(r), resume: true });
      pushLobby(r); return;
    }

    if (!room || !player) return;
    const r = room, p = player, isHost = r.hostId === p.id;

    switch (m.type) {
      case 'press': p.pressing = !!m.d; break;
      case 'signal': {
        const now = Date.now();
        if (!SIGNALS.has(m.k) || now - p.lastSig < 600) break;
        p.lastSig = now;
        bcast(r, { type: 'signal', from: p.name, seat: r.players.indexOf(p), k: m.k });
        break;
      }
      case 'setSize': {
        if (!isHost || r.phase !== 'lobby' || !SIZES.includes(m.size)) break;
        while (r.players.length > m.size) {
          const i = r.players.map(x => x.bot).lastIndexOf(true);
          if (i < 0) break; r.players.splice(i, 1);
        }
        if (r.players.length > m.size) return send(ws, { type: 'error', msg: '目前船上人數已超過 ' + m.size + ' 人' });
        r.size = m.size; pushLobby(r); break;
      }
      case 'addBots': {
        if (!isHost || r.phase !== 'lobby') break;
        while (r.players.length < r.size) {
          const used = new Set(r.players.map(x => x.name));
          const nm = BOT_NAMES.find(n => !used.has(n)) || '夥伴';
          r.players.push(makePlayer(nm, null, true));
        }
        pushLobby(r); break;
      }
      case 'clearBots': {
        if (!isHost || r.phase !== 'lobby') break;
        r.players = r.players.filter(x => !x.bot); pushLobby(r); break;
      }
      case 'start': {
        if (!isHost || r.phase !== 'lobby') break;
        if (r.players.length !== r.size) return send(ws, { type: 'error', msg: '還差 ' + (r.size - r.players.length) + ' 位船員' });
        startGame(r); break;
      }
      case 'again': {
        if (!isHost || r.phase !== 'done') break;
        r.phase = 'lobby'; pushLobby(r); bcast(r, { type: 'reset' }); break;
      }
      case 'leave': leave(); break;
    }
  });

  function leave() {
    if (!room || !player) return;
    const r = room, p = player; room = null; player = null; p.ws = null;
    if (r.phase === 'playing') { p.bot = true; p.away = true; if (!humans(r).some(h => h.ws)) deleteRoom(r); else pushLobby(r); }
    else removePlayer(r, p);
  }

  ws.on('close', () => {
    if (!room || !player) return;
    const r = room, p = player; p.ws = null; p.pressing = false;
    if (r.phase === 'playing') {
      p.bot = true; p.away = true;                       // 暫時由「幻影槳手」代划，回來後可無縫接手
      if (!humans(r).some(h => h.ws)) setTimeout(() => { if (rooms.get(r.code) === r && !humans(r).some(h => h.ws)) deleteRoom(r); }, 60000);
    } else {
      p.dropTimer = setTimeout(() => { if (!p.ws && r.players.includes(p)) removePlayer(r, p); }, 15000);
    }
  });
});

// 清掃無人的房間
setInterval(() => { for (const r of rooms.values()) if (!humans(r).some(h => h.ws) && r.phase !== 'lobby') deleteRoom(r); }, 60000).unref();

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  console.log('06 划船渡河 已啟動： http://localhost:' + PORT);
  for (const n of Object.values(nets)) for (const i of n) if (i.family === 'IPv4' && !i.internal) console.log('同一 Wi-Fi 的手機請開： http://' + i.address + ':' + PORT);
});
