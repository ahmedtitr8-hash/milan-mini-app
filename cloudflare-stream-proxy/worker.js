// stream-proxy (نسخة Cloudflare Workers) — نفس منطق نسخة Supabase حرفيًا، بس بصيغة Workers.
// الهدف: يجلب رابط بث http (غير مؤمّن) من طرف السيرفر ويعيد تقديمه كـ https، ويعيد كتابة روابط
// مانيفست HLS الداخلية (مقاطع + مفاتيح تشفير) لتمر عبر نفس البروكسي، مع تمرير المقاطع الخام كتدفق حقيقي.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
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

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: {
          "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
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
    const isManifest = headSnippet.trimStart().startsWith("#EXTM3U");

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
                return `URI="${proxyBase}?url=${encodeURIComponent(abs)}"`;
              } catch {
                return _m;
              }
            });
          }
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
