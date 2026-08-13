async function deleteCurrentMatch(){
  if (!editingId) return;
  if (!confirm('هل تريد حذف هذه المباراة نهائياً؟ سيتم حذف كل سيرفراتها المرتبطة بها.')) return;
  try{
    await sb.from('match_sources').delete().eq('match_id', editingId);
    const { error } = await sb.from('matches').delete().eq('id', editingId);
    if (error) throw error;
    toast('تم الحذف');
    closeMatchModal();
    loadMatches();
  }catch(e){ toast('تعذر الحذف: '+(e.message||e), true); }
}

