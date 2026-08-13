let currentFilter = 'all';
async function loadMatches(){
  document.getElementById('mlist').innerHTML = '<p style="color:var(--mute)">جارِ التحميل…</p>';
  const { data, error } = await sb.from('matches').select('*').eq('club', currentClub)
    .order('status').order('sort_order');
  if (error){ document.getElementById('mlist').innerHTML = '<p style="color:var(--danger)">تعذر التحميل: '+error.message+'</p>'; return; }
  matches = data || [];
  renderStats();
  renderMatchList();
}
function renderStats(){
  const c = { live:0, upcoming:0, finished:0 };
  matches.forEach(m=>{ if(c[m.status]!==undefined) c[m.status]++; });
  document.querySelector('.filter-count[data-c="all"]').textContent = matches.length;
  document.querySelector('.filter-count[data-c="live"]').textContent = c.live;
  document.querySelector('.filter-count[data-c="upcoming"]').textContent = c.upcoming;
  document.querySelector('.filter-count[data-c="finished"]').textContent = c.finished;
}
function setFilter(f){
  currentFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.toggle('active', c.dataset.f===f));
  renderMatchList();
}
function statusLabel(s){ return s==='live'?'مباشرة':s==='upcoming'?'قادمة':'منتهية'; }
function renderMatchList(){
  const list = currentFilter==='all' ? matches : matches.filter(m=>m.status===currentFilter);
  if (!list.length){ document.getElementById('mlist').innerHTML = '<p style="color:var(--mute)">لا توجد مباريات هنا</p>'; return; }
  document.getElementById('mlist').innerHTML = list.map(m=>`
    <div class="mcard">
      <div class="mcard-top">
        <div class="badges">
          <span class="badge ${m.status}">${statusLabel(m.status)}</span>
          ${m.publish_at && new Date(m.publish_at) > new Date() ? `<span class="badge" style="background:#5b3d00;color:#ffc670;">🕒 مجدولة</span>` : ''}
        </div>
      </div>
      <div class="mcard-teams">
        <img src="${m.home_logo||''}" onerror="this.style.opacity=0">
        <div class="info">
          <b>${escapeHtml(m.home_team || '—')} × ${escapeHtml(m.away_team || '—')}</b>
          <small>${escapeHtml(m.competition||'')}${m.round?(' · الجولة '+escapeHtml(m.round)):''}</small>
        </div>
        <img src="${m.away_logo||''}" onerror="this.style.opacity=0">
      </div>
      <div class="mcard-acts">
        <button class="btn secondary small" onclick="openMatchModal('${m.id}')">تعديل</button>
        <button class="btn secondary small" onclick="duplicateMatch('${m.id}')">تكرار</button>
      </div>
    </div>`).join('');
}
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function duplicateMatch(id){
  const m = matches.find(x=>x.id===id);
  if (!m) return;
  const copy = { ...m };
  delete copy.id; delete copy.created_at;
  const { data, error } = await sb.from('matches').insert(copy).select().single();
  if (error){ toast('تعذر التكرار: '+error.message, true); return; }
  const { data:srcs } = await sb.from('match_sources').select('*').eq('match_id', id);
  if (srcs && srcs.length){
    const { error: dupErr } = await sb.from('match_sources').insert(srcs.map(s=>({ match_id: data.id, tab:'full', label:s.label, url:s.url, sort_order:s.sort_order, stream_type:s.stream_type||'auto', drm_key:s.drm_key||null, drm_type:s.drm_type||'clearkey', license_url:s.license_url||null, license_headers:s.license_headers||null, fairplay_cert_url:s.fairplay_cert_url||null, qualities:s.qualities||[] })));
    if (dupErr){ toast('تم تكرار المباراة لكن فشل نسخ السيرفرات: '+dupErr.message, true); loadMatches(); return; }
  }
  toast('تم إنشاء نسخة من المباراة');
  loadMatches();
}

/* ===== نافذة المباراة ===== */
