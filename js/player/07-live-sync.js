function resyncLiveEdge(forcePlay, useCatchUp){
  if (!currentIsLive) return;
  const v = video();
  let engineEdge = null;
  if (hlsInst && isFinite(hlsInst.liveSyncPosition)){
    engineEdge = hlsInst.liveSyncPosition;
  } else if (shakaInst && shakaInst.seekRange){
    try{ const r = shakaInst.seekRange(); if (r && isFinite(r.end)) engineEdge = r.end; }catch(e){}
  } else if (dashInst && dashInst.duration){
    // بعكس hls/shaka، ما فيه بَفر كافي بالبداية نعتمد عليه — نجيب حافة اللحظة من dash.js نفسه
    // (duration للبث المباشر بـ dash.js يرجع نقطة الحافة الحالية مو الطول الكامل)
    try{ const d = dashInst.duration(); if (isFinite(d) && d > 0) engineEdge = d; }catch(e){}
  }

  let bufferedTarget = null;
  try{
    const b = v.buffered;
    if (b && b.length){
      const end = b.end(b.length - 1);
      bufferedTarget = Math.max(0, end - 0.4);
    }
  }catch(e){}

  let target = null;
  if (bufferedTarget !== null && engineEdge !== null) target = Math.min(bufferedTarget, engineEdge);
  else target = (bufferedTarget !== null) ? bufferedTarget : engineEdge;

  if (target === null){
    try{
      if (v.seekable && v.seekable.length){
        const end = v.seekable.end(v.seekable.length - 1);
        if (isFinite(end)) target = end - 1;
      }
    }catch(e){}
  }
  if (target !== null && target - v.currentTime > 6){
    if (useCatchUp) startLiveCatchUp(target);
    else {
      try{ v.currentTime = Math.max(0, target); }catch(e){}
      scheduleBaselineCapture();
    }
  }
  if (forcePlay) playReliably(v);
}

/* ============== حارس التجمّد للبث المباشر (freeze watchdog) ==============
   قبل هذا التعديل ما فيه أي مراقبة مستمرة لتجمّد الفيديو أثناء البث المباشر: لو الفيديو توقف
   عن التقدم (سيرفر Xtream يعلّق مثلاً) كان يبقى واقف بصمت لين المستخدم يسوي شيء يدويًا.
   هذا الحارس يفحص كل 4 ثوانٍ هل الوقت الحالي للفيديو يتقدّم فعليًا:
   - تجمّد قصير (~8 ثواني): يحاول مزامنة حافة اللحظة أول (أخف وأسرع حل).
   - تجمّد أطول (~16 ثانية) ولسه واقف: يعيد تحميل المصدر بالكامل من الصفر (نفس سلسلة محاولات
     البروكسيات المعتادة)، بحد أقصى 3 إعادات تحميل تلقائية خلال أي دقيقتين حتى ما يدخل بحلقة
     تكرار لا نهائية لو السيرفر المصدر منقطع فعليًا — عندها يعرض زر "إعادة المحاولة" يدويًا. */
