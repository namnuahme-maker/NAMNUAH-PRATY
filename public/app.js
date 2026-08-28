// Socket.io connection
const socket = io();

// Local State (cached replica of server state)
let localState = {
  queue: [],
  currentVideo: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 50,
  votesToSkip: []
};

let serverInfo = {
  localIp: 'localhost',
  port: 3000
};

// YouTube player variables
let ytPlayer = null;
let ytApiReady = false;
let progressInterval = null;
let isPlayerEnabled = true;

// Load Settings from LocalStorage
const savedNickname = localStorage.getItem('nickname') || '';
const savedPlayerState = localStorage.getItem('playerEnabled');

// If localstorage has playerEnabled, use it, else default to true on large screens, false on mobile
if (savedPlayerState !== null) {
  isPlayerEnabled = savedPlayerState === 'true';
} else {
  // Mobile heuristic: screen width < 768px (standard Tailwind md breakpoint)
  isPlayerEnabled = window.innerWidth >= 768;
}

// DOM Elements
const connectionBadge = document.getElementById('connection-badge');
const clientsCount = document.getElementById('clients-count');
const clientsNumber = document.getElementById('clients-number');
const togglePlayer = document.getElementById('toggle-player');
const playerContainer = document.getElementById('player-container');
const noVideoOverlay = document.getElementById('no-video-overlay');

const nicknameInput = document.getElementById('nickname-input');
const videoUrlInput = document.getElementById('video-url-input');
const addToQueueBtn = document.getElementById('add-to-queue-btn');

const currentTitle = document.getElementById('current-title');
const currentAuthor = document.getElementById('current-author');
const progressBarContainer = document.getElementById('progress-bar-container');
const progressBarFill = document.getElementById('progress-bar-fill');
const currentTimeLabel = document.getElementById('current-time-label');
const durationLabel = document.getElementById('duration-label');

const volumeSlider = document.getElementById('volume-slider');
const volumeLabel = document.getElementById('volume-label');
const volUpBtn = document.getElementById('vol-up-btn');
const volDownBtn = document.getElementById('vol-down-btn');

const playPauseBtn = document.getElementById('play-pause-btn');
const playPauseIcon = document.getElementById('play-pause-icon');
const voteSkipBtn = document.getElementById('vote-skip-btn');
const voteSkipLabel = document.getElementById('vote-skip-label');
const forceSkipBtn = document.getElementById('force-skip-btn');

const queueCount = document.getElementById('queue-count');
const queueList = document.getElementById('queue-list');
const clearQueueBtn = document.getElementById('clear-queue-btn');

const showQrBtn = document.getElementById('show-qr-btn');
const qrModal = document.getElementById('qr-modal');
const closeQrBtn = document.getElementById('close-qr-btn');
const lanUrlText = document.getElementById('lan-url-text');
const copyUrlBtn = document.getElementById('copy-url-btn');

// New Ocean Theme & Danmaku Elements
const tabControlsBtn = document.getElementById('tab-controls-btn');
const tabQueueBtn = document.getElementById('tab-queue-btn');
const mobileQueueCount = document.getElementById('mobile-queue-count');
const sectionControls = document.getElementById('section-controls');
const sectionQueue = document.getElementById('section-queue');

const reactLoveBtn = document.getElementById('react-love-btn');
const reactOkBtn = document.getElementById('react-ok-btn');
const reactBadBtn = document.getElementById('react-bad-btn');

const danmakuInput = document.getElementById('danmaku-input');
const danmakuBtn = document.getElementById('danmaku-btn');
const danmakuContainer = document.getElementById('danmaku-container');

// Initialize Form Inputs
nicknameInput.value = savedNickname;
togglePlayer.checked = isPlayerEnabled;
updatePlayerVisibility();

// -------------------------------------------------------------
// YouTube Iframe API Integration
// -------------------------------------------------------------

// Load YouTube API asynchronously
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// Automatically called by YouTube API when loaded
window.onYouTubeIframeAPIReady = function() {
  ytApiReady = true;
  console.log("YouTube API is ready");
  if (isPlayerEnabled) {
    initYoutubePlayer();
  }
};

