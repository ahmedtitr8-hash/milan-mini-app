const SUPABASE_URL = 'https://ckriyvqnrzravknajckl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rFMfYa3nWxyxp6_zYUdtCw_znCYEKfV';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

async function afterLogin(){
  document.getElementById('gate').style.display='none';
  await loadClubsCache();
  renderClubGate();
  const saved = sessionStorage.getItem('zoneClub');
  if (saved && clubsCache.some(c=>c.slug===saved)) {
    enterClub(saved);
  } else {
    sessionStorage.removeItem('zoneClub');
    document.getElementById('clubGate').style.display='flex';
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
  sessionStorage.removeItem('zoneClub');
  document.getElementById('panel').style.display='none';
  document.getElementById('clubGate').style.display='none';
  document.getElementById('gate').style.display='flex';
}

// إذا كان هناك جلسة محفوظة من قبل (تسجيل الدخول يبقى فعّالاً بين الزيارات)
(async function initAuth(){
  const { data } = await sb.auth.getSession();
  if (data && data.session){ afterLogin(); }
})();

