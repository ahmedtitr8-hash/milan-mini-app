import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  // معالجة طلبات OPTIONS المسبقة لفك قيود CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const reqUrl = new URL(req.url)
    const targetUrl = reqUrl.searchParams.get('url')
    const uaParam = reqUrl.searchParams.get('ua')

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing "url" query parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // تحديد الهوية المستخدمة لجلب البث (User-Agent)
    let userAgent = 'okhttp/4.9.0'
    if (uaParam === 'mx') {
      userAgent = 'MXPlayer/1.35.0'
    }

    // تمرير هيدر Range إن وجد (بعض سيرفرات Xtream تتطلبه ولا تستجيب بدونه)
    const rangeHeader = req.headers.get('range')

    // جلب تدفق البث مباشرة من سيرفر Xtream الأصلي
    const upstreamResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Connection': 'keep-alive',
        ...(rangeHeader ? { 'Range': rangeHeader } : {}),
      },
      redirect: 'follow',
    })

    if (!upstreamResponse.ok) {
      return new Response(`Upstream server returned status ${upstreamResponse.status}`, {
        status: upstreamResponse.status,
        headers: corsHeaders,
      })
    }

    const upstreamContentType = (upstreamResponse.headers.get('content-type') || '').toLowerCase()

    // بعض سيرفرات IPTV ترجع 200 OK مع صفحة HTML/JSON للخطأ (رابط منتهي/محظور)
    // بدل تمريرها للمشغل على أنها فيديو (وهو ما يسبب mpegts-fatal:FormatUnsupported)، نكشفها هنا ونرجع خطأ واضح
    const looksLikeErrorPage = upstreamContentType.includes('text/html') || upstreamContentType.includes('application/json')
    if (looksLikeErrorPage) {
      const bodyText = await upstreamResponse.text()
      return new Response(JSON.stringify({
        error: 'Upstream returned a non-stream response (likely invalid/expired link)',
        contentType: upstreamContentType,
        preview: bodyText.slice(0, 300),
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // تجهيز الهيدرات الخاصة بالتدفق الحي (Streaming) لمنع التخزين المؤقت والتعليق
    const responseHeaders = new Headers(corsHeaders)

    const isM3U8 = /\.m3u8(\?|#|$)/i.test(targetUrl) || upstreamContentType.includes('mpegurl') || upstreamContentType.includes('vnd.apple.mpegurl')

    if (isM3U8) {
      // manifest نصي: نعيد كتابة كل الروابط بداخله (segments/keys/الـ variant playlists) لتمر عبر نفس البروكسي
      // وإلا فالمتصفح يحاول يجيب الأجزاء مباشرة من سيرفر Xtream فيفشل بسبب الـ CORS أو الـ User-Agent
      const manifestText = await upstreamResponse.text()
      const base = new URL(targetUrl)
      const rewritten = manifestText.split('\n').map(line => {
        const trimmed = line.trim()
        if (!trimmed) return line

        // سطور EXT-X-KEY / EXT-X-MAP اللي فيها URI="..."
        if (trimmed.startsWith('#')) {
          const uriMatch = trimmed.match(/URI="([^"]+)"/i)
          if (uriMatch) {
            const abs = new URL(uriMatch[1], base).toString()
            const proxied = `${reqUrl.origin}${reqUrl.pathname}?url=${encodeURIComponent(abs)}${uaParam ? `&ua=${uaParam}` : ''}`
            return line.replace(uriMatch[1], proxied)
          }
          return line
        }

        // سطر رابط عادي (segment .ts أو playlist فرعي .m3u8)
        const abs = new URL(trimmed, base).toString()
        return `${reqUrl.origin}${reqUrl.pathname}?url=${encodeURIComponent(abs)}${uaParam ? `&ua=${uaParam}` : ''}`
      }).join('\n')

      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      responseHeaders.set('Pragma', 'no-cache')
      responseHeaders.set('Expires', '0')
      return new Response(rewritten, { status: 200, headers: responseHeaders })
    }

    // التأكد من تعيين نوع المحتوى المناسب لتدفق TS
    const contentType = upstreamContentType || 'video/mp2t'
    responseHeaders.set('Content-Type', contentType)
    const contentLength = upstreamResponse.headers.get('content-length')
    if (contentLength) responseHeaders.set('Content-Length', contentLength)
    const contentRange = upstreamResponse.headers.get('content-range')
    if (contentRange) responseHeaders.set('Content-Range', contentRange)
    responseHeaders.set('Accept-Ranges', 'bytes')

    // إيقاف أي Buffering أو Caching
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    responseHeaders.set('Pragma', 'no-cache')
    responseHeaders.set('Expires', '0')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')

    // تمرير جسم الاستجابة (ReadableStream) فورًا ودون انتظار
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status === 206 ? 206 : 200,
      headers: responseHeaders,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})