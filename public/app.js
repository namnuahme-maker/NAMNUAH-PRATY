const socket = io();

// HTML escape helper to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function safeColor(c) {
    return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#ABD2FA';
}

// Toast notification helper
function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const borderCol = type === 'error' 
        ? 'border-red-500/50 bg-red-950/90 text-red-200 shadow-red-500/20' 
        : 'border-brand-peri/50 bg-[#0a0a0a]/90 text-brand-light shadow-brand-deep/30';
    toast.className = `px-3.5 py-2 rounded-lg border text-xs shadow-xl backdrop-blur transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto flex items-center gap-2 ${borderCol}`;
    
    const icon = type === 'error' ? '<i class="fa-solid fa-circle-exclamation text-red-400"></i>' : '<i class="fa-solid fa-circle-info text-brand-peri"></i>';
    toast.innerHTML = `${icon} <span>${escapeHtml(msg)}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// State
let state = {
    queue: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 50,
    quality: 'max'
};

// Profile
let myProfile = {
    name: localStorage.getItem('nickname') || '',
    color: safeColor(localStorage.getItem('usercolor'))
};

// DOM Refs
const $ = id => document.getElementById(id);
const playerArea = $('player-area');
const ytPlayerDiv = $('yt-player');
const emptyState = $('empty-state');
const hostBadge = $('host-badge');
const unmuteBtn = $('unmute-btn');
const danmakuLayer = $('danmaku-layer');
const qrContainer = $('qr-container');
const playerQualityBadge = $('player-quality-badge');
const qualitySelect = $('quality-select');

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
setTimeout(() => {
    if (!myProfile.name) {
        showLogin();
    } else {
        updateProfileUI();
        socket.emit('set-profile', myProfile);
    }
}, 3500);

// --- Profile / Login ---
function showLogin() {
    loginName.value = myProfile.name;
    loginColor.value = myProfile.color;
    loginOverlay.classList.remove('hidden');
}

loginBtn.addEventListener('click', () => {
    const name = loginName.value.trim().substring(0, 25);
    if (!name) return showToast('กรุณาใส่ชื่อเล่น', 'error');
    
    myProfile.name = name;
    myProfile.color = safeColor(loginColor.value);
    
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

// --- YouTube API (youtube-nocookie.com) ---
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
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
            'autoplay': 1,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'rel': 0,
            'modestbranding': 1,
            'playsinline': 1,
            'enablejsapi': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
};

function onPlayerReady(event) {
    playerReady = true;
    applyHostModeState();
}

function onPlayerError(event) {
    console.error('YouTube Player Error:', event.data);
    showToast('คลิปนี้ปิดการฝังวิดีโอ ระบบกำลังสลับไปเล่นเวอร์ชันสำรองให้อัตโนมัติ...', 'info');
    // Automatically find alternative version without interrupting users
    socket.emit('resolve-error-action', 'find-alt');
}

function enforceQuality() {
    if (!hostMode || !ytPlayer || !ytPlayer.getAvailableQualityLevels || !ytPlayer.setPlaybackQuality) return;
    const target = state.quality || 'max';
    const available = ytPlayer.getAvailableQualityLevels();
    
    let selectedQuality = target;
    if (target === 'max') {
        const priority = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium'];
        selectedQuality = priority.find(q => available.includes(q)) || available[0] || 'hd1080';
    }

    if (selectedQuality && selectedQuality !== 'auto') {
        ytPlayer.setPlaybackQuality(selectedQuality);
    } else {
        ytPlayer.setPlaybackQuality('auto');
    }
    updateQualityBadge(selectedQuality);
}

function updateQualityBadge(q) {
    if (!playerQualityBadge) return;
    if (q === 'highres' || q === 'hd2160') playerQualityBadge.textContent = '4K';
    else if (q === 'hd1440') playerQualityBadge.textContent = '2K';
    else if (q === 'hd1080') playerQualityBadge.textContent = '1080p';
    else if (q === 'hd720') playerQualityBadge.textContent = '720p';
    else if (q === 'large') playerQualityBadge.textContent = '480p';
    else if (q === 'medium') playerQualityBadge.textContent = '360p';
    else playerQualityBadge.textContent = 'HD';
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        enforceQuality();
        setTimeout(enforceQuality, 1200);
    }
    if (event.data === YT.PlayerState.ENDED) {
        socket.emit('player-video-ended');
    }
    // Check if autoplay muted it
    if (ytPlayer && ytPlayer.isMuted && ytPlayer.isMuted() && unmuteBtn) {
        unmuteBtn.classList.remove('hidden');
    } else if (unmuteBtn) {
        unmuteBtn.classList.add('hidden');
    }
}

if (unmuteBtn) {
    unmuteBtn.addEventListener('click', () => {
        if (ytPlayer && ytPlayer.unMute) {
            ytPlayer.unMute();
            ytPlayer.playVideo();
            unmuteBtn.classList.add('hidden');
        }
    });
}

// Host syncs progress to server
setInterval(() => {
    if (hostMode && playerReady && ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        const currentTime = ytPlayer.getCurrentTime();
        const duration = ytPlayer.getDuration();
        socket.emit('player-progress', {
            currentTime: currentTime,
            duration: duration
        });
        updateProgress(currentTime, duration);
    }
}, 1000);

// --- Modes: Host vs Client ---
function updateUIMode() {
    if (hostMode) {
        // Host mode
        document.body.classList.remove('client-mode');
        hostBadge.classList.remove('hidden');
        clientControls.classList.add('hidden');
        qrContainer.classList.remove('hidden');
        secUsers.style.display = 'none';
        if (!window.YT) initYouTubeAPI();
        else if (!ytPlayer) window.onYouTubeIframeAPIReady();
        applyHostModeState();
    } else {
        // Client mode
        document.body.classList.add('client-mode');
        hostBadge.classList.add('hidden');
        clientControls.classList.remove('hidden');
        qrContainer.classList.add('hidden');
        secUsers.style.display = '';
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        if (unmuteBtn) unmuteBtn.classList.add('hidden');
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
    if (!sec || isNaN(sec)) return '0:00';
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

    // Quality
    if (qualitySelect && state.quality) {
        qualitySelect.value = state.quality;
    }

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
                    <p class="text-xs text-white truncate">${escapeHtml(item.title)}</p>
                    <p class="text-[9px] text-brand-light/50 truncate">เพิ่มโดย: <span style="color:${safeColor(item.color)}">${escapeHtml(item.addedBy)}</span></p>
                </div>
                <button data-remove-id="${escapeHtml(item.id)}" class="w-6 h-6 rounded bg-red-900/20 text-red-400 hover:bg-red-500 hover:text-white transition opacity-0 group-hover:opacity-100 flex items-center justify-center">
                    <i class="fa-solid fa-trash text-[10px]"></i>
                </button>
            </div>
        `).join('');
    }

    applyHostModeState();
}

