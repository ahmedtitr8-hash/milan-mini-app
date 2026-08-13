const SUPABASE_URL = 'https://ckriyvqnrzravknajckl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rFMfYa3nWxyxp6_zYUdtCw_znCYEKfV';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

try{
  if (window.Telegram && window.Telegram.WebApp){
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    if (typeof Telegram.WebApp.requestFullscreen === 'function'){
      try{ Telegram.WebApp.requestFullscreen(); }catch(e){}
    }
    function applyTgSafeArea(){
      const c = Telegram.WebApp.contentSafeAreaInset || {};
      const s = Telegram.WebApp.safeAreaInset || {};
      const top = (c.top||0) + (s.top||0);
      document.documentElement.style.setProperty('--tg-safe-top', top + 'px');
    }
    applyTgSafeArea();
    if (typeof Telegram.WebApp.onEvent === 'function'){
      Telegram.WebApp.onEvent('contentSafeAreaChanged', applyTgSafeArea);
      Telegram.WebApp.onEvent('safeAreaChanged', applyTgSafeArea);
      Telegram.WebApp.onEvent('fullscreenChanged', applyTgSafeArea);
    }
    try{ if (typeof Telegram.WebApp.setHeaderColor === 'function') Telegram.WebApp.setHeaderColor('#000000'); }catch(e){}
  }
}catch(e){}

let CLUB_NAMES = {};
let state = { club:null, currentMatch:null, sources:[], related:[], currentTab:'live', currentSource:null, barcaHubCards:null, clubTelegram:null, clubInfo:null };

