/* ============== محرك تشغيل الفيديو ============== */
let hlsInst=null;
let dashInst=null;
let mpegtsInst=null;
const video = ()=>document.getElementById('mainVideo');

function playReliably(v){
  const wasMuted = v.muted;
  v.muted = true;
  const p = v.play();
  const finishUnmute = ()=>{
    if (!wasMuted){
      v.muted = false;
      isMuted = false;
      const el = document.querySelector('#btnMute svg path');
      if (el) el.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z');
    }
    // بعض المتصفحات المدمجة (سناب/انستغرام/X) توقف التشغيل بصمت بعد إزالة الكتم — تحقق وأعد المحاولة
    setTimeout(()=>{ if (v.paused){ v.play().catch(()=>{}); } }, 400);
  };
  if (p && p.then){ p.then(finishUnmute).catch(()=>{ /* المحاولة الأولى فشلت، جرّب مرة أخرى بدون تأخير */ v.play().catch(()=>{}); }); } else { finishUnmute(); }
}

let isPlayingState=false, isMuted=false, isFull=false, ctrlTimer=null, boundOnce=false;

function showPlaceholder(msg, showRetry){
  const p=document.getElementById('playerPlaceholder');
  // سلسلة loadSource() تنادي showPlaceholder('جارِ تحميل البث…') من جديد مع كل محاولة بروكسي/محرك
  // (ممكن توصل 5-7 مرات متتالية للمصدر الواحد). لو نفس رسالة السبينر لسه ظاهرة، ما نعيد كتابة
  // innerHTML — إعادة الكتابة تهدم عنصر الـ spinner وتبنيه من جديد، فحركة الدوران ترجع صفر درجة
  // كل مرة بدل ما تكمل، وتبان للمستخدم كأنها متجمدة أو تهتز
  if (!showRetry && p.dataset.mode === 'spinner' && p.dataset.msg === msg && !p.classList.contains('hide')){
    return;
  }
  p.innerHTML = showRetry
    ? `<span>${msg}</span><button onclick="retryCurrentSource()" style="margin-top:6px;padding:8px 18px;border-radius:8px;background:var(--acc);color:#fff;font-weight:700;font-size:12px;">إعادة المحاولة</button>`
    : `<div class="spinner"></div><span>${msg}</span>`;
  p.dataset.mode = showRetry ? 'retry' : 'spinner';
  p.dataset.msg = msg;
  p.classList.remove('hide');
}

let lastUrl = null;
let lastSource = null;
let loadWatchdog = null;
// نتتبع أي محرك تشغيل شغّال فعليًا حاليًا (hls/dash/shaka/mpegts) عشان حارس التجمّد يقدر يفرّق
// طول مقاطع DASH (عادة أطول من HLS) ويعطيها صبر أكبر قبل ما يحكم إنها "متجمدة" ويعيد التحميل
let currentEngine = null;
function retryCurrentSource(){ if (lastUrl) loadSource(lastUrl, lastSource); }

