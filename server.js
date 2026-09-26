const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const https = require('https');
const { Innertube } = require('youtubei.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Innertube instance for search & YouTube metadata
let innertube = null;
async function getInnertube() {
  if (!innertube) {
    innertube = await Innertube.create();
  }
  return innertube;
}

// Collaborative Player State
let state = {
  queue: [],
  currentVideo: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 50,
  quality: 'max'
};

let connectedUsers = {}; // { socketId: { name, color } }
const clientRateLimits = new Map(); // socket.id -> { lastDanmaku: timestamp, lastReaction: timestamp }

// Helper: Get local network IP address (prioritizing physical Wi-Fi/Ethernet)
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const physicalCandidates = [];
  const otherCandidates = [];

  for (const devName in interfaces) {
    const isVirtual = /vEthernet|wsl|virtual|vmware|vbox|docker|loopback/i.test(devName);
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        if (!isVirtual) {
          if (/wi-fi|wifi|ethernet|lan/i.test(devName)) {
            return alias.address;
          }
          physicalCandidates.push(alias.address);
        } else {
          otherCandidates.push(alias.address);
        }
      }
    }
  }
  return physicalCandidates[0] || otherCandidates[0] || 'localhost';
}

// Helper: Parse YouTube URL to extract 11-character video ID (supports standard, shorts, live, embed, youtu.be)
function getYoutubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const regExp = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

// Helper: Fetch YouTube title using noembed API with 4s timeout fallback
function getYoutubeMetadata(videoId) {
  return new Promise((resolve) => {
    const req = https.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            title: json.title || `YouTube Video (${videoId})`,
            author: json.author_name || 'YouTube'
          });
        } catch (e) {
          resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
        }
      });
    });

    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
    });

    req.on('error', () => {
      resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
    });
  });
}

function playNext() {
  if (state.queue.length > 0) {
    state.currentVideo = state.queue.shift();
    state.isPlaying = true;
    state.currentTime = 0;
    state.duration = 0;
  } else {
    state.currentVideo = null;
    state.isPlaying = false;
    state.currentTime = 0;
    state.duration = 0;
  }
  broadcastState();
}

