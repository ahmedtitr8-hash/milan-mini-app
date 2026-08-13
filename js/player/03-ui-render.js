function fmtKickoff(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ar', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
}
function fmtTimeOnly(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleString('ar', { hour:'2-digit', minute:'2-digit' });
}
function fmtDateOnly(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleString('ar', { day:'2-digit', month:'2-digit' });
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function setPlayerBg(m){
  const el = document.getElementById('playerBg');
  if (!el) return;
  const hl = m && m.home_logo;
  const al = m && m.away_logo;
  if (!hl && !al){ el.innerHTML = ''; return; }
  el.innerHTML =
    (hl ? `<img src="${hl}" onerror="this.style.display='none'" alt="">` : '') +
    (hl && al ? `<span class="pbg-vs">VS</span>` : '') +
    (al ? `<img src="${al}" onerror="this.style.display='none'" alt="">` : '');
}

function barcaMatchCenter(m){
  if (m.status === 'live'){
    return `<div class="hub-time"><span class="hub-live"><span class="bdot"></span>مباشر</span></div>`;
  }
  if (m.status === 'finished'){
    const hasScore = m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;
    return `<div class="hub-time">${hasScore ? `<span class="hub-t">${m.home_score} - ${m.away_score}</span>` : ''}<span class="hub-d">انتهت</span></div>`;
  }
  return `<div class="hub-time"><span class="hub-t">${fmtTimeOnly(m.kickoff_at)}</span><span class="hub-d">${fmtDateOnly(m.kickoff_at)}</span></div>`;
}

function barcaMatchCard(m){
  const active = state.currentMatch && state.currentMatch.id === m.id;
  return `<div class="hub-card ${active?'active':''}" onclick="loadBarcaMatch('${m.id}')">
    ${(m.round || m.competition) ? `<div class="hub-card-top">
      ${m.competition?`<span class="hub-comp">${escapeHtml(m.competition)}</span>`:''}
      ${m.round?`<span class="hub-badge">${escapeHtml(String(m.round))}</span>`:''}
    </div>` : ''}
    <div class="hub-teams">
      <div class="hub-team"><div class="hub-logo"><img src="${m.home_logo||''}" alt="" onerror="this.style.opacity=0"></div><span>${escapeHtml(m.home_team||'')}</span></div>
      ${barcaMatchCenter(m)}
      <div class="hub-team"><div class="hub-logo"><img src="${m.away_logo||''}" alt="" onerror="this.style.opacity=0"></div><span>${escapeHtml(m.away_team||'')}</span></div>
    </div>
  </div>`;
}

function currentTabSources(){
  return state.sources;
}

function loadTabSources(){
  const m = state.currentMatch;
  const list = currentTabSources();
  if (list.length){
    loadSource(list[0].url, list[0]);
  } else if (m.status === 'upcoming'){
    showUpcomingState(m);
  } else {
    showPlaceholder('لا يوجد رابط متاح حالياً', true);
  }
  renderBelowPlayer();
}

let countdownTimer = null;
function showUpcomingState(m){
  destroyPlayer();
  clearInterval(countdownTimer);
  const v = video();
  v.poster = '';
  setPlayerBg(state.currentMatch);
  currentIsLive = false; updateLiveIndicator();
  document.getElementById('liveBadgeP').style.display = 'none';
  document.getElementById('seekRow').style.display = 'none';
  document.getElementById('btnBack10').style.display = 'none';
  document.getElementById('btnFwd10').style.display = 'none';
  document.getElementById('ctrlLayer').classList.add('hide');
  const p = document.getElementById('playerPlaceholder');
  p.innerHTML = `
    <svg viewBox="0 0 24 24" style="width:34px;height:34px;fill:var(--acc)"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h-2V7h2zm0 4h-2v-2h2z"/></svg>
    <span style="font-weight:800;color:#fff;">المباراة لم تبدأ بعد</span>
    <span style="font-size:12px;">موعد الانطلاق: ${fmtKickoff(m.kickoff_at) || 'قريبًا'}</span>
    <span id="kickoffCountdown" style="font-size:18px;font-weight:900;color:var(--acc);margin-top:4px;letter-spacing:.5px;"></span>`;
  p.classList.remove('hide');
  const target = m.kickoff_at ? new Date(m.kickoff_at).getTime() : null;
  const el = document.getElementById('kickoffCountdown');
  function tick(){
    if (!target || !el) { clearInterval(countdownTimer); return; }
    const diff = target - Date.now();
    if (diff <= 0){ el.textContent = 'على وشك الانطلاق'; clearInterval(countdownTimer); return; }
    const d = Math.floor(diff/86400000);
    const h = Math.floor((diff%86400000)/3600000);
    const mi = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    el.textContent = d>0
      ? `يبدأ بعد ${d} يوم ${h} س ${mi} د`
      : `يبدأ بعد ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderBarcaBelow(){
  let html = '';
  const chips = currentTabSources();
  if (chips.length){
    html += `<div class="chips-row" id="chipsRow">${chips.map((s,i)=>`<div class="chip ${i===0?'active':''}" onclick="pickSource(${i},this)">${escapeHtml(s.label)}</div>`).join('')}</div>`;
  }
  if (state.barcaHubCards && state.barcaHubCards.length){
    html += `<div class="hub-list">${state.barcaHubCards.map(barcaMatchCard).join('')}</div>`;
  }
  document.getElementById('belowPlayer').innerHTML = html;
  setServersButtonVisibility();
  const tg = state.clubTelegram;
  if (tg && tg.link){
    document.getElementById('belowPlayer').insertAdjacentHTML('beforeend', `
      <a href="${tg.link}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;
        margin:14px auto 4px;width:100%;max-width:280px;padding:11px 16px;border-radius:12px;
        background:rgba(255,255,255,.06);border:1px solid var(--border);color:#fff;text-decoration:none;
        font-size:13px;font-weight:700;justify-content:center;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="#2AABEE"><path d="M21.5 4.5L2.7 12.2c-1.2.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.8c.2.7.5.9 1.2.9.5 0 .7-.2 1-.5l2.4-2.3 5 3.7c.9.5 1.6.3 1.8-.8l3.3-15.5c.4-1.4-.5-2-1.3-1.6z"/></svg>
        <span>${escapeHtml(tg.label || 'قناة النادي على تيليجرام')}</span>
      </a>`);
  }
}

function renderBelowPlayer(){
  renderBarcaBelow();
}

function pickSource(i, el){
  const list = currentTabSources();
  if (!list[i]) return;
  document.querySelectorAll('#chipsRow .chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  loadSource(list[i].url, list[i]);
}

function closePlayer(){
  destroyPlayer();
  location.href = 'index.html';
}

