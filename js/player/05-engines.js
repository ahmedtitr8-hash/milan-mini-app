function playableUrl(u){
  if (/^http:\/\//i.test(u)) return `${STREAM_PROXY}?url=${encodeURIComponent(u)}`;
  return u;
}

function detectTypeFromExtension(url){
  if (/\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i.test(url)) return 'vod';
  if (isXtreamLiveUrl(url)) return 'live';
  return null;
}

let currentIsLive = false;
let liveIndicatorReady = false;

function applyTypeUI(type){
  const badge = document.getElementById('liveBadgeP');
  if (badge) badge.style.display = (type === 'live') ? 'flex' : 'none';
  updateLiveIndicator();
  const isLive = (type === 'live');
  currentIsLive = isLive;
  const seekRow = document.getElementById('seekRow');
  const back10 = document.getElementById('btnBack10');
  const fwd10 = document.getElementById('btnFwd10');
  const centerPlay = document.getElementById('btnCenterPlay');
  const barPlay = document.getElementById('btnBarPlay');
  if (seekRow) seekRow.style.display = isLive ? 'none' : '';
  if (back10) back10.style.display = isLive ? 'none' : '';
  if (fwd10) fwd10.style.display = isLive ? 'none' : '';
  if (centerPlay) centerPlay.style.display = isLive ? 'none' : '';
  if (barPlay) barPlay.style.display = isLive ? 'none' : '';
}

function hidePlaceholder(){ document.getElementById('playerPlaceholder').classList.add('hide'); }

function isIOSDevice(){
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

let toastTimer = null;
function showToastMsg(msg, ms){
  const t = document.getElementById('playerToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.add('hide'), ms || 3000);
}

async function destroyPlayer(){
  stopLiveCatchUp();
  try{ if (hlsInst) hlsInst.destroy(); }catch(e){}
  try{ if (dashInst) dashInst.reset(); }catch(e){}
  try{ if (mpegtsInst) mpegtsInst.destroy(); }catch(e){}
  try{ if (shakaInst) await shakaInst.destroy(); }catch(e){}
  hlsInst = null; dashInst = null; mpegtsInst = null; shakaInst = null;
  const f = document.getElementById('embedFrame');
  if (f) f.remove();
}

async function resetPlayerUI(){
  await destroyPlayer();
  const v = video();
  v.classList.remove('hide');
  v.pause(); v.removeAttribute('src'); v.load();
  document.getElementById('ctrlLayer').classList.remove('hide');
  document.getElementById('embedToolbar').classList.add('hide');
  showPlaceholder('جارِ تحميل البث…');
}

function normalizeEmbedUrl(url){
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]+)/i);
  if (yt) return { embed:true, url:`https://www.youtube.com/embed/${yt[1]}?autoplay=1&playsinline=1` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/i);
  if (vimeo) return { embed:true, url:`https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  if (/dailymotion\.com\/(video|embed)/i.test(url)){
    const dm = url.match(/(?:dailymotion\.com\/(?:video|embed\/video)\/)([\w]+)/i);
    if (dm) return { embed:true, url:`https://www.dailymotion.com/embed/video/${dm[1]}?autoplay=1` };
  }
  if (/drive\.google\.com\/file\/d\//i.test(url)){
    const gd = url.match(/\/file\/d\/([\w-]+)/i);
    if (gd) return { embed:true, url:`https://drive.google.com/file/d/${gd[1]}/preview` };
  }
  if (/facebook\.com\/.+\/videos\//i.test(url) || /fb\.watch\//i.test(url)){
    return { embed:true, url:`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&autoplay=1` };
  }
  if (/twitch\.tv\//i.test(url)){
    const tw = url.match(/twitch\.tv\/(?:videos\/(\d+)|([\w]+))/i);
    if (tw){
      const parent = location.hostname;
      return { embed:true, url: tw[1]
        ? `https://player.twitch.tv/?video=${tw[1]}&parent=${parent}&autoplay=true`
        : `https://player.twitch.tv/?channel=${tw[2]}&parent=${parent}&autoplay=true` };
    }
  }
  if (/ok\.ru\/(video|videoembed)/i.test(url)){
    const ok = url.match(/ok\.ru\/video(?:embed)?\/(\d+)/i);
    if (ok) return { embed:true, url:`https://ok.ru/videoembed/${ok[1]}` };
  }
  if (/rumble\.com\/embed/i.test(url)) return { embed:true, url };
  if (/\/embed\//i.test(url) && !/\.(m3u8|mp4|webm|mov|m4v|ts|mpd)(\?|#|$)/i.test(url)) return { embed:true, url };
  return { embed:false, url };
}

function showEmbed(url){
  destroyPlayer();
  hidePlaceholder();
  video().classList.add('hide');
  document.getElementById('ctrlLayer').classList.add('hide');
  const f = document.createElement('iframe');
  f.id = 'embedFrame';
  f.src = url;
  f.setAttribute('allowfullscreen', 'true');
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  document.getElementById('playerWrap').appendChild(f);
  document.getElementById('embedToolbar').classList.remove('hide');
  armEmbedToolbarDim();
}

function playHls(url, drmKeyIgnored, myGen){
  return new Promise((resolve, reject)=>{
    if (!(window.Hls && Hls.isSupported())){ reject(new Error('hls-unsupported')); return; }
    // لو صار تبديل سريع (سيرفر/جودة) وهذا الطلب صار قديم قبل ما يوصل هنا، نوقفه فورًا
    // قبل ما يلمس hlsInst المشتركة — يمنع تعارضه مع المحرك الجديد الأحدث
    if (loadGeneration !== myGen){ reject(new Error('superseded')); return; }
    currentEngine = 'hls';
    const v = video();
    let settled = false, mediaErrorRetries = 0;
    hlsInst = new Hls({
      // كانت false: يخلي hls.js يحلل/يفكّ كل مقطع فيديو على نفس الخيط (Main Thread) اللي يرسم
      // الواجهة ويستقبل ضغطات الأزرار — فأي لحظة معالجة مقطع تجمّد الصندوق كامل (حتى الـ spinner
      // اللي أصلاً حركة CSS مفروض تكمل لوحدها). true يخلي المعالجة بخيط منفصل (Web Worker)
      // فالواجهة تفضل سريعة الاستجابة بغض النظر عن ضغط الشبكة أو المعالجة
      enableWorker: true,
      xhrSetup: xhr => { xhr.withCredentials = false; },
      maxBufferLength: 20,
      maxMaxBufferLength: 40,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 7,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 1000,
      manifestLoadingMaxRetryTimeout: 12000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 1000,
      levelLoadingMaxRetryTimeout: 12000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 15000
    });
    hlsInst.loadSource(url);
    hlsInst.attachMedia(v);
    hlsInst.on(Hls.Events.MANIFEST_PARSED, ()=>{
      if (settled || loadGeneration !== myGen) return; settled = true;
      hidePlaceholder(); playReliably(v); setupQualityMenu();
      resolve();
    });

    hlsInst.on(Hls.Events.AUDIO_TRACKS_UPDATED, ()=>{ if (loadGeneration === myGen) setupAudioMenu(); });
    hlsInst.on(Hls.Events.ERROR, (evt, data)=>{
      if (loadGeneration !== myGen) return;
      if (!settled){
        if (data.fatal){ settled = true; reject(new Error('hls-fatal:'+(data.details||''))); }
        return;
      }
      if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR){
        mediaErrorRetries++;
        if (mediaErrorRetries <= 2){ try{ hlsInst.recoverMediaError(); }catch(e){} }
        else if (hlsInst.levels && hlsInst.levels.length > 1){
          let lowestIdx = 0, lowestBitrate = Infinity;
          hlsInst.levels.forEach((lvl,idx)=>{ if (lvl.bitrate < lowestBitrate){ lowestBitrate = lvl.bitrate; lowestIdx = idx; } });
          hlsInst.currentLevel = lowestIdx;
          showToastMsg('الجودة العالية غير مدعومة على هذا الجهاز، تم التحويل لجودة أقل تلقائيًا');
          try{ hlsInst.recoverMediaError(); }catch(e){}
          mediaErrorRetries = 0;
        }
      } else if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR){
        try{ hlsInst.startLoad(); }catch(e){}
      }
    });
  });
}

