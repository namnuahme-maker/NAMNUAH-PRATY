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
  queue: [],           // Array of { id, url, title, videoId, addedBy }
  currentVideo: null,  // { id, url, title, videoId, addedBy } or null
  isPlaying: false,    // play/pause status
  currentTime: 0,      // current progress in seconds
  duration: 0,         // current video duration in seconds
  volume: 50,          // 0 to 100
  votesToSkip: []      // array of socket IDs that voted to skip
};

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
  // If it's already just an ID of 11 characters
  if (url.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Helper: Fetch YouTube title using noembed API (no API key needed)
function getYoutubeMetadata(videoId) {
  return new Promise((resolve) => {
    https.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, (res) => {
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
    }).on('error', () => {
      resolve({ title: `YouTube Video (${videoId})`, author: 'YouTube' });
    });
  });
}

// Helper: Play next video in the queue
function playNext() {
  state.votesToSkip = []; // Clear votes
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

// Helper: Broadcast state to all clients
function broadcastState() {
  io.emit('state-update', state);
}

// Helper: Get list of active (connected) socket IDs
function getActiveSocketsCount() {
  return io.sockets.sockets.size;
}

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);
  
  // Send current state and server local IP to newly connected client
  socket.emit('init', {
    state: state,
    localIp: getLocalIp(),
    port: PORT
  });

  // Client requests connection info (in case IP changes)
  socket.on('get-connection-info', () => {
    socket.emit('connection-info', {
      localIp: getLocalIp(),
      port: PORT
    });
  });

  // Add video to queue
  socket.on('add-to-queue', async (data) => {
    const videoId = getYoutubeId(data.url);
    if (!videoId) {
      socket.emit('error-msg', 'URL วิดีโอ YouTube ไม่ถูกต้อง');
      return;
    }

    try {
      const meta = await getYoutubeMetadata(videoId);
      const queueItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId: videoId,
        title: meta.title,
        author: meta.author,
        addedBy: data.nickname || 'ผู้ใช้ทั่วไป'
      };

      state.queue.push(queueItem);
      
      // If nothing is playing, play this video immediately
      if (!state.currentVideo) {
        playNext();
      } else {
        broadcastState();
      }
    } catch (err) {
      socket.emit('error-msg', 'ไม่สามารถดึงข้อมูลวิดีโอได้');
    }
  });

  // Play/Pause control
  socket.on('play-control', (isPlaying) => {
    if (state.currentVideo) {
      state.isPlaying = isPlaying;
      broadcastState();
    }
  });

  // Volume control
  socket.on('volume-control', (vol) => {
    state.volume = Math.max(0, Math.min(100, vol));
    broadcastState();
  });

  // Instant skip (force skip)
  socket.on('skip-video', () => {
    playNext();
  });

  // Vote to skip
  socket.on('vote-skip', () => {
    if (!state.currentVideo) return;
    
    // Add vote if not already voted
    if (!state.votesToSkip.includes(socket.id)) {
      state.votesToSkip.push(socket.id);
    }
    
    const requiredVotes = Math.ceil(getActiveSocketsCount() / 2);
    if (state.votesToSkip.length >= requiredVotes) {
      playNext();
    } else {
      broadcastState();
    }
  });

  // Remove single video from queue
  socket.on('remove-from-queue', (itemId) => {
    state.queue = state.queue.filter(item => item.id !== itemId);
    broadcastState();
  });

  // Clear entire queue
  socket.on('clear-queue', () => {
    state.queue = [];
    broadcastState();
  });

  // Player informs server about current playback progress
  socket.on('player-progress', (data) => {
    // Only update if player is streaming time
    state.currentTime = data.currentTime;
    if (data.duration) {
      state.duration = data.duration;
    }
    // We send time updates as volatile to avoid queue congestion
    socket.broadcast.volatile.emit('time-update', {
      currentTime: state.currentTime,
      duration: state.duration
    });
  });

  // Sync state (when video ends on player client)
  socket.on('player-video-ended', () => {
    playNext();
  });

  // Seek video to specific time
  socket.on('seek-to', (seconds) => {
    state.currentTime = seconds;
    io.emit('seek-video', seconds);
  });

  // Reaction event
  socket.on('send-reaction', (data) => {
    io.emit('new-reaction', data);
  });

  // Danmaku comments event
  socket.on('send-danmaku', (data) => {
    io.emit('new-danmaku', data);
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove client's vote if they disconnected
    const index = state.votesToSkip.indexOf(socket.id);
    if (index > -1) {
      state.votesToSkip.splice(index, 1);
      broadcastState();
    }
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
