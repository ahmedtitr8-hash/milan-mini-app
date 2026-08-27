// stream-proxy: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https
// حتى يقدر المشغل في الميني آب (صفحة https) يشغّله بشكل طبيعي بدون أي قيد Mixed Content من المتصفح.
// يدعم: قوائم HLS (m3u8 رئيسية وفرعية) مع إعادة كتابة كل الروابط الداخلية (مقاطع + مفاتيح تشفير)
// لتمر أيضًا عبر هذا البروكسي نفسه، بالإضافة لتمرير المقاطع الخام (.ts وغيرها) كما هي (streaming حقيقي
// بلا تجميع كامل بالذاكرة أولاً) بدون تعديل.
//
// ⚠️ مهم جدًا: هذه الفانكشن لازم تُنشر بدون التحقق من JWT (verify_jwt = false)، راجع supabase/config.toml
//
// ⚠️ ملاحظة أساسية (إصلاح مهم): تحديد "هل الرد مانيفست m3u8 أو لا" لا يعتمد على امتداد الرابط أو ترويسة
// Content-Type فقط بعد الآن — كثير من روابط Xtream/IPTV تُعيد توجيه (redirect) لرابط CDN موقّع رقميًا
// بلا امتداد m3u8 وبلا ترويسة صحيحة، فكان القسم القديم يفوّت اكتشافها ويمرّرها كبيانات ثنائية خام دون
// إعادة كتابة روابطها الداخلية، فتنكسر القائمة بالكامل. الحل: نتحقق من أول بايتات الرد الفعلية (نقرأ أول
// جزء فقط، لا الرد كامل، حفاظًا على التدفق الحقيقي بلا تجميع للمقاطع الكبيرة) ونبحث عن توقيع "#EXTM3U".

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// نفس هويات User-Agent المتاحة بنسخة Cloudflare Workers — إصلاح 2026-08-18: قبل هذا
// التعديل كانت هذي الفانكشن تستخدم VLC ثابت دايمًا بدون أي خيار، وكانت أصلاً ما تدعم
// DASH/MPD إطلاقًا (بس HLS) — فلو صار تبديل احتياطي لها من Cloudflare، روابط MPD كانت
// توصل الشكل الخام بدون إعادة كتابة روابط المقاطع الداخلية، فتفشل بصمت من زاوية ثانية.
const UA_PRESETS: Record<string, string> = {
  okhttp: "okhttp/4.9.0",
  vlc: "VLC/3.0.20 LibVLC/3.0.20",
  mx: "MXPlayer/1.47.5 (Linux; Android 13) ExoPlayerLib/2.18.1",
  tivimate: "TiviMate/4.7.0 (Linux;Android 11) ExoPlayerLib/2.18.1",
  smarters: "IPTVSmartersPro/1.0 (Linux;Android 12) ExoPlayerLib/2.16.1",
  gse: "GSE_SMART_IPTV/1.0 (Linux; Android 12)",
  perfect: "Perfect Player/1.6 (Linux;Android 11)",
  kodi: "Kodi/20.2 (Linux; Android 12) Android/12 App_Bitness/64 Version/20.2-(20.2.0)",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) {
    return new Response("Missing 'url' query param", { status: 400, headers: CORS_HEADERS });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid target url", { status: 400, headers: CORS_HEADERS });
  }

  const uaKey = (reqUrl.searchParams.get("ua") || "vlc").toLowerCase();
  const userAgent = UA_PRESETS[uaKey] || UA_PRESETS.vlc;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": userAgent,
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

  // نقرأ أول جزء فقط من الرد (لا الرد كامل) لنتحقق فعليًا هل هو نص مانيفست HLS/DASH أم
  // بيانات ثنائية — أدق من الاعتماد على الامتداد/الترويسة فقط، ويحافظ على التدفق الحقيقي
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
  // DASH: نفس منطق نسخة Cloudflare حرفيًا — يعتمد على أول بايتات الرد (XML) لا اسم الملف
  const isMpd = /^<\?xml|^<mpd\b/i.test(trimmedHead);

  if (isMpd) {
    try {
      const chunks: Uint8Array[] = firstChunk ? [firstChunk] : [];
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

      const proxify = (raw: string) => {
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
      return new Response(`MPD processing failed: ${e}`, { status: 502, headers: CORS_HEADERS });
    }
  }

  if (isManifest) {
    try {
    // مانيفست: نص صغير دومًا، نقرأ بقية الرد كاملاً (لا مشكلة تجميعه، حجمه ضئيل) ونعيد كتابة روابطه
    const chunks: Uint8Array[] = firstChunk ? [firstChunk] : [];
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
          // بعض أسطر الوصف (مثل EXT-X-KEY لمفاتيح التشفير) تحمل أيضًا رابطًا داخل URI="..."
          return line.replace(/URI="([^"]+)"/i, (_m, uri) => {
            try {
              const abs = new URL(uri, targetUrl).toString();
              return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&ua=${uaKey}"`;
            } catch {
              return _m;
            }
          });
        }
        // سطر رابط عادي (مقطع .ts أو قائمة فرعية .m3u8) — نحوّله لرابط مطلق ثم نمرّره عبر نفس البروكسي
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
      return new Response(`HLS manifest processing failed: ${e}`, { status: 502, headers: CORS_HEADERS });
    }
  }

  // مقطع فيديو/صوت، أو تدفق MPEG-TS خام مستمر، أو أي محتوى آخر: يُمرَّر كتدفق حقيقي (لا يُجمَّع بالذاكرة)،
  // مع إعادة دمج أول جزء قرأناه بالمقدمة قبل باقي التدفق حتى لا نفقد أي بايت منه
  const stream = new ReadableStream<Uint8Array>({
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
});
