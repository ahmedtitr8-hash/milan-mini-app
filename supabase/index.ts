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

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
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

  // نقرأ أول جزء فقط من الرد (لا الرد كامل) لنتحقق فعليًا هل هو نص مانيفست HLS أم بيانات ثنائية —
  // هذا أدق من الاعتماد على الامتداد/الترويسة فقط، وما يزال يحافظ على التدفق الحقيقي للمقاطع الكبيرة
  const reader = upstream.body?.getReader();
  if (!reader) {
    return new Response("Upstream body unavailable", { status: 502, headers: CORS_HEADERS });
  }
  const { value: firstChunk, done: firstDone } = await reader.read();
  const headSnippet = firstChunk
    ? new TextDecoder("utf-8", { fatal: false }).decode(firstChunk.slice(0, 64))
    : "";
  const isManifest = headSnippet.trimStart().startsWith("#EXTM3U");

  if (isManifest) {
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
              return `URI="${proxyBase}?url=${encodeURIComponent(abs)}"`;
            } catch {
              return _m;
            }
          });
        }
        // سطر رابط عادي (مقطع .ts أو قائمة فرعية .m3u8) — نحوّله لرابط مطلق ثم نمرّره عبر نفس البروكسي
        try {
          const abs = new URL(trimmed, targetUrl).toString();
          return `${proxyBase}?url=${encodeURIComponent(abs)}`;
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
