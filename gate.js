/* ============================================================
   بوابة الاشتراك الإجباري بقناة النادي على تيليجرام
   - كل نادي له قناته الخاصة (محفوظة بجدول clubs.telegram_channel_id)
   - تاخذ id المستخدم تلقائيًا من initData (موقّعة، ما تنزور)
   - تتحقق من الاشتراك عبر Edge Function (check-subscription)
   - لو مب مشترك: تقفل الشاشة كاملة وتفحص كل 4 ثواني تلقائيًا
     بدون أي تحديث للصفحة، وتفتح على طول أول ما ينضم
   - فيه زر "تحقق الآن" يدوي احتياطي لو الفحص التلقائي تأخر أو فشل
   ============================================================ */
(function(){
  'use strict';

  const CHECK_URL = 'https://ckriyvqnrzravknajckl.supabase.co/functions/v1/check-subscription';
  const CACHE_MS  = 5 * 60 * 1000; // كاش 5 دقايق داخل نفس الجلسة لنفس النادي
  const POLL_MS   = 4000;

  // اسم النادي من رابط الصفحة (player.html?club=milan)
  const CLUB = new URL(location.href).searchParams.get('club') || '';
  const CACHE_KEY = 'subGateOkAt:' + CLUB;

  let pollTimer = null;

  function injectStyle(){
    if (document.getElementById('subGateStyle')) return;
    const st = document.createElement('style');
    st.id = 'subGateStyle';
    st.textContent = `
    #subGate{position:fixed;inset:0;z-index:999999;background:#070707;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:16px;padding:30px;text-align:center;
      font-family:'Cairo',sans-serif;color:#F2F2F2;}
    #subGate .g-icon{width:70px;height:70px;border-radius:50%;background:#141414;border:1px solid #262626;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    #subGate .g-icon svg{width:32px;height:32px;fill:#2AABEE;}
    #subGate h2{font-size:17px;font-weight:800;max-width:280px;line-height:1.6;margin:0;}
    #subGate .g-join{display:flex;align-items:center;gap:8px;padding:13px 28px;border-radius:12px;
      background:#2AABEE;color:#fff;text-decoration:none;font-size:14px;font-weight:800;margin-top:10px;}
    #subGate .g-status{font-size:12px;color:#7a7a7a;display:flex;align-items:center;gap:7px;margin-top:2px;}
    #subGate .g-spin{width:13px;height:13px;border-radius:50%;border:2px solid #2a2a2a;border-top-color:#2AABEE;
      animation:gSpin .7s linear infinite;flex-shrink:0;}
    @keyframes gSpin{to{transform:rotate(360deg)}}
    #subGate .g-manual{margin-top:4px;font-size:12.5px;color:#2AABEE;font-weight:700;background:none;border:none;
      text-decoration:underline;padding:4px;}
    #subGate .g-manual:disabled{opacity:.5;text-decoration:none;}
    `;
    document.head.appendChild(st);
  }

  function showGate(link){
    injectStyle();
    if (document.getElementById('subGate')) return;
    document.documentElement.style.overflow = 'hidden';
    const gate = document.createElement('div');
    gate.id = 'subGate';
    gate.innerHTML =
      '<div class="g-icon"><svg viewBox="0 0 24 24"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3l-4.2-1.31c-.9-.28-.91-.9.2-1.34L19.5 4.16c.75-.33 1.47.18 1.19 1.34l-2.99 14.08c-.21.99-.8 1.23-1.62.76l-4.48-3.3-2.16 2.08c-.24.24-.44.44-.9.44z"/></svg></div>' +
      '<h2>لازم تشترك بقناة النادي عشان تدخل</h2>' +
      '<a class="g-join" href="' + (link || 'https://t.me/') + '" target="_blank" rel="noopener">اشترك بالقناة الآن</a>' +
      '<div class="g-status"><span class="g-spin" id="subGateSpin"></span><span id="subGateStatusText">نتحقق من اشتراكك تلقائيًا...</span></div>' +
      '<button class="g-manual" id="subGateManualBtn">اشتركت؟ اضغط هنا للتحقق الآن</button>';
    document.body.appendChild(gate);

    const manualBtn = document.getElementById('subGateManualBtn');
    manualBtn.addEventListener('click', async ()=>{
      manualBtn.disabled = true;
      const statusText = document.getElementById('subGateStatusText');
      if (statusText) statusText.textContent = 'جاري التحقق...';
      const r = await checkSub();
      if (r.subscribed){
        sessionStorage.setItem(CACHE_KEY, String(Date.now()));
        hideGate();
        return;
      }
      if (statusText) statusText.textContent = 'نتحقق من اشتراكك تلقائيًا...';
      manualBtn.disabled = false;
    });
  }

  function hideGate(){
    const gate = document.getElementById('subGate');
    if (gate) gate.remove();
    document.documentElement.style.overflow = '';
    if (pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  }

  async function checkSub(){
    try{
      const initData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';
      if (!initData) return { ok:false, subscribed:false, noTg:true };
      const res = await fetch(CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, club: CLUB })
      });
      return await res.json();
    }catch(e){
      return { ok:false, subscribed:false, netErr:true };
    }
  }

  async function runGate(){
    if (!CLUB) return; // بدون اسم نادي بالرابط ما نقدر نعرف أي قناة نتحقق منها

    const cachedAt = sessionStorage.getItem(CACHE_KEY);
    if (cachedAt && (Date.now() - parseInt(cachedAt, 10)) < CACHE_MS) return;

    const result = await checkSub();

    // مفتوح من متصفح عادي مو من داخل تيليجرام: ما فيه initData نتحقق منه، نتركه يمر
    if (result.noTg) return;

    if (result.subscribed){
      sessionStorage.setItem(CACHE_KEY, String(Date.now()));
      hideGate();
      return;
    }

    // خطأ شبكة مؤقت: ما نقفل الشاشة على المستخدم بالخطأ، بس نعيد المحاولة بصمت
    if (result.netErr) return;

    showGate(result.channelLink);
    if (!pollTimer){
      pollTimer = setInterval(async ()=>{
        const r2 = await checkSub();
        if (r2.subscribed){
          sessionStorage.setItem(CACHE_KEY, String(Date.now()));
          hideGate();
        }
      }, POLL_MS);
    }
  }

  if (document.body) runGate();
  else document.addEventListener('DOMContentLoaded', runGate);
})();