// Queue delegation for delete buttons
queueList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-id]');
    if (btn) {
        const id = btn.getAttribute('data-remove-id');
        if (id) socket.emit('remove-from-queue', id);
    }
});

function applyHostModeState() {
    if (!state.currentVideo) {
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        return;
    }

    const videoId = state.currentVideo.videoId;

    if (!hostMode || !playerReady || !ytPlayer || !ytPlayer.loadVideoById) return;

    let currentUrl = ytPlayer.getVideoUrl ? ytPlayer.getVideoUrl() : '';
    if (!currentUrl || !currentUrl.includes(videoId)) {
        ytPlayer.loadVideoById(videoId);
    }
    
    if (state.isPlaying) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
    
    ytPlayer.setVolume(state.volume);
}

function updateProgress(curr, dur) {
    if (dur > 0) {
        const p = (curr / dur) * 100;
        progressFill.style.width = `${Math.min(100, Math.max(0, p))}%`;
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
    const val = urlInput.value.trim();
    if(!val) return showToast('กรุณาวางลิงก์ YouTube ก่อนกดเพิ่ม', 'error');
    socket.emit('add-to-queue', { 
        url: val, 
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
    socket.emit('volume-control', parseInt(e.target.value));
});

volDown.addEventListener('click', () => socket.emit('volume-control', Math.max(0, state.volume - 10)));
volUp.addEventListener('click', () => socket.emit('volume-control', Math.min(100, state.volume + 10)));

if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
        const val = e.target.value;
        socket.emit('quality-control', val);
        showToast(`ตั้งค่าความคมชัดเป็น: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });
}

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
    const text = msgInput.value.trim();
    if(!text) return;
    socket.emit('send-danmaku', {
        text: text,
        nickname: myProfile.name,
        color: myProfile.color,
        tts: ttsToggle.checked
    });
    msgInput.value = '';
});

msgInput.addEventListener('keypress', e => {
    if(e.key === 'Enter') msgBtn.click();
});

socket.on('show-toast-broadcast', (msg) => {
    showToast(msg, 'info');
});

// --- Socket Listeners ---
socket.on('init', (data) => {
    state = data.state;
    renderState();
    
    // Generate QR
    qrContainer.innerHTML = '<div id="qrcode"></div><div class="text-[9px] text-center text-primary mt-1 font-bold select-all" id="url-display"></div>';
    
    let link = window.location.origin;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        link = `http://${data.localIp}:${data.port}`;
    }
    
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
    if (hostMode) enforceQuality();
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
    
    const onlineCount = $('online-count');
    if (keys.length > 0) {
        onlineCount.classList.remove('hidden');
    } else {
        onlineCount.classList.add('hidden');
    }
    
    if (keys.length === 0) {
        usersList.innerHTML = `<p class="text-[9px] text-brand-light/30 py-2">ไม่มีผู้ใช้</p>`;
        return;
    }

    usersList.innerHTML = keys.map(id => {
        const u = users[id];
        const color = safeColor(u.color);
        return `<div class="bg-[#0a0a0a] border border-brand-deep/30 rounded px-2 py-1 text-[10px] flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${color}"></span>
            <span style="color: ${color}">${escapeHtml(u.name) || 'ผู้ใช้ทั่วไป'}</span>
        </div>`;
    }).join('');
}

// Visuals
socket.on('new-reaction', emoji => {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '10%';
    playerArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('new-danmaku', data => {
    if (hostMode && data.tts && 'speechSynthesis' in window) {
        const textToSpeak = (data.text || '').substring(0, 60);
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'th-TH';
        const voices = window.speechSynthesis.getVoices();
        const googleVoice = voices.find(v => v.name.toLowerCase().includes('google') && v.lang.includes('th'));
        if (googleVoice) utterance.voice = googleVoice;
        window.speechSynthesis.speak(utterance);
    }

    const el = document.createElement('div');
    el.className = 'danmaku-text';
    const color = safeColor(data.color);
    el.innerHTML = `<span style="color: ${color}">${escapeHtml(data.nickname) || ''}:</span> ${escapeHtml(data.text)}`;
    el.style.top = (Math.random() * 60 + 10) + '%';
    el.style.animationDuration = (Math.random() * 4 + 7) + 's';
    danmakuLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('error-msg', msg => showToast(msg, 'error'));

// --- Connection Status Badge ---
const statusBadge = $('status-badge');

socket.on('connect', () => {
    statusBadge.innerHTML = '● เชื่อมต่อแล้ว';
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/30';
});

socket.on('disconnect', () => {
    statusBadge.innerHTML = '● ขาดการเชื่อมต่อ';
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/30';
});

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
            showToast(`Error: ${err.message}`, 'error');
        });
    } else {
        document.exitFullscreen();
    }
});

fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        playerArea.requestFullscreen().catch(err => {
            showToast(`Error: ${err.message}`, 'error');
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