let watchdogTimer = null;
let wdLastTime = -1;
let wdStuckStrikes = 0;
let wdAutoReloadTimes = [];
function wdNoteAutoReload(){
  const now = Date.now();
  wdAutoReloadTimes = wdAutoReloadTimes.filter(t => now - t < 120000);
  wdAutoReloadTimes.push(now);
}
function wdReloadsExceeded(){
  return wdAutoReloadTimes.filter(t => Date.now() - t < 120000).length >= 3;
}
function wdReloadCurrentSource(){
  if (wdReloadsExceeded()){
    showPlaceholder('البث متجمّد ولم تنجح إعادة المحاولة التلقائية', true);
    return;
  }
  wdNoteAutoReload();
  if (lastUrl) loadSource(lastUrl, lastSource);
}
function freezeWatchdogTick(){
  if (!currentIsLive || document.hidden){ wdStuckStrikes = 0; wdLastTime = -1; return; }
  const v = video();
  if (!v || v.paused || v.ended){ wdStuckStrikes = 0; wdLastTime = v ? v.currentTime : -1; return; }
  const t = v.currentTime;
  if (wdLastTime >= 0 && Math.abs(t - wdLastTime) < 0.05) wdStuckStrikes++;
  else wdStuckStrikes = 0;
  wdLastTime = t;

  // مقاطع DASH عادة أطول من HLS (قد تصل 4-6 ثواني)، فنفس عتبة الصبر (8/16 ثانية) القديمة كانت
  // تحكم عليه "متجمّد" بسرعة زايدة وتدخله بحلقة إعادة تحميل متكررة وهو أصلاً بس ينتظر مقطع تالي
  // بشكل طبيعي. نعطي DASH عتبة أعلى (~16 ثانية لمزامنة اللحظة، ~28 ثانية لإعادة التحميل الكامل).
  // Shaka يُستخدم حصرًا لروابط MPD/DASH بهذا الكود (مو HLS إطلاقًا)، فلازم ياخذ نفس عتبة صبر DASH،
  // خصوصًا مع مصادر تمر ببروكسي بطيء (زي نفق جوال) وين التأخير الطبيعي بالتحميل قد يتجاوز 16 ثانية
  // بدون ما يكون تجمّد حقيقي — قبل هذا كان يُصنَّف "شاكا" ضمن الفئة القصيرة فيعيد التحميل قبل أوانه
  const isDashLike = (currentEngine === 'dash' || currentEngine === 'shaka');
  const syncStrikes = isDashLike ? 4 : 2;
  const reloadStrikes = isDashLike ? 7 : 4;
  if (wdStuckStrikes === syncStrikes) resyncLiveEdge(true, false);
  else if (wdStuckStrikes >= reloadStrikes){ wdStuckStrikes = 0; wdReloadCurrentSource(); }
}
clearInterval(watchdogTimer);
watchdogTimer = setInterval(freezeWatchdogTick, 4000);

// المتصفح يجمّد/يوقف تحديث الفيديو وقت ما الصفحة بالخلفية (تبديل تطبيق، تصغير تيليجرام...)؛
// أول ما ترجع الصفحة للواجهة، البَفر يكون قديم — نزامن حافة اللحظة فورًا بدل ما ينتظر المستخدم
document.addEventListener('visibilitychange', ()=>{
  if (!document.hidden && currentIsLive){
    wdStuckStrikes = 0; wdLastTime = -1;
    setTimeout(()=>resyncLiveEdge(true, false), 300);
  }
});

/* ===== لحاق تدريجي بحافة البث المباشر (تسريع بدل قفز مباشر يسبب تعليق) ===== */
let catchUpTimer = null;
function stopLiveCatchUp(){
  if (catchUpTimer){ clearInterval(catchUpTimer); catchUpTimer = null; }
  try{ const v = video(); if (v) v.playbackRate = 1; }catch(e){}
}
function getCurrentLiveEdge(fallback){
  if (hlsInst && isFinite(hlsInst.liveSyncPosition)) return hlsInst.liveSyncPosition;
  if (shakaInst && shakaInst.seekRange){
    try{ const r = shakaInst.seekRange(); if (r && isFinite(r.end)) return r.end; }catch(e){}
  }
  if (dashInst && dashInst.duration){
    try{ const d = dashInst.duration(); if (isFinite(d) && d > 0) return d; }catch(e){}
  }
  return fallback;
}
function startLiveCatchUp(target){
  const v = video();
  const gap = target - v.currentTime;
  // فجوة كبيرة جدًا (دقائق): التسريع هيطول بلا داعي، الأسلم قفزة مباشرة هنا فقط
  if (gap > 90){
    try{ v.currentTime = Math.max(0, target); }catch(e){}
    scheduleBaselineCapture();
    return;
  }
  clearInterval(catchUpTimer);
  const startedAt = Date.now();
  function bufferedAheadSecs(){
    try{
      const buf = v.buffered;
      for (let i=0;i<buf.length;i++){
        if (buf.start(i) <= v.currentTime + 0.2 && buf.end(i) >= v.currentTime){
          return buf.end(i) - v.currentTime;
        }
      }
    }catch(e){}
    return 0;
  }
  catchUpTimer = setInterval(()=>{
    if (!currentIsLive || v.paused || v.ended){ stopLiveCatchUp(); scheduleBaselineCapture(); return; }
    const liveEdge = getCurrentLiveEdge(target);
    const remaining = liveEdge - v.currentTime;
    if (remaining <= 1.2){
      stopLiveCatchUp();
      scheduleBaselineCapture();
      return;
    }
    // نسرّع بقدر ما البَفر المتاح فعليًا يسمح، وبهامش أمان أوسع — الأولوية القصوى إنه ما يعلّق أبدًا
    const ahead = bufferedAheadSecs();
    let targetRate;
    if (ahead < 2.5) targetRate = 1;            // بَفر قليل: نرجع عادي فورًا لين يتعبى، قبل لا يوصل نقطة التعليق
    else if (ahead < 6) targetRate = 1.15;      // بَفر متوسط: تسريع طفيف جدًا، أمان أولاً
    else targetRate = remaining > 25 ? 1.75 : 1.4; // بَفر كويس فعلاً: تسريع أوضح
    if (Math.abs(v.playbackRate - targetRate) > 0.05){
      try{ v.playbackRate = targetRate; }catch(e){}
    }
    // أمان: لو ما لحق خلال 30 ثانية (شبكة بطيئة تمنع تجميع بَفر كافٍ)، نوقف التسريع ونحدّث المؤشر
    // بدل ما يظل عالق أو يفضل يحسب على بيانات قديمة (سبب بقاءه رمادي)
    if (Date.now() - startedAt > 30000){ stopLiveCatchUp(); scheduleBaselineCapture(); }
  }, 400);
}

