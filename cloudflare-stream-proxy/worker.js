// stream-proxy (نسخة Cloudflare Workers) — نفس منطق نسخة Supabase حرفيًا، بس بصيغة Workers.
// الهدف: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https، ويعيد كتابة روابط
// مانيفست HLS الداخلية (مقاطع + مفاتيح تشفير) لتمر عبر نفس البروكسي، مع تمرير المقاطع الخام كتدفق حقيقي.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
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

    // تمرير خام لطلبات غير GET/HEAD (تحدي رخصة DRM بصيغة POST مثلاً) — بدون أي تحليل/إعادة كتابة
    // للجسم (هذا بيانات ثنائية للايسنس، مو مانيفست)، فقط تمرير الميثود + الهيدرز المهمة + الجسم كما
    // هي، وإرجاع رد سيرفر الترخيص خام (status + body) زي ما هو حتى ينجح EME بالمتصفح.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const fwdHeaders = new Headers();
      const skip = new Set(["host", "origin", "referer", "cookie", "content-length"]);
      for (const [k, v] of req.headers) {
        if (!skip.has(k.toLowerCase())) fwdHeaders.set(k, v);
      }
      if (!fwdHeaders.has("user-agent")) fwdHeaders.set("User-Agent", userAgent);

      const bodyBuf = req.body ? await req.arrayBuffer() : undefined;
      let licenseResp;
      try {
        licenseResp = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: fwdHeaders,
          body: bodyBuf,
        });
      } catch (e) {
        return new Response(`Upstream fetch failed: ${e}`, { status: 502, headers: CORS_HEADERS });
      }
      const outHeaders = new Headers(CORS_HEADERS);
      const ct = licenseResp.headers.get("content-type");
      if (ct) outHeaders.set("Content-Type", ct);
      return new Response(licenseResp.body, { status: licenseResp.status, headers: outHeaders });
    }

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

      // media= و initialization= بـSegmentTemplate كثيرًا ما تحتوي متغيرات قوالب DASH حية
      // ($Number$, $Time$, $Bandwidth$, $RepresentationID$, $$) لازم تبقى علامة $ حرفية عشان
      // المشغل (شاكا/dash.js) يقدر يستبدلها برقم/وقت المقطع الفعلي وقت الطلب. لو مرّرناها زي ما
      // هي جوا proxify()، فـencodeURIComponent يحوّل $ إلى %24 ويكسر القالب بالكامل بصمت — كل
      // طلبات المقاطع تصير لرابط وهمي واحد ثابت (أو تفشل)، رغم إن المانفست والجودات نفسها تبقى
      // تتحلل بنجاح تام (لأنها ما تعتمد على القالب) — بالضبط سلوك "يجيب الجودات بس ما يشتغل".
      // الحل: نحمي رموز $...$ بعناصر نائبة قبل الترميز، ونرجعها حرفية بعده.
      const DASH_TOKEN_RE = /\$(Number|Time|Bandwidth|RepresentationID|SubNumber)(%0\d+d)?\$|\$\$/g;
      const proxifyTemplate = (raw) => {
        const tokens = [];
        const guarded = raw.replace(DASH_TOKEN_RE, (m) => {
          tokens.push(m);
          return `__DASHTOK${tokens.length - 1}__`;
        });
        let out = proxify(guarded);
        tokens.forEach((tok, i) => { out = out.split(`__DASHTOK${i}__`).join(tok); });
        return out;
      };

      const rewritten = text
        .replace(/(<BaseURL[^>]*>)([\s\S]*?)(<\/BaseURL>)/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`)
        .replace(/(initialization=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxifyTemplate(url)}${close}`)
        .replace(/(media=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxifyTemplate(url)}${close}`)
        .replace(/(<SegmentURL[^>]*\bmedia=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`);

      return new Response(rewritten, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/dash+xml",
          "Cache-Control": "no-store",
        },
      });
    }

    if (isManifest) {
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
