/* ===== إعلان ما قبل التشغيل (Pre-roll) =====
   يظهر مرة وحدة عند فتح مباراة لأول مرة (مو عند تبديل سيرفر/جودة)، قبل تحميل
   البث الفعلي، لمدة محدودة (10-20 ثانية) يحددها الأدمن. لو ad_enabled = false
   أو ما فيه رابط صورة/فيديو، ما يظهر شي وتحميل البث يبدأ فورًا زي المعتاد. */

let adSettings = null;

async function loadAdSettings(){
  try{
    const { data } = await sb.from('app_settings')
      .select('ad_enabled,ad_image_url,ad_video_url,ad_click_url,ad_duration_seconds,ad_skip_after_seconds,ad_network_script')
      .eq('id', 1).single();
    adSettings = data || null;
  }catch(e){
    console.error('loadAdSettings error:', e);
    adSettings = null;
  }
}

/* innerHTML العادي ما يشغّل وسوم <script> جواه — هذي الدالة تعيد بناءها يدويًا عشان
   أكواد شبكات الإعلانات (اللي غالبًا عبارة عن <script> أو <ins>+<script>) تشتغل فعليًا */
function injectHtmlWithScripts(container, htmlString){
  container.innerHTML = htmlString;
  const oldScripts = container.querySelectorAll('script');
  oldScripts.forEach(oldScript=>{
    const newScript = document.createElement('script');
    for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
    newScript.text = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
}

function showPreRollAd(){
  return new Promise(resolve => {
    const hasNetworkAd = adSettings && adSettings.ad_network_script && adSettings.ad_network_script.trim();
    const hasDirectMedia = adSettings && (adSettings.ad_video_url || adSettings.ad_image_url);
    if (!adSettings || !adSettings.ad_enabled || (!hasNetworkAd && !hasDirectMedia)){ resolve(); return; }

    const overlay = document.getElementById('adOverlay');
    const mediaWrap = document.getElementById('adMedia');
    const countEl = document.getElementById('adCountdown');
    const skipBtn = document.getElementById('adSkipBtn');
    if (!overlay || !mediaWrap || !countEl || !skipBtn){ resolve(); return; }

    const duration = Math.min(20, Math.max(10, parseInt(adSettings.ad_duration_seconds, 10) || 15));
    const skipAfter = Math.max(0, Math.min(duration, parseInt(adSettings.ad_skip_after_seconds, 10) || 0));

    mediaWrap.innerHTML = '';
    let mediaEl = null;

    if (hasNetworkAd){
      // كود شبكة إعلانات خارجية (HTML/JS) — يُعرض كما هو، العداد والتخطي يبقى من عندنا
      injectHtmlWithScripts(mediaWrap, adSettings.ad_network_script);
    } else if (adSettings.ad_video_url){
      mediaEl = document.createElement('video');
      mediaEl.src = adSettings.ad_video_url;
      mediaEl.autoplay = true; mediaEl.muted = true; mediaEl.loop = true;
      mediaEl.playsInline = true; mediaEl.setAttribute('webkit-playsinline', '');
      mediaWrap.appendChild(mediaEl);
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = adSettings.ad_image_url;
      mediaEl.alt = 'إعلان';
      mediaWrap.appendChild(mediaEl);
    }
    if (mediaEl && adSettings.ad_click_url){
      mediaEl.style.cursor = 'pointer';
      mediaEl.onclick = ()=>{ try{ window.open(adSettings.ad_click_url, '_blank'); }catch(e){} };
    }

    skipBtn.classList.add('hide');
    overlay.classList.remove('hide');

    let remaining = duration;
    let finished = false;
    let timer = null;

    function renderCount(){
      countEl.textContent = `إعلان — ${remaining} ث`;
    }
    renderCount();

    function finish(){
      if (finished) return;
      finished = true;
      clearInterval(timer);
      overlay.classList.add('hide');
      try{ if (mediaEl.pause) mediaEl.pause(); }catch(e){}
      mediaWrap.innerHTML = '';
      skipBtn.onclick = null;
      resolve();
    }

    if (skipAfter > 0){
      skipBtn.onclick = (e)=>{ e.stopPropagation(); finish(); };
    }

    timer = setInterval(()=>{
      remaining--;
      if (remaining <= 0){ finish(); return; }
      renderCount();
      if (skipAfter > 0 && (duration - remaining) >= skipAfter){
        skipBtn.classList.remove('hide');
      }
    }, 1000);
  });
}
