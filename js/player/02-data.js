/* ===== نبضة حياة المشاهد (تغذي لوحة إحصائيات المشاهدين بالأدمن) ===== */
function getHeartbeatSessionId(){
  try{
    const tgId = window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user && Telegram.WebApp.initDataUnsafe.user.id;
    if (tgId) return 'tg_' + tgId;
  }catch(e){}
  try{
    let sid = localStorage.getItem('zoneViewerSessionId');
    if (!sid){ sid = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('zoneViewerSessionId', sid); }
    return sid;
  }catch(e){ return 'anon_' + Date.now().toString(36); }
}
const HEARTBEAT_SESSION_ID = getHeartbeatSessionId();
function getHeartbeatUsername(){
  try{ return Telegram.WebApp.initDataUnsafe.user.username || null; }catch(e){ return null; }
}
// جلسة مشاهدة متواصلة: تتجدد من جديد كل ما فُتحت صفحة المشغل (لا تُحفظ بالجهاز) — تُستخدم
// لحساب "كم مستخدم استمر بالمشاهدة 30/60/90/120 دقيقة متواصلة" ووقت الذروة بلوحة الأدمن
const WATCH_SESSION_ID = 'ws_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
const WATCH_SESSION_STARTED_MS = Date.now();

async function sendHeartbeat(){
  try{
    const m = state.currentMatch;
    const matchLabel = m ? (m.title || [m.home_team, m.away_team].filter(Boolean).join(' × ')) : null;
    const durationSeconds = Math.max(0, Math.round((Date.now() - WATCH_SESSION_STARTED_MS)/1000));

    // الكتابة تمر عبر دالتين محميتين (RPC) بدل الإدخال المباشر بالجدول —
    // انظر الملاحظة بملف schema.sql (2026-08-13) لسبب هذا التغيير
    const { error } = await sb.rpc('record_heartbeat', {
      p_session_id: HEARTBEAT_SESSION_ID,
      p_tg_username: getHeartbeatUsername(),
      p_club: state.club || null,
      p_match_id: m ? m.id : null,
      p_match_label: matchLabel,
      p_source_label: (state.currentSource && state.currentSource.label) || null
    });
    if (error) console.error('heartbeat error:', error.message || error);

    const { error: sErr } = await sb.rpc('record_watch_session', {
      p_watch_session_id: WATCH_SESSION_ID,
      p_session_id: HEARTBEAT_SESSION_ID,
      p_tg_username: getHeartbeatUsername(),
      p_club: state.club || null,
      p_match_id: m ? m.id : null,
      p_match_label: matchLabel,
      p_source_label: (state.currentSource && state.currentSource.label) || null,
      p_duration_seconds: durationSeconds
    });
    if (sErr) console.error('viewer_sessions error:', sErr.message || sErr);
  }catch(e){ console.error('heartbeat error:', e); }
}
let heartbeatTimer = null;
function startHeartbeat(){
  sendHeartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, 25000); // كل 25 ثانية، يطابق افتراض لوحة الأدمن (نشِط = آخر نبضة خلال دقيقتين)
}

async function loadTicker(){
  try{
    const { data } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (data && data.ticker_text) document.getElementById('tickerText').textContent = data.ticker_text;
  }catch(e){}
}
loadTicker();
loadAdSettings();

/* أي طلب شبكة بسلسلة تحميل النادي/المباراة ممكن نظريًا يعلّق بلا رد أبدًا (لا نجاح ولا خطأ) —
   هذا الغلاف يضمن إنه دايمًا يرجع رد (نجاح أو مهلة منتهية) خلال مدة معقولة */
function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_,rej)=> setTimeout(()=>rej(new Error('انتهت المهلة بلا رد')), ms || 15000))
  ]);
}

async function openClub(club){
  try{
    state.club = club;
    document.body.setAttribute('data-club', club);
    await loadClubInfo(club);
    await renderBarcaHub();
  }catch(e){
    console.error('openClub error:', e);
    document.getElementById('playerTitle').textContent = CLUB_NAMES[club] || '';
    const p = document.getElementById('playerPlaceholder');
    p.innerHTML = `<span>تعذر تحميل بيانات النادي — تحقق من الاتصال</span>
      <button onclick="location.reload()" style="margin-top:6px;padding:8px 18px;border-radius:8px;background:var(--acc);color:#fff;font-weight:700;font-size:12px;">إعادة المحاولة</button>`;
    p.classList.remove('hide');
  }
}

async function renderBarcaHub(){
  const club = state.club;
  state.barcaHubCards = null;
  document.getElementById('playerTitle').textContent = CLUB_NAMES[club] || '';
  await resetPlayerUI();
  document.getElementById('belowPlayer').innerHTML = '';
  const { data } = await withTimeout(sb.from('matches').select('*').eq('club', club));
  const now = Date.now();
  const matches = (data || []).filter(m => !m.publish_at || new Date(m.publish_at).getTime() <= now);
  if (!matches.length){
    showPlaceholder('لا توجد مباريات مضافة حالياً', false);
    return;
  }
  const live = matches.filter(m=>m.status==='live');
  const upcoming = matches.filter(m=>m.status==='upcoming')
    .sort((a,b)=> new Date(a.kickoff_at||0) - new Date(b.kickoff_at||0));
  const finished = matches.filter(m=>m.status==='finished')
    .sort((a,b)=> new Date(b.kickoff_at||0) - new Date(a.kickoff_at||0));
  const cards = [...live, ...upcoming, ...finished];
  state.barcaHubCards = cards;
  const initial = live[0] || upcoming[0] || finished[0];
  await loadBarcaMatch(initial.id);
}

let matchGeneration = 0;

async function loadBarcaMatch(matchId){
  const myMatchGen = ++matchGeneration;
  destroyPlayer();
  await resetPlayerUI();
  if (myMatchGen !== matchGeneration) return;

  const { data:m } = await withTimeout(sb.from('matches').select('*').eq('id', matchId).single());
  if (myMatchGen !== matchGeneration) return;
  if (!m) return;

  const { data:sources } = await withTimeout(sb.from('match_sources').select('*').eq('match_id', matchId).order('sort_order'));
  if (myMatchGen !== matchGeneration) return;

  state.currentMatch = m;
  document.getElementById('playerTitle').textContent = CLUB_NAMES[state.club] || '';
  const now = Date.now();
  state.sources = (sources || []).filter(s => !s.publish_at || new Date(s.publish_at).getTime() <= now);
  state.related = [];
  renderBelowPlayer();
  loadTabSources();
}

async function loadClubInfo(club){
  const { data } = await withTimeout(sb.from('clubs').select('*').eq('slug', club).single());
  state.clubInfo = data || null;
  state.clubTelegram = data ? { link: data.telegram_link||'', label: data.telegram_label||'' } : null;
  if (data){
    CLUB_NAMES[club] = data.name || club;
    if (data.accent_color) document.body.style.setProperty('--acc', data.accent_color);
    if (data.accent_color2) document.body.style.setProperty('--acc2', data.accent_color2);
  }
  const url = data && data.logo_url;
  if (!url) return;
  ['homeCrest','finCrest'].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    const img = document.createElement('img');
    img.src = url; img.alt=''; img.className='top-crest';
    img.onerror = ()=>{};
    img.onload = ()=>{ el.replaceWith(img); img.id = id; };
  });
}

function backToClubs(){ location.href = 'index.html'; }
