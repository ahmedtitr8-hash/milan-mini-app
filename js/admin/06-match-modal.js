function openMatchModal(id){
  editingId = id;
  const m = id ? matches.find(x=>x.id===id) : null;
  document.getElementById('modalTitle').textContent = id ? 'تعديل المحتوى' : 'إضافة محتوى جديد';
  document.getElementById('btnDeleteMatch').classList.toggle('hide', !id);

  document.getElementById('f_home_team').value = m?.home_team || '';
  document.getElementById('f_away_team').value = m?.away_team || '';
  document.getElementById('f_home_logo').value = m?.home_logo || '';
  document.getElementById('f_away_logo').value = m?.away_logo || '';
  document.getElementById('f_competition').value = m?.competition || '';
  document.getElementById('f_round').value = m?.round || '';
  document.getElementById('f_status').value = m?.status || 'upcoming';
  document.getElementById('f_kickoff').value = m?.kickoff_at ? toLocalInput(m.kickoff_at) : '';
  document.getElementById('f_publish_at').value = m?.publish_at ? toLocalInput(m.publish_at) : '';
  document.getElementById('f_home_score').value = (m?.home_score ?? '');
  document.getElementById('f_away_score').value = (m?.away_score ?? '');

  updateStatusSections();
  document.getElementById('f_status').onchange = updateStatusSections;

  if (id){ loadSourcesFor(id); }
  else { sourceRows = []; renderSourceRows(); }

  document.getElementById('matchModalBg').classList.add('on');
}
function toLocalInput(iso){
  const d = new Date(iso);
  const pad = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function closeMatchModal(){ document.getElementById('matchModalBg').classList.remove('on'); }

function updateStatusSections(){
  const status = document.getElementById('f_status').value;
  document.getElementById('finishedSection').classList.toggle('hide', status!=='finished');
}

/* ===== سيرفرات المباراة ===== */
async function loadSourcesFor(id){
  const { data } = await sb.from('match_sources').select('*').eq('match_id', id).order('sort_order');
  sourceRows = (data||[]).map(s=>({
    label:s.label, url:s.url, sort_order:s.sort_order,
    stream_type: s.stream_type || 'auto',
    drm_key: s.drm_key || '',
    drm_type: s.drm_type || 'clearkey',
    license_url: s.license_url || '',
    license_headers: s.license_headers || '',
    fairplay_cert_url: s.fairplay_cert_url || '',
    publish_at: s.publish_at || null,
    qualities: Array.isArray(s.qualities) ? s.qualities.map(q=>({label:q.label||'', url:q.url||''})) : []
  }));
  renderSourceRows();
}
function addSourceRow(){
  sourceRows.push({ label:'سيرفر '+(sourceRows.length+1), url:'', sort_order: sourceRows.length, stream_type:'auto', drm_key:'', drm_type:'clearkey', license_url:'', license_headers:'', fairplay_cert_url:'', publish_at:null, qualities:[] });
  renderSourceRows();
}
function renderSourceRows(){
  const streamTypeOptions = `
    <option value="auto">🔎 تلقائي (يكتشفه المشغل من الرابط)</option>
    <option value="live">🔴 بث مباشر (إجباري)</option>
    <option value="vod">🎬 فيديو مسجل (إجباري)</option>`;
  const drmTypeOptions = `
    <option value="clearkey">🔑 ClearKey</option>
    <option value="widevine">🛡️ Widevine</option>
    <option value="playready">🛡️ PlayReady</option>
    <option value="fairplay">🍎 FairPlay</option>`;
  document.getElementById('sourcesList').innerHTML = sourceRows.map((s,i)=>{
    const quals = s.qualities || [];
    return `
    <div class="src-card">
      <div class="src-top">
        <input placeholder="اسم السيرفر (مثال: سيرفر 1)" value="${escapeHtml(s.label)}" onchange="sourceRows[${i}].label=this.value" style="flex:1">
      </div>
      <div class="src-bottom">
        <input class="url-field" placeholder="رابط m3u8 / mp4 / embed" value="${escapeHtml(s.url)}" onchange="sourceRows[${i}].url=this.value">
        <input type="number" title="الترتيب" value="${s.sort_order}" onchange="sourceRows[${i}].sort_order=parseInt(this.value)||0">
        <div class="del-btn" onclick="removeSourceRow(${i})">✕</div>
      </div>
      <div class="src-type-row">
        <select onchange="sourceRows[${i}].stream_type=this.value" title="نوع البث">${streamTypeOptions.replace('value="'+(s.stream_type||'auto')+'"','value="'+(s.stream_type||'auto')+'" selected')}</select>
        <select onchange="sourceRows[${i}].drm_type=this.value; renderSourceRows();" title="نوع DRM" style="flex:none;max-width:130px;">${drmTypeOptions.replace('value="'+(s.drm_type||'clearkey')+'"','value="'+(s.drm_type||'clearkey')+'" selected')}</select>
      </div>
      ${(s.drm_type||'clearkey')==='clearkey' ? `
      <div class="src-type-row">
        <input placeholder="مفتاح ClearKey (اختياري): kid:key" value="${escapeHtml(s.drm_key||'')}" onchange="sourceRows[${i}].drm_key=this.value" style="flex:1">
      </div>` : `
      <div class="src-type-row">
        <input placeholder="رابط سيرفر الترخيص (License URL)" value="${escapeHtml(s.license_url||'')}" onchange="sourceRows[${i}].license_url=this.value" style="flex:1">
      </div>
      <div class="src-type-row">
        <input placeholder='هيدرز إضافية اختيارية (JSON): {"Authorization":"Bearer ..."}' value="${escapeHtml(s.license_headers||'')}" onchange="sourceRows[${i}].license_headers=this.value" style="flex:1">
      </div>
      ${(s.drm_type)==='fairplay' ? `
      <div class="src-type-row">
        <input placeholder="رابط شهادة FairPlay (.cer) — مطلوب" value="${escapeHtml(s.fairplay_cert_url||'')}" onchange="sourceRows[${i}].fairplay_cert_url=this.value" style="flex:1">
      </div>` : ''}`}
      <div class="src-type-row">
        <label style="font-size:10.5px;color:var(--mute);flex-shrink:0;">جدولة النشر</label>
        <input type="datetime-local" value="${s.publish_at ? toLocalInput(s.publish_at) : ''}" onchange="sourceRows[${i}].publish_at = this.value ? new Date(this.value).toISOString() : null" style="max-width:200px;flex:none;">
      </div>
      <div class="qual-box">
        <div class="qual-head">
          <span>جودات إضافية</span>
          <button type="button" class="btn secondary tiny" onclick="addQualityRow(${i})">+ إضافة جودة</button>
        </div>
        <div class="qual-list">
          ${quals.map((q,qi)=>`
            <div class="qual-row">
              <input class="qual-label" placeholder="1080p" value="${escapeHtml(q.label)}" onchange="sourceRows[${i}].qualities[${qi}].label=this.value">
              <input class="url-field" placeholder="رابط هذه الجودة" value="${escapeHtml(q.url)}" onchange="sourceRows[${i}].qualities[${qi}].url=this.value">
              <div class="del-btn" onclick="removeQualityRow(${i},${qi})">✕</div>
            </div>`).join('') || '<p style="color:var(--mute);font-size:11px;">بدون جودات إضافية — يعمل رابط السيرفر الرئيسي فقط</p>'}
        </div>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--mute);font-size:12px;">لا توجد سيرفرات، اضغط "إضافة سيرفر"</p>';
}
function removeSourceRow(i){ sourceRows.splice(i,1); renderSourceRows(); }
function addQualityRow(i){
  if (!sourceRows[i].qualities) sourceRows[i].qualities = [];
  sourceRows[i].qualities.push({ label:'', url:'' });
  renderSourceRows();
}
function removeQualityRow(i,qi){ sourceRows[i].qualities.splice(qi,1); renderSourceRows(); }

/* ===== حفظ ===== */
