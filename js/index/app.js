/* ============== إعداد Supabase ============== */
const SUPABASE_URL = 'https://ckriyvqnrzravknajckl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rFMfYa3nWxyxp6_zYUdtCw_znCYEKfV';
// بروكسي https لروابط IPTV/Xtream التي تكون http فقط: يحوّلها فعليًا لرابط https قابل للتشغيل هنا مباشرة
// (بدون هذا، يمنع المتصفح نفسه أي رابط http داخل صفحة https كقيد أمان لا يمكن تجاوزه بأي كود آخر)
const STREAM_PROXY = `https://milan-mini-app.ahmedtitr8.workers.dev`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============== Telegram Mini App ============== */
try{
  if (window.Telegram && window.Telegram.WebApp){
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    // نطلب فول سكرين تيليجرام على مستوى التطبيق كامل من البداية (لا فقط أثناء تشغيل الفيديو)،
    // فيعطي شكل الشريط المبسّط نفسه على كل صفحات التطبيق
    if (typeof Telegram.WebApp.requestFullscreen === 'function'){
      try{ Telegram.WebApp.requestFullscreen(); }catch(e){}
    }
    // بوضع الفول سكرين، تيليجرام يحجز مساحة علوية لعناصر التحكم الخاصة به (contentSafeAreaInset) —
    // إن لم نحترم هذي المساحة، محتوانا (الشريط العلوي لصفحتنا) يرتفع فوقها ويتصادم بصريًا معها كما لوحظ.
    // نطبّق هذي المساحة كـpadding-top على الصفحة كاملة، ونحدّثها كل ما تتغيّر (دخول/خروج فول سكرين)
    function applyTgSafeArea(){
      const c = Telegram.WebApp.contentSafeAreaInset || {};
      const s = Telegram.WebApp.safeAreaInset || {};
      const top = (c.top||0) + (s.top||0);
      document.documentElement.style.setProperty('--tg-safe-top', top + 'px');
    }
    applyTgSafeArea();
    if (typeof Telegram.WebApp.onEvent === 'function'){
      Telegram.WebApp.onEvent('contentSafeAreaChanged', applyTgSafeArea);
      Telegram.WebApp.onEvent('safeAreaChanged', applyTgSafeArea);
      Telegram.WebApp.onEvent('fullscreenChanged', applyTgSafeArea);
    }
    // شريط تيليجرام العلوي (الذي يحوي زر الإغلاق/السهم/القائمة) عنصر تحكمه تيليجرام نفسه من خارج صفحتنا
    // تمامًا (ليس جزءًا من DOM صفحتنا)، فلا يمكننا تغيير حدوده أو حجمه — أقصى ما يمكن التحكم به هو لونه،
    // فنُزامنه دائمًا مع لون النادي الحالي (var(--acc)) حتى يبدو موحّدًا مع باقي الواجهة
    // نجبر شريط تيليجرام العلوي يكون أسود صريح دائمًا (بعض جلسات تيليجرام تحتفظ بآخر لون تم ضبطه
    // من قبل، فنعيد ضبطه صراحة لأسود عند كل فتح للتطبيق حتى لا يبقى أي لون قديم عالق من قبل)
    try{ if (typeof Telegram.WebApp.setHeaderColor === 'function') Telegram.WebApp.setHeaderColor('#000000'); }catch(e){}
  }
}catch(e){}
const IS_TG = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);

/* ============== الحالة ============== */
let CLUB_NAMES = {}; // يُعبّأ ديناميكيًا من جدول clubs بدل قيم ثابتة بالكود
let state = { club:null, matches:[], finished:[], currentMatch:null, sources:[], related:[], currentTab:'live', currentSource:null, barcaHubCards:null };

/* ============== الشاشة الرئيسية: أقسام حرة (شبكة أندية/فيديو/بانر) — كل شيء من قاعدة البيانات ============== */
function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderClubBtn(c){
  const btn = document.createElement('button');
  btn.className = 'club-btn';
  btn.onclick = ()=>openClub(c.slug);
  const crestBg = `linear-gradient(135deg, ${c.accent_color||'#888'}, ${c.accent_color2||'#444'})`;
  const letter = (c.name||c.slug||'?').trim().charAt(0) || '?';
  const crestId = 'pickCrest_' + c.slug;
  btn.innerHTML = `
    <div class="club-crest" id="${crestId}" style="background:${crestBg}">${escHtml(letter)}</div>
    <div class="club-name">${escHtml(c.name||c.slug)}</div>
    <div class="club-sub">${escHtml(c.subtitle||'')}</div>`;
  if (c.logo_url){
    const img = new Image();
    img.className = 'pick-logo'; img.alt = '';
    img.onload = ()=>{ const el=document.getElementById(crestId); if(el){ el.replaceWith(img); img.id = crestId; } };
    img.onerror = ()=>{};
    img.src = c.logo_url;
  }
  return btn;
}

