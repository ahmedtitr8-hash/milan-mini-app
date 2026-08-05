// stream-proxy (نسخة Cloudflare Workers)
// الهدف: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https، ويعيد كتابة روابط
// مانيفست HLS الداخلية (مقاطع + مفاتيح تشفير) لتمر عبر نفس البروكسي، مع تمرير المقاطع الخام كتدفق حقيقي.
//
// وضعان:
//   1) الوضع القديم ?url=<رابط>&ua=<هوية>          -> للـ m3u8/mp4/ts وغيرها (زي ما كان تمامًا)
//   2) وضع جديد /dproxy/<token>/<اسم ملف>          -> مخصص لمانيفست MPD (DASH) لما يكون معه ترويسات
//      إضافية (Referer/User-Agent/Origin/Cookie/مخصصة) ما يقدر المتصفح يرسلها مباشرة. الاعتماد على
//      المسار (لا ?url=) مهم عشان الروابط النسبية جوا المانيفست (BaseURL/SegmentTemplate) تنحل صح
//      تلقائيًا من طرف dash.js لأنها بتبقى بنفس مسار /dproxy/<token>/.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// هويات User-Agent متاحة للاختيار عبر ?ua=xxx بنداء الرابط. الافتراضي (ما فيه ?ua أو قيمة غير معروفة)
// يبقى okhttp/4.9.0 بالضبط زي قبل — ما تغير سلوك أي مستخدم حالي للبروكسي بدون هذا البارامتر.
const UA_PRESETS = {
  okhttp: "okhttp/4.9.0",
  vlc: "VLC/3.0.20 LibVLC/3.0.20",
  mx: "MXPlayer/1.47.5 (Linux; Android 13) ExoPlayerLib/2.18.1",
  tivimate: "TiviMate/4.7.0 (Linux;Android 11) ExoPlayerLib/2.18.1",
  smarters: "IPTVSmartersPro/1.0 (Linux;Android 12) ExoPlayerLib/2.16.1",
  gse: "GSE_SMART_IPTV/1.0 (Linux; Android 12)",
  perfect: "Perfect Player/1.6 (Linux;Android 11)",
  kodi: "Kodi/20.2 (Linux; Android 12) Android/12 App_Bitness/64 Version/20.2-(20.2.0)",
};

// ============== أدوات base64url (متوافقة مع نفس الترميز المستخدم بـ player.html) ==============
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// يبني كائن ترويسات upstream: افتراضي User-Agent + أي ترويسات إضافية ممرَّرة (تكتب فوق الافتراضي لو تكررت)
function buildUpstreamHeaders(extra) {
  const headers = { "User-Agent": UA_PRESETS.okhttp };
  if (extra) {
    for (const k in extra) {
      if (extra[k]) headers[k] = String(extra[k]);
    }
  }
  return headers;
}

// ============== إعادة كتابة روابط MPD/DASH الداخلية (مطلقة فقط — النسبية تنحل تلقائيًا عبر مسار /dproxy/) ==============
function rewriteMpd(text, originBase, headers) {
  function proxiedAbsolute(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const dir = u.origin + u.pathname.replace(/[^/]*$/, "");
      const filename = u.pathname.split("/").pop() || "";
      const token = b64urlEncode(JSON.stringify({ d: dir, h: headers || {} }));
      let proxied = `${originBase}/dproxy/${token}/${filename}`;
      if (u.search) proxied += u.search;
      return proxied;
    } catch {
      return null;
    }
  }
  text = text.replace(/<BaseURL>\s*(https?:\/\/[^<\s]+)\s*<\/BaseURL>/gi, (m, url) => {
    const p = proxiedAbsolute(url);
    return p ? `<BaseURL>${p}</BaseURL>` : m;
  });
  text = text.replace(/(media|initialization)="(https?:\/\/[^"]+)"/gi, (m, attr, url) => {
    const p = proxiedAbsolute(url);
    return p ? `${attr}="${p}"` : m;
  });
  return text;
}

