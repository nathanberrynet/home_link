const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8580;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error('[HomeLink Error] Failed to create data directory:', err.message);
    }
}

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

// Recursive asset scanner to catch files in root data/ or any subfolders
function getAssetsRecursive(dir, baseDir = dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'config.json' || file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~') || file.includes('.swp.')) return;
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
        } catch(e) {}
        let osVer = `${os.type()} ${os.release()}`;
        try {
            if (fs.existsSync('/etc/os-release')) {
                const match = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/);
                if (match && match[1]) osVer = match[1];
            }
        } catch(e) {}
        res.json({
            hostname: os.hostname(),
            osVersion: osVer,
            cpuCores: cpus.length,
            cpuPercent: isNaN(cpuUsage) ? 0 : cpuUsage,
            ramTotalGB: (totalMem / (1024**3)).toFixed(1),
            ramUsedGB: (usedMem / (1024**3)).toFixed(1),
            ramPercent: Math.round((usedMem / totalMem) * 100),
            uptime: uptimeStr,
            arch: os.arch()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

app.get('/api/proxy-stats', async (req, res) => {
    const { targetUrl, apiKey, serviceType } = req.query;
    if (!targetUrl || !apiKey) return res.status(400).json({ error: 'Missing targetUrl or apiKey' });
    try {
        let apiUrl = targetUrl.replace(/\/$/, '');
        if (serviceType === 'sonarr' || serviceType === 'radarr') apiUrl += `/api/v3/queue?apikey=${apiKey}`;
        else if (serviceType === 'prowlarr') apiUrl += `/api/v1/applications?apikey=${apiKey}`;
        else return res.json({ badge: 'Connected' });
        const response = await fetch(apiUrl);
        const data = await response.json();
        const count = Array.isArray(data) ? data.length : (data.totalRecords || 0);
        res.json({ badge: `${count} in queue` });
    } catch (err) {
        res.status(500).json({ badge: 'API Offline' });
    }
});

app.listen(PORT, () => {
    console.log(`[HomeLink] Server running on port ${PORT}`);
});