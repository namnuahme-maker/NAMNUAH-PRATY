// =====================================================
// NAMNUAH PRATY - Client App (Rewritten from scratch)
// =====================================================

const socket = io();

// --- State ---
let state = { queue: [], currentVideo: null, isPlaying: false, currentTime: 0, duration: 0, volume: 50, votesToSkip: [] };
let ytPlayer = null;
let ytReady = false;
let hostMode = true;
let progressTimer = null;

// --- Load saved settings ---
const savedName = localStorage.getItem('nn') || '';
const savedHost = localStorage.getItem('host');
if (savedHost !== null) {
    hostMode = savedHost === '1';
} else {
    hostMode = window.innerWidth >= 768;
}

// --- DOM refs ---
const $ = id => document.getElementById(id);

const statusBadge = $('status-badge');
const onlineNum = $('online-num');
const onlineCount = $('online-count');

const toggleHost = $('toggle-host');
const playerArea = $('player-area');
const emptyState = $('empty-state');
const hostBadge = $('host-badge');
const danmakuLayer = $('danmaku-layer');

const nickname = $('nickname');
const urlInput = $('url-input');
const addBtn = $('add-btn');

const reactLove = $('react-love');
const reactOk = $('react-ok');
const reactBad = $('react-bad');

const msgInput = $('msg-input');
const msgBtn = $('msg-btn');

const nowTitle = $('now-title');
const nowAuthor = $('now-author');
const progressBar = $('progress-bar');
const progressFill = $('progress-fill');
const timeNow = $('time-now');
const timeTotal = $('time-total');

const volSlider = $('vol-slider');
const volLabel = $('vol-label');
const volDown = $('vol-down');
const volUp = $('vol-up');

const btnPlay = $('btn-play');
const iconPlay = $('icon-play');
const btnVote = $('btn-vote');
const voteLabel = $('vote-label');
const btnSkip = $('btn-skip');

const qCount = $('q-count');
const qCountMobile = $('q-count-mobile');
const queueList = $('queue-list');
const clearBtn = $('clear-btn');

const tabCtrl = $('tab-ctrl');
const tabQueue = $('tab-queue');
const secCtrl = $('sec-ctrl');
const secQueue = $('sec-queue');

const qrOpen = $('qr-open');
const qrModal = $('qr-modal');
const qrClose = $('qr-close');
const urlDisplay = $('url-display');
const copyBtn = $('copy-btn');

// --- Init ---
nickname.value = savedName;
toggleHost.checked = hostMode;
updateHostVisibility();

// --- YouTube API ---
const ytTag = document.createElement('script');
ytTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytTag);

window.onYouTubeIframeAPIReady = function() {
    ytReady = true;
    if (hostMode) createPlayer();
};

function createPlayer() {
    if (!ytReady || ytPlayer) return;
    ytPlayer = new YT.Player('yt-player', {
        width: '100%', height: '100%',
        videoId: '',
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, fs: 0, origin: window.location.origin },
        events: {
            onReady: () => { ytPlayer.setVolume(state.volume); syncPlayer(); },
            onStateChange: onYTState,
            onError: () => { socket.emit('player-video-ended'); }
        }
    });
}

function destroyPlayer() {
    stopProgress();
    if (ytPlayer && ytPlayer.destroy) ytPlayer.destroy();
    ytPlayer = null;
    // Recreate div
    const area = playerArea;
    if (!$('yt-player')) {
        const d = document.createElement('div');
        d.id = 'yt-player';
        d.className = 'w-full h-full';
        area.insertBefore(d, area.firstChild);
    }
}

function onYTState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
        startProgress();
        if (!state.isPlaying) socket.emit('play-control', true);
    } else if (e.data === YT.PlayerState.PAUSED) {
        stopProgress();
        if (state.isPlaying) socket.emit('play-control', false);
    } else if (e.data === YT.PlayerState.ENDED) {
        stopProgress();
        socket.emit('player-video-ended');
    }
}

function startProgress() {
    stopProgress();
    progressTimer = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            const cur = ytPlayer.getCurrentTime();
            const dur = ytPlayer.getDuration();
            state.currentTime = cur;
            state.duration = dur;
            renderProgress(cur, dur);
            socket.emit('player-progress', { currentTime: cur, duration: dur });
        }
    }, 1000);
}

function stopProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

