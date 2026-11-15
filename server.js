const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8580;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const WALLPAPERS_DIR = path.join(DATA_DIR, 'wallpapers');

if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); }
if (!fs.existsSync(ICONS_DIR)) { fs.mkdirSync(ICONS_DIR, { recursive: true }); }
if (!fs.existsSync(WALLPAPERS_DIR)) { fs.mkdirSync(WALLPAPERS_DIR, { recursive: true }); }

// Automatically bootstrap default config on fresh installs if missing
if (!fs.existsSync(CONFIG_FILE)) {
    const defaultInitialConfig = {
        version: '2.6',
        timestamp: new Date().toISOString(),
        currentProfileId: 'admin',
        defaultStartupProfileId: 'admin',
        profiles: [
            {
                id: 'admin',
                name: 'Admin',
                isMain: true,
                password: '',
                avatar: '',
                theme: 'dark',
                weatherZip: '28601',
                pingIntervalSec: 60,
                tileSpacingVal: '2',
                customBgData: '',
                bgScaleMode: 'cover',
                bgZoomVal: 100,
                bgOpacity: 30,
                bgTrueColor: false,
                bgPosX: 50,
                bgPosY: 50,
                showSystemMonitor: false,
                sysMonConfig: { name: '', osOverride: '' },
                apps: [
                    { id: '1', name: 'TrueNAS CORE', category: 'Storage & NAS', url: 'https://truenas.local', icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/truenas.png', color: 'orange', customBg: '', fontColor: '#f1f5f9', pingEnabled: true, apiKey: '', serviceType: 'generic' },
                    { id: '2', name: 'Home Assistant', category: 'Smart Home', url: 'http://192.168.1.234:8123', icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png', color: 'blue', customBg: '', fontColor: '#f1f5f9', pingEnabled: true, apiKey: '', serviceType: 'generic' },
                    { id: '3', name: 'Sonarr', category: 'Media', url: 'http://sonarr.local:8989', icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/sonarr.png', color: 'cyan', customBg: '', fontColor: '#f1f5f9', pingEnabled: true, apiKey: '', serviceType: 'sonarr' }
                ],
                categories: ['Media', 'Storage & NAS', 'Smart Home', 'Networking', 'Web']
            }
        ]
    };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultInitialConfig, null, 2), 'utf8');
    } catch (err) {}
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));
app.use('/data', express.static(DATA_DIR));

function downloadAndCacheIcon(url) {
    return new Promise((resolve) => {
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return resolve(url);
        }

        const filename = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_') + '.png';
        const localPath = path.join(ICONS_DIR, filename);
        const relativePath = `/data/icons/${filename}`;

        if (fs.existsSync(localPath)) return resolve(relativePath);

        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadAndCacheIcon(response.headers.location).then(resolve);
            }
            if (response.statusCode !== 200) return resolve(url);

            const fileStream = fs.createWriteStream(localPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => { fileStream.close(); resolve(relativePath); });
            fileStream.on('error', () => resolve(url));
        });

        request.on('error', () => resolve(url));
        request.setTimeout(5000, () => { request.destroy(); resolve(url); });
    });
}

async function cacheAllExistingIconsOnStartup() {
    if (!fs.existsSync(CONFIG_FILE)) return;
    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const config = JSON.parse(raw);
        let updated = false;
        if (config && Array.isArray(config.profiles)) {
            for (const profile of config.profiles) {
                if (Array.isArray(profile.apps)) {
                    for (const appItem of profile.apps) {
                        if (appItem.icon && (appItem.icon.startsWith('http://') || appItem.icon.startsWith('https://'))) {
                            const cachedPath = await downloadAndCacheIcon(appItem.icon);
                            if (cachedPath !== appItem.icon) { appItem.icon = cachedPath; updated = true; }
                        }
                    }
                }
            }
        }
        if (updated) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        }
    } catch (err) {}
}

app.get('/api/config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try { res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); }
        catch (err) { res.status(500).json({ error: 'Failed to parse config' }); }
    } else { res.json({ categories: [], profiles: [] }); }
});

app.post('/api/config', (req, res) => {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to save config' }); }
});

