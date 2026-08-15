async function saveAppSettings(){
  const payload = {
    id: 1,
    telegram_link_1: document.getElementById('f_tg_link1').value.trim(),
    telegram_label_1: document.getElementById('f_tg_label1').value.trim() || 'القناة الأولى',
    telegram_link_2: document.getElementById('f_tg_link2').value.trim(),
    telegram_label_2: document.getElementById('f_tg_label2').value.trim() || 'القناة الثانية',
    rights_text: document.getElementById('f_rights_text').value.trim(),
    ticker_text: document.getElementById('f_ticker_text').value.trim(),
    ad_enabled: document.getElementById('f_ad_enabled').checked,
    ad_image_url: document.getElementById('f_ad_image_url').value.trim(),
    ad_video_url: document.getElementById('f_ad_video_url').value.trim(),
    ad_click_url: document.getElementById('f_ad_click_url').value.trim(),
    ad_duration_seconds: Math.min(20, Math.max(10, parseInt(document.getElementById('f_ad_duration_seconds').value, 10) || 15)),
    ad_skip_after_seconds: Math.max(0, parseInt(document.getElementById('f_ad_skip_after_seconds').value, 10) || 0),
    ad_network_script: document.getElementById('f_ad_network_script').value.trim(),
  };
  const { error } = await sb.from('app_settings').upsert(payload);
  if (error){ toast('تعذر الحفظ: '+error.message, true); return; }
  toast('تم حفظ الإعدادات العامة');
}
async function saveClubLogo(){
  const url = document.getElementById('clubLogoInput').value.trim();
  const name = document.getElementById('clubNameInput').value.trim();
  const subtitle = document.getElementById('clubSubtitleInput').value.trim();
  const acc = document.getElementById('clubAccInput').value;
  const acc2 = document.getElementById('clubAcc2Input').value;
  const tgLink = document.getElementById('clubTgLinkInput').value.trim();
  const tgLabel = document.getElementById('clubTgLabelInput').value.trim() || 'قناة النادي على تيليجرام';
  const tgChannelId = document.getElementById('clubTgChannelIdInput').value.trim();
  const isActive = document.getElementById('clubActiveInput').checked;
  if (!name){ toast('اكتب اسم النادي', true); return; }
  const { error } = await sb.from('clubs').update({
    name, subtitle, logo_url: url, accent_color: acc, accent_color2: acc2,
    telegram_link: tgLink, telegram_label: tgLabel, telegram_channel_id: tgChannelId, is_active: isActive
  }).eq('slug', currentClub);
  if (error){ toast('تعذر الحفظ: '+error.message, true); return; }
  document.getElementById('clubLogoPreview').src = url;
  document.getElementById('topTitle').textContent = name;
  document.getElementById('topCrest').textContent = name.trim().charAt(0) || '?';
  document.body.style.setProperty('--acc', acc);
  await loadClubsCache();
  toast(isActive ? 'تم حفظ إعدادات النادي' : 'تم حفظ الإعدادات — النادي مخفي الآن عن المستخدمين');
}
function switchClub(){
  sessionStorage.removeItem('zoneClub');
  document.getElementById('panel').style.display='none';
  renderClubGate();
  document.getElementById('clubGate').style.display='flex';
}

/* ===== تحميل المباريات ===== */
