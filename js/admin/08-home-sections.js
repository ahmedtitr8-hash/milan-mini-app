let homeSectionsCache = [];
let editingSectionId = null;

function sectionTypeLabel(t){
  return t==='clubs_grid' ? '⚽ شبكة أندية' : t==='video' ? '🎬 فيديو' : t==='banner' ? '🖼 بانر صورة' : t;
}

async function loadHomeSectionsList(){
  const { data, error } = await sb.from('home_sections').select('*').order('sort_order');
  if (error){
    document.getElementById('homeSectionsList').innerHTML = '<p style="color:var(--danger)">تعذر التحميل: '+error.message+'</p>';
    return;
  }
  homeSectionsCache = data || [];
  renderHomeSectionsList();
}
function renderHomeSectionsList(){
  const host = document.getElementById('homeSectionsList');
  if (!homeSectionsCache.length){
    host.innerHTML = '<p style="color:var(--mute)">لا توجد أقسام مضافة بعد</p>';
    return;
  }
  host.innerHTML = homeSectionsCache.map((s,i)=>{
    const cfg = s.config || {};
    let detail = '';
    if (s.type === 'clubs_grid') detail = (cfg.club_slugs && cfg.club_slugs.length) ? `أندية محدّدة (${cfg.club_slugs.length})` : 'كل الأندية النشطة';
    else if (s.type === 'video') detail = escapeHtmlAdmin(cfg.url || '—');
    else if (s.type === 'banner') detail = escapeHtmlAdmin(cfg.image_url || '—');
    return `<div class="src-card" style="padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="min-width:0;">
          <b style="font-size:13px;">${sectionTypeLabel(s.type)}${s.title ? ' — '+escapeHtmlAdmin(s.title) : ''}</b>
          <div style="font-size:11px;color:var(--mute);margin-top:3px;overflow-wrap:break-word;">${detail}</div>
          ${s.is_active ? '' : '<div style="font-size:11px;color:var(--danger);margin-top:3px;">معطّل (لا يظهر للمستخدم)</div>'}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn secondary small" ${i===0?'disabled style="opacity:.35"':''} onclick="moveSection(${i},-1)">▲</button>
          <button class="btn secondary small" ${i===homeSectionsCache.length-1?'disabled style="opacity:.35"':''} onclick="moveSection(${i},1)">▼</button>
          <button class="btn secondary small" onclick="editSection('${s.id}')">تعديل</button>
          <button class="btn danger small" onclick="deleteSection('${s.id}')">حذف</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
async function moveSection(index, dir){
  const other = index + dir;
  if (other < 0 || other >= homeSectionsCache.length) return;
  const a = homeSectionsCache[index], b = homeSectionsCache[other];
  const aOrder = a.sort_order, bOrder = b.sort_order;
  const { error } = await Promise.all([
    sb.from('home_sections').update({ sort_order: bOrder }).eq('id', a.id),
    sb.from('home_sections').update({ sort_order: aOrder }).eq('id', b.id)
  ]).then(results=>results.find(r=>r.error)||{});
  if (error){ toast('تعذر تغيير الترتيب: '+error.message, true); return; }
  await loadHomeSectionsList();
}
async function deleteSection(id){
  if (!confirm('حذف هذا القسم من الصفحة الرئيسية؟')) return;
  const { error } = await sb.from('home_sections').delete().eq('id', id);
  if (error){ toast('تعذر الحذف: '+error.message, true); return; }
  toast('تم حذف القسم');
  await loadHomeSectionsList();
}
function openHomeSections(){
  document.getElementById('homeSectionsBg').classList.add('on');
  loadHomeSectionsList();
}
function closeHomeSections(){ document.getElementById('homeSectionsBg').classList.remove('on'); }

function onSectionTypeChange(){
  const t = document.getElementById('sf_type').value;
  document.getElementById('sf_clubs_wrap').classList.toggle('hide', t!=='clubs_grid');
  document.getElementById('sf_video_wrap').classList.toggle('hide', t!=='video');
  document.getElementById('sf_banner_wrap').classList.toggle('hide', t!=='banner');
}
function renderSectionClubChecks(selectedSlugs){
  const host = document.getElementById('sf_clubs_checks');
  host.innerHTML = clubsCache.map(c=>`
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
      <input type="checkbox" value="${escHtmlAttr(c.slug)}" ${selectedSlugs.includes(c.slug)?'checked':''} style="width:16px;height:16px;">
      ${escapeHtmlAdmin(c.name||c.slug)}
    </label>`).join('') || '<span style="color:var(--mute);font-size:12px;">لا توجد أندية مضافة بعد</span>';
}
function escHtmlAttr(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }
function openSectionForm(section){
  editingSectionId = section ? section.id : null;
  document.getElementById('sectionFormTitle').textContent = section ? 'تعديل القسم' : 'إضافة قسم';
  const cfg = (section && section.config) || {};
  document.getElementById('sf_type').value = (section && section.type) || 'clubs_grid';
  document.getElementById('sf_title').value = (section && section.title) || '';
  document.getElementById('sf_video_url').value = cfg.url || '';
  document.getElementById('sf_banner_img').value = cfg.image_url || '';
  document.getElementById('sf_banner_link').value = cfg.link_url || '';
  renderSectionClubChecks(cfg.club_slugs || []);
  onSectionTypeChange();
  document.getElementById('sectionFormBg').classList.add('on');
}
function editSection(id){
  const s = homeSectionsCache.find(x=>x.id===id);
  if (s) openSectionForm(s);
}
function closeSectionForm(){ document.getElementById('sectionFormBg').classList.remove('on'); }
async function saveSection(){
  const type = document.getElementById('sf_type').value;
  const title = document.getElementById('sf_title').value.trim();
  let config = {};
  if (type === 'clubs_grid'){
    const checked = [...document.querySelectorAll('#sf_clubs_checks input:checked')].map(i=>i.value);
    config = { club_slugs: checked };
  } else if (type === 'video'){
    const url = document.getElementById('sf_video_url').value.trim();
    if (!url){ toast('اكتب رابط الفيديو', true); return; }
    config = { url };
  } else if (type === 'banner'){
    const image_url = document.getElementById('sf_banner_img').value.trim();
    const link_url = document.getElementById('sf_banner_link').value.trim();
    if (!image_url){ toast('اكتب رابط صورة البانر', true); return; }
    config = { image_url, link_url };
  }
  if (editingSectionId){
    const { error } = await sb.from('home_sections').update({ type, title, config }).eq('id', editingSectionId);
    if (error){ toast('تعذر الحفظ: '+error.message, true); return; }
    toast('تم تعديل القسم');
  } else {
    const maxOrder = homeSectionsCache.reduce((m,s)=>Math.max(m, s.sort_order||0), 0);
    const { error } = await sb.from('home_sections').insert({ type, title, config, sort_order: maxOrder+1 });
    if (error){ toast('تعذر الإضافة: '+error.message, true); return; }
    toast('تمت إضافة القسم');
  }
  closeSectionForm();
  await loadHomeSectionsList();
}