// Helper for JSON API GET requests
function httpGetJson(targetUrl, headers = {}) {
    return new Promise((resolve) => {
        try {
            const cleanUrl = targetUrl.replace(/\/+$/, '');
            const client = cleanUrl.startsWith('https') ? https : http;
            const req = client.get(cleanUrl, { headers }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch(e) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(4000, () => { req.destroy(); resolve(null); });
        } catch(e) {
            resolve(null);
        }
    });
}

// Smart Service API Proxy supporting Sonarr, Radarr, Prowlarr, qBittorrent, Immich & Custom
app.get('/api/proxy-stats', async (req, res) => {
    const { targetUrl, apiKey, serviceType } = req.query;
    if (!targetUrl) return res.status(400).json({ error: 'Missing targetUrl' });
    try {
        const cleanUrl = targetUrl.replace(/\/+$/, '');
        const client = cleanUrl.startsWith('https') ? https : http;
        let headers = { 'X-Api-Key': apiKey || '' };

        if (serviceType === 'immich') {
            const stats = await httpGetJson(`${cleanUrl}/api/server/statistics`, { 'x-api-key': apiKey || '' });
            if (stats && (stats.photos !== undefined || stats.videos !== undefined)) {
                const photos = stats.photos || 0;
                const videos = stats.videos || 0;
                return res.json({ badge: `${photos.toLocaleString()} photos • ${videos.toLocaleString()} videos` });
            }
            return res.json({ badge: 'Online (No Stats)' });
        }

        if (serviceType === 'qbittorrent') {
            const transferInfo = await httpGetJson(`${cleanUrl}/api/v2/transfer/info`, headers);
            const torrentsInfo = await httpGetJson(`${cleanUrl}/api/v2/torrents/info`, headers);

            let dlSpeedFormatted = '0 B/s';
            let activeCount = 0;

            if (transferInfo && typeof transferInfo.dl_info_speed === 'number') {
                const bytesSec = transferInfo.dl_info_speed;
                if (bytesSec > 1024 * 1024 * 1024) dlSpeedFormatted = (bytesSec / (1024**3)).toFixed(1) + ' GB/s';
                else if (bytesSec > 1024 * 1024) dlSpeedFormatted = (bytesSec / (1024**2)).toFixed(1) + ' MB/s';
                else if (bytesSec > 1024) dlSpeedFormatted = (bytesSec / 1024).toFixed(1) + ' KB/s';
                else if (bytesSec > 0) dlSpeedFormatted = bytesSec + ' B/s';
            }

            if (Array.isArray(torrentsInfo)) {
                activeCount = torrentsInfo.filter(t => 
                    t.state === 'downloading' || 
                    t.state === 'uploading' || 
                    t.state === 'forcedDL' || 
                    t.state === 'forcedUP' ||
                    (t.dlspeed && t.dlspeed > 0) ||
                    (t.upspeed && t.upspeed > 0)
                ).length;
            }

            const badgeText = activeCount > 0 
                ? `${activeCount} active • DL: ${dlSpeedFormatted}` 
                : `0 active (Idle)`;

            return res.json({ badge: badgeText });
        }

        let endpoint = '/api/v3/queue';
        if (serviceType === 'prowlarr') {
            endpoint = '/api/v1/queue';
        } else if (serviceType === 'radarr' || serviceType === 'sonarr') {
            endpoint = '/api/v3/queue';
        }

        const apiReq = client.get(`${cleanUrl}${endpoint}`, { headers }, (apiRes) => {
            let data = '';
            apiRes.on('data', chunk => data += chunk);
            apiRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    let count = 0;
                    if (Array.isArray(json)) {
                        count = json.length;
                    } else if (json && typeof json === 'object' && Array.isArray(json.records)) {
                        count = json.totalRecords !== undefined ? json.totalRecords : json.records.length;
                    }
                    res.json({ badge: `${count} in queue` });
                } catch(e) {
                    res.status(500).json({ error: 'Invalid JSON from service' });
                }
            });
        });
        apiReq.on('error', (err) => res.status(500).json({ error: err.message }));
        apiReq.setTimeout(5000, () => { apiReq.destroy(); res.status(504).json({ error: 'Gateway timeout' }); });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Host System Stats Endpoint
function getCpuUsagePercent() {
    return new Promise((resolve) => {
        const start = os.cpus().map(c => c.times);
        setTimeout(() => {
            const end = os.cpus().map(c => c.times);
            let idleDiff = 0;
            let totalDiff = 0;

            for (let i = 0; i < start.length; i++) {
                const s = start[i];
                const e = end[i];
                const sTotal = s.user + s.nice + s.sys + s.idle + s.irq;
                const eTotal = e.user + e.nice + e.sys + e.idle + e.irq;
                idleDiff += (e.idle - s.idle);
                totalDiff += (eTotal - sTotal);
            }
            const pct = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;
            resolve(pct);
        }, 250);
    });
}

function getHostOsInfo() {
    const releaseFiles = ['/host-os-release', '/etc/os-release'];
    for (const file of releaseFiles) {
        if (fs.existsSync(file)) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const match = content.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
                if (match && match[1]) return match[1];
            } catch (e) {}
        }
    }
    return `${os.type()} ${os.release()}`;
}