function initYoutubePlayer() {
  if (!ytApiReady || ytPlayer) return;

  // Create iframe element inside #yt-player div
  ytPlayer = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    videoId: localState.currentVideo ? localState.currentVideo.videoId : '',
    playerVars: {
      'autoplay': 0,
      'controls': 1, // Let user have controls on player screen too
      'rel': 0,
      'modestbranding': 1,
      'fs': 1,
      'origin': window.location.origin
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
}

function destroyYoutubePlayer() {
  stopProgressInterval();
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    ytPlayer.destroy();
  }
  ytPlayer = null;
  // Recreate the div container since YT destroy removes it
  const videoWrapper = document.getElementById('video-wrapper');
  if (videoWrapper && !document.getElementById('yt-player')) {
    const playerDiv = document.createElement('div');
    playerDiv.id = 'yt-player';
    videoWrapper.insertBefore(playerDiv, videoWrapper.firstChild);
  }
}

function onPlayerReady(event) {
  console.log("YouTube player is ready");
  // Set volume based on server state
  ytPlayer.setVolume(localState.volume);
  
  // If we have video currently active in state, load it
  syncPlayerWithState();
}

function onPlayerStateChange(event) {
  // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued)
  if (event.data === YT.PlayerState.PLAYING) {
    startProgressInterval();
    // Notify server play state if was paused
    if (!localState.isPlaying) {
      socket.emit('play-control', true);
    }
  } else if (event.data === YT.PlayerState.PAUSED) {
    stopProgressInterval();
    // Notify server pause state if was playing
    if (localState.isPlaying) {
      socket.emit('play-control', false);
    }
  } else if (event.data === YT.PlayerState.ENDED) {
    stopProgressInterval();
    socket.emit('player-video-ended');
  }
}

function onPlayerError(event) {
  console.error("YouTube Player error:", event.data);
  // Auto-skip video if it fails to load or play
  socket.emit('player-video-ended');
}

function startProgressInterval() {
  stopProgressInterval();
  progressInterval = setInterval(() => {
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && typeof ytPlayer.getDuration === 'function') {
      const currentTime = ytPlayer.getCurrentTime();
      const duration = ytPlayer.getDuration();
      
      // Update local state directly for responsive feedback
      localState.currentTime = currentTime;
      localState.duration = duration;
      updateProgressBar(currentTime, duration);

      // Send status to server
      socket.emit('player-progress', {
        currentTime: currentTime,
        duration: duration
      });
    }
  }, 1000);
}

function stopProgressInterval() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// -------------------------------------------------------------
// State Synchronization
// -------------------------------------------------------------

