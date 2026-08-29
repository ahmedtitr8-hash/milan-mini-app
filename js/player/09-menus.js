function setupQualityMenu(){
  const btn = document.getElementById('btnQuality');
  const menu = document.getElementById('qualityMenu');
  setupAudioMenu();

  const src = state.currentSource;
  const manualQ = (src && Array.isArray(src.qualities)) ? src.qualities.filter(q=>q && q.url) : [];
  if (manualQ.length){
    btn.classList.remove('hide');
    const activeUrl = lastUrl;
    const items = [`<div data-mq="-1" class="${src.url===activeUrl?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${src.url===activeUrl?'✓ ':''}الجودة الأساسية</div>`]
      .concat(manualQ.map((q,i)=>`<div data-mq="${i}" class="${q.url===activeUrl?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${q.url===activeUrl?'✓ ':''}${escapeHtml(q.label||('جودة '+(i+1)))}</div>`));
    menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
    menu.querySelectorAll('[data-mq]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        menu.classList.add('hide');
        const idx = parseInt(el.dataset.mq);
        const targetUrl = idx===-1 ? src.url : manualQ[idx].url;
        if (targetUrl && targetUrl !== activeUrl) loadSource(targetUrl, src);
      };
    });
    return;
  }

  if (hlsInst && hlsInst.levels && hlsInst.levels.length >= 2){
    btn.classList.remove('hide');
    const byHeight = new Map();
    hlsInst.levels.forEach((lvl,i)=>{
      const key = lvl.height || lvl.bitrate;
      if (!byHeight.has(key) || byHeight.get(key).lvl.bitrate < lvl.bitrate) byHeight.set(key, {lvl, i});
    });
    const uniq = [...byHeight.values()].sort((a,b)=>b.lvl.height-a.lvl.height);
    const activeLevel = hlsInst.autoLevelEnabled ? -1 : hlsInst.currentLevel;
    const items = [`<div data-l="-1" class="${activeLevel===-1?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${activeLevel===-1?'✓ ':''}تلقائي</div>`]
      .concat(uniq.map(({lvl,i})=>`<div data-l="${i}" class="${activeLevel===i?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${activeLevel===i?'✓ ':''}${lvl.height?lvl.height+'p':Math.round(lvl.bitrate/1000)+'kbps'}</div>`));
    menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
    menu.querySelectorAll('[data-l]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        hlsInst.nextLevel = parseInt(el.dataset.l);
        menu.querySelectorAll('[data-l]').forEach(x=>x.classList.toggle('menu-active', x===el));
        menu.classList.add('hide');
        afterSmoothQualitySwitch();
      };
    });
    return;
  }

  if (dashInst && dashInst.getBitrateInfoListFor){
    const rawList = dashInst.getBitrateInfoListFor('video') || [];
    const byH = new Map();
    rawList.forEach(l=>{ const key = l.height || l.bitrate; if (!byH.has(key) || byH.get(key).bitrate < l.bitrate) byH.set(key, l); });
    const list = [...byH.values()].sort((a,b)=>(b.height||0)-(a.height||0));
    if (list.length >= 2){
      btn.classList.remove('hide');
      let autoOn = true; try{ autoOn = !!dashInst.getSettings().streaming.abr.autoSwitchBitrate.video; }catch(e){}
      let curIdx = -1; try{ curIdx = dashInst.getQualityFor('video'); }catch(e){}
      const activeIdx = autoOn ? -1 : curIdx;
      const items = [`<div data-dq="-1" class="${activeIdx===-1?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${activeIdx===-1?'✓ ':''}تلقائي</div>`]
        .concat(list.map(l=>`<div data-dq="${l.qualityIndex}" class="${activeIdx===l.qualityIndex?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${activeIdx===l.qualityIndex?'✓ ':''}${l.height?l.height+'p':Math.round(l.bitrate/1000)+'kbps'}</div>`));
      menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
      menu.querySelectorAll('[data-dq]').forEach(el=>{
        el.onclick = (e)=>{
          e.stopPropagation();
          const idx = parseInt(el.dataset.dq);
          dashInst.updateSettings({ streaming:{ buffer:{ fastSwitchEnabled:false }, abr:{ autoSwitchBitrate:{ video: idx===-1 } } } });
          if (idx !== -1) dashInst.setQualityFor('video', idx);
          menu.querySelectorAll('[data-dq]').forEach(x=>x.classList.toggle('menu-active', x===el));
          menu.classList.add('hide');
          afterSmoothQualitySwitch();
        };
      });
      return;
    }
  }

  if (shakaInst && shakaInst.getVariantTracks){
    const rawTracks = (shakaInst.getVariantTracks() || []).filter(t=>t.height || t.bandwidth);
    const byHt = new Map();
    rawTracks.forEach(t=>{ const key = t.height || t.bandwidth; if (!byHt.has(key) || byHt.get(key).bandwidth < t.bandwidth) byHt.set(key, t); });
    const tracks = [...byHt.values()].sort((a,b)=>(b.height||0)-(a.height||0));
    if (tracks.length >= 2){
      btn.classList.remove('hide');
      const shakaAutoOn = (function(){ try{ return shakaInst.getConfiguration().abr.enabled; }catch(e){ return true; } })();
      const items = [`<div data-sq="-1" class="${shakaAutoOn?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${shakaAutoOn?'✓ ':''}تلقائي</div>`]
        .concat(tracks.map(t=>`<div data-sq="${t.id}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${t.height?t.height+'p':Math.round(t.bandwidth/1000)+'kbps'}</div>`));
      menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
      menu.querySelectorAll('[data-sq]').forEach(el=>{
        el.onclick = (e)=>{
          e.stopPropagation();
          const id = parseInt(el.dataset.sq);
          if (id === -1){ shakaInst.configure('abr.enabled', true); }
          else{
            shakaInst.configure('abr.enabled', false);
            const t = tracks.find(t=>t.id===id);
            if (t) shakaInst.selectVariantTrack(t, false);
          }
          menu.querySelectorAll('[data-sq]').forEach(x=>x.classList.toggle('menu-active', x===el));
          menu.classList.add('hide');
          afterSmoothQualitySwitch();
        };
      });
      return;
    }
  }

  btn.classList.add('hide');
}

