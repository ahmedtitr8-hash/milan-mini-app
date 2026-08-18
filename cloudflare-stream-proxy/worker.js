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
          // بعض مصادر DASH/HLS ترفض الطلبات اللي ما فيها Referer يطابق دومين المصدر نفسه (حماية
          // ضد السحب المباشر) — نرسل Referer لنفس دومين الهدف، يطابق تمامًا لو المستخدم فتح
          // الرابط مباشرة بمتصفحه (نفس السلوك اللي أثبتنا إنه ينجح)
          "Referer": `${targetUrl.protocol}//${targetUrl.host}/`,
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
      ? new TextDecoder("utf-8", { fatal: false }).decode(firstChunk.slice(0, 64))
      : "";
    const trimmedHead = headSnippet.trimStart();
    const isManifest = trimmedHead.startsWith("#EXTM3U");
    // DASH: نفس منطق نسخة Supabase حرفيًا — يعتمد على أول بايتات الرد (XML) لا اسم الملف إطلاقًا
    const isMpd = /^<\?xml|^<mpd\b/i.test(trimmedHead);

    if (isMpd) {
      try {
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

        const proxify = (raw) => {
          try {
            const abs = new URL(raw.trim(), targetUrl).toString();
            return `${proxyBase}?url=${encodeURIComponent(abs)}&ua=${uaKey}`;
          } catch {
            return raw;
          }
        };

        const rewritten = text
          .replace(/(<BaseURL[^>]*>)([\s\S]*?)(<\/BaseURL>)/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`)
          .replace(/(initialization=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`)
          .replace(/(media=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`)
          .replace(/(<SegmentURL[^>]*\bmedia=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`);

        return new Response(rewritten, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/dash+xml",
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        // مهم: بدون هذا try/catch، أي خطأ بمعالجة نص MPD (تنسيق غير متوقع، ترميز غريب)
        // يخلي Cloudflare يرجّع صفحة خطأ افتراضية بلا هيدرات CORS إطلاقًا — يوصل المتصفح
        // كـ"خطأ CORS" مُضلّل تمامًا بينما السبب الحقيقي معالجة نص فشلت، مو CORS
        return new Response(`MPD processing failed: ${e}`, { status: 502, headers: CORS_HEADERS });
      }
    }

    if (isManifest) {
      try {
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
      } catch (e) {
        // نفس الإصلاح: نحمي معالجة HLS من نفس نمط الانهيار الصامت
        return new Response(`HLS manifest processing failed: ${e}`, { status: 502, headers: CORS_HEADERS });
      }
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
