/* ===== بانر إعلاني ثابت أسفل الشاشة (Sticky Bottom Banner) =====
   يظهر فوق كامل الصفحة في index.html (شاشة اختيار النادي) وplayer.html
   (حول المشغل، مو جوه الفيديو نفسه) — يُدار بالكامل من لوحة الأدمن عبر
   app_settings. لو banner_ad_enabled = false أو ما فيه صورة/كود، ما يظهر شي.

   منطق زر الإغلاق (✕): البانر ما يختفي نهائيًا أبدًا. لما يضغط المستخدم
   ✕ (وهذا فعل حقيقي منه، مو تايمر تلقائي)، نطلب إعلانًا جديدًا فورًا
   ونعرضه بمكان نفس البانر — هذا يسمى "User-Initiated Refresh" ومسموح به
   عند كل شبكات الإعلانات (حتى AdSense نفسها)، على عكس التحديث التلقائي
   بفاصل زمني ثابت (Time-Based Auto Refresh) وهذا ممنوع ويُحسب احتيال.
   يعتمد على وجود متغيّر عام اسمه sb (عميل Supabase) قبل تحميل هذا الملف. */

(function(){
  var lastData = null; // آخر إعدادات وصلت من قاعدة البيانات، نعيد استخدامها عند كل إغلاق

  /* innerHTML العادي ما يشغّل وسوم <script> جواه — هذي الدالة تعيد بناءها
     يدويًا عشان أكواد شبكات الإعلانات تشتغل فعليًا (نفس أسلوب 11-ads.js) */
  function injectHtmlWithScripts(container, htmlString){
    container.innerHTML = htmlString;
    container.querySelectorAll('script').forEach(oldScript=>{
      const newScript = document.createElement('script');
      for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
      newScript.text = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  }

  // يملأ حاوية الإعلان (media) بمحتوى جديد بناءً على آخر إعدادات معروفة.
  // نفس الدالة تُستخدم أول مرة وبعد كل ضغطة إغلاق (طلب إعلان جديد فعلي).
  function renderAdInto(media, data){
    const hasNetwork = data.banner_ad_network_script && data.banner_ad_network_script.trim();
    if (hasNetwork){
      injectHtmlWithScripts(media, data.banner_ad_network_script);
    } else {
      media.innerHTML = '';
      const link = data.banner_ad_click_url ? document.createElement('a') : document.createElement('div');
      if (data.banner_ad_click_url){
        link.href = data.banner_ad_click_url;
        link.target = '_blank';
        link.rel = 'noopener';
      }
      const img = document.createElement('img');
      img.src = data.banner_ad_image_url;
      img.alt = 'إعلان';
      link.appendChild(img);
      media.appendChild(link);
    }
  }

  function buildBanner(data){
    const hasNetwork = data.banner_ad_network_script && data.banner_ad_network_script.trim();
    const hasImage = data.banner_ad_image_url && data.banner_ad_image_url.trim();
    if (!data.banner_ad_enabled || (!hasNetwork && !hasImage)) return;
    lastData = data;

    const wrap = document.createElement('div');
    wrap.id = 'bottomBannerAd';

    const media = document.createElement('div');
    media.id = 'bottomBannerMedia';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'bottomBannerClose';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'تحديث الإعلان');
    closeBtn.textContent = '\u2715';
    // ضغطة المستخدم = فعل حقيقي، فنطلب إعلانًا جديدًا بدل ما نخفي البانر
    closeBtn.onclick = ()=> renderAdInto(media, lastData);

    renderAdInto(media, data);

    wrap.appendChild(media);
    wrap.appendChild(closeBtn);
    document.body.appendChild(wrap);
    document.body.classList.add('has-bottom-banner');
  }

  async function loadBottomBannerAd(){
    try{
      const { data } = await sb.from('app_settings')
        .select('banner_ad_enabled,banner_ad_image_url,banner_ad_click_url,banner_ad_network_script')
        .eq('id', 1).single();
      if (data) buildBanner(data);
    }catch(e){
      console.error('loadBottomBannerAd error:', e);
    }
  }

  loadBottomBannerAd();
})();
