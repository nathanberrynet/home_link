const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8580;
const DATA_DIR = path.join(__dirname, 'data');
const CACHED_ICONS_DIR = path.join(DATA_DIR, 'cached_icons');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ICONS_MANIFEST_FILE = path.join(DATA_DIR, 'icons-manifest.json');

[DATA_DIR, CACHED_ICONS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
            console.error(`[HomeLink Error] Failed to create directory ${dir}:`, err.message);
        }
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/api/config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
        } catch (err) {
            res.status(500).json({ error: 'Failed to parse config' });
        }
    } else {
        res.json({ categories: [], profiles: [] });
    }
});

app.post('/api/config', (req, res) => {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// Fetch & cache the full 2,500+ homarr-labs/dashboard-icons index locally
app.get('/api/icons-manifest', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        if (!forceRefresh && fs.existsSync(ICONS_MANIFEST_FILE)) {
            const stat = fs.statSync(ICONS_MANIFEST_FILE);
            const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
            if (ageHours < 168) {
                return res.json(JSON.parse(fs.readFileSync(ICONS_MANIFEST_FILE, 'utf8')));
            }
        }

        const response = await fetch('https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main?recursive=1', {
            headers: { 'User-Agent': 'HomeLink-Dashboard' }
        });
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const data = await response.json();

        const icons = [];
        const seen = new Set();
        if (data && Array.isArray(data.tree)) {
            data.tree.forEach(entry => {
                if (entry.path && entry.path.startsWith('png/') && entry.path.endsWith('.png')) {
                    const slug = entry.path.replace('png/', '').replace('.png', '');
                    if (!seen.has(slug)) {
                        seen.add(slug);
                        icons.push({
                            name: slug.replace(/-/g, ' '),
                            slug: slug,
                            url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`
                        });
                    }
                }
            });
        }

        fs.writeFileSync(ICONS_MANIFEST_FILE, JSON.stringify(icons), 'utf8');
        res.json(icons);
    } catch (err) {
        if (fs.existsSync(ICONS_MANIFEST_FILE)) {
            return res.json(JSON.parse(fs.readFileSync(ICONS_MANIFEST_FILE, 'utf8')));
        }
        res.status(500).json({ error: 'Failed to fetch icons manifest', details: err.message });
    }
});

// Proxy-download and locally cache selected remote icons for 100% offline capability
app.post('/api/cache-icon', async (req, res) => {
    const { url, slug } = req.body;
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Valid remote URL required' });
    }
    try {
        const cleanSlug = (slug || path.basename(new URL(url).pathname).replace(/\.[^/.]+$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');
        const ext = path.extname(new URL(url).pathname) || '.png';
        const localFilename = `${cleanSlug}${ext}`;
        const localFilePath = path.join(CACHED_ICONS_DIR, localFilename);
        const publicUrl = `/data/cached_icons/${localFilename}`;

        if (fs.existsSync(localFilePath)) {
            return res.json({ url: publicUrl, cached: true });
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(localFilePath, Buffer.from(arrayBuffer));

        res.json({ url: publicUrl, cached: false });
    } catch (err) {
        res.json({ url, fallback: true, error: err.message });
    }
});

function getAssetsRecursive(dir, baseDir = dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'config.json' || file === 'icons-manifest.json' || file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~') || file.includes('.swp.')) return;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAssetsRecursive(filePath, baseDir));
        } else {
            const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
            const lower = file.toLowerCase();
            const isWallpaper = lower.includes('bg_') || lower.includes('wallpaper') || lower.includes('background');
            results.push({
                type: isWallpaper ? 'wallpaper' : 'icon',
                url: `/data/${relativePath}`,
                filename: file,
                size: stat.size,
                owner: 'admin'
            });
        }
    });
    return results;
}

app.get('/api/assets', (req, res) => {
    try {
        const assets = getAssetsRecursive(DATA_DIR);
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list assets' });
    }
});

app.delete('/api/assets/:type/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const allAssets = getAssetsRecursive(DATA_DIR);
        const target = allAssets.find(a => a.filename === filename);
        if (target && fs.existsSync(path.join(DATA_DIR, target.url.replace('/data/', '')))) {
            fs.unlinkSync(path.join(DATA_DIR, target.url.replace('/data/', '')));
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete asset' });
    }
});

app.post('/api/upload-icon', (req, res) => {
    try {
        const { image, filename } = req.body;
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const safeName = 'icon_' + Date.now() + '_' + filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        fs.writeFileSync(path.join(DATA_DIR, safeName), buffer);
        res.json({ url: `/data/${safeName}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to upload icon' });
    }
});

app.post('/api/upload-wallpaper', (req, res) => {
    try {
        const { image, filename } = req.body;
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const safeName = 'bg_' + Date.now() + '_' + filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        fs.writeFileSync(path.join(DATA_DIR, safeName), buffer);
        res.json({ url: `/data/${safeName}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to upload wallpaper' });
    }
});

app.use('/data', express.static(DATA_DIR));

app.get('/api/system-stats', (req, res) => {
    try {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        let totalIdle = 0, totalTick = 0;
        cpus.forEach(cpu => {
            for (let type in cpu.times) totalTick += cpu.times[type];
            totalIdle += cpu.times.idle;
        });
        const cpuUsage = Math.round(100 - (totalIdle / totalTick) * 100);
        let uptimeStr = '0h 0m';
        try {
            const uptimeSec = os.uptime();
            uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
        } catch (e) {}
        let osVer = `${os.type()} ${os.release()}`;
        try {
            if (fs.existsSync('/etc/os-release')) {
                const match = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/);
                if (match && match[1]) osVer = match[1];
            }
        } catch (e) {}
        res.json({
            hostname: os.hostname(),
            osVersion: osVer,
            cpuCores: cpus.length,
            cpuPercent: isNaN(cpuUsage) ? 0 : cpuUsage,
            ramTotalGB: (totalMem / (1024 ** 3)).toFixed(1),
            ramUsedGB: (usedMem / (1024 ** 3)).toFixed(1),
            ramPercent: Math.round((usedMem / totalMem) * 100),
            uptime: uptimeStr,
            arch: os.arch()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
    if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${Math.round(bytesPerSec)} B/s`;
}

async function getQbitSessionCookie(baseUrl, secret) {
    if (!secret) return { cookie: '', reason: 'no_secret' };
    let username = 'admin';
    let password = secret;
    if (secret.includes(':')) {
        const idx = secret.indexOf(':');
        username = secret.slice(0, idx);
        password = secret.slice(idx + 1);
    }
    try {
        const res = await fetch(`${baseUrl}/api/v2/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': baseUrl,
                'Referer': `${baseUrl}/`
            },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });
        const bodyText = (await res.text()).trim();
        if (!res.ok || bodyText !== 'Ok.') {
            return { cookie: '', reason: bodyText === 'Fails.' ? 'bad_login' : `http_${res.status}` };
        }
        const setCookie = res.headers.get('set-cookie') || '';
        const sidMatch = setCookie.match(/SID=[^;]+/i);
        return { cookie: sidMatch ? sidMatch[0] : '', reason: 'ok' };
    } catch {
        return { cookie: '', reason: 'error' };
    }
}

app.get('/api/proxy-stats', async (req, res) => {
    const { targetUrl, apiKey, serviceType, appName } = req.query;
    if (!targetUrl) return res.status(400).json({ error: 'Missing targetUrl' });
    const baseUrl = targetUrl.replace(/\/$/, '');
    const lowerType = (serviceType || '').toLowerCase();
    const lowerName = (appName || '').toLowerCase();

    const isQbit = lowerType === 'qbittorrent' ||
        (lowerType === 'generic' && (lowerName.includes('qbit') || baseUrl.includes('qbit') || baseUrl.endsWith(':8880') || baseUrl.endsWith(':8080')));

    try {
        if (lowerType === 'sonarr' || lowerType === 'radarr') {
            const response = await fetch(`${baseUrl}/api/v3/queue?apikey=${encodeURIComponent(apiKey || '')}`);
            const data = await response.json();
            const count = Array.isArray(data) ? data.length : (data.totalRecords || 0);
            return res.json({ badge: `${count} in queue` });
        }

        if (lowerType === 'prowlarr') {
            const response = await fetch(`${baseUrl}/api/v1/applications?apikey=${encodeURIComponent(apiKey || '')}`);
            const data = await response.json();
            const count = Array.isArray(data) ? data.length : 0;
            return res.json({ badge: `${count} apps` });
        }

        if (lowerType === 'immich') {
            const headers = { 'Accept': 'application/json' };
            if (apiKey) headers['x-api-key'] = apiKey;

            let statsRes = await fetch(`${baseUrl}/api/server/statistics`, { headers });
            if (statsRes.status === 404) {
                statsRes = await fetch(`${baseUrl}/api/server-statistics`, { headers });
            }

            if (!statsRes.ok) {
                return res.json({ badge: statsRes.status === 401 || statsRes.status === 403 ? 'Auth Needed' : 'API Error' });
            }

            const stats = await statsRes.json();
            const photos = Number(stats.photos || 0);
            const videos = Number(stats.videos || 0);
            const fmtCount = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
            return res.json({ badge: `${fmtCount(photos)} photos • ${fmtCount(videos)} vids` });
        }

        if (isQbit) {
            const headers = {
                'Origin': baseUrl,
                'Referer': `${baseUrl}/`
            };
            let transferRes = await fetch(`${baseUrl}/api/v2/transfer/info`, { headers });
            let torrentsRes = await fetch(`${baseUrl}/api/v2/torrents/info`, { headers });

            if (!transferRes.ok || !torrentsRes.ok) {
                const login = await getQbitSessionCookie(baseUrl, apiKey || '');
                if (login.cookie) {
                    headers['Cookie'] = login.cookie;
                    transferRes = await fetch(`${baseUrl}/api/v2/transfer/info`, { headers });
                    torrentsRes = await fetch(`${baseUrl}/api/v2/torrents/info`, { headers });
                } else if (login.reason === 'bad_login') {
                    return res.json({ badge: 'Bad Login' });
                }
            }

            if (!transferRes.ok) {
                return res.json({ badge: transferRes.status === 403 ? 'CSRF / 403' : 'Auth Needed' });
            }

            const transferData = await transferRes.json();
            let queueCount = 0;
            if (torrentsRes.ok) {
                const torrents = await torrentsRes.json();
                if (Array.isArray(torrents)) {
                    queueCount = torrents.filter(t =>
                        ['downloading', 'stalledDL', 'queuedDL', 'metaDL', 'checkingDL'].includes(t.state)
                    ).length;
                }
            }

            const dlSpeed = formatSpeed(transferData.dl_info_speed || 0);
            return res.json({ badge: `${queueCount} q • ${dlSpeed}` });
        }

        return res.json({ badge: 'Connected' });
    } catch (err) {
        res.status(500).json({ badge: 'API Offline' });
    }
});

app.listen(PORT, () => {
    console.log(`[HomeLink] Server running on port ${PORT}`);
});