function syncPlayerWithState() {
  if (!isPlayerEnabled || !ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;

  const currentVideo = localState.currentVideo;
  
  if (currentVideo) {
    noVideoOverlay.classList.add('hidden');
    
    const videoId = currentVideo.videoId;
    const playerVideoUrl = ytPlayer.getVideoUrl() || '';
    const isDifferentVideo = !playerVideoUrl.includes(videoId);

    if (isDifferentVideo) {
      // Load and autoplay new video ID
      ytPlayer.loadVideoById({
        videoId: videoId,
        startSeconds: localState.currentTime || 0
      });
    }

    // Sync Play / Pause
    const playerState = ytPlayer.getPlayerState();
    if (localState.isPlaying && playerState !== YT.PlayerState.PLAYING && playerState !== YT.PlayerState.BUFFERING) {
      ytPlayer.playVideo();
    } else if (!localState.isPlaying && playerState === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    }

    // Sync Volume
    if (ytPlayer.getVolume() !== localState.volume) {
      ytPlayer.setVolume(localState.volume);
    }

    // Sync current time if way out of sync (> 3 seconds drift)
    const drift = Math.abs(ytPlayer.getCurrentTime() - localState.currentTime);
    if (drift > 3 && !isDifferentVideo) {
      ytPlayer.seekTo(localState.currentTime, true);
    }

  } else {
    // No video active
    noVideoOverlay.classList.remove('hidden');
    ytPlayer.stopVideo();
  }
}

// -------------------------------------------------------------
// UI Render Methods
// -------------------------------------------------------------

function updatePlayerVisibility() {
  if (isPlayerEnabled) {
    playerContainer.classList.remove('hidden');
  } else {
    playerContainer.classList.add('hidden');
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateProgressBar(current, duration) {
  if (!duration) {
    progressBarFill.style.width = '0%';
    currentTimeLabel.textContent = '0:00';
    durationLabel.textContent = '0:00';
    return;
  }
  const pct = (current / duration) * 100;
  progressBarFill.style.width = `${pct}%`;
  currentTimeLabel.textContent = formatTime(current);
  durationLabel.textContent = formatTime(duration);
}

function renderUI() {
  // Update Play/Pause Button
  if (localState.isPlaying) {
    playPauseIcon.className = "fa-solid fa-pause text-lg";
  } else {
    playPauseIcon.className = "fa-solid fa-play text-lg";
  }

  // Update Title and Author
  if (localState.currentVideo) {
    currentTitle.textContent = localState.currentVideo.title;
    currentAuthor.textContent = `เพิ่มโดย: ${localState.currentVideo.addedBy}`;
    updateProgressBar(localState.currentTime, localState.duration);
  } else {
    currentTitle.textContent = 'ยังไม่มีเพลงที่เล่น';
    currentAuthor.textContent = 'กรุณาแอดเพลงเข้าคิว';
    updateProgressBar(0, 0);
  }

  // Update Volume Elements
  volumeSlider.value = localState.volume;
  volumeLabel.textContent = `${localState.volume}%`;

  // Update Vote Button Label
  const requiredVotes = Math.ceil(clientsNumber.textContent / 2);
  const currentVotes = localState.votesToSkip.length;
  voteSkipLabel.textContent = `โหวตข้าม (${currentVotes}/${requiredVotes})`;
  
  // Highlighting if local user already voted
  if (localState.votesToSkip.includes(socket.id)) {
    voteSkipBtn.classList.remove('bg-black/50', 'hover:bg-white/10', 'border-white/5');
    voteSkipBtn.classList.add('bg-brand-500/20', 'border-brand-500/50', 'text-brand-500');
  } else {
    voteSkipBtn.classList.remove('bg-brand-500/20', 'border-brand-500/50', 'text-brand-500');
    voteSkipBtn.classList.add('bg-black/50', 'hover:bg-white/10', 'border-white/5');
  }

  // Update Queue Count
  queueCount.textContent = localState.queue.length;
  if (mobileQueueCount) {
    mobileQueueCount.textContent = localState.queue.length;
  }

  // Render Queue List
  queueList.innerHTML = '';
  if (localState.queue.length === 0) {
    queueList.innerHTML = `
      <div class="text-center text-xs text-slate-500 py-6">
          ยังไม่มีคิวเพลงถัดไป
      </div>
    `;
  } else {
    localState.queue.forEach((item, index) => {
      const queueItemDiv = document.createElement('div');
      queueItemDiv.className = "bg-black/30 border border-white/5 hover:bg-white/10 p-2.5 rounded-xl flex items-center justify-between text-xs transition";
      queueItemDiv.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0 flex-1">
            <span class="font-bold text-brand-500/70 text-sm w-4 text-center shrink-0">${index + 1}</span>
            <div class="min-w-0 flex-1">
                <p class="font-medium text-slate-200 truncate">${item.title}</p>
                <p class="text-[10px] text-slate-500 mt-0.5 tracking-wide">ADDED BY: ${item.addedBy}</p>
            </div>
        </div>
        <button class="delete-queue-item text-slate-600 hover:text-red-400 p-2 transition ml-2 shrink-0 bg-white/5 hover:bg-white/10 rounded-lg" data-id="${item.id}">
            <i class="fa-solid fa-trash-can"></i>
        </button>
      `;
      queueList.appendChild(queueItemDiv);
    });

    // Add click listeners to delete buttons
    document.querySelectorAll('.delete-queue-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        socket.emit('remove-from-queue', id);
      });
    });
  }
}

function renderQRCode(url) {
  document.getElementById("qrcode").innerHTML = "";
  new QRCode(document.getElementById("qrcode"), {
    text: url,
    width: 180,
    height: 180,
    colorDark : "#020617", // slate-950
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
}

// -------------------------------------------------------------
// Event Listeners (User Interactions)
// -------------------------------------------------------------

// Toggle Screen Player Mode
togglePlayer.addEventListener('change', (e) => {
  isPlayerEnabled = e.target.checked;
  localStorage.setItem('playerEnabled', isPlayerEnabled);
  updatePlayerVisibility();
  
  if (isPlayerEnabled) {
    initYoutubePlayer();
  } else {
    destroyYoutubePlayer();
  }
  
  // Re-sync UI or connection details
  renderUI();
  if (ytPlayer) {
    syncPlayerWithState();
  }
});

// Update Nickname Local Storage on Change
nicknameInput.addEventListener('input', (e) => {
  const name = e.target.value.trim();
  localStorage.setItem('nickname', name);
});

// Add to Queue Action
function handleAddToQueue() {
  const url = videoUrlInput.value.trim();
  const nickname = nicknameInput.value.trim() || 'ผู้ใช้ทั่วไป';
  if (!url) return;

  socket.emit('add-to-queue', {
    url: url,
    nickname: nickname
  });
  videoUrlInput.value = '';
}

addToQueueBtn.addEventListener('click', handleAddToQueue);
videoUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAddToQueue();
});

// Play/Pause Action
playPauseBtn.addEventListener('click', () => {
  if (!localState.currentVideo) return;
  socket.emit('play-control', !localState.isPlaying);
});

// Volume actions
function updateVolume(val) {
  socket.emit('volume-control', val);
}

volumeSlider.addEventListener('input', (e) => {
  const vol = parseInt(e.target.value);
  // Optimistic UI update
  volumeLabel.textContent = `${vol}%`;
  updateVolume(vol);
});

volUpBtn.addEventListener('click', () => {
  const targetVol = Math.min(100, localState.volume + 5);
  updateVolume(targetVol);
});

volDownBtn.addEventListener('click', () => {
  const targetVol = Math.max(0, localState.volume - 5);
  updateVolume(targetVol);
});

// Skip controls
voteSkipBtn.addEventListener('click', () => {
  if (!localState.currentVideo) return;
  socket.emit('vote-skip');
});

forceSkipBtn.addEventListener('click', () => {
  if (!localState.currentVideo) return;
  socket.emit('skip-video');
});

// Clear Queue Action
clearQueueBtn.addEventListener('click', () => {
  if (confirm('คุณต้องการลบวิดีโอทั้งหมดออกจากคิวใช่หรือไม่?')) {
    socket.emit('clear-queue');
  }
});

// Seek Track Click
progressBarContainer.addEventListener('click', (e) => {
  if (!localState.currentVideo || !localState.duration) return;
  const rect = progressBarContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = clickX / rect.width;
  const targetSeconds = percentage * localState.duration;
  socket.emit('seek-to', targetSeconds);
});

// QR Modal Actions
showQrBtn.addEventListener('click', () => {
  qrModal.classList.remove('hidden');
});

closeQrBtn.addEventListener('click', () => {
  qrModal.classList.add('hidden');
});

qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) {
    qrModal.classList.add('hidden');
  }
});

copyUrlBtn.addEventListener('click', () => {
  const url = lanUrlText.textContent;
  navigator.clipboard.writeText(url).then(() => {
    const originalText = copyUrlBtn.innerHTML;
    copyUrlBtn.innerHTML = `<i class="fa-solid fa-check text-green-400"></i> <span class="text-green-400">คัดลอกแล้ว</span>`;
    setTimeout(() => {
      copyUrlBtn.innerHTML = originalText;
    }, 2000);
  });
});

// Mobile Tab Switching
if (tabControlsBtn && tabQueueBtn) {
  tabControlsBtn.addEventListener('click', () => {
    sectionControls.classList.remove('hidden');
    sectionQueue.classList.add('hidden');
    tabControlsBtn.className = "flex-1 py-3 text-center text-xs font-medium border-b-2 border-brand-500 text-brand-500 transition tracking-wide";
    tabQueueBtn.className = "flex-1 py-3 text-center text-xs font-medium border-b-2 border-transparent text-slate-500 transition tracking-wide";
  });

  tabQueueBtn.addEventListener('click', () => {
    sectionQueue.classList.remove('hidden');
    sectionControls.classList.add('hidden');
    tabQueueBtn.className = "flex-1 py-3 text-center text-xs font-medium border-b-2 border-brand-500 text-brand-500 transition tracking-wide";
    tabControlsBtn.className = "flex-1 py-3 text-center text-xs font-medium border-b-2 border-transparent text-slate-500 transition tracking-wide";
  });
}

// Mood Reactions click handlers
if (reactLoveBtn) {
  reactLoveBtn.addEventListener('click', () => {
    socket.emit('send-reaction', { type: 'love' });
  });
}
if (reactOkBtn) {
  reactOkBtn.addEventListener('click', () => {
    socket.emit('send-reaction', { type: 'ok' });
  });
}
if (reactBadBtn) {
  reactBadBtn.addEventListener('click', () => {
    socket.emit('send-reaction', { type: 'bad' });
  });
}

// Danmaku Comment click/enter handlers
function sendDanmakuMessage() {
  if (!danmakuInput) return;
  const text = danmakuInput.value.trim();
  const nickname = nicknameInput.value.trim() || 'ผู้ใช้ทั่วไป';
  if (!text) return;
  
  socket.emit('send-danmaku', { text, nickname });
  danmakuInput.value = '';
}

if (danmakuBtn) {
  danmakuBtn.addEventListener('click', sendDanmakuMessage);
}
if (danmakuInput) {
  danmakuInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendDanmakuMessage();
  });
}

// -------------------------------------------------------------
// Socket Event Handlers
// -------------------------------------------------------------

socket.on('connect', () => {
  connectionBadge.className = "px-2 py-1 rounded text-xs bg-green-500/20 text-green-400 border border-green-500/30 flex items-center space-x-1";
  connectionBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 pulse-badge"></span><span>เชื่อมต่อแล้ว</span>`;
});

socket.on('disconnect', () => {
  connectionBadge.className = "px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 border border-red-500/30 flex items-center space-x-1";
  connectionBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping mr-1"></span><span>ขาดการเชื่อมต่อ</span>`;
  clientsNumber.textContent = "0";
  stopProgressInterval();
});

socket.on('init', (data) => {
  localState = data.state;
  serverInfo.localIp = data.localIp;
  serverInfo.port = data.port;

  // Build QR code / Connect URL
  let connectUrl = window.location.origin;
  const hostname = window.location.hostname;
  
  // If accessing locally via localhost/127.0.0.1, use the server's LAN IP
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    connectUrl = `http://${serverInfo.localIp}:${serverInfo.port}`;
  }
  
  lanUrlText.textContent = connectUrl;
  renderQRCode(connectUrl);

  // Sync client list
  clientsNumber.textContent = "1"; // Self connection
  
  // Render and play
  renderUI();
  if (isPlayerEnabled) {
    initYoutubePlayer();
    syncPlayerWithState();
  }
});

socket.on('state-update', (state) => {
  localState = state;
  
  // Render layout updates
  renderUI();
  
  // Sync the video player if enabled
  syncPlayerWithState();
});

socket.on('time-update', (data) => {
  localState.currentTime = data.currentTime;
  localState.duration = data.duration;
  
  // Only update progress bar directly from network if we are NOT the local player
  // If we are the player, our local interval drives the progress bar for smooth action
  if (!isPlayerEnabled || !ytPlayer) {
    updateProgressBar(data.currentTime, data.duration);
  }
});

socket.on('seek-video', (seconds) => {
  localState.currentTime = seconds;
  if (isPlayerEnabled && ytPlayer && typeof ytPlayer.seekTo === 'function') {
    ytPlayer.seekTo(seconds, true);
  }
});

socket.on('error-msg', (msg) => {
  alert(`ข้อผิดพลาด: ${msg}`);
});

// Socket listeners for reactions and danmaku comments
socket.on('new-reaction', (data) => {
  spawnFloatingReaction(data.type);
});

socket.on('new-danmaku', (data) => {
  spawnDanmaku(data.text, data.nickname);
});

// -------------------------------------------------------------
// Floating Reactions and Danmaku Spawners
// -------------------------------------------------------------

function spawnFloatingReaction(type) {
  if (!isPlayerEnabled || !playerContainer) return;
  
  const emojiMap = {
    'love': '😍',
    'ok': '👍',
    'bad': '👎'
  };
  
  const emoji = emojiMap[type] || '✨';
  const reactionDiv = document.createElement('div');
  reactionDiv.className = 'floating-reaction';
  reactionDiv.textContent = emoji;
  
  // Random horizontal position (10% to 90%)
  const randomX = Math.random() * 80 + 10;
  reactionDiv.style.left = `${randomX}%`;
  
  // Random angle
  const randomAngle = Math.random() * 40 - 20; // -20deg to 20deg
  reactionDiv.style.setProperty('--angle', `${randomAngle}deg`);
  
  playerContainer.appendChild(reactionDiv);
  
  // Remove element after animation completes
  reactionDiv.addEventListener('animationend', () => {
    reactionDiv.remove();
  });
}

function spawnDanmaku(text, nickname) {
  if (!isPlayerEnabled || !danmakuContainer) return;
  
  const danmakuSpan = document.createElement('span');
  danmakuSpan.className = 'danmaku-item';
  danmakuSpan.textContent = `${nickname}: ${text}`;
  
  // Random vertical track (10% to 75% height) to prevent blocking controls
  const randomY = Math.random() * 65 + 10;
  danmakuSpan.style.top = `${randomY}%`;
  
  // Random speed duration (7s to 12s)
  const duration = Math.random() * 5 + 7;
  danmakuSpan.style.animationDuration = `${duration}s`;
  
  // Random font size (1.2rem to 1.7rem)
  const size = Math.random() * 0.5 + 1.2;
  danmakuSpan.style.fontSize = `${size}rem`;
  
  danmakuContainer.appendChild(danmakuSpan);
  
  // Remove element after animation completes
  danmakuSpan.addEventListener('animationend', () => {
    danmakuSpan.remove();
  });
}

