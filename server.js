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

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/data', express.static(DATA_DIR));

// Helper to download and cache a remote image URL to /app/data/icons/
function downloadAndCacheIcon(url) {
    return new Promise((resolve) => {
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return resolve(url);
        }

        const filename = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_') + '.png';
        const localPath = path.join(ICONS_DIR, filename);
        const relativePath = `/data/icons/${filename}`;

        if (fs.existsSync(localPath)) {
            return resolve(relativePath);
        }

        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadAndCacheIcon(response.headers.location).then(resolve);
            }

            if (response.statusCode !== 200) {
                console.warn(`[Icon Cache] Failed to fetch (${response.statusCode}): ${url}`);
                return resolve(url);
            }

            const fileStream = fs.createWriteStream(localPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`[Icon Cache] Saved locally: ${relativePath}`);
                resolve(relativePath);
            });
            fileStream.on('error', () => {
                resolve(url);
            });
        });

        request.on('error', (err) => {
            console.warn(`[Icon Cache] Error fetching ${url}: ${err.message}`);
            resolve(url);
        });

        request.setTimeout(5000, () => {
            request.destroy();
            resolve(url);
        });
    });
}

// Automatically sweeps config.json on startup and caches all existing remote icons
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
                            if (cachedPath !== appItem.icon) {
                                appItem.icon = cachedPath;
                                updated = true;
                            }
                        }
                    }
                }
            }
        }

        if (updated) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
            console.log('[Icon Cache] Startup migration complete: All existing external icons cached to server.');
        }
    } catch (err) {
        console.error('[Icon Cache] Startup scan failed:', err.message);
    }
}

app.get('/api/config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            res.json(JSON.parse(data));
        } catch (err) {
            res.status(500).json({ error: 'Failed to parse config file' });
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
        res.status(500).json({ error: 'Failed to save config file' });
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

// API: List all local cached icon files
app.get('/api/icons', (req, res) => {
    if (!fs.existsSync(ICONS_DIR)) return res.json([]);
    try {
        const files = fs.readdirNames = fs.readdirSync(ICONS_DIR).map(filename => {
            const filePath = path.join(ICONS_DIR, filename);
            const stats = fs.statSync(filePath);
            return {
                filename,
                url: `/data/icons/${filename}`,
                size: stats.size,
                created: stats.birthtime
            };
        });
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list local icons' });
    }
});

// API: Delete a specific local cached icon file
app.delete('/api/icons/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(ICONS_DIR, filename);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`[Icon Cache] Deleted local asset: ${filename}`);
            return res.json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to delete file' });
        }
    }
    res.status(404).json({ error: 'File not found' });
});

// Run bulk icon migration before accepting connections
cacheAllExistingIconsOnStartup().then(() => {
    app.listen(PORT, () => {
        console.log(`HomeLink running on port ${PORT}`);
    });
});