function playDash(url, drmKey, myGen){
  return new Promise((resolve, reject)=>{
    if (!window.dashjs){ reject(new Error('dash-unsupported')); return; }
    if (loadGeneration !== myGen){ reject(new Error('superseded')); return; }
    currentEngine = 'dash';
    const v = video();
    let settled = false;
    dashInst = dashjs.MediaPlayer().create();
    dashInst.updateSettings({ streaming:{
      text:{ defaultEnabled:false },
      // نجبر dash.js يبدأ التشغيل قريب من حافة اللحظة الحالية بدل ما يبدأ من أقدم جزء متوفر
      // بالمنيفست — هذا هو سبب "يجلس على أول فريم" لين تضغط لايف يدويًا. رفعناها من 6 لـ12 ثانية
      // عشان تعطي بَفر أمان أكبر لسيرفرات بث حية غير مستقرة (زي Action) وما تدخل بحلقة تجمّد/إعادة
      // تحميل متكررة كل ما يتأخر توصيل مقطع لحظات بسيطة
      delay:{ liveDelay:12, liveDelayFragmentCount:NaN },
      // التسريع التلقائي المدمج بمكتبة dash.js معطّل الآن — التسريع يصير يدوي بس (بالضغط على زر LIVE)،
      // ما نبي المشغل يسرّع من نفسه إطلاقًا حتى لو صار فيه تأخر بسيط
      liveCatchup:{ enabled:false },
      retryAttempts:{ MPD:4, MediaSegment:4, InitializationSegment:4, IndexSegment:4, BitstreamSwitchingSegment:4 },
      retryIntervals:{ MPD:1000, MediaSegment:1000, InitializationSegment:1000, IndexSegment:1000, BitstreamSwitchingSegment:1000 }
    } });
    if (drmKey){
      try{
        const clearKeys = {};
        drmKey.split(',').forEach(pair=>{
          const [kid, key] = pair.split(':').map(x=>x && x.trim());
          if (kid && key) clearKeys[kid] = key;
        });
        if (Object.keys(clearKeys).length) dashInst.setProtectionData({ 'org.w3.clearkey': { clearkeys: clearKeys } });
      }catch(e){}
    }
    dashInst.initialize(v, url, false);
    const BUFFER_TARGET_SEC = 2.5, MAX_WAIT_MS = 2500, waitStart = Date.now();
    const tryStartPlayback = ()=>{
      if (settled || loadGeneration !== myGen) return;
      let buffered = 0;
      try{ buffered = dashInst.getBufferLength ? dashInst.getBufferLength('video') : 0; }catch(e){}
      if (buffered >= BUFFER_TARGET_SEC || (Date.now() - waitStart) >= MAX_WAIT_MS){
        settled = true; hidePlaceholder(); playReliably(v); resolve();
      } else {
        setTimeout(tryStartPlayback, 200);
      }
    };
    dashInst.on(dashjs.MediaPlayer.events.CAN_PLAY, ()=>{ if(settled || loadGeneration !== myGen) return; tryStartPlayback(); });
    dashInst.on(dashjs.MediaPlayer.events.ERROR, (e)=>{ if(settled || loadGeneration !== myGen) return; settled=true; reject(new Error('dash-fatal:'+((e&&e.error&&e.error.code)||''))); });
  });
}