function setupAudioMenu(){
  const btn = document.getElementById('btnAudio');
  const menu = document.getElementById('audioMenu');
  if (!btn || !menu) return;

  if (hlsInst && hlsInst.audioTracks && hlsInst.audioTracks.length >= 2){
    btn.classList.remove('hide');
    const items = hlsInst.audioTracks.map((t,i)=>`<div data-at="${i}" class="${i===hlsInst.audioTrack?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${i===hlsInst.audioTrack?'✓ ':''}${escapeHtml(t.name||t.lang||('مسار '+(i+1)))}</div>`);
    menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
    menu.querySelectorAll('[data-at]').forEach(el=>{
      el.onclick = (e)=>{ e.stopPropagation(); hlsInst.audioTrack = parseInt(el.dataset.at); menu.classList.add('hide'); setupAudioMenu(); nudgeAfterSwitch(); };
    });
    return;
  }

  if (dashInst && dashInst.getTracksFor){
    const tracks = dashInst.getTracksFor('audio') || [];
    if (tracks.length >= 2){
      btn.classList.remove('hide');
      const current = dashInst.getCurrentTrackFor ? dashInst.getCurrentTrackFor('audio') : null;
      const items = tracks.map((t,i)=>`<div data-adq="${i}" class="${(current&&current.index===t.index)?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${(current&&current.index===t.index)?'✓ ':''}${escapeHtml(t.lang||('مسار '+(i+1)))}</div>`);
      menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
      menu.querySelectorAll('[data-adq]').forEach(el=>{
        el.onclick = (e)=>{ e.stopPropagation(); dashInst.setCurrentTrack(tracks[parseInt(el.dataset.adq)]); menu.classList.add('hide'); setupAudioMenu(); };
      });
      return;
    }
  }

  if (shakaInst && shakaInst.getAudioLanguagesAndRoles){
    const opts = shakaInst.getAudioLanguagesAndRoles() || [];
    if (opts.length >= 2){
      btn.classList.remove('hide');
      let curLang = null, curRole = null;
      try{
        const activeTrack = (shakaInst.getVariantTracks() || []).find(t=>t.active);
        if (activeTrack){ curLang = activeTrack.language; curRole = (activeTrack.audioRoles && activeTrack.audioRoles[0]) || null; }
      }catch(e){}
      const items = opts.map((o,i)=>{
        const isActive = curLang && o.language === curLang && (!o.role || o.role === curRole);
        return `<div data-asq="${i}" class="${isActive?'menu-active':''}" style="padding:10px 14px;font-size:12px;font-weight:700;color:#fff;">${isActive?'✓ ':''}${escapeHtml(o.language||('مسار '+(i+1)))}${o.role?(' — '+escapeHtml(o.role)):''}</div>`;
      });
      menu.innerHTML = items.join('<div style="height:1px;background:var(--border)"></div>');
      menu.querySelectorAll('[data-asq]').forEach(el=>{
        el.onclick = (e)=>{
          e.stopPropagation();
          const o = opts[parseInt(el.dataset.asq)];
          shakaInst.selectAudioLanguage(o.language, o.role);
          menu.classList.add('hide');
          setupAudioMenu(); nudgeAfterSwitch();
        };
      });
      return;
    }
  }

  btn.classList.add('hide');
}

