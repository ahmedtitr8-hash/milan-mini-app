let viewerStatsTimer = null;
let viewerStatsScope = null; // null = كل الأندية، أو slug نادٍ محدد

function fmtHour(h){
  if (h===null || h===undefined) return '—';
  const period = h < 12 ? 'ص' : 'م';
  let h12 = h % 12; if (h12===0) h12 = 12;
  return `${h12}:00 ${period}`;
}

async function loadViewerStats(){
  const scope = viewerStatsScope;
  const [{ data: activeRows, error: e1 }, { data: agg, error: e2 }] = await Promise.all([
    sb.from('viewer_heartbeats').select('*')
      .gte('last_seen', new Date(Date.now() - 2*60*1000).toISOString())
      .then(res=>{
        if (res.error) return res;
        const rows = scope ? (res.data||[]).filter(r=>r.club===scope) : (res.data||[]);
        return { data: rows.sort((a,b)=> new Date(b.last_seen)-new Date(a.last_seen)) };
      }),
    sb.rpc('viewer_stats', { p_club: scope })
  ]);
  if (e1 || e2){
    document.getElementById('viewerStatsList').innerHTML = '<p style="color:var(--danger)">تعذر التحميل: '+((e1||e2).message)+'</p>';
    return;
  }
  const active = activeRows || [];
  const s = (agg && agg[0]) || {};
  document.getElementById('viewerStatsRow').innerHTML = `
    <div class="stat-box"><b>${s.watching_now ?? active.length}</b><span>يشاهدون الآن</span></div>
    <div class="stat-box"><b>${s.unique_today ?? 0}</b><span>اليوم</span></div>
    <div class="stat-box"><b>${s.unique_all_time ?? 0}</b><span>إجمالي المستخدمين (كل الوقت)</span></div>
    <div class="stat-box"><b>${fmtHour(s.peak_hour)}</b><span>وقت الذروة</span></div>`;
  document.getElementById('viewerStatsRow2').innerHTML = `
    <div class="stat-box"><b>${s.watched_30 ?? 0}</b><span>شاهدوا 30 دقيقة+ متواصلة</span></div>
    <div class="stat-box"><b>${s.watched_60 ?? 0}</b><span>شاهدوا 60 دقيقة+ متواصلة</span></div>
    <div class="stat-box"><b>${s.watched_90 ?? 0}</b><span>شاهدوا 90 دقيقة+ متواصلة</span></div>
    <div class="stat-box"><b>${s.watched_120 ?? 0}</b><span>شاهدوا 120 دقيقة+ متواصلة</span></div>`;

  if (!active.length){
    document.getElementById('viewerStatsList').innerHTML = '<p style="color:var(--mute)">ما فيه أحد يشاهد حاليًا</p>';
    return;
  }
  document.getElementById('viewerStatsList').innerHTML = active.map(r=>{
    const clubName = CLUB_NAMES[r.club] || r.club || '—';
    const who = r.tg_username ? '@'+escapeHtmlAdmin(r.tg_username) : 'مستخدم بدون اسم ظاهر';
    const watching = r.match_label ? escapeHtmlAdmin(r.match_label) : 'لسه ما فتح مباراة';
    const src = r.source_label ? ' — '+escapeHtmlAdmin(r.source_label) : '';
    const secsAgo = Math.max(0, Math.round((Date.now() - new Date(r.last_seen).getTime())/1000));
    return `<div class="src-card" style="padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b style="font-size:13px;">${who}</b>
        <span style="font-size:11px;color:var(--mute)">${clubName} · قبل ${secsAgo} ث</span>
      </div>
      <div style="font-size:12px;color:var(--mute);margin-top:4px;">${watching}${src}</div>
    </div>`;
  }).join('');
}
function escapeHtmlAdmin(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function openViewerStats(clubScope){
  viewerStatsScope = clubScope || null;
  const label = viewerStatsScope ? (CLUB_NAMES[viewerStatsScope] || viewerStatsScope) : 'كل الأندية';
  document.getElementById('viewerStatsTitle').textContent = `👥 إحصائيات المشاهدين — ${label}`;
  loadViewerStats();
  document.getElementById('viewerStatsBg').classList.add('on');
  clearInterval(viewerStatsTimer);
  viewerStatsTimer = setInterval(loadViewerStats, 10000); // تحديث كل 10 ثوانٍ وقت ما اللوحة مفتوحة
}
function closeViewerStats(){
  document.getElementById('viewerStatsBg').classList.remove('on');
  clearInterval(viewerStatsTimer);
}
async function testHeartbeatConnection(){
  const box = document.getElementById('hbDiagResult');
  box.style.color = 'var(--mute)';
  box.textContent = 'جارِ الاختبار…';
  const lines = [];
  let ok = true;
  try{
    // عميل منفصل بدون جلسة تسجيل دخول الأدمن — يحاكي بالضبط صلاحيات أي زائر يفتح المشغل
    const anonClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const testId = 'diag_' + Date.now();

    // 1) جدول "يشاهدون الآن" (viewer_heartbeats) — موجود من قبل
    const { error: hbErr } = await anonClient.from('viewer_heartbeats').upsert({
      session_id: testId, club: 'test', match_label: 'اختبار تشخيصي', last_seen: new Date().toISOString()
    }, { onConflict: 'session_id' });
    lines.push(hbErr ? `❌ جدول viewer_heartbeats: ${hbErr.message}` : '✅ جدول viewer_heartbeats يستقبل بيانات بشكل سليم');
    if (hbErr) ok = false;

    // 2) جدول الجلسات التفصيلية (viewer_sessions) — الجديد اللي تُحسب منه إحصائيات "اليوم"
    //    و"كل الوقت" و"وقت الذروة" ومدة المشاهدة. لو هذا يفشل، الأرقام هذي تبقى صفر للأبد
    //    حتى لو "يشاهدون الآن" شغال، لأنه جدول منفصل تمامًا.
    const { error: vsErr } = await anonClient.from('viewer_sessions').upsert({
      watch_session_id: 'ws_'+testId, session_id: testId, club: 'test',
      last_seen: new Date().toISOString(), duration_seconds: 0
    }, { onConflict: 'watch_session_id' });
    if (vsErr){
      ok = false;
      const missing = /relation .* does not exist|schema cache/i.test(vsErr.message);
      lines.push(missing
        ? `❌ جدول viewer_sessions غير موجود — لازم تشغّل ملف schema.sql المحدّث بمحرر SQL بسوبابيس (فيه إنشاء هذا الجدول ودالة viewer_stats)`
        : `❌ جدول viewer_sessions: ${vsErr.message}`);
    } else {
      lines.push('✅ جدول viewer_sessions يستقبل بيانات بشكل سليم');
    }

    // 3) دالة viewer_stats نفسها (اللي تحسب كل الأرقام بلوحة الإحصائيات) — هذي مقصود إنها
    //    للأدمن المسجّل دخول بس (مو للزوار العاديين)، فنختبرها بجلسة الأدمن الحالية مب anonClient
    const { error: rpcErr } = await sb.rpc('viewer_stats', { p_club: 'test' });
    if (rpcErr){
      ok = false;
      const missing = /function .* does not exist|schema cache/i.test(rpcErr.message);
      lines.push(missing
        ? '❌ دالة viewer_stats غير موجودة — نفس السبب: شغّل schema.sql المحدّث'
        : `❌ دالة viewer_stats: ${rpcErr.message}`);
    } else {
      lines.push('✅ دالة viewer_stats شغالة وترجع بيانات');
    }

    // تنظيف بيانات الاختبار (ما تأثر على أي إحصائية حقيقية أصلاً لأنها مستبعدة باسم النادي "test")
    await anonClient.from('viewer_heartbeats').delete().eq('session_id', testId);
    await anonClient.from('viewer_sessions').delete().eq('watch_session_id', 'ws_'+testId);

    box.style.color = ok ? '#7fdc7f' : '#ff8080';
    box.innerHTML = lines.join('<br>') + (ok
      ? '<br><br>✅ كل شيء شغال من طرف السيرفر. لو لسه الأرقام مو متحدثة رغم إنك فعلاً فتحت المشغل وتابعت، جرّب افتح المشغل بمتصفح عادي (مو تيليجرام) وشوف الـ Console (F12) وقت التشغيل — لو فيه رسالة "heartbeat error" أو "viewer_sessions error" ابعثها لي بالضبط.'
      : '');
  }catch(e){
    box.style.color = '#ff8080';
    box.textContent = '❌ خطأ: ' + (e.message || e);
  }
}