function renderHomeSection(sec, clubsList){
  const cfg = sec.config || {};
  if (sec.type === 'clubs_grid'){
    const wrap = document.createElement('div');
    wrap.className = 'club-row';
    let list = clubsList;
    if (Array.isArray(cfg.club_slugs) && cfg.club_slugs.length){
      list = clubsList.filter(c=>cfg.club_slugs.includes(c.slug));
    }
    list.forEach(c=>wrap.appendChild(renderClubBtn(c)));
    return list.length ? wrap : null;
  }
  if (sec.type === 'video'){
    if (!cfg.url) return null;
    const wrap = document.createElement('div');
    wrap.className = 'home-video-wrap';
    const v = document.createElement('video');
    v.src = cfg.url; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.controls = true;
    wrap.appendChild(v);
    return wrap;
  }
  if (sec.type === 'banner'){
    const hasNetwork = cfg.network_script && cfg.network_script.trim();
    if (!hasNetwork && !cfg.image_url) return null;
    const wrap = document.createElement('div');
    wrap.className = 'home-banner';
    if (hasNetwork){
      wrap.innerHTML = cfg.network_script;
      wrap.querySelectorAll('script').forEach(oldScript=>{
        const newScript = document.createElement('script');
        for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
        newScript.text = oldScript.textContent;
        oldScript.replaceWith(newScript);
      });
      return wrap;
    }
    const a = document.createElement(cfg.link_url ? 'a' : 'div');
    a.className = 'home-banner';
    if (cfg.link_url){ a.href = cfg.link_url; a.target = '_blank'; a.rel = 'noopener'; }
    const img = document.createElement('img');
    img.src = cfg.image_url; img.alt = '';
    a.appendChild(img);
    return a;
  }
  return null;
}

async function renderHome(){
  const [{ data: clubs }, { data: sections }] = await Promise.all([
    sb.from('clubs').select('*').eq('is_active', true).order('sort_order'),
    sb.from('home_sections').select('*').eq('is_active', true).order('sort_order')
  ]);
  const clubsList = clubs || [];
  clubsList.forEach(c=>{ CLUB_NAMES[c.slug] = c.name || c.slug; });
  const host = document.getElementById('homeSections');
  host.innerHTML = '';
  // احتياط: لو ما أضاف الأدمن أي قسم بعد (جدول home_sections فاضي)، نعرض شبكة كل الأندية تلقائيًا
  // حتى لا تظهر صفحة فاضية بالخطأ
  const list = (sections && sections.length) ? sections : [{ type:'clubs_grid', config:{} }];
  list.forEach(sec=>{
    const el = renderHomeSection(sec, clubsList);
    if (el) host.appendChild(el);
  });
  if (!clubsList.length){
    host.innerHTML = '<p style="color:var(--mute);font-size:13px;padding:0 20px;text-align:center;">لا توجد أندية مضافة بعد</p>';
  }
}
renderHome();

/* ============== إعدادات عامة: قناتا تيليجرام وسطر الحقوق ============== */
async function loadAppSettings(){
  try{
    const { data } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (!data) return;
    if (data.telegram_link_1){
      document.getElementById('tgBtn1').href = data.telegram_link_1;
      document.getElementById('tgLabel1').textContent = data.telegram_label_1 || 'القناة الأولى';
      document.getElementById('tgBtn1').classList.remove('hide');
    }
    if (data.telegram_link_2){
      document.getElementById('tgBtn2').href = data.telegram_link_2;
      document.getElementById('tgLabel2').textContent = data.telegram_label_2 || 'القناة الثانية';
      document.getElementById('tgBtn2').classList.remove('hide');
    }
    if (data.rights_text){
      document.getElementById('rightsLine').textContent = data.rights_text;
      document.getElementById('rightsLine').classList.remove('hide');
    }
    if (data.ticker_text){
      document.getElementById('tickerText').textContent = data.ticker_text;
    }
  }catch(e){}
}
loadAppSettings();
/* ============== فتح صفحة النادي: تنقّل حقيقي لصفحة player.html المستقلة (وليس iframe) ============== */
function openClub(club){
  location.href = 'player.html?club=' + club;
}