function toggleAudioMenu(){
  document.getElementById('aspectMenu').classList.add('hide');
  document.getElementById('serverMenu').classList.add('hide');
  document.getElementById('qualityMenu').classList.add('hide');
  document.getElementById('audioMenu').classList.toggle('hide');
}

function toggleQualityMenu(){
  document.getElementById('aspectMenu').classList.add('hide');
  document.getElementById('serverMenu').classList.add('hide');
  document.getElementById('audioMenu').classList.add('hide');
  document.getElementById('qualityMenu').classList.toggle('hide');
}

function toggleAspectMenu(){
  document.getElementById('qualityMenu').classList.add('hide');
  document.getElementById('serverMenu').classList.add('hide');
  document.getElementById('audioMenu').classList.add('hide');
  document.getElementById('aspectMenu').classList.toggle('hide');
}

function setServersButtonVisibility(){
  const btn = document.getElementById('btnServers');
  const list = currentTabSources();
  btn.classList.toggle('hide', list.length <= 1);
}

let serverMenuPage = 0;
const SERVERS_PER_PAGE = 9;

function renderServerMenuPage(){
  const panel = document.getElementById('serverMenu');
  const list = currentTabSources();
  const activeUrl = lastUrl;
  const start = serverMenuPage * SERVERS_PER_PAGE;
  const pageItems = list.slice(start, start + SERVERS_PER_PAGE).map((s,i)=>({ s, realIdx: start + i }));
  const activePos = pageItems.findIndex(it => it.s.url === activeUrl);
  if (activePos !== -1){
    const activeItem = pageItems.splice(activePos, 1)[0];
    pageItems.splice(Math.floor(pageItems.length / 2), 0, activeItem);
  }
  const chipStyle = 'padding:10px 14px;font-size:12px;font-weight:700;color:#fff;white-space:nowrap;cursor:pointer;';
  let html = pageItems.map(({s, realIdx})=>{
    const active = s.url===activeUrl;
    return `<div data-srv="${realIdx}" style="${chipStyle}${active?'background:var(--acc);':''}">${active?'✓ ':''}${escapeHtml(s.label||('سيرفر '+(realIdx+1)))}</div>`;
  }).join('<div style="height:1px;background:var(--border)"></div>');
  if (list.length > SERVERS_PER_PAGE){
    html += `<div style="height:1px;background:var(--border)"></div>
      <div data-srv-next="1" style="${chipStyle}display:flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
    </div>`;
  }
  panel.innerHTML = html;
  panel.querySelectorAll('[data-srv]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); pickSourceFromMenu(parseInt(el.dataset.srv,10)); };
  });
  const nextBtn = panel.querySelector('[data-srv-next]');
  if (nextBtn){
    nextBtn.onclick = (e)=>{
      e.stopPropagation();
      const totalPages = Math.ceil(list.length / SERVERS_PER_PAGE);
      serverMenuPage = (serverMenuPage + 1) % totalPages;
      renderServerMenuPage();
    };
  }
}

function toggleServerMenu(){
  document.getElementById('aspectMenu').classList.add('hide');
  document.getElementById('qualityMenu').classList.add('hide');
  document.getElementById('audioMenu').classList.add('hide');
  const menu = document.getElementById('serverMenu');
  const icon = document.getElementById('btnServersIcon');
  const willOpen = menu.classList.contains('hide');
  if (willOpen){
    serverMenuPage = 0;
    renderServerMenuPage();
  }
  menu.classList.toggle('hide');
  icon.innerHTML = willOpen
    ? '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>'
    : '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6z"/>';
}

function pickSourceFromMenu(i){
  const list = currentTabSources();
  if (!list[i]) return;
  loadSource(list[i].url, list[i]);
  document.getElementById('serverMenu').classList.add('hide');
  document.getElementById('btnServersIcon').innerHTML = '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6z"/>';
  document.querySelectorAll('#chipsRow .chip').forEach((c,idx)=>c.classList.toggle('active', idx===i));
}

function setAspect(mode){
  const w = document.getElementById('playerWrap');
  w.classList.remove('ar-cover','ar-fill','ar-9x16','ar-16x9');
  if (mode) w.classList.add('ar-'+mode);
  document.getElementById('aspectMenu').querySelectorAll('[data-ar]').forEach(el=>{
    el.classList.toggle('menu-active', el.dataset.ar === (mode||''));
  });
  document.getElementById('aspectMenu').classList.add('hide');
}

