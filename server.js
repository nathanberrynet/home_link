const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const WALLPAPERS_DIR = path.join(DATA_DIR, 'wallpapers');

[DATA_DIR, ICONS_DIR, WALLPAPERS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(__dirname));
app.use('/data', express.static(DATA_DIR));

const defaultProfiles = [
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
    sysMonConfig: { name: '', osOverride: '', icon: 'fa-solid fa-server', color: 'orange', customBg: '', fontColor: '', refreshInterval: 3 },
    apps: [
      { id: '1', name: 'TrueNAS CORE', category: 'Storage & NAS', url: 'https://truenas.local', icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/truenas.png', color: 'orange', customBg: '', fontColor: '#f1f5f9', pingEnabled: true, apiKey: '', serviceType: 'generic' },
      { id: '2', name: 'Home Assistant', category: 'Smart Home', url: 'http://192.168.1.234:8123', icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png', color: 'blue', customBg: '', fontColor: '#f1f5f9', pingEnabled: true, apiKey: '', serviceType: 'generic' }
    ],
    categories: ['Media', 'Storage & NAS', 'Smart Home', 'Networking', 'Web']
  }
];

app.get('/api/config', (req, res) => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        return res.json(parsed);
      }
    }
    res.json({ profiles: defaultProfiles, defaultStartupProfileId: 'admin' });
  } catch (err) {
    res.json({ profiles: defaultProfiles, defaultStartupProfileId: 'admin' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assets', (req, res) => {
  try {
    let assets = [];
    if (fs.existsSync(ICONS_DIR)) {
      fs.readdirSync(ICONS_DIR).forEach(file => {
        if (file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~')) return;
        const stats = fs.statSync(path.join(ICONS_DIR, file));
        assets.push({ type: 'icon', filename: file, url: `/data/icons/${file}`, size: stats.size, updatedAt: stats.mtime });
      });
    }
    if (fs.existsSync(WALLPAPERS_DIR)) {
      fs.readdirSync(WALLPAPERS_DIR).forEach(file => {
        if (file.startsWith('.') || file.endsWith('.swp') || file.endsWith('~')) return;
        const stats = fs.statSync(path.join(WALLPAPERS_DIR, file));
        assets.push({ type: 'wallpaper', filename: file, url: `/data/wallpapers/${file}`, size: stats.size, updatedAt: stats.mtime });
      });
    }
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assets/:type/:filename', (req, res) => {
  try {
    const { type, filename } = req.params;
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

app.post('/api/upload-icon', (req, res) => {
  try {
    const { image, filename } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const cleanFilename = Date.now() + '-' + (filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'icon.png');
    fs.writeFileSync(path.join(ICONS_DIR, cleanFilename), Buffer.from(base64Data, 'base64'));
    res.json({ success: true, url: `/data/icons/${cleanFilename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-wallpaper', (req, res) => {
  try {
    const { image, filename } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const cleanFilename = Date.now() + '-' + (filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'wallpaper.jpg');
    fs.writeFileSync(path.join(WALLPAPERS_DIR, cleanFilename), Buffer.from(base64Data, 'base64'));
    res.json({ success: true, url: `/data/wallpapers/${cleanFilename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system-stats', (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);
    const cpus = os.cpus();
    const cpuCores = cpus.length;
    const loadAvg = os.loadavg()[0];
    const cpuPercent = Math.min(100, Math.round((loadAvg / cpuCores) * 100));
    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / (3600 * 24));
    const hours = Math.floor((uptimeSec % (3600 * 24)) / 3600);
    res.json({
      hostname: os.hostname(),
      osVersion: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuCores,
      cpuPercent,
      ramPercent,
      ramUsedGB: (usedMem / (1024 ** 3)).toFixed(1),
      ramTotalGB: (totalMem / (1024 ** 3)).toFixed(1),
      uptime: `${days}d ${hours}h`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`HomeLink server running locally on port ${PORT}`);
});