function syncPlayer() {
    if (!hostMode || !ytPlayer || !ytPlayer.getPlayerState) return;
    const v = state.currentVideo;
    if (v) {
        emptyState.classList.add('hidden');
        const url = ytPlayer.getVideoUrl ? ytPlayer.getVideoUrl() : '';
        if (!url || !url.includes(v.videoId)) {
            ytPlayer.loadVideoById({ videoId: v.videoId, startSeconds: state.currentTime || 0 });
        }
        const ps = ytPlayer.getPlayerState();
        if (state.isPlaying && ps !== YT.PlayerState.PLAYING && ps !== YT.PlayerState.BUFFERING) {
            ytPlayer.playVideo();
        } else if (!state.isPlaying && ps === YT.PlayerState.PLAYING) {
            ytPlayer.pauseVideo();
        }
        if (ytPlayer.getVolume() !== state.volume) ytPlayer.setVolume(state.volume);
        if (Math.abs(ytPlayer.getCurrentTime() - state.currentTime) > 3) ytPlayer.seekTo(state.currentTime, true);
    } else {
        emptyState.classList.remove('hidden');
        if (ytPlayer.stopVideo) ytPlayer.stopVideo();
    }
}

// --- Render ---
function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function renderProgress(cur, dur) {
    const pct = dur ? (cur / dur) * 100 : 0;
    progressFill.style.width = pct + '%';
    timeNow.textContent = fmt(cur);
    timeTotal.textContent = fmt(dur);
}