// يجلب upstream ويعيد تمرير الرد: يكتشف مانيفست (HLS أو MPD) عبر أول جزء من الرد الفعلي، ويرجّع
// النوعين بإعادة كتابة مناسبة، وأي شيء غير هذا (مقاطع فيديو/صوت خام) كتدفق حقيقي بدون تعديل.
async function fetchAndRelay({ target, upstreamHeaders, rewriteMode, originBase, headersForRewrite }) {
  let upstream;
  try {
    upstream = await fetch(target.toString(), { headers: upstreamHeaders, redirect: "follow" });
  } catch (e) {
    return new Response(`Upstream fetch failed: ${e}`, { status: 502, headers: CORS_HEADERS });
  }
  if (!upstream.ok) {
    return new Response(`Upstream returned ${upstream.status}`, { status: upstream.status, headers: CORS_HEADERS });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const reader = upstream.body?.getReader();
  if (!reader) {
    return new Response("Upstream body unavailable", { status: 502, headers: CORS_HEADERS });
  }
  const { value: firstChunk, done: firstDone } = await reader.read();
  const headSnippet = firstChunk
    ? new TextDecoder("utf-8", { fatal: false }).decode(firstChunk.slice(0, 2048))
    : "";
  const isHls = headSnippet.trimStart().startsWith("#EXTM3U");
  const isMpd = /<mpd[\s>]/i.test(headSnippet);

  if (isHls || isMpd) {
    const chunks = firstChunk ? [firstChunk] : [];
    if (!firstDone) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    }
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { combined.set(c, offset); offset += c.length; }
    const text = new TextDecoder("utf-8").decode(combined);

    if (isMpd) {
      const rewritten = rewriteMpd(text, originBase, headersForRewrite);
      return new Response(rewritten, {
        headers: { ...CORS_HEADERS, "Content-Type": "application/dash+xml", "Cache-Control": "no-store" },
      });
    }

    // HLS — فقط بوضع ?url= القديم (rewriteMode='query') نعيد كتابة الأسطر بنفس الأسلوب السابق تمامًا
    if (rewriteMode && rewriteMode.type === "query") {
      const { proxyBase, targetUrl, uaKey, xh } = rewriteMode;
      const suffix = (xh ? `&xh=${xh}` : "") + (uaKey ? `&ua=${uaKey}` : "");
      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/i, (_m, uri) => {
              try {
                const abs = new URL(uri, targetUrl).toString();
                return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${suffix}"`;
              } catch {
                return _m;
              }
            });
          }
          try {
            const abs = new URL(trimmed, targetUrl).toString();
            return `${proxyBase}?url=${encodeURIComponent(abs)}${suffix}`;
          } catch {
            return line;
          }
        })
        .join("\n");
      return new Response(rewritten, {
        headers: { ...CORS_HEADERS, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    }

    // HLS جاي عبر /dproxy/ (نادر) — نرجّعه كما هو، الروابط الداخلية غالبًا نسبية وتنحل تلقائيًا
    return new Response(text, {
      headers: { ...CORS_HEADERS, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      if (firstChunk) controller.enqueue(firstChunk);
      if (!firstDone) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      }
      controller.close();
    },
    cancel() {
      try { reader.cancel(); } catch (_e) { /* ignore */ }
    },
  });

  return new Response(stream, {
    headers: { ...CORS_HEADERS, "Content-Type": contentType || "video/mp2t", "Cache-Control": "no-store" },
  });
}

// ============== وضع /dproxy/<token>/<filename...> ==============
async function handleDashProxy(reqUrl) {
  const parts = reqUrl.pathname.split("/").filter(Boolean); // ["dproxy", token, ...rest]
  const token = parts[1];
  const rest = decodeURIComponent(parts.slice(2).join("/"));
  if (!token || !rest) {
    return new Response("Invalid dproxy path", { status: 400, headers: CORS_HEADERS });
  }
  let meta;
  try {
    meta = JSON.parse(b64urlDecode(token));
  } catch {
    return new Response("Invalid proxy token", { status: 400, headers: CORS_HEADERS });
  }
  let target;
  try {
    target = new URL(rest, meta.d);
  } catch {
    return new Response("Invalid target url", { status: 400, headers: CORS_HEADERS });
  }
  reqUrl.searchParams.forEach((v, k) => { target.searchParams.set(k, v); });

  const originBase = `${reqUrl.origin}`;
  return fetchAndRelay({
    target,
    upstreamHeaders: buildUpstreamHeaders(meta.h),
    originBase,
    headersForRewrite: meta.h || {},
  });
}

// ============== الوضع القديم ?url=<رابط> ==============
async function handleLegacyProxy(reqUrl) {
  const target = reqUrl.searchParams.get("url");
  if (!target) {
    return new Response("Missing 'url' query param", { status: 400, headers: CORS_HEADERS });
  }
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid target url", { status: 400, headers: CORS_HEADERS });
  }

  const uaKey = (reqUrl.searchParams.get("ua") || "okhttp").toLowerCase();
  const xhRaw = reqUrl.searchParams.get("xh") || "";
  let extraHeaders = {};
  if (xhRaw) {
    try { extraHeaders = JSON.parse(b64urlDecode(xhRaw)); } catch { extraHeaders = {}; }
  }
  const upstreamHeaders = buildUpstreamHeaders(Object.assign(
    { "User-Agent": UA_PRESETS[uaKey] || UA_PRESETS.okhttp },
    extraHeaders
  ));

  const proxyBase = `${reqUrl.origin}${reqUrl.pathname}`;
  return fetchAndRelay({
    target: targetUrl,
    upstreamHeaders,
    rewriteMode: { type: "query", proxyBase, targetUrl, uaKey, xh: xhRaw || null },
    originBase: reqUrl.origin,
    headersForRewrite: extraHeaders,
  });
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const reqUrl = new URL(req.url);
    if (reqUrl.pathname.startsWith("/dproxy/")) {
      return handleDashProxy(reqUrl);
    }
    return handleLegacyProxy(reqUrl);
  },
};
