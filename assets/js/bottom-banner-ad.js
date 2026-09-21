/* ===== بانر إعلاني ثابت أسفل الشاشة (Sticky Bottom Banner) =====
   يظهر فوق كامل الصفحة في index.html (شاشة اختيار النادي) وplayer.html
   (حول المشغل، مو جوه الفيديو نفسه) — يُدار بالكامل من لوحة الأدمن عبر
   app_settings. لو banner_ad_enabled = false أو ما فيه صورة/كود، ما يظهر شي.
   زر الإغلاق (✕) يخفيه لبقية الجلسة فقط (sessionStorage) — يرجع يظهر
   بفتح جديد للتطبيق أو تحديث الصفحة.
   يعتمد على وجود متغيّر عام اسمه sb (عميل Supabase) قبل تحميل هذا الملف. */

(function(){
  if (sessionStorage.getItem('bottomBannerDismissed') === '1') return;

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

  function dismissBanner(wrap){
    wrap.remove();
    document.body.classList.remove('has-bottom-banner');
    try{ sessionStorage.setItem('bottomBannerDismissed', '1'); }catch(e){}
  }

  function buildBanner(data){
    const hasNetwork = data.banner_ad_network_script && data.banner_ad_network_script.trim();
    const hasImage = data.banner_ad_image_url && data.banner_ad_image_url.trim();
    if (!data.banner_ad_enabled || (!hasNetwork && !hasImage)) return;

    const wrap = document.createElement('div');
    wrap.id = 'bottomBannerAd';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'bottomBannerClose';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'إغلاق الإعلان');
    closeBtn.textContent = '\u2715';
    closeBtn.onclick = ()=> dismissBanner(wrap);

    const media = document.createElement('div');
    media.id = 'bottomBannerMedia';

    if (hasNetwork){
      injectHtmlWithScripts(media, data.banner_ad_network_script);
    } else {
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
