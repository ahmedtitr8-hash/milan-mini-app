function timeoutAfter(ms){ return new Promise(resolve=>setTimeout(()=>resolve('timeout'), ms)); }

let loadGeneration = 0;

async function loadSource(url, source){
  const myGen = ++loadGeneration;
  lastUrl = url;
  lastSource = source || null;
  state.currentSource = source || null;

  currentIsLive = false; liveIndicatorReady = false; baselineDelay = null; clearTimeout(baselineTimer); updateLiveIndicator();
  document.getElementById('liveBadgeP').style.display = 'none';
  await resetPlayerUI();

  if (!url){ showPlaceholder('تعذر التشغيل، جرّب سيرفر آخر', true); return; }

  if (/<iframe[\s>]/i.test(url)){
    const m = url.match(/src=["']([^"']+)["']/i);
    if (m && m[1]){ showEmbed(m[1].startsWith('http') ? m[1] : ('https:'+m[1])); setupQualityMenu(); return; }
  }

  const rawUrl = url.trim();

  // رابط منشور قناة تيليجرام (تسجيلات مباريات مرفوعة تيليجرام، بدون حد حجم) — يفتح
  // بتطبيق تيليجرام نفسه بمشغله الأصلي، بدل محاولة تشغيله داخل مشغّلنا المخصص (اللي
  // مصمم لروابط بث/فيديو مباشرة، مو لمنشورات تيليجرام)
  if (/^https?:\/\/t\.me\/[A-Za-z0-9_]+\/\d+/i.test(rawUrl)) {
    showPlaceholder('يفتح بتطبيق تيليجرام…', false);
    if (window.Telegram && window.Telegram.WebApp && typeof Telegram.WebApp.openTelegramLink === 'function') {
      Telegram.WebApp.openTelegramLink(rawUrl);
    } else {
      window.open(rawUrl, '_blank'); // احتياط لو فُتح المشغل خارج تطبيق تيليجرام (نادر)
    }
    return;
  }

  // كشف النمط الوهمي: m3u8 (ماستر أو مباشر) يغلّف بث اكستريم حي بمقطع واحد بلا نهاية.
  // لو انكشف، نحول تلقائيًا للرابط الحقيقي جواه (اكستريم) ونكمل من مسار اكستريم العادي.
  // ولو الرابط ماستر بلايليست (فيه عدة جودات)، نعبّي قائمة الجودات بالواجهة أول شي.
  if (/\.m3u8?(\?|#|$)/i.test(rawUrl) && !isXtreamLiveUrl(rawUrl)){
    const qualityList = await getMasterQualityList(rawUrl);
    if (loadGeneration !== myGen) return;
    let sourceForRecursion = source;
    if (qualityList){
      sourceForRecursion = Object.assign({}, source, { url: rawUrl, qualities: qualityList });
    }
    const unwrapped = await tryUnwrapFakeXtreamPlaylist(rawUrl);
    if (loadGeneration !== myGen) return;
    if (unwrapped){
      return loadSource(unwrapped, sourceForRecursion);
    }
  }

  const m = state.currentMatch;
  video().poster = '';
  setPlayerBg(state.currentMatch);

  const forcedType = source && source.stream_type && source.stream_type !== 'auto' ? source.stream_type : null;
  const bestGuess = forcedType || detectTypeFromExtension(rawUrl) || 'vod';
  applyTypeUI(bestGuess);

  const norm = normalizeEmbedUrl(rawUrl);
  if (norm.embed){ showEmbed(norm.url); setupQualityMenu(); return; }

  bindVideoEvents();
  setupQualityMenu();

  const drmKey = (source && source.drm_key) ? String(source.drm_key).trim() : null;
  const isXtreamSource = isXtreamLiveUrl(rawUrl);
  const PROXY_BASE = isXtreamSource ? XTREAM_STREAM_PROXY : STREAM_PROXY;

  let playUrl = rawUrl;
  if (/^http:\/\//i.test(rawUrl) || isXtreamSource) {
    playUrl = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}`;
  }

  function makeAttempt(engine, targetUrl){
    if (engine === 'mpegts') return playMpegts(targetUrl, myGen);
    if (engine === 'dash') return playDash(targetUrl, drmKey, myGen);
    if (engine === 'shaka') return playShaka(targetUrl, drmKey, myGen);
    if (engine === 'native') return playNative(targetUrl, myGen);
    return playHls(targetUrl, null, myGen);
  }

  let primaryEngine = 'hls';
  if (/\.mpd(\?|#|$)/i.test(rawUrl)){
    // روابط mpd كلها (مو رابط معين) ما تشتغل زين مع dash.js — تروح على شاكا مباشرة دايمًا
    primaryEngine = 'shaka';
  } else if (/\.m3u8?(\?|#|$)/i.test(rawUrl)){
    primaryEngine = 'hls';
  } else if (/\.ts(\?|#|$)/i.test(rawUrl) || isXtreamSource){
    primaryEngine = 'mpegts';
  } else if (/\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i.test(rawUrl)){
    // ملف فيديو عادي (زي المباريات المسجلة) — يروح مباشرة على عنصر <video> الأصلي،
    // مو HLS.js (اللي مصمم لملفات m3u8 فقط ويعطي نتيجة غير مضمونة مع mp4 عادي)
    primaryEngine = 'native';
  }

  function raceAttempt(promiseFn, onErr, ms){
    let err = null;
    return Promise.race([
      promiseFn.then(()=>'ok').catch(e=>{ err = e; return 'fail'; }),
      timeoutAfter(ms || 10000).then(r=>{ if(!err) err = new Error('انتهت المهلة بلا رد'); return r; })
    ]).then(r=>{ if (onErr) onErr(err); return r; });
  }

  let err1 = null, err2 = null, result;

  const adminForcedVod = forcedType === 'vod';
  const adminForcedLive = forcedType === 'live';

  if (adminForcedLive){
    // فيديو محدد صراحة "بث مباشر" من الأدمن: نجرب المحرك المتوقع من امتداد الرابط أول (مباشر →
    // بروكسي → بروكسي MX)، وبعدها شاكا على طول (لأنها أقوى محرك عام يغطي mpd وm3u8 مع بعض،
    // فما فيه داعي نضيع وقت بمحركات ما تناسب امتداد الرابط أصلاً). محركات ثانية (hls/mpegts
    // مثلاً على رابط .mpd) بس تتجرب لو نوع الرابط أصلاً كان غامض (ما تحدد من الامتداد).
    const proxiedUrl = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}`;
    const proxiedUrlMx = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}&ua=mx`;
    const extensionKnown = /\.(mpd|m3u8?|ts)(\?|#|$)/i.test(rawUrl) || isXtreamSource;
    const errs = [];
    result = 'fail';

    const attempts = [
      { engine: primaryEngine, url: playUrl },
      { engine: primaryEngine, url: proxiedUrl },
      { engine: primaryEngine, url: proxiedUrlMx },
    ];

    for (const a of attempts){
      if (a === attempts[0]){ /* أول محاولة، البلاير أصلاً جاهز من resetPlayerUI اللي فوق */ }
      else{ await resetPlayerUI(); if (loadGeneration !== myGen) return; }
      result = await raceAttempt(makeAttempt(a.engine, a.url), e=>errs.push(`${a.engine}: ${e?e.message:'؟'}`), 8000);
      if (loadGeneration !== myGen) return;
      if (result === 'ok'){ primaryEngine = a.engine; break; }
    }

    if (result !== 'ok' && primaryEngine !== 'shaka'){
      await resetPlayerUI();
      if (loadGeneration !== myGen) return;
      result = await raceAttempt(playShaka(proxiedUrl, drmKey, myGen), e=>errs.push(`shaka: ${e?e.message:'؟'}`), 8000);
      if (loadGeneration !== myGen) return;
    }

    if (result !== 'ok' && !extensionKnown){
      for (const engine of ['hls','dash','mpegts'].filter(e=>e!==primaryEngine)){
        await resetPlayerUI(); if (loadGeneration !== myGen) return;
        result = await raceAttempt(makeAttempt(engine, proxiedUrl), e=>errs.push(`${engine}: ${e?e.message:'؟'}`), 8000);
        if (loadGeneration !== myGen) return;
        if (result === 'ok'){ primaryEngine = engine; break; }
      }
    }

    // ملاذ أخير: لو Cloudflare فشل بكل محاولاته (مباشر/بروكسي/UA بديل/محركات ثانية)، جرّب
    // بروكسي Supabase (بنية تحتية مختلفة، قد ما تكون محجوبة بنفس قواعد حجب IP اللي تصيب Cloudflare).
    // ما تُشغَّل إلا كملاذ نهائي بعد فشل كل شي فوق — ما تأثر على أي مصدر شغال حاليًا
    if (result !== 'ok' && !isXtreamSource){
      await resetPlayerUI(); if (loadGeneration !== myGen) return;
      const proxiedSupabase = `${XTREAM_STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}`;
      result = await raceAttempt(playShaka(proxiedSupabase, drmKey, myGen), e=>errs.push(`shaka(supabase): ${e?e.message:'؟'}`), 8000);
      if (loadGeneration !== myGen) return;
    }

    // ملاذ رابع اختياري: بروكسي VPS خاص (لو مُجهّز — راجع VPS_STREAM_PROXY فوق). فاضي افتراضيًا فما يشتغل شي هنا.
    if (result !== 'ok' && !isXtreamSource && VPS_STREAM_PROXY){
      await resetPlayerUI(); if (loadGeneration !== myGen) return;
      const proxiedVps = `${VPS_STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}`;
      result = await raceAttempt(playShaka(proxiedVps, drmKey, myGen), e=>errs.push(`shaka(vps): ${e?e.message:'؟'}`), 8000);
      if (loadGeneration !== myGen) return;
    }
    if (result !== 'ok') err1 = new Error(errs.join(' | ') || '؟');
  } else if (!isXtreamSource && primaryEngine !== 'mpegts' && !adminForcedVod){
    const proxiedUrl = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}`;
    const proxiedUrlMx = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}&ua=mx`;
    // المحاولة المباشرة (بدون بروكسي) لو راح تفشل غالبًا بسبب CORS تفشل بسرعة، لكن لو السيرفر
    // ساكت (يعلّق الاتصال بلا رد) ما نبيه يوقفنا 10 ثواني كاملة — نقطعها بعد 6 ثواني ونروح للبروكسي
    const directTimeout = playUrl.startsWith(STREAM_PROXY) || playUrl.startsWith(XTREAM_STREAM_PROXY) ? 10000 : 6000;
    result = await raceAttempt(playShaka(playUrl, drmKey, myGen), e=>err2=e, directTimeout);
    if (loadGeneration !== myGen) return;
    if (result !== 'ok' && !playUrl.startsWith(STREAM_PROXY) && !playUrl.startsWith(XTREAM_STREAM_PROXY)){
      await resetPlayerUI();
      result = await raceAttempt(playShaka(proxiedUrl, drmKey, myGen), e=>err2=e);
      if (loadGeneration !== myGen) return;
      if (result !== 'ok'){
        await resetPlayerUI();
        result = await raceAttempt(playShaka(proxiedUrlMx, drmKey, myGen), e=>err2=e);
        if (loadGeneration !== myGen) return;
      }
    }
  } else {
    // Xtream / mpegts / أو فيديو مسجل محدد صراحة من الأدمن: المحرك الصحيح (hls/dash/mpegts) مباشرة
    // ملفات mp4 عادية (تسجيلات كاملة) تحتاج مهلة أطول من البث المباشر — مصادر زي
    // Internet Archive أحيانًا تكون بطيئة بالاستجابة الأولى لملفات كبيرة، 10 ثواني قليلة
    const primaryTimeout = primaryEngine === 'native' ? 25000 : 10000;
    result = await raceAttempt(makeAttempt(primaryEngine, playUrl), e=>err1=e, primaryTimeout);
    if (loadGeneration !== myGen) return;

    if (result !== 'ok' && isXtreamSource){
      const proxiedUrlMx = `${PROXY_BASE}?url=${encodeURIComponent(rawUrl)}&ua=mx`;
      await resetPlayerUI();
      result = await raceAttempt(makeAttempt(primaryEngine, proxiedUrlMx), e=>err1=e);
      if (loadGeneration !== myGen) return;
    }

    // روابط https مباشرة (زي روابط مباريات كاملة من مواقع embed أو منصات محمية زي Shahid/Intigral)
    // أحيانًا يرفضها السيرفر المصدر لو الطلب ما جا من نفس نطاقه (حماية ضد السحب المباشر) —
    // نجرب تمريرها عبر البروكسي بدل الاتصال المباشر، وبعدها بـUA بديل لو البروكسي الافتراضي فشل
    // (بعض المنصات المحمية بشدة زي Shahid/Intigral ترفض UA الافتراضي تحديدًا)
    if (result !== 'ok' && !isXtreamSource && playUrl === rawUrl){
      const proxiedDirect = `${STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}`;
      await resetPlayerUI();
      result = await raceAttempt(makeAttempt(primaryEngine, proxiedDirect), e=>err1=e);
      if (loadGeneration !== myGen) return;

      if (result !== 'ok'){
        const proxiedDirectMx = `${STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}&ua=mx`;
        await resetPlayerUI();
        result = await raceAttempt(makeAttempt(primaryEngine, proxiedDirectMx), e=>err1=e);
        if (loadGeneration !== myGen) return;
      }

      // لو بروكسي Cloudflare فشل بكل صوره (مباشر/بروكسي/UA بديل)، نجرب بروكسي Supabase كملاذ أخير —
      // بنية تحتية مختلفة كليًا (Deno Deploy)، فبعض منصات الحماية اللي تحجب نطاق IP سحابي معيّن
      // (زي Cloudflare) قد ما تحجب هذا. هذي محاولة إضافية بس، ما تُشغَّل إلا لو كل محاولات
      // Cloudflare فوق فشلت فعلًا — فما تأثر على أي مصدر شغال حاليًا عبر Cloudflare
      if (result !== 'ok'){
        const proxiedSupabase = `${XTREAM_STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}`;
        await resetPlayerUI();
        result = await raceAttempt(makeAttempt(primaryEngine, proxiedSupabase), e=>err1=e);
        if (loadGeneration !== myGen) return;
      }

      if (result !== 'ok' && VPS_STREAM_PROXY){
        const proxiedVps = `${VPS_STREAM_PROXY}?url=${encodeURIComponent(rawUrl)}`;
        await resetPlayerUI();
        result = await raceAttempt(makeAttempt(primaryEngine, proxiedVps), e=>err1=e);
        if (loadGeneration !== myGen) return;
      }
    }
  }

  if (result !== 'ok'){
    const parts = [];
    if (err1) parts.push(`${primaryEngine}: ${err1.message}`);
    if (err2) parts.push(`shaka: ${err2.message}`);
    if (!parts.length) parts.push(`${primaryEngine}: ؟`);
    console.error('تعذر تشغيل الرابط —', parts.join(' | '));
    showPlaceholder('تعذر التشغيل، جرّب سيرفر آخر', true);
    return;
  }

  // بث مباشر: أول ما يوصل البث، الوضعية تبدأ من أقدم جزء موجود بالبَفر مو من حافة اللحظة الحالية،
  // فيبان الفيديو متجمّد على أول صورة. سابقًا كانت هذي المزامنة التلقائية تسوي قفزة مباشرة (hard seek)
  // لحافة اللحظة، وهذا يسبب توقف/تعليق مع DASH لأن النقطة المستهدفة أحيانًا ما تكون موجودة بالبَفر بعد
  // (خصوصًا بأول ثوانٍ)، فيضطر يعيد التخزين المؤقت من جديد ويعلّق — ويحتاج المستخدم يضغط زر "مباشر"
  // يدويًا عشان يستخدم وضع "اللحاق التدريجي" (تسريع السرعة بدل القفز) اللي ما يسبب هالمشكلة.
  // الحل: نخلي المزامنة التلقائية تستخدم نفس وضع اللحاق التدريجي اللي يستخدمه الزر يدويًا، تلقائيًا.
  if (currentIsLive){
    const autoSync = ()=>{ if (loadGeneration === myGen) resyncLiveEdge(true, false); };
    setTimeout(autoSync, 900);
    setTimeout(autoSync, 2200);
    setTimeout(autoSync, 4000);
    setTimeout(autoSync, 7000); // شبكة بطيئة/DASH يحتاج وقت أطول أحيانًا لين يتجمع بَفر كافي
  }
}

