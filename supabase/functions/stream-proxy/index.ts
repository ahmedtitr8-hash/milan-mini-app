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
    // الافتراضي (بدون ?ua=) يبقى VLC كما هو دايمًا — ما يتغيّر شي لمصادر Xtream/IPTV
    // الحالية. "?ua=browser" خيار إضافي جديد بس لمصادر عامة (زي بوتات تحويل فيديو
    // تيليجرام) تحجب توقيعات المشغلات وتقبل متصفح حقيقي عادي.
    const uaParam = reqUrl.searchParams.get("ua");
    const userAgent = uaParam === "browser"
      ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      : "VLC/3.0.20 LibVLC/3.0.20";
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": userAgent,
      "Referer": `${targetUrl.protocol}//${targetUrl.host}/`,
    };
    // نمرّر طلب الجزء (Range) من المتصفح للمصدر الأصلي — بدون هذا، تشغيل وتقديم
    // الفيديوهات الكبيرة عبر البروكسي يفشل أو يتوقف (المتصفح يطلب الملف على أجزاء،
    // مو دفعة وحدة، خصوصًا لملفات mp4 كبيرة).
    const range = req.headers.get("range");
    if (range) upstreamHeaders["Range"] = range;
    upstream = await fetch(targetUrl.toString(), {
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch (e) {
    return new Response(`Upstream fetch failed: ${e}`, { status: 502, headers: CORS_HEADERS });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Upstream returned ${upstream.status}`, {
      status: upstream.status,
      headers: CORS_HEADERS,
    });
  }

  // بعض سيرفرات "تحويل فيديو تيليجرام لرابط" (زي بوتات koyeb) ما ترجع Content-Type صحيح
  // (فاضي أو application/octet-stream عام) — لو تركناها تنزل على الافتراضي "video/mp2t"
  // بالأسفل، عنصر <video> بالمتصفح يفسّر ملف mp4 عادي كأنه بث MPEG-TS خام ويفشل التشغيل
  // بصمت (بينما مشغلات خارجية زي VLC/MX ما تهتم بالهيدر وتكتشف النوع من المحتوى نفسه).
  // الحل: لو الهيدر الجاي من المصدر فاضي/عام، نخمّن النوع من امتداد الرابط نفسه بدلًا من ذلك.
  const rawContentType = upstream.headers.get("content-type") || "";
  const isGenericContentType = !rawContentType || /^(application\/octet-stream|binary\/octet-stream|text\/plain)\b/i.test(rawContentType);
  const extToMime: Record<string, string> = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".ogv": "video/ogg",
  };
  let guessedContentType: string | null = null;
  if (isGenericContentType) {
    const lowerPath = targetUrl.pathname.toLowerCase();
    for (const ext in extToMime) {
      if (lowerPath.endsWith(ext)) { guessedContentType = extToMime[ext]; break; }
    }
  }
  const contentType = guessedContentType || rawContentType;
  // مهم: ما نبني proxyBase من reqUrl.origin/pathname — رنتايم إيدج سوبابيس يعرض على الفنكشن
  // رابط طلب داخلي مختلف عن الرابط العام (بروتوكول http بدل https، وبدون مقطع /functions/v1/)،
  // فأي رابط فرعي (جودة/مقطع) نعيد كتابته بهالطريقة يطلع مكسور وما يوصله المتصفح أبدًا — بينما
  // المانفست الرئيسي يشتغل عادي لأن طلبه الأول يجي من المتصفح مباشرة على الرابط العام الصحيح.
  // الحل: نثبّت الرابط العام الحقيقي لهالفنكشن صراحة بدل ما نشتقه من الطلب.
  const proxyBase = `https://ckriyvqnrzravknajckl.supabase.co/functions/v1/stream-proxy`;

  // نقرأ أول جزء فقط من الرد (لا الرد كامل) لنتحقق فعليًا هل هو نص مانيفست HLS أم بيانات ثنائية —
  // هذا أدق من الاعتماد على الامتداد/الترويسة فقط، وما يزال يحافظ على التدفق الحقيقي للمقاطع الكبيرة
  const reader = upstream.body?.getReader();
  if (!reader) {
    return new Response("Upstream body unavailable", { status: 502, headers: CORS_HEADERS });
  }
  // نلف قراءة الجزء الأول بـtry/catch: بدونها، أي خلل بالتدفق هنا (انقطاع مفاجئ من المصدر، أو
  // طلب Range غريب زي "آخر N بايت" ما يدعمه المصدر زين) يفجّر الفنكشن كاملة بخطأ غير معالج —
  // ورد الخطأ هذا يطلع بلا هيدرات CORS إطلاقًا (منصة سوبابيس ترجعه، مو الكود عندنا)، فيوصل
  // المتصفح كفشل تام، والفيديو بالمشغل يطلع له "إعادة المحاولة" بدل ما يشتغل أو يرجع خطأ مفهوم
  let firstChunk: Uint8Array | undefined;
  let firstDone: boolean;
  try {
    const result = await reader.read();
    firstChunk = result.value;
    firstDone = result.done;
  } catch (e) {
    return new Response(`Upstream stream read failed: ${e}`, { status: 502, headers: CORS_HEADERS });
  }
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
      try {
        if (firstChunk) controller.enqueue(firstChunk);
        if (!firstDone) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (e) {
        // نفس الحماية هنا: خلل أثناء التدفق (مو أول جزء بس) يقفل التدفق بخطأ مسيطر عليه
        // بدل ما يفجّر الفنكشن ويرجع كراش بلا CORS بمنتصف تنزيل الفيديو
        controller.error(e);
      }
    },
    cancel() {
      try { reader.cancel(); } catch (_e) { /* ignore */ }
    },
  });

  return new Response(stream, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": contentType || "video/mp2t",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      ...(upstream.headers.get("content-range")
        ? { "Content-Range": upstream.headers.get("content-range")! }
        : {}),
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length")! }
        : {}),
      "Cache-Control": "no-store",
    },
  });
});
