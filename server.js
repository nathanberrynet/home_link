const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8580;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const WALLPAPERS_DIR = path.join(DATA_DIR, 'wallpapers');

if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); }
if (!fs.existsSync(ICONS_DIR)) { fs.mkdirSync(ICONS_DIR, { recursive: true }); }
if (!fs.existsSync(WALLPAPERS_DIR)) { fs.mkdirSync(WALLPAPERS_DIR, { recursive: true }); }

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