function isXtreamLiveUrl(url){
  if (/\/(movie|series)\//i.test(url)) return false;
  // رابط أداة البث/التسجيل الخاصة بنا (BarMi) ينتهي دايمًا بـ stream.m3u8 — ملف HLS حقيقي
  // مباشر، مو بث IPTV خام. بدون هالاستثناء، وجود كلمة "live" بمساره يخليه يُصنّف غلط كجهاز
  // IPTV، فيمر ببروكسي يتنكر بمتصفح وهمي (VLC) — ونفق Cloudflare يحجب هالتنكر ويكسر التشغيل.
  if (/\/stream\.m3u8(\?|#|$)/i.test(url)) return false;
  if (/\/live\//i.test(url)) return true;
  return /^https?:\/\/[^\/]+\/[^\/?#]+\/[^\/?#]+\/\d+(\.\w+)?(\?|#|$)/i.test(url);
}

// بعض ملفات m3u8 (زي اللي على GitHub بمشروعك) هي غلاف وهمي: مانفست HLS يحتوي مقطع واحد فقط
// بمدة "-1" (غير محددة) يشير لرابط بث اكستريم حي مستمر (TS خام بلا نهاية). هذا النمط تفهمه
// مشغلات زي VLC/ffmpeg، لكن hls.js وShaka يتعاملون معه كمقطع HLS عادي وينتظرون اكتماله —
// وبما إنه بث حي بلا نهاية، الانتظار ما يخلص أبدًا فيظهر البث "متجمد". هذي الدالة تكتشف
// هالنمط وتطلع الرابط الحقيقي جواه عشان نشغله عبر مسار اكستريم العادي (mpegts + بروكسي سوبابيس)
// بدل ما نحاول نخلي HLS/Shaka يتعاملون معه.
async function fetchTextWithTimeout(url, ms){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), ms || 6000);
  try{
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.text();
  }catch(e){
    return null;
  }finally{
    clearTimeout(t);
  }
}

async function tryUnwrapFakeXtreamPlaylist(url){
  try{
    let text = await fetchTextWithTimeout(url, 6000);
    if (!text || !/#EXTM3U/i.test(text)) return null;
    let baseUrl = url;

    // لو ماستر بلاي ليست (فيه عدة جودات) — ناخذ أول جودة نلقاها ونجيب المانفست الفرعي مالها
    if (/#EXT-X-STREAM-INF/i.test(text)){
      const lines = text.split('\n').map(l=>l.trim());
      let variantLine = null;
      for (let i=0;i<lines.length;i++){
        if (lines[i].startsWith('#EXT-X-STREAM-INF')){
          for (let j=i+1;j<lines.length;j++){
            if (lines[j] && !lines[j].startsWith('#')){ variantLine = lines[j]; break; }
          }
          if (variantLine) break;
        }
      }
      if (!variantLine) return null;
      const variantUrl = new URL(variantLine, baseUrl).toString();
      text = await fetchTextWithTimeout(variantUrl, 6000);
      if (!text) return null;
      baseUrl = variantUrl;
    }

    // الآن المفروض عندنا media playlist — نتأكد إنه مقطع وحيد بلا نهاية (النمط الوهمي)
    const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
    const segLines = lines.filter(l=>l && !l.startsWith('#'));
    const hasEndlist = /#EXT-X-ENDLIST/i.test(text);
    if (segLines.length === 1 && !hasEndlist){
      const segUrl = new URL(segLines[0], baseUrl).toString();
      if (isXtreamLiveUrl(segUrl) || /\.ts(\?|#|$)/i.test(segUrl)){
        return segUrl;
      }
    }
    return null;
  }catch(e){
    return null;
  }
}

// يقرأ ماستر بلايليست ويطلع كل الجودات المتاحة (تسمية + رابط الفرعي المطلق) — تستخدم لتعبئة
// قائمة الجودات بالواجهة، بدون ما نفك تشفير/تغليف كل جودة مسبقًا (يصير هذا فقط لما المستخدم يختارها).
async function getMasterQualityList(masterUrl){
  try{
    const text = await fetchTextWithTimeout(masterUrl, 6000);
    if (!text || !/#EXT-X-STREAM-INF/i.test(text)) return null;
    const lines = text.split('\n').map(l=>l.trim());
    const list = [];
    for (let i=0;i<lines.length;i++){
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      let variantLine = null;
      for (let j=i+1;j<lines.length;j++){
        if (lines[j] && !lines[j].startsWith('#')){ variantLine = lines[j]; break; }
      }
      if (!variantLine) continue;
      const attrs = lines[i];
      const nameMatch = attrs.match(/NAME="([^"]+)"/i);
      const resMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
      const bwMatch = attrs.match(/BANDWIDTH=(\d+)/i);
      const label = nameMatch ? nameMatch[1]
        : resMatch ? `${resMatch[2]}p`
        : bwMatch ? `${Math.round(parseInt(bwMatch[1],10)/1000)}kbps`
        : `جودة ${list.length + 1}`;
      list.push({ label, url: new URL(variantLine, masterUrl).toString() });
    }
    return list.length ? list : null;
  }catch(e){
    return null;
  }
}

const STREAM_PROXY = `https://ckriyvqnrzravknajckl.supabase.co/functions/v1/stream-proxy`;
const XTREAM_STREAM_PROXY = `https://ckriyvqnrzravknajckl.supabase.co/functions/v1/stream-proxy`;
// بروكسي VPS اختياري (ملاذ أخير ثالث) — لو سويت سيرفر VPS منفصل وشغّلت عليه server.js اللي عطيتك، حط رابطه هنا.
// خليه فاضي حاليًا (يعني هذا الفولباك ما يشتغل ولا يأثر على أي شي) لين تجهّز السيرفر فعليًا.
const VPS_STREAM_PROXY = `https://pot-participated-electronic-establish.trycloudflare.com`;

