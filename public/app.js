const socket = io();

// State
let state = {
    queue: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 50
};

// Profile
let myProfile = {
    name: localStorage.getItem('nickname') || '',
    color: localStorage.getItem('usercolor') || '#ABD2FA'
};

// DOM Refs
const $ = id => document.getElementById(id);
const playerArea = $('player-area');
const ytPlayerDiv = $('yt-player');
const emptyState = $('empty-state');
const hostBadge = $('host-badge');
const danmakuLayer = $('danmaku-layer');
const qrContainer = $('qr-container');

// Overlays
const loginOverlay = $('login-overlay');
const loginName = $('login-name');
const loginColor = $('login-color');
const loginBtn = $('login-btn');
const editProfileBtn = $('edit-profile-btn');
const myColorDot = $('my-color-dot');

// Controls
const toggleHost = $('toggle-host');
const urlInput = $('url-input');
const addBtn = $('add-btn');
const btnPlay = $('btn-play');
const iconPlay = $('icon-play');
const btnSkip = $('btn-skip');
const skipLabel = $('skip-label');
const volDown = $('vol-down');
const volUp = $('vol-up');
const volSlider = $('vol-slider');
const volLabel = $('vol-label');
const progressFill = $('progress-fill');
const timeNow = $('time-now');
const timeTotal = $('time-total');
const progressBar = $('progress-bar');
const clientControls = $('client-controls');

// Displays
const nowTitle = $('now-title');
const nowAuthor = $('now-author');
const queueList = $('queue-list');
const qCount = $('q-count');
const qCountMobile = $('q-count-mobile');
const clearBtn = $('clear-btn');
const usersList = $('users-list');
const onlineNum = $('online-num');
const secUsers = $('sec-users');

// Danmaku & Reactions
const msgInput = $('msg-input');
const msgBtn = $('msg-btn');
const ttsToggle = $('tts-toggle');
const reactLove = $('react-love');
const reactOk = $('react-ok');
const reactBad = $('react-bad');

// Tabs (Mobile)
const tabCtrl = $('tab-ctrl');
const tabQueue = $('tab-queue');
const secCtrl = $('sec-ctrl');
const secQueue = $('sec-queue');

// Device defaults
const isMobile = window.innerWidth < 768;
let hostMode = localStorage.getItem('host') !== null ? localStorage.getItem('host') === 'true' : !isMobile;
toggleHost.checked = hostMode;

// --- Intro Animation ---
// Handled completely by CSS animations on #intro-overlay. It disappears after 3.5s.
setTimeout(() => {
    // Show login if no profile
    if (!myProfile.name) {
        showLogin();
    } else {
        updateProfileUI();
        socket.emit('set-profile', myProfile);
    }
}, 3500); // Wait for intro to finish

// --- Profile / Login ---
function showLogin() {
    loginName.value = myProfile.name;
    loginColor.value = myProfile.color;
    loginOverlay.classList.remove('hidden');
}

loginBtn.addEventListener('click', () => {
    const name = loginName.value.trim();
    if (!name) return alert('กรุณาใส่ชื่อเล่น');
    
    myProfile.name = name;
    myProfile.color = loginColor.value;
    
    localStorage.setItem('nickname', myProfile.name);
    localStorage.setItem('usercolor', myProfile.color);
    
    loginOverlay.classList.add('hidden');
    updateProfileUI();
    socket.emit('set-profile', myProfile);
});

editProfileBtn.addEventListener('click', showLogin);

function updateProfileUI() {
    myColorDot.style.backgroundColor = myProfile.color;
}

// --- YouTube API ---
let ytPlayer = null;
let playerReady = false;

function initYouTubeAPI() {
    if (window.YT) return;
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function() {
    if (!hostMode) return;
    ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 1,
            'controls': 0, // hide native controls
            'disablekb': 1,
            'fs': 0,       // disable native fullscreen (we use our own)
            'rel': 0,
            'modestbranding': 1,
            'playsinline': 1, // Fix for mobile playback
            'origin': window.location.origin
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    playerReady = true;
    applyHostModeState();
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        socket.emit('player-video-ended');
    }
}

// Host syncs time to server
setInterval(() => {
    if (hostMode && playerReady && ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        socket.emit('player-progress', {
            currentTime: ytPlayer.getCurrentTime(),
            duration: ytPlayer.getDuration()
        });
    }
}, 1000);


// --- Modes: Host vs Client ---
function updateUIMode() {
    if (hostMode) {
        // Host
        document.body.classList.remove('client-mode');
        hostBadge.classList.remove('hidden');
        clientControls.classList.add('hidden');
        qrContainer.classList.remove('hidden');
        secUsers.style.display = 'none';
        if (!window.YT) initYouTubeAPI();
        else if (!ytPlayer) window.onYouTubeIframeAPIReady();
        applyHostModeState();
    } else {
        // Client
        document.body.classList.add('client-mode');
        hostBadge.classList.add('hidden');
        clientControls.classList.remove('hidden');
        qrContainer.classList.add('hidden');
        secUsers.style.display = '';
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    }
}

