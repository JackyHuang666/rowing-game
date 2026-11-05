'use strict';
// 零依賴的最小 WebSocket 伺服器（RFC 6455，文字訊息即可）
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function attach(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    onConnection(new Conn(socket));
  });
}

class Conn {
  constructor(socket) {
    this.socket = socket; this.readyState = 1; this.buf = Buffer.alloc(0);
    this.frag = []; this.handlers = {};
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); try { this._parse(); } catch (e) { this.close(); } });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  _closed() { if (this.readyState === 3) return; this.readyState = 3; this.handlers.close && this.handlers.close(); }
  _parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) { this.close(); return; }
      if (b.length < off + (masked ? 4 : 0) + len) return;
      let payload;
      if (masked) {
        const m = b.subarray(off, off + 4); off += 4;
        payload = Buffer.from(b.subarray(off, off + len));
        for (let i = 0; i < len; i++) payload[i] ^= m[i & 3];
      } else payload = Buffer.from(b.subarray(off, off + len));
      this.buf = b.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.handlers.message && this.handlers.message(msg); }
      }
    }
  }
  _frame(op, payload) {
    if (this.readyState !== 1) return;
    const n = payload.length; let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(str) { this._frame(0x1, Buffer.from(str, 'utf8')); }
  close() { if (this.readyState === 1) { try { this._frame(0x8, Buffer.alloc(0)); } catch (e) {} } this.readyState = 3; try { this.socket.end(); } catch (e) {} this.handlers.close && this.handlers.close(); this.handlers.close = null; }
}

module.exports = { attach };