function render() {
    // Play/Pause icon
    iconPlay.className = state.isPlaying ? 'fa-solid fa-pause text-lg text-sky-300' : 'fa-solid fa-play text-lg text-sky-300';

    // Now playing
    if (state.currentVideo) {
        nowTitle.textContent = state.currentVideo.title;
        nowAuthor.textContent = 'เพิ่มโดย: ' + state.currentVideo.addedBy;
        renderProgress(state.currentTime, state.duration);
    } else {
        nowTitle.textContent = 'ยังไม่มีเพลง';
        nowAuthor.textContent = '—';
        renderProgress(0, 0);
    }

    // Volume
    volSlider.value = state.volume;
    volLabel.textContent = state.volume + '%';

    // Vote skip
    const total = parseInt(onlineNum.textContent) || 1;
    const needed = Math.ceil(total / 2);
    const votes = state.votesToSkip.length;
    voteLabel.textContent = 'โหวตข้าม ' + votes + '/' + needed;

    if (state.votesToSkip.includes(socket.id)) {
        btnVote.classList.add('ring-1', 'ring-sky-400/50');
    } else {
        btnVote.classList.remove('ring-1', 'ring-sky-400/50');
    }

    // Queue count
    qCount.textContent = state.queue.length;
    qCountMobile.textContent = state.queue.length;

    // Queue list
    queueList.innerHTML = '';
    if (state.queue.length === 0) {
        queueList.innerHTML = '<p class="text-center text-xs text-gray-600 py-8">คิวว่างเปล่า</p>';
    } else {
        state.queue.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'bg-gray-800/60 border border-gray-700/30 rounded-lg p-2.5 flex items-center justify-between text-xs hover:bg-gray-700/50 transition';
            div.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-sky-400/70 font-bold w-5 text-center shrink-0">${i + 1}</span>
                    <div class="min-w-0 flex-1">
                        <p class="text-gray-200 truncate font-medium">${item.title}</p>
                        <p class="text-[10px] text-gray-500">โดย ${item.addedBy}</p>
                    </div>
                </div>
                <button class="del-item text-gray-600 hover:text-red-400 p-1.5 transition shrink-0" data-id="${item.id}">
                    <i class="fa-solid fa-trash-can"></i>
                </button>`;
            queueList.appendChild(div);
        });
        queueList.querySelectorAll('.del-item').forEach(b => {
            b.addEventListener('click', () => socket.emit('remove-from-queue', b.dataset.id));
        });
    }
}

function updateHostVisibility() {
    if (hostMode) {
        playerArea.classList.remove('hidden');
        hostBadge.classList.remove('hidden');
    } else {
        playerArea.classList.add('hidden');
        hostBadge.classList.add('hidden');
    }
}

// --- Event Listeners ---

// Host toggle
toggleHost.addEventListener('change', e => {
    hostMode = e.target.checked;
    localStorage.setItem('host', hostMode ? '1' : '0');
    updateHostVisibility();
    if (hostMode) createPlayer();
    else destroyPlayer();
    render();
    if (ytPlayer) syncPlayer();
});

// Nickname
nickname.addEventListener('input', () => localStorage.setItem('nn', nickname.value.trim()));

// Add to queue
function doAdd() {
    const url = urlInput.value.trim();
    const name = nickname.value.trim() || 'ผู้ใช้ทั่วไป';
    if (!url) return;
    socket.emit('add-to-queue', { url, nickname: name });
    urlInput.value = '';
}
addBtn.addEventListener('click', doAdd);
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

// Play/pause
btnPlay.addEventListener('click', () => { if (state.currentVideo) socket.emit('play-control', !state.isPlaying); });

// Volume
volSlider.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    volLabel.textContent = v + '%';
    socket.emit('volume-control', v);
});
volDown.addEventListener('click', () => socket.emit('volume-control', Math.max(0, state.volume - 5)));
volUp.addEventListener('click', () => socket.emit('volume-control', Math.min(100, state.volume + 5)));

// Skip
btnVote.addEventListener('click', () => { if (state.currentVideo) socket.emit('vote-skip'); });
btnSkip.addEventListener('click', () => { if (state.currentVideo) socket.emit('skip-video'); });

// Clear queue
clearBtn.addEventListener('click', () => { if (confirm('ล้างคิวทั้งหมด?')) socket.emit('clear-queue'); });

// Progress seek
progressBar.addEventListener('click', e => {
    if (!state.currentVideo || !state.duration) return;
    const pct = (e.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth;
    socket.emit('seek-to', pct * state.duration);
});

// Reactions
reactLove.addEventListener('click', () => socket.emit('send-reaction', { type: 'love' }));
reactOk.addEventListener('click', () => socket.emit('send-reaction', { type: 'ok' }));
reactBad.addEventListener('click', () => socket.emit('send-reaction', { type: 'bad' }));

// Danmaku
function doMsg() {
    const t = msgInput.value.trim();
    if (!t) return;
    socket.emit('send-danmaku', { text: t, nickname: nickname.value.trim() || 'ผู้ใช้ทั่วไป' });
    msgInput.value = '';
}
msgBtn.addEventListener('click', doMsg);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') doMsg(); });

// Mobile tabs
tabCtrl.addEventListener('click', () => {
    secCtrl.classList.remove('hidden');
    secQueue.classList.add('hidden');
    tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-sky-300 border-b-2 border-sky-400';
    tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-gray-500 border-b-2 border-transparent';
});
tabQueue.addEventListener('click', () => {
    secQueue.classList.remove('hidden');
    secCtrl.classList.add('hidden');
    tabQueue.className = 'flex-1 py-2.5 text-xs font-medium text-sky-300 border-b-2 border-sky-400';
    tabCtrl.className = 'flex-1 py-2.5 text-xs font-medium text-gray-500 border-b-2 border-transparent';
});

// QR Modal
qrOpen.addEventListener('click', () => qrModal.classList.remove('hidden'));
qrClose.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModal.addEventListener('click', e => { if (e.target === qrModal) qrModal.classList.add('hidden'); });
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(urlDisplay.textContent).then(() => {
        copyBtn.innerHTML = '<i class="fa-solid fa-check text-green-400"></i>';
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1500);
    });
});

// --- Socket Events ---

socket.on('connect', () => {
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30';
    statusBadge.innerHTML = '● เชื่อมต่อแล้ว';
});

socket.on('disconnect', () => {
    statusBadge.className = 'text-[11px] px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30';
    statusBadge.innerHTML = '● ขาดการเชื่อมต่อ';
    onlineNum.textContent = '0';
    stopProgress();
});

socket.on('init', data => {
    state = data.state;
    // Build connect URL
    let url = window.location.origin;
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
        url = 'http://' + data.localIp + ':' + data.port;
    }
    urlDisplay.textContent = url;
    // QR code
    $('qrcode').innerHTML = '';
    new QRCode($('qrcode'), { text: url, width: 160, height: 160, colorDark: '#111827', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
    onlineNum.textContent = '1';
    onlineCount.classList.remove('hidden');
    render();
    if (hostMode) { createPlayer(); syncPlayer(); }
});

socket.on('state-update', s => {
    state = s;
    render();
    syncPlayer();
});

socket.on('time-update', d => {
    state.currentTime = d.currentTime;
    state.duration = d.duration;
    if (!hostMode || !ytPlayer) renderProgress(d.currentTime, d.duration);
});

socket.on('seek-video', sec => {
    state.currentTime = sec;
    if (hostMode && ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(sec, true);
});

socket.on('error-msg', msg => alert('ผิดพลาด: ' + msg));

// Reactions & Danmaku
socket.on('new-reaction', data => {
    if (!hostMode) return;
    const map = { love: '😍', ok: '👍', bad: '👎' };
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = map[data.type] || '✨';
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '10px';
    playerArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

socket.on('new-danmaku', data => {
    if (!hostMode) return;
    const el = document.createElement('div');
    el.className = 'danmaku-text';
    el.textContent = (data.nickname || '') + ': ' + data.text;
    el.style.top = (Math.random() * 60 + 10) + '%';
    el.style.animationDuration = (Math.random() * 4 + 7) + 's';
    danmakuLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
});

// --- Custom Fullscreen (keeps danmaku & reactions visible) ---
const fsBtn = $('fs-btn');
fsBtn.addEventListener('click', () => {
    const el = playerArea;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
});

// Update icon on fullscreen change
function onFSChange() {
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fsBtn.innerHTML = isFS ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
}
document.addEventListener('fullscreenchange', onFSChange);
document.addEventListener('webkitfullscreenchange', onFSChange);