function playMpegts(url, myGen){
  return new Promise((resolve, reject)=>{
    if (!(window.mpegts && mpegts.isSupported())){ reject(new Error('mpegts-unsupported')); return; }
    if (loadGeneration !== myGen){ reject(new Error('superseded')); return; }
    currentEngine = 'mpegts';
    const v = video();
    let settled = false;

    try{
      mpegtsInst = mpegts.createPlayer({
        type: 'mse',
        isLive: true,
        url: url,
        hasAudio: true,
        hasVideo: true
      }, {
        enableStashBuffer: true,              // مخزن لامتصاص تقطعات الشبكة
        stashInitialSize: 384,               // مخزن ابتدائي أخف (كان 1MB) — بث حي مستمر ما يحتاج بفر ابتدائي ثقيل، يبدأ التشغيل أسرع
        liveBufferLatencyChasing: false,     // التسريع التلقائي المدمج بالمكتبة معطّل — التسريع الآن يدوي بس (زر LIVE)
        liveBufferLatencyMaxLatency: 12,     // أقصى تأخير مسموح قبل ما يبدأ يلاحق (كان 8 — رفعناه شوي عشان ما يلاحق بسبب تذبذب مؤقت بسيط)
        liveBufferLatencyMinRemain: 3,       // يبدأ اللحاق بعد 3 ثانية احتياطي
        liveCatchUpPlaybackRate: 1.08,       // سرعة اللحاق (8% فوق الطبيعي — أخف من قبل حتى ما يبين كتقطّع أثناء اللحاق)
        autoCleanupSourceBuffer: true,       // تنظيف المخزن القديم تلقائياً
        autoCleanupMaxBackwardDuration: 15,  // يحذف ما قبل 15 ثانية ماضية
        autoCleanupMinBackwardDuration: 8,   // يبدأ التنظيف من 8 ثانية ماضية
        fixAudioTimestampGap: false,         // إصلاح mpegts.js الافتراضي لفجوات التوقيت أحيانًا يسبب توقف قصير مع Xtream — نعطّله ونعتمد على حارس التجمّد بدلاً منه
      });

      mpegtsInst.attachMediaElement(v);

      mpegtsInst.on(mpegts.Events.ERROR, (errType, errDetail, errInfo)=>{
        if (loadGeneration !== myGen) return;
        if (!settled){
          settled = true;
          reject(new Error('mpegts-fatal:' + errType + (errDetail ? (':' + errDetail) : '')));
          return;
        }
        // خطأ بعد ما البث اشتغل فعليًا (انقطاع منتصف البث، شائع مع روابط Xtream/.ts) —
        // سابقًا كان يُتجاهل بصمت ويبقى الفيديو متجمّدًا على آخر صورة. الآن نعيد تحميل
        // المصدر تلقائيًا (بنفس حد إعادة المحاولات اللي يستخدمه حارس التجمّد)
        wdReloadCurrentSource();
      });

      const onLoadedData = ()=>{
        if (settled || loadGeneration !== myGen) return;
        settled = true;
        v.removeEventListener('loadeddata', onLoadedData);
        hidePlaceholder();
        playReliably(v);
        resolve();
      };

      v.addEventListener('loadeddata', onLoadedData);
      mpegtsInst.load();
      mpegtsInst.play().catch(()=>{});
    }catch(e){
      if (!settled){ settled = true; reject(e); }
    }
  });
}