const EMBED_ASPECT_CYCLE = ['', 'cover', 'fill', '9x16', '16x9'];
let embedAspectIdx = 0;

function cycleEmbedAspect(){
  embedAspectIdx = (embedAspectIdx + 1) % EMBED_ASPECT_CYCLE.length;
  setAspect(EMBED_ASPECT_CYCLE[embedAspectIdx]);
  armEmbedToolbarDim();
}

let embedDimTimer = null;
function armEmbedToolbarDim(){
  const bar = document.getElementById('embedToolbar');
  bar.classList.remove('dim');
  clearTimeout(embedDimTimer);
  embedDimTimer = setTimeout(()=>{ bar.classList.add('dim'); }, 4000);
}

document.getElementById('aspectMenu').querySelectorAll('[data-ar]').forEach(el=>{
  el.onclick = (e)=>{ e.stopPropagation(); setAspect(el.dataset.ar); };
});

function toggleFS(){
  if (isFull) { exitFS(); return; }
  const w = document.getElementById('playerWrap');
  const v = video();
  const tg = window.Telegram && window.Telegram.WebApp;
  isFull = true;
  document.body.classList.add('fs-lock');

  if (isIOSDevice() && v.webkitEnterFullscreen && !document.getElementById('embedFrame')){
    try{ v.webkitEnterFullscreen(); showCtrl(); return; }catch(e){}
  }

  if (tg && typeof tg.requestFullscreen === 'function'){
    try{ tg.requestFullscreen(); }catch(e){}
  }

  const root = document.documentElement;
  const reqFS = root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen || root.msRequestFullscreen;
  if (reqFS){ Promise.resolve(reqFS.call(root)).catch(()=>{}); }

  w.classList.add('fs');
  if (document.getElementById('embedFrame')){
    document.getElementById('btnEmbedFS').classList.add('hide');
    document.getElementById('btnEmbedFSClose').classList.remove('hide');
  }
  showCtrl();
}

function exitFS(){
  isFull = false;
  const w = document.getElementById('playerWrap');
  w.classList.remove('fs');
  document.body.classList.remove('fs-lock');
  if (document.getElementById('embedFrame')){
    document.getElementById('btnEmbedFS').classList.remove('hide');
    document.getElementById('btnEmbedFSClose').classList.add('hide');
  }
  const exitter = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if ((document.fullscreenElement || document.webkitFullscreenElement) && exitter){
    try{ exitter.call(document); }catch(e){}
  }
  if (video().webkitDisplayingFullscreen && video().webkitExitFullscreen){ try{ video().webkitExitFullscreen(); }catch(e){} }
}

function pipSupported(){
  const v = video();
  return !!(document.pictureInPictureEnabled && v && !v.disablePictureInPicture)
    || !!(v && v.webkitSupportsPresentationMode && typeof v.webkitSetPresentationMode === 'function');
}

async function togglePIP(){
  const v = video();
  try{
    // مسار متصفحات كروم/أندرويد القياسي
    if (document.pictureInPictureEnabled && !v.disablePictureInPicture){
      if (document.pictureInPictureElement){
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
      return;
    }
    // مسار سفاري/iOS (طريقة مختلفة كليًا، ما تستخدم Picture-in-Picture API القياسي)
    if (v.webkitSupportsPresentationMode && typeof v.webkitSetPresentationMode === 'function'){
      v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      return;
    }
    showToastMsg('PIP غير مدعوم: ' + (document.pictureInPictureEnabled ? 'enabled=true' : 'enabled=false') + ' / disabled=' + v.disablePictureInPicture, 4000);
  }catch(e){
    // مؤقت للتشخيص: نطلع نص الخطأ الفعلي فوق الشاشة بدل ما نبلعه بصمت
    showToastMsg('خطأ PIP: ' + (e && e.message ? e.message : e), 4000);
  }
}

// نخفي زر PIP تلقائيًا لو المتصفح/الويبفيو ما يدعم الخاصية إطلاقًا (بعض متصفحات تيليجرام الداخلية)
// ملاحظة: هالسكربت محمّل بآخر الصفحة بعد ما DOM يكون جاهز أصلاً، فـDOMContentLoaded يكون
// فات فعلاً وما بينفّذ — نشغّل الفحص مباشرة بدل ما ننتظر حدث صار من قبل
// (مؤقتًا للتشخيص: الزر يبان دايمًا حاليًا بدل ما ينخفي، عشان نقدر نضغطه ونشوف سبب الفشل الحقيقي)
(function initPIPButton(){
  const btn = document.getElementById('btnPIP');
  if (btn){ btn.classList.remove('hide'); }
})();