let liveIndicatorDelayed = false;

function measureLiveDelay(v){
  let delay = 0, got = false;
  try{
    if (dashInst && dashInst.getCurrentLiveLatency){
      const lat = dashInst.getCurrentLiveLatency();
      if (isFinite(lat) && lat >= 0){ delay = lat; got = true; }
    }
  }catch(e){}
  if (!got && hlsInst){
    try{
      const syncPos = hlsInst.liveSyncPosition;
      if (isFinite(syncPos)){ delay = Math.max(0, syncPos - v.currentTime); got = true; }
    }catch(e){}
  }
  if (!got && shakaInst && shakaInst.getStats){
    try{
      const stats = shakaInst.getStats();
      if (stats && isFinite(stats.liveLatency) && stats.liveLatency >= 0){ delay = stats.liveLatency; got = true; }
    }catch(e){}
  }
  if (!got){
    try{
      if (v.seekable && v.seekable.length){
        const liveEdge = v.seekable.end(v.seekable.length - 1);
        if (isFinite(liveEdge)) delay = Math.max(0, liveEdge - v.currentTime);
      }
    }catch(e){}
  }
  return delay;
}

let baselineDelay = null;
let baselineTimer = null;

function scheduleBaselineCapture(){
  clearTimeout(baselineTimer);
  baselineTimer = setTimeout(()=>{
    if (!currentIsLive || !liveIndicatorReady) return;
    baselineDelay = measureLiveDelay(video());
  }, 4000);
}

function updateLiveIndicator(){
  const el = document.getElementById('btnLiveIndicator');
  if (!el) return;
  if (!currentIsLive || !liveIndicatorReady){ el.classList.add('hide'); return; }
  el.classList.remove('hide');
  const v = video();
  const rawDelay = measureLiveDelay(v);
  const delay = Math.max(0, rawDelay - (baselineDelay || 0));
  if (liveIndicatorDelayed){ if (delay <= 3) liveIndicatorDelayed = false; }
  else { if (delay > 7) liveIndicatorDelayed = true; }
  el.classList.toggle('at-edge', !liveIndicatorDelayed);
  el.classList.toggle('delayed', liveIndicatorDelayed);
}
setInterval(updateLiveIndicator, 1000);

function afterSmoothQualitySwitch(){ playReliably(video()); }

function nudgeAfterSwitch(){
  const v = video();
  playReliably(v);
  setTimeout(()=>{ if (v.paused || v.readyState < 3) resyncLiveEdge(true); }, 1200);
  setTimeout(()=>{ if (v.paused || v.readyState < 3) resyncLiveEdge(true); }, 2500);
}

