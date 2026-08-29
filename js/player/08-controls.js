function bindVideoEvents(){
  if (boundOnce) return; boundOnce=true;
  const v = video();
  try{ v.disableRemotePlayback = true; }catch(e){}
  v.addEventListener('contextmenu', e=>e.preventDefault());
  document.getElementById('playerWrap').addEventListener('contextmenu', e=>e.preventDefault());
  v.addEventListener('play', ()=>{ isPlayingState=true; updatePlayIcons(true); showCtrl(); });
  v.addEventListener('pause', ()=>{ isPlayingState=false; updatePlayIcons(false); });
  v.addEventListener('timeupdate', ()=>{
    if (!v.duration) return;
    const pct = (v.currentTime/v.duration)*100;
    const bar = document.getElementById('seekBar');
    bar.value = pct;
    updateSeekFill(bar, pct);
    document.getElementById('timeCur').textContent = fmtSec(v.currentTime);
    document.getElementById('timeDur').textContent = fmtSec(v.duration);
  });
  v.addEventListener('webkitendfullscreen', ()=>{
    if (isFull){
      isFull = false;
      document.getElementById('playerWrap').classList.remove('fs');
      document.body.classList.remove('fs-lock');
    }
  });
  v.addEventListener('playing', ()=>{ liveIndicatorReady = true; scheduleBaselineCapture(); updateLiveIndicator(); });
}

function fmtSec(s){ if(!s||isNaN(s)) return '0:00'; const m=Math.floor(s/60), ss=Math.floor(s%60); return m+':'+(ss<10?'0':'')+ss; }

function updatePlayIcons(playing){
  const path = playing
    ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'
    : 'M8 5v14l11-7z';
  document.querySelectorAll('#btnCenterPlay svg path, #btnBarPlay svg path').forEach(p=>p.setAttribute('d',path));
}

function togglePlay(){
  const v = video();
  if (document.getElementById('embedFrame')) return;
  if (v.paused) playReliably(v); else v.pause();
  showCtrl();
}

function toggleMute(){
  const v = video();
  isMuted = !isMuted; v.muted = isMuted;
  const path = isMuted
    ? 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z'
    : 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z';
  document.querySelector('#btnMute svg path').setAttribute('d', path);
}

function seekBy(sec){
  const v = video(); if (!v.duration) return;
  v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime+sec));
  const pct = (v.currentTime/v.duration)*100;
  const bar = document.getElementById('seekBar');
  if (bar){ bar.value = pct; updateSeekFill(bar, pct); }
  showCtrl();
}

function onSeekInput(val){
  const v = video(); if (!v.duration) return;
  v.currentTime = (val/100)*v.duration;
  updateSeekFill(document.getElementById('seekBar'), val);
}

// يلوّن الجزء اللي انسحب منه الفيديو (قبل النقطة الحمراء) بلون واضح، بدل ما يكون بس نقطة معلّقة بلا أثر خلفها
function updateSeekFill(el, pct){
  pct = Math.max(0, Math.min(100, Number(pct) || 0));
  el.style.background = `linear-gradient(to right, var(--acc) 0%, var(--acc) ${pct}%, rgba(255,255,255,.25) ${pct}%, rgba(255,255,255,.25) 100%)`;
}

function showCtrl(){
  const w = document.getElementById('playerWrap');
  w.classList.add('show');
  clearTimeout(ctrlTimer);
  ctrlTimer = setTimeout(()=>w.classList.remove('show'), 3200);
}

let lastTap=0;
function onPlayerTap(e){
  const now = Date.now();
  const w = document.getElementById('playerWrap');
  if (now-lastTap < 300){ lastTap=0; return; }
  lastTap = now;
  if (w.classList.contains('show')){ clearTimeout(ctrlTimer); w.classList.remove('show'); }
  else showCtrl();
}

