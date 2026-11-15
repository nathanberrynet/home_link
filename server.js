const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload limit for base64 image and wallpaper uploads
app.use(express.json({ limit: '50mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const WALLPAPERS_DIR = path.join(DATA_DIR, 'wallpapers');

// Ensure local data directories exist (fully offline local storage)
[DATA_DIR, ICONS_DIR, WALLPAPERS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve static frontend files from current directory
app.use(express.static(__dirname));

// Serve local data files (icons, wallpapers) statically
app.use('/data', express.static(DATA_DIR));

// GET /api/config - Load dashboard configuration
app.get('/api/config', (req, res) => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json({ profiles: [], defaultStartupProfileId: 'admin' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config - Save dashboard configuration
app.post('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assets - Scans storage, ignoring hidden files and editor swap files (.swp)
app.get('/api/assets', (req, res) => {
  try {
    let assets = [];

    // Scan icons directory
    if (fs.existsSync(ICONS_DIR)) {
      const iconFiles = fs.readdirSync(ICONS_DIR);
      iconFiles.forEach(file => {
        if (file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~')) return;
        const filePath = path.join(ICONS_DIR, file);
        const stats = fs.statSync(filePath);
        assets.push({
          type: 'icon',
          filename: file,
          url: `/data/icons/${file}`,
          size: stats.size,
          updatedAt: stats.mtime
        });
      });
    }

    // Scan wallpapers directory
    if (fs.existsSync(WALLPAPERS_DIR)) {
      const wpFiles = fs.readdirSync(WALLPAPERS_DIR);
      wpFiles.forEach(file => {
        if (file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~')) return;
        const filePath = path.join(WALLPAPERS_DIR, file);
        const stats = fs.statSync(filePath);
        assets.push({
          type: 'wallpaper',
          filename: file,
          url: `/data/wallpapers/${file}`,
          size: stats.size,
          updatedAt: stats.mtime
        });
      });
    }

    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/assets/:type/:filename - Delete a local asset
app.delete('/api/assets/:type/:filename', (req, res) => {
  try {
    const { type, filename } = req.params;
    // Prevent directory traversal attacks
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const targetDir = type === 'wallpaper' ? WALLPAPERS_DIR : ICONS_DIR;
    const filePath = path.join(targetDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Asset not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload-icon - Upload icon to local storage
app.post('/api/upload-icon', (req, res) => {
  try {
    const { image, filename } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const cleanFilename = Date.now() + '-' + (filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'icon.png');
    const filePath = path.join(ICONS_DIR, cleanFilename);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    res.json({ success: true, url: `/data/icons/${cleanFilename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload-wallpaper - Upload wallpaper to local storage
app.post('/api/upload-wallpaper', (req, res) => {
  try {
    const { image, filename } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const cleanFilename = Date.now() + '-' + (filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'wallpaper.jpg');
    const filePath = path.join(WALLPAPERS_DIR, cleanFilename);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    res.json({ success: true, url: `/data/wallpapers/${cleanFilename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-stats - Host system monitor stats (CPU, RAM, Uptime)
app.get('/api/system-stats', (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    const cpuCores = cpus.length;

    // Calculate simple CPU load average based on os loadavg
    const loadAvg = os.loadavg()[0];
    const cpuPercent = Math.min(100, Math.round((loadAvg / cpuCores) * 100));

    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / (3600 * 24));
    const hours = Math.floor((uptimeSec % (3600 * 24)) / 3600);
    const uptimeStr = `${days}d ${hours}h`;

    res.json({
      hostname: os.hostname(),
      osVersion: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuCores,
      cpuPercent,
      ramPercent,
      ramUsedGB: (usedMem / (1024 ** 3)).toFixed(1),
      ramTotalGB: (totalMem / (1024 ** 3)).toFixed(1),
      uptime: uptimeStr
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`HomeLink server running locally on port ${PORT}`);
});