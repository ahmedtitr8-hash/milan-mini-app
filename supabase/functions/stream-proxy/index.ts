// stream-proxy: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https
// حتى يقدر المشغل في الميني آب (صفحة https) يشغّله بشكل طبيعي بدون أي قيد Mixed Content من المتصفح.
// يدعم: قوائم HLS (m3u8 رئيسية وفرعية) مع إعادة كتابة كل الروابط الداخلية (مقاطع + مفاتيح تشفير)
// لتمر أيضًا عبر هذا البروكسي نفسه، بالإضافة لتمرير المقاطع الخام (.ts وغيرها) كما هي بدون تعديل.

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

  // بعض بورتالات Xtream/IPTV ترفض المتصفحات العادية وتطلب user-agent مألوف مثل VLC
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
  const isManifest =
    /\.m3u8?(\?|$)/i.test(targetUrl.pathname) ||
    contentType.includes("mpegurl") ||
    contentType.includes("m3u") ||
    contentType.includes("x-mpegURL");

  const proxyBase = `${reqUrl.origin}${reqUrl.pathname}`;

  if (isManifest) {
    const text = await upstream.text();
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

  // مقطع فيديو/صوت أو أي محتوى آخر (مثل مفتاح تشفير .key): يمرَّر بايت لبايت بدون أي تعديل
  return new Response(upstream.body, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": contentType || "video/mp2t",
      "Cache-Control": "no-store",
    },
  });
});
