function loadLibWithFallback(globalName, urls, idx){
  idx = idx || 0;
  if (idx >= urls.length) return;
  if (window[globalName]) return;
  const s = document.createElement('script');
  s.src = urls[idx];
  s.onload = function(){};
  s.onerror = function(){ loadLibWithFallback(globalName, urls, idx+1); };
  document.head.appendChild(s);
  setTimeout(function(){ if (!window[globalName]) loadLibWithFallback(globalName, urls, idx+1); }, 6000);
}
loadLibWithFallback('Hls', [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js',
  'https://unpkg.com/hls.js@1.5.13/dist/hls.min.js'
]);
loadLibWithFallback('dashjs', [
  'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.all.min.js',
  'https://unpkg.com/dashjs@4.7.4/dist/dash.all.min.js'
]);
loadLibWithFallback('mpegts', [
  'https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js',
  'https://unpkg.com/mpegts.js@1.7.3/dist/mpegts.min.js'
]);
loadLibWithFallback('shaka', [
  'https://cdn.jsdelivr.net/npm/shaka-player@4.10.5/dist/shaka-player.compiled.js',
  'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.10.5/shaka-player.compiled.js',
  'https://unpkg.com/shaka-player@4.10.5/dist/shaka-player.compiled.js'
]);
function waitForLib(globalName, maxMs){
  return new Promise(resolve=>{
    if (window[globalName]) return resolve(true);
    const start = Date.now();
    const iv = setInterval(()=>{
      if (window[globalName]){ clearInterval(iv); resolve(true); }
      else if (Date.now() - start > maxMs){ clearInterval(iv); resolve(false); }
    }, 200);
  });
}
