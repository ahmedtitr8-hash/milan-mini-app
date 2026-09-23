/* ===== إعلان جانبي دوري أثناء التشغيل (Side Ad) =====
   يختلف عن إعلان ما قبل التشغيل (11-ads.js): هذا يظهر بشكل دوري أثناء المشاهدة
   نفسها، كل side_ad_interval_seconds، ويستمر side_ad_duration_seconds ثم يختفي —
   بدون ما يوقف أو يعيد تحميل البث إطلاقًا (الفيديو يفضل يشتغل بالخلفية طول الوقت).

   ⚠️ #playerWrap نفسه (حجمه، عرضه، حدوده، ووضع الفول سكرين) لا يتغيّر أبدًا — لا
   نلمسه ولا كلاس .fs الخاص فيه بأي شكل. اللي يتغيّر فعليًا هو بس المساحة الداخلية:
   إضافة كلاس side-ad-active على #playerWrap تخلي #videoStage (يلف الفيديو وكل
   عناصر التحكم) يضيق من جهة وحدة بانتقال CSS سلس، و#sideAdBox يظهر بالمساحة اللي
   تحررت — الاثنين جوه نفس حدود #playerWrap تمامًا، بلا أي تغيير بحجم المشغل نفسه
   وبلا أي تأثير على أنميشن الفول سكرين (يبقى زي ما كان تمامًا). يشتغل بالوضع
   العادي وبالفول سكرين على حد سواء، لأن #videoStage/#sideAdBox نسبيّان لصندوق
   #playerWrap الحالي أيًا كان وضعه.

   ⚠️ التوقيت عالمي موحّد، مو لكل مستخدم لحاله: العدّاد يبدأ من لحظة إضافة/حفظ رابط
   السيرفر بلوحة الأدمن (عمود created_at بجدول match_sources)، بغض النظر تمامًا عن
   وجود مشاهدين من عدمه، وبغض النظر متى فتح كل مستخدم الصفحة. يعني لو الفاصل 20 دقيقة،
   الإعلان يطلع لجميع المشاهدين بنفس اللحظات بالضبط (00:20، 00:40، 01:00...) حسب وقت
   إضافة السيرفر — مو 20 دقيقة من وقت فتح كل شخص للصفحة. فلو مستخدم فتح الصفحة بالمنتصف
   بالضبط وقت نافذة إعلان شغّالة عالميًا، يشوفه فورًا لباقي مدته المتبقية فقط، ولو فتحها
   بمنتصف الفترة الهادئة، ينتظر لين الموعد العالمي التالي بالضبط زي البقية. */

let sideAdSettings = null;
let sideAdShowTimeoutId = null;
let sideAdHideTimeoutId = null;
let sideAdTickTimeoutId = null;

async function loadSideAdSettings(){
  try{
    const { data } = await sb.from('app_settings')
      .select('side_ad_enabled,side_ad_interval_seconds,side_ad_duration_seconds,side_ad_image_url,side_ad_click_url,side_ad_network_script')
      .eq('id', 1).single();
    sideAdSettings = data || null;
  }catch(e){
    console.error('loadSideAdSettings error:', e);
    sideAdSettings = null;
  }
}
loadSideAdSettings();

function stopSideAdCycle(){
  if (sideAdShowTimeoutId){ clearTimeout(sideAdShowTimeoutId); sideAdShowTimeoutId = null; }
  if (sideAdHideTimeoutId){ clearTimeout(sideAdHideTimeoutId); sideAdHideTimeoutId = null; }
  if (sideAdTickTimeoutId){ clearTimeout(sideAdTickTimeoutId); sideAdTickTimeoutId = null; }
  const stage = document.getElementById('playerWrap');
  if (stage) stage.classList.remove('side-ad-active');
}

function renderSideAdContent(){
  const media = document.getElementById('sideAdMedia');
  if (!media || !sideAdSettings) return false;
  const hasNetwork = sideAdSettings.side_ad_network_script && sideAdSettings.side_ad_network_script.trim();
  const hasImage = sideAdSettings.side_ad_image_url && sideAdSettings.side_ad_image_url.trim();
  if (!hasNetwork && !hasImage) return false;

  media.innerHTML = '';
  if (hasNetwork){
    injectHtmlWithScripts(media, sideAdSettings.side_ad_network_script); // دالة مشتركة من 11-ads.js
  } else {
    const link = sideAdSettings.side_ad_click_url ? document.createElement('a') : document.createElement('div');
    if (sideAdSettings.side_ad_click_url){
      link.href = sideAdSettings.side_ad_click_url;
      link.target = '_blank';
      link.rel = 'noopener';
    }
    const img = document.createElement('img');
    img.src = sideAdSettings.side_ad_image_url;
    img.alt = 'إعلان';
    link.appendChild(img);
    media.appendChild(link);
  }
  return true;
}

function hideSideAdNow(){
  const stage = document.getElementById('playerWrap');
  if (stage) stage.classList.remove('side-ad-active');
  if (sideAdHideTimeoutId){ clearTimeout(sideAdHideTimeoutId); sideAdHideTimeoutId = null; }
}

function showSideAdFor(remainingMs){
  const stage = document.getElementById('playerWrap');
  if (!stage) return;
  if (!renderSideAdContent()) return;
  stage.classList.add('side-ad-active');
  const closeBtn = document.getElementById('sideAdClose');
  if (closeBtn) closeBtn.onclick = hideSideAdNow;
  if (sideAdHideTimeoutId) clearTimeout(sideAdHideTimeoutId);
  sideAdHideTimeoutId = setTimeout(()=>{ sideAdHideTimeoutId = null; hideSideAdNow(); }, remainingMs);
}

// يُنادى من loadTabSources() كل ما يتحمّل سيرفر/مصدر جديد. sourceCreatedAt = التوقيت
// اللي انحفظ فيه رابط هذا السيرفر بلوحة الأدمن (source.created_at من قاعدة البيانات) —
// هذا هو مرجع "الصفر" لجدول المواعيد العالمي، مو وقت فتح المستخدم للصفحة.
async function startSideAdCycle(sourceCreatedAt){
  stopSideAdCycle();
  if (!sideAdSettings) await loadSideAdSettings();
  if (!sideAdSettings || !sideAdSettings.side_ad_enabled) return;
  if (!sourceCreatedAt) return;

  const interval = Math.max(60, parseInt(sideAdSettings.side_ad_interval_seconds, 10) || 1200);
  const duration = Math.max(1, parseInt(sideAdSettings.side_ad_duration_seconds, 10) || 20);
  const createdAtMs = new Date(sourceCreatedAt).getTime();
  if (isNaN(createdAtMs)) return;

  function scheduleNextTick(){
    const elapsedSec = Math.max(0, (Date.now() - createdAtMs) / 1000);
    const cyclePos = elapsedSec % interval; // مكاننا داخل الدورة الحالية (0..interval)
    const msUntilNextBoundary = (interval - cyclePos) * 1000;

    // لو إحنا أصلًا داخل نافذة إعلان شغّالة عالميًا هالحين (شخص فتح الصفحة بمنتصفها)،
    // نعرضها فورًا لباقي مدتها المتبقية بس — مو من الصفر
    if (cyclePos < duration){
      showSideAdFor((duration - cyclePos) * 1000);
    }

    sideAdTickTimeoutId = setTimeout(()=>{
      showSideAdFor(duration * 1000);
      scheduleNextTick();
    }, msUntilNextBoundary);
  }

  scheduleNextTick();
}
