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
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// نفس هويات User-Agent المتاحة بنسخة Workers، لضمان تطابق سلوك ?ua=xxx بين البروكسيين
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
  // نلتقط apikey من الطلب الحالي (سواء جاء بترويسة أو بارامتر رابط) ونمرره لكل رابط مقطع/مانفست
  // فرعي نعيد كتابته — وإلا كل طلب لاحق (مقاطع، مانفستات متداخلة) يرجع "No API key found in request"
  // من بوابة Supabase حتى لو الطلب الأول نجح.
  const incomingApiKey = reqUrl.searchParams.get("apikey") || req.headers.get("apikey") || "";

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
    let licenseResp: Response;
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
  // ⚠️ إصلاح مهم: بيئة تشغيل Supabase Edge Functions تسلّم للفنكشن req.url وقد شالت منه بادئة
  // التوجيه "/functions/v1/stream-proxy" (تشوف الفنكشن نفسها فقط، مو المسار العام الكامل). لو
  // بنينا proxyBase من reqUrl.pathname مباشرة، كل روابط المقاطع اللي نعيد كتابتها بالمانفست تطلع
  // ناقصة هالبادئة → Supabase ترفضها بخطأ "requested path is invalid" لأي طلب مقطع لاحق، حتى لو
  // المصدر نفسه سليم تمامًا. المسار ثابت دايمًا لهذي الفنكشن، فنثبّته صراحة بدل الاعتماد على
  // reqUrl.pathname المتقلب.
  const proxyBase = `${reqUrl.origin}/functions/v1/stream-proxy`;

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
  const trimmedHead = headSnippet.trimStart();
  const isManifest = trimmedHead.startsWith("#EXTM3U");
  // DASH: نفس منطق نسخة Workers حرفيًا — يعتمد على أول بايتات الرد (XML) لا اسم الملف إطلاقًا
  const isMpd = /^<\?xml|^<mpd\b/i.test(trimmedHead);

  if (isMpd) {
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
        const akParam = incomingApiKey ? `&apikey=${encodeURIComponent(incomingApiKey)}` : "";
        return `${proxyBase}?url=${encodeURIComponent(abs)}&ua=${uaKey}${akParam}`;
      } catch {
        return raw;
      }
    };

    // media= و initialization= بـSegmentTemplate كثيرًا ما تحتوي متغيرات قوالب DASH حية
    // ($Number$, $Time$, $Bandwidth$, $RepresentationID$, $$) لازم تبقى علامة $ حرفية عشان
    // المشغل (شاكا/dash.js) يقدر يستبدلها برقم/وقت المقطع الفعلي وقت الطلب. لو مرّرناها زي ما
    // هي جوا proxify()، فـencodeURIComponent يحوّل $ إلى %24 ويكسر القالب بالكامل بصمت — كل
    // طلبات المقاطع تصير لرابط وهمي واحد ثابت (أو تفشل)، رغم إن المانفست والجودات نفسها تبقى
    // تتحلل بنجاح تام (لأنها ما تعتمد على القالب). الحل: نحمي رموز $...$ بعناصر نائبة قبل
    // الترميز، ونرجعها حرفية بعده.
    const DASH_TOKEN_RE = /\$(Number|Time|Bandwidth|RepresentationID|SubNumber)(%0\d+d)?\$|\$\$/g;
    const proxifyTemplate = (raw: string) => {
      const tokens: string[] = [];
      const guarded = raw.replace(DASH_TOKEN_RE, (m) => {
        tokens.push(m);
        return `__DASHTOK${tokens.length - 1}__`;
      });
      let out = proxify(guarded);
      tokens.forEach((tok, i) => { out = out.split(`__DASHTOK${i}__`).join(tok); });
      return out;
    };

    const rewrittenMpd = text
      .replace(/(<BaseURL[^>]*>)([\s\S]*?)(<\/BaseURL>)/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`)
      .replace(/(initialization=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxifyTemplate(url)}${close}`)
      .replace(/(media=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxifyTemplate(url)}${close}`)
      .replace(/(<SegmentURL[^>]*\bmedia=")([^"]+)(")/gi, (_m, open, url, close) => `${open}${proxify(url)}${close}`);

    return new Response(rewrittenMpd, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
      },
    });
  }

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

    const akParam = incomingApiKey ? `&apikey=${encodeURIComponent(incomingApiKey)}` : "";
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
              return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${akParam}"`;
            } catch {
              return _m;
            }
          });
        }
        // سطر رابط عادي (مقطع .ts أو قائمة فرعية .m3u8) — نحوّله لرابط مطلق ثم نمرّره عبر نفس البروكسي
        try {
          const abs = new URL(trimmed, targetUrl).toString();
          return `${proxyBase}?url=${encodeURIComponent(abs)}${akParam}`;
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
