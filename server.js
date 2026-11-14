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
app.use('/data', express.static(DATA_DIR)); // Serve cached icons & config locally to all devices

app.get('/api/config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            res.json(JSON.parse(data));
        } catch (err) {
            res.status(500).json({ error: 'Failed to parse config file' });
        }
    } else {
        res.json({ categories: [], tiles: [] });
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

// Automatically downloads and caches selected online icons server-side for all devices & offline use
app.post('/api/cache-icon', async (req, res) => {
    const { url } = req.body;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    try {
        const filename = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_') + '.png';
        const localPath = path.join(ICONS_DIR, filename);
        const relativePath = `/data/icons/${filename}`;

        if (fs.existsSync(localPath)) {
            return res.json({ url: relativePath });
        }

        const client = url.startsWith('https') ? https : http;
        client.get(url, (response) => {
            if (response.statusCode !== 200) {
                return res.status(500).json({ error: 'Failed to fetch icon' });
            }
            const fileStream = fs.createWriteStream(localPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                res.json({ url: relativePath });
            });
        }).on('error', (err) => {
            res.status(500).json({ error: err.message });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`HomeLink running on port ${PORT}`);
});