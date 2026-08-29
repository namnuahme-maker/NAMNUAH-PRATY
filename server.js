const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Collaborative Player State
let state = {
  queue: [],
  currentVideo: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 50
};

let connectedUsers = {}; // { socketId: { name, color } }

// Helper: Get local network IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// Helper: Parse YouTube URL to extract 11-character video ID
function getYoutubeId(url) {
  if (!url) return null;
  if (url.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Helper: Fetch YouTube title using noembed API
function getYoutubeMetadata(videoId) {
  return new Promise((resolve) => {
    https.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ title: json.title || `YouTube Video (${videoId})`, author: json.author_name || 'YouTube' });
        } catch (e) {
          resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
        }
      });
    }).on('error', () => resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' }));
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
    connectedUsers[socket.id] = { name: data.name, color: data.color };
    io.emit('users-update', connectedUsers);
  });

  socket.on('add-to-queue', async (data) => {
    const videoId = getYoutubeId(data.url);
    if (!videoId) return socket.emit('error-msg', 'URL วิดีโอ YouTube ไม่ถูกต้อง');
    try {
      const meta = await getYoutubeMetadata(videoId);
      state.queue.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId: videoId,
        title: meta.title,
        author: meta.author,
        addedBy: data.nickname || 'ผู้ใช้ทั่วไป',
        color: data.color || '#ABD2FA'
      });
      if (!state.currentVideo) playNext();
      else broadcastState();
    } catch (err) {
      socket.emit('error-msg', 'ไม่สามารถดึงข้อมูลวิดีโอได้');
    }
  });

  socket.on('play-control', (isPlaying) => {
    if (state.currentVideo) {
      state.isPlaying = isPlaying;
      broadcastState();
    }
  });

  socket.on('volume-control', (vol) => {
    state.volume = Math.max(0, Math.min(100, vol));
    broadcastState();
  });

  socket.on('skip-video', () => playNext());

  socket.on('remove-from-queue', (itemId) => {
    state.queue = state.queue.filter(item => item.id !== itemId);
    broadcastState();
  });

  socket.on('clear-queue', () => {
    state.queue = [];
    broadcastState();
  });

  socket.on('player-progress', (data) => {
    state.currentTime = data.currentTime;
    if (data.duration) state.duration = data.duration;
    socket.broadcast.volatile.emit('time-update', { currentTime: state.currentTime, duration: state.duration });
  });

  socket.on('player-video-ended', () => playNext());
  
  socket.on('seek-to', (seconds) => {
    state.currentTime = seconds;
    io.emit('seek-video', seconds);
  });

  socket.on('send-reaction', (data) => io.emit('new-reaction', data));
  socket.on('send-danmaku', (data) => io.emit('new-danmaku', data));

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete connectedUsers[socket.id];
    io.emit('users-update', connectedUsers);
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`=============================================================`);
  console.log(`Server is running!`);
  console.log(`Access locally: http://localhost:${PORT}`);
  console.log(`Access on LAN:  http://${ip}:${PORT}`);
  console.log(`=============================================================`);
});