function playNative(url, myGen){
  return new Promise((resolve, reject)=>{
    const v = video();
    let settled = false;
    const onOk = ()=>{
      if (settled || loadGeneration !== myGen) return; settled = true;
      v.removeEventListener('error', onErr);
      hidePlaceholder(); playReliably(v);
      resolve();
    };
    const onErr = ()=>{
      if (settled || loadGeneration !== myGen) return; settled = true;
      v.removeEventListener('loadeddata', onOk);
      const code = v.error && v.error.code;
      reject(new Error('native-fatal'+(code?(':'+code):'')));
    };
    v.addEventListener('loadeddata', onOk, { once:true });
    v.addEventListener('error', onErr, { once:true });
    try{
      v.src = url;
      v.load();
      v.play().catch(()=>{});
    }catch(e){ if (!settled){ settled = true; reject(e); } }
  });
}

let shakaInst = null;
async function playShaka(url, drmKey, myGen){
  if (!window.shaka) await waitForLib('shaka', 6000);
  if (!window.shaka){ throw new Error('shaka-unsupported'); }
  currentEngine = 'shaka';
  try{ shaka.polyfill.installAll(); }catch(e){}
  if (!(shaka.Player && shaka.Player.isBrowserSupported && shaka.Player.isBrowserSupported())){
    throw new Error('shaka-unsupported');
  }
  const v = video();
  try{ if (shakaInst) await shakaInst.destroy(); }catch(e){}
  if (loadGeneration !== myGen) throw new Error('superseded');
  shakaInst = new shaka.Player();
  await shakaInst.attach(v);
  try{
    shakaInst.configure({
      streaming:{
        retryParameters:{ maxAttempts:5, baseDelay:1000, backoffFactor:2, fuzzFactor:0.5, timeout:0 },
        bufferingGoal: 20,
        rebufferingGoal: 4,
        bufferBehind: 30
      },
      manifest:{
        retryParameters:{ maxAttempts:5, baseDelay:1000, backoffFactor:2, fuzzFactor:0.5, timeout:0 }
      }
    });
  }catch(e){}
  if (drmKey){
    try{
      // Shaka يتوقع kid/key بصيغة Hex (32 حرف لكل قيمة 16-بايت). لو وصلت بصيغة Base64/Base64url
      // (زي بعض منصات DRM مثل Shahid/Intigral)، نحوّلها تلقائيًا لـHex قبل التهيئة — وإلا Shaka
      // يعلّق بصمت بمرحلة إعداد فك التشفير وما يطلب أي مقطع فيديو أبدًا (المانفست بس ينجح دايمًا).
      const toHex = (str) => {
        // Hex صالح أصلاً (32 حرف 0-9a-f) → رجّعه زي ما هو
        if (/^[0-9a-fA-F]{32}$/.test(str)) return str.toLowerCase();
        try{
          const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const binary = atob(padded);
          let hex = '';
          for (let i = 0; i < binary.length; i++){
            hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
          }
          return hex;
        }catch(e){ return str; }
      };
      const clearKeys = {};
      drmKey.split(',').forEach(pair=>{
        const [kid, key] = pair.split(':').map(x=>x && x.trim());
        if (kid && key) clearKeys[toHex(kid)] = toHex(key);
      });
      if (Object.keys(clearKeys).length) shakaInst.configure({ drm:{ clearKeys } });
    }catch(e){}
  }
  await shakaInst.load(url);
  if (loadGeneration !== myGen) return;
  hidePlaceholder(); playReliably(v);
  setupQualityMenu();
}