toggleHost.addEventListener('change', (e) => {
    hostMode = e.target.checked;
    localStorage.setItem('host', hostMode);
    updateUIMode();
});

// Init on load
updateUIMode();


// --- Render UI ---
function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function renderState() {
    // Current Video
    if (state.currentVideo) {
        nowTitle.textContent = state.currentVideo.title;
        nowAuthor.textContent = `เพิ่มโดย: ${state.currentVideo.addedBy}`;
        emptyState.classList.add('hidden');
    } else {
        nowTitle.textContent = 'ยังไม่มีเพลง';
        nowAuthor.textContent = '—';
        emptyState.classList.remove('hidden');
    }

    // Play/Pause icon
    iconPlay.className = state.isPlaying ? "fa-solid fa-pause text-lg text-brand-peri" : "fa-solid fa-play text-lg text-brand-peri";

    // Volume
    volSlider.value = state.volume;
    volLabel.textContent = `${state.volume}%`;

    // Queue
    qCount.textContent = state.queue.length;
    qCountMobile.textContent = state.queue.length;
    
    if (state.queue.length === 0) {
        queueList.innerHTML = `<p class="text-center text-[10px] text-brand-light/30 py-4">คิวว่างเปล่า</p>`;
    } else {
        queueList.innerHTML = state.queue.map((item, index) => `
            <div class="flex items-center gap-2 p-2 bg-[#0a0a0a] rounded-lg border border-brand-deep/20 group">
                <span class="text-[10px] text-brand-light/50 w-4 text-center font-mono">${index + 1}</span>
                <div class="flex-1 min-w-0">
                    <p class="text-xs text-white truncate">${item.title}</p>
                    <p class="text-[9px] text-brand-light/50 truncate">เพิ่มโดย: <span style="color:${item.color || '#ABD2FA'}">${item.addedBy}</span></p>
                </div>
                <button onclick="socket.emit('remove-from-queue', '${item.id}')" class="w-6 h-6 rounded bg-red-900/20 text-red-400 hover:bg-red-500 hover:text-white transition opacity-0 group-hover:opacity-100 flex items-center justify-center">
                    <i class="fa-solid fa-trash text-[10px]"></i>
                </button>
            </div>
        `).join('');
    }

    applyHostModeState();
}

function applyHostModeState() {
    if (!hostMode || !playerReady || !ytPlayer || !ytPlayer.loadVideoById) return;

    if (state.currentVideo) {
        let currentUrl = ytPlayer.getVideoUrl();
        let ytId = state.currentVideo.videoId;
        if (!currentUrl || !currentUrl.includes(ytId)) {
            ytPlayer.loadVideoById(ytId);
        }
        
        if (state.isPlaying) ytPlayer.playVideo();
        else ytPlayer.pauseVideo();
        
        ytPlayer.setVolume(state.volume);
    } else {
        ytPlayer.stopVideo();
    }
}

function updateProgress(curr, dur) {
    if (dur > 0) {
        const p = (curr / dur) * 100;
        progressFill.style.width = `${p}%`;
        timeNow.textContent = formatTime(curr);
        timeTotal.textContent = formatTime(dur);
    } else {
        progressFill.style.width = `0%`;
        timeNow.textContent = '0:00';
        timeTotal.textContent = '0:00';
    }
}


// --- 3-Click Skip Logic ---
let skipCount = 0;
let skipTimer = null;

btnSkip.addEventListener('click', () => {
    skipCount++;
    clearTimeout(skipTimer);
    
    if (skipCount === 1) {
        skipLabel.textContent = "แน่ใจ?";
        skipLabel.className = "text-[9px] mt-0.5 text-yellow-400";
        btnSkip.classList.add('border-yellow-500/50');
    } else if (skipCount === 2) {
        skipLabel.textContent = "ยืนยัน?";
        skipLabel.className = "text-[9px] mt-0.5 text-red-500 font-bold";
        btnSkip.classList.remove('border-yellow-500/50');
        btnSkip.classList.add('border-red-500');
    } else if (skipCount === 3) {
        socket.emit('skip-video');
        resetSkipBtn();
        return;
    }
    
    skipTimer = setTimeout(resetSkipBtn, 3000);
});

function resetSkipBtn() {
    skipCount = 0;
    skipLabel.textContent = "ข้ามเลย";
    skipLabel.className = "text-[9px] mt-0.5";
    btnSkip.className = "flex-1 bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 text-red-400 rounded-lg py-2 flex flex-col items-center transition relative overflow-hidden";
}


// --- Actions ---
addBtn.addEventListener('click', () => {
    if(!urlInput.value) return;
    socket.emit('add-to-queue', { 
        url: urlInput.value, 
        nickname: myProfile.name,
        color: myProfile.color 
    });
    urlInput.value = '';
});

urlInput.addEventListener('keypress', e => {
    if(e.key === 'Enter') addBtn.click();
});

btnPlay.addEventListener('click', () => {
    socket.emit('play-control', !state.isPlaying);
});

volSlider.addEventListener('input', e => {
    socket.emit('volume-control', e.target.value);
});

