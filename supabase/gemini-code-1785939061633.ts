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

    // جلب تدفق البث مباشرة من سيرفر Xtream الأصلي
    const upstreamResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Connection': 'keep-alive',
      },
    })

    if (!upstreamResponse.ok) {
      return new Response(`Upstream server returned status ${upstreamResponse.status}`, {
        status: upstreamResponse.status,
        headers: corsHeaders,
      })
    }

    // تجهيز الهيدرات الخاصة بالتدفق الحي (Streaming) لمنع التخزين المؤقت والتعليق
    const responseHeaders = new Headers(corsHeaders)
    
    // التأكد من تعيين نوع المحتوى المناسب لتدفق TS
    const contentType = upstreamResponse.headers.get('content-type') || 'video/mp2t'
    responseHeaders.set('Content-Type', contentType)
    
    // إيقاف أي Buffering أو Caching
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    responseHeaders.set('Pragma', 'no-cache')
    responseHeaders.set('Expires', '0')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')

    // تمرير جسم الاستجابة (ReadableStream) فورًا ودون انتظار
    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})