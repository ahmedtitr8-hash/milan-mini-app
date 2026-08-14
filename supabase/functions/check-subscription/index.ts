// supabase/functions/check-subscription/index.ts
// يتحقق أن initData موقّعة فعلًا من تيليجرام بمفتاح البوت (ما يقدر أي حد يزوّر user_id
// ويدّعي إنه مشترك)، وبعدها يسأل تيليجرام مباشرة (getChatMember) هل هذا الـ id فعلًا
// عضو بقناة *هذا النادي بالذات* (كل نادي له قناته الخاصة، محفوظة بجدول clubs).
//
// إشعارات الدخول (2026-08-14): بدل ما نرسل رسالة جديدة بكل فحص (كل 4 ثواني أثناء
// انتظار الاشتراك، وهذا كان يغرق المالك برسايل متكررة)، نرسل رسالة واحدة فقط لكل
// "زيارة" (فتح الصفحة)، ونعدّلها في مكانها لما تتغيّر الحالة الفعلية، بدل تكرارها.
// عداد "دخول اليوم" يزيد فقط عند دخول ناجح فعلي، ويُحسب من آخر 3 فجر بتوقيت السعودية.

const BOT_TOKEN        = Deno.env.get("BOT_TOKEN") || "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY") || "";
const OWNER_CHAT_ID    = "1459882979";
const REPORT_BOT_TOKEN = Deno.env.get("REPORT_BOT_TOKEN") || BOT_TOKEN;

// فحص جديد = مرّ أكثر من هالمدة من آخر فحص لنفس الشخص/النادي (متوافق مع دورة الفحص
// التلقائي كل 4 ثواني بـ gate.js — يعطينا هامش أمان كافٍ لغطاء أي تأخير شبكة عابر)
const SAME_VISIT_WINDOW_MS = 45_000;

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

// ============================================================
//  تنبيهات الأخطاء التشغيلية (إعدادات ناقصة، فشل تحقق التوقيع...) — تبقى كما كانت،
//  رسالة مستقلة لكل حالة، لأنها نادرة الحدوث وتحتاج انتباه فوري لما تصير.
// ============================================================
async function notifyOwnerError(text: string) {
  if (!REPORT_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${REPORT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OWNER_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {
    // ما نكسر الطلب الأصلي لو فشل إرسال التقرير نفسه
  }
}

// ============================================================
//  إشعار الدخول الموحّد (رسالة واحدة تتحدّث بمكانها)
// ============================================================
async function getNotifyState(tgUserId: number, club: string):
  Promise<{ messageId: number | null; lastStatus: string | null; isNewVisit: boolean }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_notify_state`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tg_user_id: tgUserId, p_club: club }),
    });
    const rows = await res.json();
    const r = rows?.[0];
    if (!r) return { messageId: null, lastStatus: null, isNewVisit: true };
    return { messageId: r.message_id ?? null, lastStatus: r.last_status ?? null, isNewVisit: !!r.is_new_visit };
  } catch {
    // لو فشل القراءة، نتصرف كأنها زيارة جديدة (أسلم من ضياع الإشعار كليًا)
    return { messageId: null, lastStatus: null, isNewVisit: true };
  }
}

async function setNotifyState(tgUserId: number, club: string, messageId: number | null, status: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_notify_state`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tg_user_id: tgUserId, p_club: club, p_message_id: messageId, p_status: status }),
    });
  } catch { /* ignore */ }
}