function broadcastState() {
  io.emit('state-update', state);
}

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.emit('init', {
    state: state,
    localIp: getLocalIp(),
    port: PORT,
    users: connectedUsers
  });

  socket.on('set-profile', (data) => {
    if (!data || typeof data !== 'object') return;
    const name = typeof data.name === 'string' ? data.name.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
    const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';
    connectedUsers[socket.id] = { name: name || 'ผู้ใช้ทั่วไป', color };
    io.emit('users-update', connectedUsers);
  });

  socket.on('add-to-queue', async (data) => {
    if (!data || typeof data !== 'object' || !data.url) {
      return socket.emit('error-msg', 'กรุณาระบุ URL วิดีโอ YouTube');
    }
    const videoId = getYoutubeId(data.url);
    if (!videoId) {
      return socket.emit('error-msg', 'URL วิดีโอ YouTube ไม่ถูกต้อง (รองรับทั้งลิงก์ปกติ, Shorts, Live และ youtu.be)');
    }

    try {
      const meta = await getYoutubeMetadata(videoId);
      const nickname = typeof data.nickname === 'string' ? data.nickname.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
      const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';

      state.queue.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId: videoId,
        title: meta.title,
        author: meta.author,
        addedBy: nickname || 'ผู้ใช้ทั่วไป',
        color: color,
        addedBySocketId: socket.id
      });

      if (!state.currentVideo) playNext();
      else broadcastState();
    } catch (err) {
      socket.emit('error-msg', 'ไม่สามารถดึงข้อมูลวิดีโอได้');
    }
  });

  socket.on('play-control', (isPlaying) => {
    if (state.currentVideo && typeof isPlaying === 'boolean') {
      state.isPlaying = isPlaying;
      broadcastState();
    }
  });

  socket.on('volume-control', (vol) => {
    if (typeof vol === 'number' && !isNaN(vol)) {
      state.volume = Math.max(0, Math.min(100, Math.round(vol)));
      broadcastState();
    }
  });

  socket.on('quality-control', (qual) => {
    if (typeof qual === 'string') {
      state.quality = qual;
      broadcastState();
    }
  });

  socket.on('skip-video', () => playNext());

  socket.on('remove-from-queue', (itemId) => {
    if (typeof itemId !== 'string') return;
    state.queue = state.queue.filter(item => item.id !== itemId);
    broadcastState();
  });

  socket.on('clear-queue', () => {
    state.queue = [];
    broadcastState();
  });

  socket.on('player-progress', (data) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.currentTime === 'number' && !isNaN(data.currentTime)) {
      state.currentTime = data.currentTime;
    }
    if (typeof data.duration === 'number' && !isNaN(data.duration) && data.duration > 0) {
      state.duration = data.duration;
    }
    socket.broadcast.volatile.emit('time-update', {
      currentTime: state.currentTime,
      duration: state.duration
    });
  });

  socket.on('player-video-ended', () => playNext());

  socket.on('seek-to', (seconds) => {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return;
    state.currentTime = seconds;
    io.emit('seek-video', seconds);
  });

  // Embed Error Handlers & Interactive Choice
  socket.on('playback-error', (data) => {
    if (!data || !state.currentVideo) return;
    io.emit('show-error-prompt', {
      videoId: state.currentVideo.videoId,
      title: state.currentVideo.title,
      errorCode: data.errorCode || 150
    });
  });

  socket.on('resolve-error-action', async (action) => {
    io.emit('close-error-prompt');

    if (action === 'find-alt') {
      if (!state.currentVideo) return;
      try {
        const yt = await getInnertube();
        const currentTitle = state.currentVideo.title;
        const currentId = state.currentVideo.videoId;
        // Clean query from noisy brackets
        const cleanTitle = currentTitle.replace(/[\(\[\{【].*?[\)\]\}】]/g, ' ').trim();
        const query = cleanTitle || currentTitle;

        console.log(`Searching alternative for: "${query}" (Original: ${currentId})`);
        const search = await yt.search(query);

        // Find alternative video that is not the broken one
        const alt = search.videos.find(v => v.id && v.id !== currentId);
        if (alt) {
          console.log(`Found alternative: ${alt.id} - ${alt.title?.text}`);
          state.currentVideo = {
            id: state.currentVideo.id,
            url: `https://www.youtube.com/watch?v=${alt.id}`,
            videoId: alt.id,
            title: alt.title?.text || alt.title?.runs?.[0]?.text || currentTitle,
            author: alt.author?.name || 'YouTube',
            addedBy: `${state.currentVideo.addedBy} (เวอร์ชันสำรอง)`,
            color: state.currentVideo.color
          };
          state.isPlaying = true;
          state.currentTime = 0;
          state.duration = 0;
          broadcastState();
          io.emit('show-toast-broadcast', `สลับไปเล่นคลิปสำรอง: ${state.currentVideo.title}`);
        } else {
          socket.emit('error-msg', 'ไม่พบคลิปสำรองสำหรับเพลงนี้');
          playNext();
        }
      } catch (err) {
        console.error('Find alternative error:', err.message);
        playNext();
      }
    } else if (action === 'skip') {
      playNext();
    }
  });

  socket.on('send-reaction', (emoji) => {
    if (typeof emoji !== 'string') return;
    const allowedEmojis = ['😍', '👍', '👎', '🎉', '🔥', '❤️'];
    if (!allowedEmojis.includes(emoji)) return;

    const now = Date.now();
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0 };
    if (now - limits.lastReaction < 200) return;
    limits.lastReaction = now;
    clientRateLimits.set(socket.id, limits);

    io.emit('new-reaction', emoji);
  });

  socket.on('send-danmaku', (data) => {
    if (!data || typeof data !== 'object' || typeof data.text !== 'string') return;

    const now = Date.now();
    const limits = clientRateLimits.get(socket.id) || { lastDanmaku: 0, lastReaction: 0 };
    if (now - limits.lastDanmaku < 1000) {
      return socket.emit('error-msg', 'ส่งข้อความเร็วเกินไป กรุณารอ 1 วินาที');
    }
    limits.lastDanmaku = now;
    clientRateLimits.set(socket.id, limits);

    const text = data.text.trim().substring(0, 80);
    if (!text) return;
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().substring(0, 25) : 'ผู้ใช้ทั่วไป';
    const color = typeof data.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#ABD2FA';

    io.emit('new-danmaku', {
      text,
      nickname,
      color,
      tts: Boolean(data.tts)
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete connectedUsers[socket.id];
    clientRateLimits.delete(socket.id);
    io.emit('users-update', connectedUsers);
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`=============================================================`);
  console.log(`NAMNUAH PARTY Server is running!`);
  console.log(`Access locally: http://localhost:${PORT}`);
  console.log(`Access on LAN:  http://${ip}:${PORT}`);
  console.log(`=============================================================`);
});
