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
    voteSkipBtn.classList.remove('bg-slate-800', 'hover:bg-slate-750');
    voteSkipBtn.classList.add('bg-brand-500/20', 'border-brand-500/50', 'text-brand-500');
  } else {
    voteSkipBtn.classList.remove('bg-brand-500/20', 'border-brand-500/50', 'text-brand-500');
    voteSkipBtn.classList.add('bg-slate-800', 'hover:bg-slate-750');
  }

  // Update Queue Count
  queueCount.textContent = localState.queue.length;

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
      queueItemDiv.className = "bg-slate-800/50 border border-slate-850 hover:bg-slate-800/80 p-2.5 rounded-lg flex items-center justify-between text-xs transition";
      queueItemDiv.innerHTML = `
        <div class="flex items-center space-x-2.5 min-w-0 flex-1">
            <span class="font-bold text-slate-500 text-sm w-4 text-center shrink-0">${index + 1}</span>
            <div class="min-w-0 flex-1">
                <p class="font-medium text-white truncate">${item.title}</p>
                <p class="text-[10px] text-slate-400 mt-0.5">โดย: ${item.addedBy}</p>
            </div>
        </div>
        <button class="delete-queue-item text-slate-500 hover:text-red-400 p-1.5 transition ml-2 shrink-0" data-id="${item.id}">
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
