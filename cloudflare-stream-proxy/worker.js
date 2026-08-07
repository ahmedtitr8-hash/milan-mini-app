// stream-proxy (نسخة Cloudflare Workers) — نفس منطق نسخة Supabase حرفيًا، بس بصيغة Workers.
// الهدف: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https، ويعيد كتابة روابط
// مانيفست HLS الداخلية (مقاطع + مفاتيح تشفير) لتمر عبر نفس البروكسي، مع تمرير المقاطع الخام كتدفق حقيقي.

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

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(req.url);
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
    const userAgent = UA_PRESETS[uaKey] || UA_PRESETS.okhttp;

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: {
          "User-Agent": userAgent,
        },
        redirect: "follow",
      });
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e}`, { status: 502, headers: CORS_HEADERS });
    }

    if (!upstream.ok) {
      return new Response(`Upstream returned ${upstream.status}`, {
        status: upstream.status,
        headers: CORS_HEADERS,
      });
    }

    const contentType = upstream.headers.get("content-type") || "";
    const proxyBase = `${reqUrl.origin}${reqUrl.pathname}`;

    const reader = upstream.body?.getReader();
    if (!reader) {
      return new Response("Upstream body unavailable", { status: 502, headers: CORS_HEADERS });
    }
    const { value: firstChunk, done: firstDone } = await reader.read();
    const headSnippet = firstChunk
      ? new TextDecoder("utf-8", { fatal: false }).decode(firstChunk.slice(0, 500))
      : "";
    const trimmedHead = headSnippet.trimStart();
    const isHlsManifest = trimmedHead.startsWith("#EXTM3U");
    // كشف مانفست DASH لا يعتمد على امتداد الرابط (index.mpd أو أي اسم ثاني) — نفس فلسفة كشف
    // #EXTM3U فوق: نتحقق من أول بايتات الرد الفعلية (وسم <MPD أو تصريح XML) بغض النظر عن اسم الملف
    const isDashManifest =
      contentType.toLowerCase().includes("dash+xml") || /<MPD[\s>]/i.test(trimmedHead);

    if (isHlsManifest) {
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

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/i, (_m, uri) => {
              try {
                const abs = new URL(uri, targetUrl).toString();
                return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&ua=${uaKey}"`;
              } catch {
                return _m;
              }
            });
          }
          try {
            const abs = new URL(trimmed, targetUrl).toString();
            return `${proxyBase}?url=${encodeURIComponent(abs)}&ua=${uaKey}`;
          } catch {
            return line;
          }
        })
        .join("\n");

      return new Response(rewritten, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      });
    }

    if (isDashManifest) {
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

      // نحول أي رابط داخل المانفست (BaseURL / initialization / media / sourceURL) لرابط مطلق
      // يمر عبر نفس البروكسي — تمامًا زي HLS فوق، بغض النظر عن اسم ملف الـmpd نفسه أو شكل الروابط
      // بداخله (نسبية أو مطلقة). $Number$/$Time$/... (قوالب SegmentTemplate) تُحفظ كما هي حرفيًا
      // (encodeURIComponent يحوّلها %24 فنعيدها $ يدويًا) عشان المشغل يقدر يعوّض فيها لاحقًا،
      // و& تتحول &amp; لأن القيمة تنزرع داخل خاصية/نص XML ولازم تكون سليمة XML-wise.
      const wrapXml = (raw) => {
        try {
          const abs = new URL(raw.trim(), targetUrl).toString();
          const encoded = encodeURIComponent(abs).replace(/%24/g, "$");
          const proxied = `${proxyBase}?url=${encoded}&ua=${uaKey}`;
          return proxied.replace(/&/g, "&amp;");
        } catch {
          return raw;
        }
      };

      const rewrittenMpd = text
        .replace(/(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi, (_m, open, url, close) => `${open}${wrapXml(url)}${close}`)
        .replace(/\b(initialization|media|sourceURL)(\s*=\s*)"([^"]*)"/gi, (_m, attr, eq, url) => {
          if (!url) return _m;
          return `${attr}${eq}"${wrapXml(url)}"`;
        });

      return new Response(rewrittenMpd, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/dash+xml",
          "Cache-Control": "no-store",
        },
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
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType || "video/mp2t",
        "Cache-Control": "no-store",
      },
    });
  },
};
