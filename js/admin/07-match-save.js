async function saveMatch(){
  const payload = {
    club: currentClub,
    home_team: val('f_home_team'), away_team: val('f_away_team'),
    home_logo: val('f_home_logo'), away_logo: val('f_away_logo'),
    competition: val('f_competition'), round: val('f_round'),
    status: val('f_status'),
    kickoff_at: val('f_kickoff') ? new Date(val('f_kickoff')).toISOString() : null,
    publish_at: val('f_publish_at') ? new Date(val('f_publish_at')).toISOString() : null,
    home_score: val('f_home_score') !== '' ? parseInt(val('f_home_score')) : null,
    away_score: val('f_away_score') !== '' ? parseInt(val('f_away_score')) : null
  };

  let matchId = editingId;
  try{
    if (matchId){
      const { error } = await sb.from('matches').update(payload).eq('id', matchId);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('matches').insert(payload).select().single();
      if (error) throw error;
      matchId = data.id;
    }

    // حفظ السيرفرات: حذف القديم وإدراج الحالي (أبسط وأضمن تزامن)
    const { error: delErr } = await sb.from('match_sources').delete().eq('match_id', matchId);
    if (delErr) throw delErr;
    const cleanSources = sourceRows.filter(s=>s.url && s.url.trim());
    if (cleanSources.length){
      const { error: insErr } = await sb.from('match_sources').insert(cleanSources.map(s=>({
        match_id: matchId, tab:'full', label:s.label||'سيرفر', url:s.url, sort_order:s.sort_order||0,
        stream_type: s.stream_type || 'auto',
        drm_key: (s.drm_key||'').trim() || null,
        drm_type: s.drm_type || 'clearkey',
        license_url: (s.license_url||'').trim() || null,
        license_headers: (s.license_headers||'').trim() || null,
        fairplay_cert_url: (s.fairplay_cert_url||'').trim() || null,
        publish_at: s.publish_at || null,
        qualities: (s.qualities||[]).filter(q=>q.url && q.url.trim()).map(q=>({ label:(q.label||'').trim()||'جودة', url:q.url.trim() }))
      })));
      if (insErr) throw insErr;
    }

    toast('تم الحفظ بنجاح');
    closeMatchModal();
    loadMatches();
  }catch(e){
    toast('حدث خطأ: '+(e.message||e), true);
  }
}
function val(id){ return document.getElementById(id).value.trim ? document.getElementById(id).value.trim() : document.getElementById(id).value; }


/* ===== إدارة أقسام الصفحة الرئيسية (index) — شبكة أندية / فيديو / بانر بأي ترتيب ===== */