async function recordClubEntry(tgUserId: number, club: string): Promise<number | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_club_entry`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tg_user_id: tgUserId, p_club: club }),
    });
    const data = await res.json();
    if (typeof data === "number") return data;
    if (Array.isArray(data) && typeof data[0] === "number") return data[0];
    return null;
  } catch {
    return null;
  }
}

async function sendNewMessage(text: string): Promise<number | null> {
  if (!REPORT_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${REPORT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OWNER_CHAT_ID, text, parse_mode: "HTML" }),
    });
    const data = await res.json();
    return data?.result?.message_id ?? null;
  } catch {
    return null;
  }
}

async function editMessage(messageId: number, text: string) {
  if (!REPORT_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${REPORT_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OWNER_CHAT_ID, message_id: messageId, text, parse_mode: "HTML" }),
    });
  } catch { /* ignore */ }
}

// يقرر: نرسل رسالة جديدة، أو نعدّل الموجودة، أو ما نسوي شي أصلاً (نفس الحالة بنفس الزيارة)
async function reportEntry(tgUserId: number, club: string, subscribed: boolean, userLabel: string, status: string | undefined) {
  const newStatus = subscribed ? "member" : "rejected";
  const state = await getNotifyState(tgUserId, club);

  // العداد يزيد فقط لما الدخول ناجح فعليًا، ولأول مرة بهالزيارة (مو مع كل فحص متكرر لنفس الحالة)
  let entryCountToday: number | null = null;
  if (subscribed && (state.isNewVisit || state.lastStatus !== "member")) {
    entryCountToday = await recordClubEntry(tgUserId, club);
  }

  const countLine = entryCountToday !== null ? `\nعدد الدخول اليوم لهذا النادي: ${entryCountToday}` : "";
  const text = (subscribed
    ? `✅ دخول ناجح: ${userLabel} — نادي: ${club} — حالته بالقناة: ${status}`
    : `🚫 دخول مرفوض: ${userLabel} — نادي: ${club} — حالته بالقناة: ${status || "غير عضو"}`
  ) + countLine;

  if (state.isNewVisit || !state.messageId) {
    // زيارة جديدة كليًا (أول فحص، أو مرّ وقت طويل منذ آخر فحص) — رسالة جديدة
    const newMsgId = await sendNewMessage(text);
    await setNotifyState(tgUserId, club, newMsgId, newStatus);
  } else if (state.lastStatus !== newStatus) {
    // نفس الزيارة، لكن الحالة تغيّرت (مثلاً: كان مرفوض، صار ناجح بعد ما اشترك) — نعدّل نفس الرسالة
    await editMessage(state.messageId, text);
    await setNotifyState(tgUserId, club, state.messageId, newStatus);
  } else {
    // نفس الزيارة، نفس الحالة (لسا مرفوض مثلاً) — ما نرسل ولا نعدّل شي، بس نحدّث وقت آخر ظهور
    await setNotifyState(tgUserId, club, state.messageId, newStatus);
  }
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

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (authDate && (Date.now() / 1000 - authDate) > 86400) return null;

  const userStr = params.get("user");
  if (!userStr) return null;
  try { return JSON.parse(userStr); } catch { return null; }
}

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
    await notifyOwnerError("⚠️ check-subscription: متغيرات البيئة ناقصة (BOT_TOKEN/SUPABASE_URL/SUPABASE_ANON_KEY) — كل المستخدمين بيفشلون بالتحقق.");
    return json({ ok: false, subscribed: false, error: "not_configured" }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const initData = body?.initData;
  const club = body?.club;
  if (!initData || typeof initData !== "string") {
    await notifyOwnerError(`⚠️ check-subscription: طلب بدون initData (نادي: ${club || "?"})`);
    return json({ ok: false, subscribed: false, error: "no_init_data" });
  }
  if (!club || typeof club !== "string") {
    await notifyOwnerError("⚠️ check-subscription: طلب بدون اسم نادي بالرابط");
    return json({ ok: false, subscribed: false, error: "no_club" });
  }

  const user = await verifyInitData(initData, BOT_TOKEN);
  if (!user || !user.id) {
    await notifyOwnerError(`❌ check-subscription: فشل التحقق من توقيع initData (نادي: ${club}). السبب الأرجح: BOT_TOKEN بالسكريت مو نفس توكن البوت الفعلي، أو initData قديمة/مشوّهة.`);
    return json({ ok: false, subscribed: false, error: "invalid_init_data" });
  }

  const userLabel = `${user.first_name || ""} ${user.last_name || ""} (@${user.username || "بدون يوزرنيم"} | id:${user.id})`.trim();

  const channel = await getClubChannel(club);
  if (!channel) {
    await notifyOwnerError(`⚠️ check-subscription: ما فيه صف بجدول clubs لنادي "${club}" أو telegram_channel_id فاضي. المستخدم ${userLabel} دخل بدون فحص (bypass).`);
    return json({ ok: true, subscribed: true, noChannelConfigured: true });
  }

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel.channelId)}&user_id=${user.id}`
    );
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      await notifyOwnerError(`❌ check-subscription: تيليجرام رفض getChatMember لنادي "${club}" (channel_id: ${channel.channelId}).\nرسالة تيليجرام: <b>${tgData.description || "غير معروفة"}</b>\nالسبب الأرجح: البوت مو أدمن بهذي القناة، أو channel_id غلط.\nالمستخدم: ${userLabel}`);
      return json({ ok: true, subscribed: false, channelLink: channel.channelLink });
    }

    const status = tgData.result?.status;
    const subscribed = ["member", "administrator", "creator"].includes(status);

    await reportEntry(user.id, club, subscribed, userLabel, status);

    return json({ ok: true, subscribed, channelLink: channel.channelLink });
  } catch (err) {
    await notifyOwnerError(`❌ check-subscription: استثناء بالاتصال بتيليجرام لنادي "${club}". المستخدم: ${userLabel}. الخطأ: ${String(err)}`);
    return json({ ok: false, subscribed: false, error: "telegram_api_failed" });
  }
});
