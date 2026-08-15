const SUPABASE_URL = 'https://ckriyvqnrzravknajckl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rFMfYa3nWxyxp6_zYUdtCw_znCYEKfV';
// نص صراحة على إعدادات حفظ الجلسة بدل الاعتماد على قيم افتراضية بالمكتبة — رابط الـ CDN
// بصفحة admin.html غير مثبّت على نسخة فرعية محددة (@2 بس)، فأي تحديث تلقائي بالمكتبة
// نظريًا ممكن يغيّر سلوك افتراضي. هذا يضمن إن الجلسة تُخزَّن بـ localStorage (يبقى بين
// الزيارات) وتتجدد تلقائيًا قبل ما تنتهي، بغض النظر عن أي تحديث مستقبلي بالمكتبة
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

let CLUB_NAMES = {}; // يُعبّأ ديناميكيًا من جدول clubs بدل قيم ثابتة بالكود
let clubsCache = [];
let currentClub = null;
let matches = [];
let editingId = null;
let sourceRows = []; // {tab,label,url,sort_order}

function escHtmlAdmin(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function toast(msg, err){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (err?' err':'');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ===== الدخول عبر Supabase Auth ===== */
async function checkGate(){
  const email = document.getElementById('gateEmail').value.trim();
  const password = document.getElementById('gateInput').value;
  document.getElementById('gateMsg').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error){
    document.getElementById('gateMsg').textContent = 'بيانات الدخول غير صحيحة';
    return;
  }
  afterLogin();
}
document.getElementById('gateInput').addEventListener('keydown', e=>{ if(e.key==='Enter') checkGate(); });

/* أي طلب شبكة هنا ممكن نظريًا يعلّق بلا رد أبدًا أو يفشل فجأة (شبكة متقطعة) —
   هذا الغلاف يضمن رد دائمًا (نجاح أو مهلة منتهية) خلال مدة معقولة، بدل ما يتعلّق للأبد */
function withTimeoutAdmin(promise, ms){
  return Promise.race([
    promise,
    new Promise((_,rej)=> setTimeout(()=>rej(new Error('انتهت المهلة بلا رد')), ms || 15000))
  ]);
}

async function afterLogin(){
  document.getElementById('gate').style.display='none';
  try{
    // محاولة تلقائية صامتة ثانية قبل ما نستسلم — شبكة بعض المتصفحات المدمجة (زي أدوات
    // تحويل الموقع لتطبيق) أحيانًا تحتاج محاولة زيادة بس عشان تنجح، مو خلل حقيقي
    let clubsLoaded = false, lastErr = null;
    for (let attempt = 0; attempt < 2 && !clubsLoaded; attempt++){
      try{
        if (attempt > 0) await new Promise(r=>setTimeout(r, 1200));
        await withTimeoutAdmin(loadClubsCache());
        clubsLoaded = true;
      }catch(e){ lastErr = e; }
    }
    if (!clubsLoaded) throw lastErr;

    renderClubGate();
    const saved = localStorage.getItem('zoneClub');
    if (saved && clubsCache.some(c=>c.slug===saved)) {
      enterClub(saved);
    } else {
      localStorage.removeItem('zoneClub');
      document.getElementById('clubGate').style.display='flex';
    }
  }catch(e){
    // مهم: وصولنا هنا معناه تسجيل الدخول نفسه نجح فعلاً (الجلسة سليمة) — الفشل خاص بس
    // بتحميل قائمة الأندية (شبكة بطيئة/متقطعة). سابقًا كنا نرجّع المستخدم لشاشة تسجيل
    // الدخول بالكامل هنا، فيضطر يكتب الإيميل وكلمة المرور من جديد رغم إن جلسته أصلاً شغالة
    // — بدلها نعرض زر "إعادة المحاولة" داخل شاشة اختيار النادي نفسها، يعيد تحميل قائمة
    // الأندية فقط، بدون ما يلمس تسجيل الدخول أو يطلب بياناته مرة ثانية
    console.error('afterLogin error:', e);
    document.getElementById('clubGate').style.display='flex';
    document.getElementById('clubPickRow').innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:30px 14px;color:var(--mute);">
        <p style="margin-bottom:14px;font-size:13px;">تعذر تحميل قائمة الأندية — تحقق من الاتصال وحاول مرة أخرى</p>
        <button class="btn" onclick="afterLogin()">إعادة المحاولة</button>
      </div>`;
  }
}
function toggleTopMenu(){
  document.getElementById('topMenuList').classList.toggle('on');
}
function closeTopMenu(){
  document.getElementById('topMenuList').classList.remove('on');
}
document.addEventListener('click', (e)=>{
  const menu = document.getElementById('topMenuList');
  const wrap = document.querySelector('.top-menu');
  if (menu && menu.classList.contains('on') && wrap && !wrap.contains(e.target)) closeTopMenu();
});
async function doLogout(){
  await sb.auth.signOut();
  localStorage.removeItem('zoneClub');
  document.getElementById('panel').style.display='none';
  document.getElementById('clubGate').style.display='none';
  document.getElementById('gate').style.display='flex';
}

// إذا كان هناك جلسة محفوظة من قبل (تسجيل الدخول يبقى فعّالاً بين الزيارات)
(async function initAuth(){
  try{
    const { data } = await sb.auth.getSession();
    if (data && data.session){ afterLogin(); }
  }catch(e){
    console.error('initAuth error:', e);
    // نسيب شاشة الدخول ظاهرة كما هي افتراضيًا (ما لمسناها أصلاً بهالحالة) — أفضل من شاشة سوداء
  }
})();

