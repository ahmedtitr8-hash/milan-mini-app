// supabase/functions/check-subscription/index.ts
// يتحقق أن initData موقّعة فعلًا من تيليجرام بمفتاح البوت (ما يقدر أي حد يزوّر user_id
// ويدّعي إنه مشترك)، وبعدها يسأل تيليجرام مباشرة (getChatMember) هل هذا الـ id فعلًا
// عضو بقناة *هذا النادي بالذات* (كل نادي له قناته الخاصة، محفوظة بجدول clubs).

const BOT_TOKEN     = Deno.env.get("BOT_TOKEN") || "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyInitData(initData: string, botToken: string): Promise<any | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs: string[] = [];
  for (const [k, v] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    pairs.push(`${k}=${v}`);
  }
  const dataCheckString = pairs.join("\n");

  const enc = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    "raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretKeyBytes = await crypto.subtle.sign("HMAC", webAppDataKey, enc.encode(botToken));
  const secretKey = await crypto.subtle.importKey(
    "raw", secretKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", secretKey, enc.encode(dataCheckString));
  const computedHash = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  if (computedHash !== hash) return null;

  // نرفض initData الأقدم من 24 ساعة كطبقة حماية إضافية ضد إعادة استخدام قديمة
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (authDate && (Date.now() / 1000 - authDate) > 86400) return null;

  const userStr = params.get("user");
  if (!userStr) return null;
  try { return JSON.parse(userStr); } catch { return null; }
}

// يجيب channel_id + رابط الدعوة لنادٍ معيّن من جدول clubs (قراءة عامة مسموحة أصلًا بالـ RLS)
async function getClubChannel(clubSlug: string): Promise<{ channelId: string; channelLink: string } | null> {
  const url = `${SUPABASE_URL}/rest/v1/clubs?slug=eq.${encodeURIComponent(clubSlug)}&select=telegram_channel_id,telegram_link`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const row = rows?.[0];
  if (!row || !row.telegram_channel_id) return null;
  return { channelId: row.telegram_channel_id, channelLink: row.telegram_link || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON) {
    return json({ ok: false, subscribed: false, error: "not_configured" }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const initData = body?.initData;
  const club = body?.club;
  if (!initData || typeof initData !== "string") {
    return json({ ok: false, subscribed: false, error: "no_init_data" });
  }
  if (!club || typeof club !== "string") {
    return json({ ok: false, subscribed: false, error: "no_club" });
  }

  const user = await verifyInitData(initData, BOT_TOKEN);
  if (!user || !user.id) {
    return json({ ok: false, subscribed: false, error: "invalid_init_data" });
  }

  const channel = await getClubChannel(club);
  if (!channel) {
    // ما فيه قناة محفوظة لهذا النادي بعد بجدول clubs — نتركه يمر بدل ما نقفل بالخطأ
    return json({ ok: true, subscribed: true, noChannelConfigured: true });
  }

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel.channelId)}&user_id=${user.id}`
    );
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      // خطأ من تيليجرام (مثلًا البوت مب أدمن بهالقناة) — نعتبره غير مشترك بدل ما نفشل الطلب
      return json({ ok: true, subscribed: false, channelLink: channel.channelLink });
    }

    const status = tgData.result?.status;
    const subscribed = ["member", "administrator", "creator"].includes(status);
    return json({ ok: true, subscribed, channelLink: channel.channelLink });
  } catch {
    return json({ ok: false, subscribed: false, error: "telegram_api_failed" });
  }
});