volDown.addEventListener('click', () => socket.emit('volume-control', Math.max(0, state.volume - 10)));
volUp.addEventListener('click', () => socket.emit('volume-control', Math.min(100, state.volume + 10)));

clearBtn.addEventListener('click', () => {
    if(confirm('ล้างคิวทั้งหมดหรือไม่?')) socket.emit('clear-queue');
});

progressBar.addEventListener('click', (e) => {
    if(!state.currentVideo || !state.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const seekTime = pos * state.duration;
    socket.emit('seek-to', seekTime);
});

// Reactions
const sendReact = (emoji) => socket.emit('send-reaction', emoji);
reactLove.addEventListener('click', () => sendReact('😍'));
reactOk.addEventListener('click', () => sendReact('👍'));
reactBad.addEventListener('click', () => sendReact('👎'));

// Danmaku
msgBtn.addEventListener('click', () => {
    if(!msgInput.value.trim()) return;
    socket.emit('send-danmaku', {
        text: msgInput.value.trim(),
        nickname: myProfile.name,
        color: myProfile.color,
        tts: ttsToggle.checked
    });
    msgInput.value = '';
});

msgInput.addEventListener('keypress', e => {
    if(e.key === 'Enter') msgBtn.click();
});


// --- Socket Listeners ---
socket.on('init', (data) => {
    state = data.state;
    renderState();
    
    // Generate QR
    qrContainer.innerHTML = '<div id="qrcode"></div><div class="text-[9px] text-center text-primary mt-1 font-bold select-all" id="url-display"></div>';
    
    // Use the actual public URL the browser is connected to, instead of the server's internal local IP.
    const link = window.location.origin;
    
    new QRCode(document.getElementById("qrcode"), {
        text: link,
        width: 100,
        height: 100,
        colorDark : "#1c2938",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
    });
    document.getElementById('url-display').textContent = link;

    if (data.users) updateUsersList(data.users);
});

socket.on('state-update', (newState) => {
    state = newState;
    renderState();
});

socket.on('time-update', (data) => {
    if (!hostMode) {
        state.currentTime = data.currentTime;
        state.duration = data.duration;
        updateProgress(data.currentTime, data.duration);
    }
});

socket.on('seek-video', (seconds) => {
    if (hostMode && playerReady && ytPlayer && ytPlayer.seekTo) {
        ytPlayer.seekTo(seconds, true);
    }
});

socket.on('users-update', (users) => {
    updateUsersList(users);
});

function updateUsersList(users) {
    const keys = Object.keys(users);
    onlineNum.textContent = keys.length;
    
    if (keys.length === 0) {
        usersList.innerHTML = `<p class="text-[9px] text-brand-light/30 py-2">ไม่มีผู้ใช้</p>`;
        return;
    }

    usersList.innerHTML = keys.map(id => {
        const u = users[id];
        return `<div class="bg-[#0a0a0a] border border-brand-deep/30 rounded px-2 py-1 text-[10px] flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${u.color || '#7692FF'}"></span>
            <span style="color: ${u.color || '#ABD2FA'}">${u.name || 'Anonymous'}</span>
        </div>`;
    }).join('');
}

// Visuals
socket.on('new-reaction', emoji => {
    if (!hostMode) return;
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '10%';
    playerArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('new-danmaku', data => {
    if (!hostMode) return;

    // TTS
    if (data.tts && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(data.text);
        utterance.lang = 'th-TH'; // Default Thai
        const voices = window.speechSynthesis.getVoices();
        const googleVoice = voices.find(v => v.name.toLowerCase().includes('google') && v.lang.includes('th'));
        if (googleVoice) utterance.voice = googleVoice;
        window.speechSynthesis.speak(utterance);
    }

    // Visual text
    const el = document.createElement('div');
    el.className = 'danmaku-text';
    el.innerHTML = `<span style="color: ${data.color || '#fff'}">${data.nickname || ''}:</span> ${data.text}`;
    el.style.top = (Math.random() * 60 + 10) + '%';
    el.style.animationDuration = (Math.random() * 4 + 7) + 's';
    danmakuLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('error-msg', msg => alert(msg));


// --- Mobile Tabs ---
if (isMobile) {
    tabCtrl.addEventListener('click', () => {
        secCtrl.classList.remove('hidden');
        secQueue.classList.add('hidden');
        tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-brand-peri border-b-2 border-brand-peri';
        tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-brand-light/50 border-b-2 border-transparent';
    });

    tabQueue.addEventListener('click', () => {
        secCtrl.classList.add('hidden');
        secQueue.classList.remove('hidden');
        secQueue.classList.add('block'); // override md:block
        tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-brand-peri border-b-2 border-brand-peri';
        tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-brand-light/50 border-b-2 border-transparent';
    });
}

// --- Fullscreen & Theater Mode ---
const fsBtn = $('fs-btn');
const theaterBtn = $('theater-btn');

theaterBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            alert(`Error: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
});

fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        playerArea.requestFullscreen().catch(err => {
            alert(`Error: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
});

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === document.documentElement) {
        document.body.classList.add('web-fullscreen');
    } else {
        document.body.classList.remove('web-fullscreen');
    }
});

// Preload voices for TTS
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.getVoices();
}