app.get('/api/system-stats', async (req, res) => {
    try {
        const cpuPercent = await getCpuUsagePercent();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const ramPercent = Math.round((usedMem / totalMem) * 100);

        const formatGB = (bytes) => (bytes / (1024 ** 3)).toFixed(1);
        const uptimeSec = os.uptime();
        const days = Math.floor(uptimeSec / 86400);
        const hours = Math.floor((uptimeSec % 86400) / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);

        res.json({
            hostname: os.hostname(),
            osVersion: getHostOsInfo(),
            kernel: os.release(),
            arch: os.arch(),
            cpuCores: os.cpus().length,
            cpuPercent,
            ramUsedGB: formatGB(usedMem),
            ramTotalGB: formatGB(totalMem),
            ramPercent,
            uptime: `${days}d ${hours}h ${mins}m`
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to gather system stats' });
    }
});

app.post('/api/cache-icon', async (req, res) => {
    const { url } = req.body;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    const cachedUrl = await downloadAndCacheIcon(url);
    res.json({ url: cachedUrl });
});

app.post('/api/upload-icon', (req, res) => {
    const { image, filename, profileId } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });
    try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = filename ? path.extname(filename) : '.png';
        const safeProfile = profileId || 'admin';
        const safeName = `icon_${safeProfile}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
        const filePath = path.join(ICONS_DIR, safeName);
        fs.writeFileSync(filePath, buffer);
        res.json({ url: `/data/icons/${safeName}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save icon' });
    }
});

app.post('/api/upload-wallpaper', (req, res) => {
    const { image, filename, profileId } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });
    try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = filename ? path.extname(filename) : '.png';
        const safeProfile = profileId || 'admin';
        const safeName = `bg_${safeProfile}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
        const filePath = path.join(WALLPAPERS_DIR, safeName);
        fs.writeFileSync(filePath, buffer);
        res.json({ url: `/data/wallpapers/${safeName}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save wallpaper' });
    }
});

app.get('/api/assets', (req, res) => {
    const { profileId, isAdmin } = req.query;
    let assets = [];
    const isUserAdmin = isAdmin === 'true';

    try {
        if (fs.existsSync(ICONS_DIR)) {
            fs.readdirSync(ICONS_DIR).forEach(filename => {
                const filePath = path.join(ICONS_DIR, filename);
                const stats = fs.statSync(filePath);
                const isUserScoped = filename.startsWith('icon_');
                const ownerId = isUserScoped ? filename.split('_')[1] : null;

                if (isUserAdmin || !isUserScoped || ownerId === profileId) {
                    assets.push({
                        filename,
                        type: 'icon',
                        owner: ownerId || 'shared',
                        url: `/data/icons/${filename}`,
                        size: stats.size,
                        created: stats.birthtime
                    });
                }
            });
        }

        if (fs.existsSync(WALLPAPERS_DIR)) {
            fs.readdirSync(WALLPAPERS_DIR).forEach(filename => {
                const filePath = path.join(WALLPAPERS_DIR, filename);
                const stats = fs.statSync(filePath);
                const parts = filename.split('_');
                const ownerId = parts.length > 1 ? parts[1] : null;

                if (isUserAdmin || ownerId === profileId) {
                    assets.push({
                        filename,
                        type: 'wallpaper',
                        owner: ownerId || 'unknown',
                        url: `/data/wallpapers/${filename}`,
                        size: stats.size,
                        created: stats.birthtime
                    });
                }
            });
        }
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list assets' });
    }
});

app.delete('/api/assets/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const targetDir = type === 'wallpaper' ? WALLPAPERS_DIR : ICONS_DIR;
    const filePath = path.join(targetDir, filename);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            return res.json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to delete file' });
        }
    }
    res.status(404).json({ error: 'File not found' });
});

cacheAllExistingIconsOnStartup().then(() => {
    app.listen(PORT, () => { console.log(`HomeLink running on port ${PORT}`); });
});