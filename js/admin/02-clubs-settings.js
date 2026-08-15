/* ===== إدارة الأندية (إضافة/حذف/عرض) — كل شيء ديناميكي من جدول clubs ===== */
async function loadClubsCache(){
  const { data } = await sb.from('clubs').select('*').order('sort_order');
  clubsCache = data || [];
  clubsCache.forEach(c=>{ CLUB_NAMES[c.slug] = c.name || c.slug; });
  return clubsCache;
}
function renderClubGate(){
  const host = document.getElementById('clubPickRow');
  host.innerHTML = '';
  clubsCache.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'club-pick';
    const letter = (c.name||c.slug||'?').trim().charAt(0) || '?';
    const crestBg = `linear-gradient(135deg, ${c.accent_color||'#888'}, ${c.accent_color2||'#444'})`;
    div.innerHTML = `
      <span class="del-club" title="حذف النادي">🗑</span>
      <div class="crest" style="background:${crestBg}">${c.logo_url ? `<img src="${escHtmlAdmin(c.logo_url)}" onerror="this.remove()">` : escHtmlAdmin(letter)}</div>
      <b>${escHtmlAdmin(c.name||c.slug)}</b>
      ${c.is_active===false ? '<span style="font-size:10px;font-weight:800;color:#ff8080;">🚫 مخفي مؤقتًا</span>' : ''}`;
    div.querySelector('.del-club').onclick = (e)=>{ e.stopPropagation(); deleteClub(c.slug, c.name||c.slug); };
    div.addEventListener('click', ()=>enterClub(c.slug));
    host.appendChild(div);
  });
  const addDiv = document.createElement('div');
  addDiv.className = 'club-pick add-club';
  addDiv.innerHTML = `<span class="plus">+</span><b>إضافة</b>`;
  addDiv.onclick = openAddChoice;
  host.appendChild(addDiv);
}
function openAddChoice(){ document.getElementById('addChoiceBg').classList.add('on'); }
function closeAddChoice(){ document.getElementById('addChoiceBg').classList.remove('on'); }
function addChoiceClub(){ closeAddChoice(); openClubForm(); }
function addChoiceSection(){ closeAddChoice(); openHomeSections(); }
function openClubForm(){
  document.getElementById('cf_name').value='';
  document.getElementById('cf_slug').value='';
  document.getElementById('cf_slug').dataset.touched='';
  document.getElementById('cf_subtitle').value='';
  document.getElementById('cf_logo').value='';
  document.getElementById('cf_acc').value='#E2101A';
  document.getElementById('cf_acc2').value='#FF4747';
  document.getElementById('clubFormBg').classList.add('on');
}
function closeClubForm(){ document.getElementById('clubFormBg').classList.remove('on'); }
function slugifyClub(s){
  return String(s||'').trim().toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s-]/g,'')
    .replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}
document.getElementById('cf_name').addEventListener('input', ()=>{
  const slugEl = document.getElementById('cf_slug');
  if (!slugEl.dataset.touched) slugEl.value = slugifyClub(document.getElementById('cf_name').value);
});
document.getElementById('cf_slug').addEventListener('input', e=>{ e.target.dataset.touched = '1'; });
async function saveNewClub(){
  const name = document.getElementById('cf_name').value.trim();
  const slug = slugifyClub(document.getElementById('cf_slug').value || name);
  if (!name || !slug){ toast('اكتب اسم النادي على الأقل', true); return; }
  if (clubsCache.some(c=>c.slug===slug)){ toast('هذا المعرّف مستخدم بنادٍ آخر، غيّره', true); return; }
  const subtitle = document.getElementById('cf_subtitle').value.trim();
  const logo = document.getElementById('cf_logo').value.trim();
  const acc = document.getElementById('cf_acc').value;
  const acc2 = document.getElementById('cf_acc2').value;
  const maxOrder = clubsCache.reduce((m,c)=>Math.max(m, c.sort_order||0), 0);
  const { error } = await sb.from('clubs').insert({
    slug, name, subtitle, logo_url: logo, accent_color: acc, accent_color2: acc2, sort_order: maxOrder+1
  });
  if (error){ toast('تعذر الإضافة: '+error.message, true); return; }
  toast('تمت إضافة النادي');
  closeClubForm();
  await loadClubsCache();
  renderClubGate();
}
async function deleteClub(slug, name){
  if (!confirm(`حذف نادي "${name}" نهائيًا مع كل مبارياته وسيرفراته؟ لا يمكن التراجع عن هذا.`)) return;
  const { error } = await sb.from('clubs').delete().eq('slug', slug);
  if (error){ toast('تعذر الحذف: '+error.message, true); return; }
  toast('تم حذف النادي');
  const wasCurrent = currentClub === slug;
  await loadClubsCache();
  renderClubGate();
  if (wasCurrent) switchClub();
}

function enterClub(club){
  currentClub = club;
  localStorage.setItem('zoneClub', club);
  document.body.setAttribute('data-club', club);
  const c = clubsCache.find(x=>x.slug===club);
  document.body.style.setProperty('--acc', (c && c.accent_color) || '#E87B00');
  document.getElementById('clubGate').style.display='none';
  document.getElementById('panel').style.display='block';
  document.getElementById('topCrest').textContent = (c && c.name ? c.name.trim().charAt(0) : club.charAt(0).toUpperCase()) || '?';
  document.getElementById('topTitle').textContent = (c && c.name) || club;
  loadClubLogo();
  loadMatches();
}
async function loadClubLogo(){
  const { data } = await sb.from('clubs').select('*').eq('slug', currentClub).single();
  document.getElementById('clubLogoInput').value = (data && data.logo_url) || '';
  document.getElementById('clubLogoPreview').src = (data && data.logo_url) || '';
  document.getElementById('clubNameInput').value = (data && data.name) || '';
  document.getElementById('clubSubtitleInput').value = (data && data.subtitle) || '';
  document.getElementById('clubAccInput').value = (data && data.accent_color) || '#E87B00';
  document.getElementById('clubAcc2Input').value = (data && data.accent_color2) || '#FF9520';
  document.getElementById('clubTgLinkInput').value = (data && data.telegram_link) || '';
  document.getElementById('clubTgLabelInput').value = (data && data.telegram_label) || '';
  document.getElementById('clubTgChannelIdInput').value = (data && data.telegram_channel_id) || '';
  document.getElementById('clubActiveInput').checked = !data || data.is_active !== false;
}
async function loadAppSettings(){
  const { data } = await sb.from('app_settings').select('*').eq('id', 1).single();
  document.getElementById('f_tg_link1').value = (data && data.telegram_link_1) || '';
  document.getElementById('f_tg_label1').value = (data && data.telegram_label_1) || '';
  document.getElementById('f_tg_link2').value = (data && data.telegram_link_2) || '';
  document.getElementById('f_tg_label2').value = (data && data.telegram_label_2) || '';
  document.getElementById('f_rights_text').value = (data && data.rights_text) || '';
  document.getElementById('f_ticker_text').value = (data && data.ticker_text) || '';
}
function openGlobalSettings(){
  loadAppSettings();
  document.getElementById('globalSettingsBg').classList.add('on');
}
function closeGlobalSettings(){ document.getElementById('globalSettingsBg').classList.remove('on'); }

/* ===== لوحة إحصائيات المشاهدين ===== */
