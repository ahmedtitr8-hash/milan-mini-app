const DRAG_THRESHOLD = 8;
function enableFsMenuDragScroll(){
  document.querySelectorAll('.popup-menu').forEach(el=>{
    if (el.dataset.dragBound) return;
    el.dataset.dragBound = '1';
    let startY = 0, startScroll = 0, dragging = false, movedFar = false;
    el.addEventListener('touchstart', (e)=>{
      if (!document.getElementById('playerWrap').classList.contains('fs')) return;
      dragging = true;
      movedFar = false;
      startY = e.touches[0].clientY;
      startScroll = el.scrollLeft;
    }, {passive:true});
    el.addEventListener('touchmove', (e)=>{
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > DRAG_THRESHOLD) movedFar = true;
      el.scrollLeft = startScroll - dy;
    }, {passive:true});
    el.addEventListener('click', (e)=>{
      if (movedFar){ e.stopPropagation(); e.preventDefault(); }
    }, true);
    el.addEventListener('touchend', ()=>{ dragging = false; }, {passive:true});
    el.addEventListener('touchcancel', ()=>{ dragging = false; movedFar = false; }, {passive:true});
  });
}
enableFsMenuDragScroll();

(async function boot(){
  const qs = new URLSearchParams(location.search);
  const club = qs.get('club');
  if (!club){ location.href = 'index.html'; return; }
  try{
    const clubCheck = sb.from('clubs').select('slug').eq('slug', club).eq('is_active', true).single();
    const timeout = new Promise((_,rej)=> setTimeout(()=>rej(new Error('timeout')), 15000));
    const { data, error } = await Promise.race([clubCheck, timeout]);
    if (error || !data){ location.href = 'index.html'; return; }
    await openClub(club);   // مربوطة بـ try/catch داخلية (تعرض رسالة خطأ واضحة) — ما تسيب الشاشة متجمدة
    startHeartbeat();
  }catch(e){
    // فشل حتى قبل التأكد من وجود النادي (شبكة منقطعة تمامًا، أو الطلب علّق بلا رد أصلاً) —
    // ما نسيب الشاشة على حالها الافتراضي بصمت للأبد
    console.error('boot error:', e);
    const p = document.getElementById('playerPlaceholder');
    p.innerHTML = `<span>تعذر الاتصال — تحقق من الشبكة</span>
      <button onclick="location.reload()" style="margin-top:6px;padding:8px 18px;border-radius:8px;background:var(--acc);color:#fff;font-weight:700;font-size:12px;">إعادة المحاولة</button>`;
    p.classList.remove('hide');
  }
})();
