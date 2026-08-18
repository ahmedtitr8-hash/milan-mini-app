// admin-bot: بوت تيليجرام يشتغل على نفس جداول الأدمن الحالي بالضبط (clubs, matches,
// match_sources) — مو نظام أدمن ثاني منفصل، بس "باب" إضافي لنفس البيانات، تماماً
// زي admin.html لكن عبر تيليجرام. أي تعديل من البوت يظهر فوراً بالأدمن الحالي، والعكس.
//
// ⚠️ لازم تُنشر بدون التحقق من JWT (verify_jwt = false)، لأن تيليجرام يستدعيها مباشرة
// بدون أي Authorization header — راجع supabase/config.toml (نفس مبدأ stream-proxy).

const BOT_TOKEN       = Deno.env.get("ADMIN_BOT_TOKEN") || "";
const ADMIN_CHAT_ID   = Deno.env.get("ADMIN_CHAT_ID") || "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LOGO_BUCKET      = "club-logos";

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============================================================
//  أدوات مساعدة عامة
// ============================================================
async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: (init.headers as any)?.["Prefer"] || "return=representation",
      ...(init.headers || {}),
    },
  });
}
async function sbJson(path: string, init: RequestInit = {}) {
  const r = await sb(path, init);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ============================================================
//  حالة المحادثة (بدل ذاكرة الجلسة — نفس فكرة server-side state)
// ============================================================
async function getSession(chatId: number) {
  const rows = await sbJson(`bot_sessions?chat_id=eq.${chatId}&select=*`);
  return rows[0] || null;
}
async function setSession(chatId: number, state: string, data: Record<string, unknown> = {}) {
  await sb(`bot_sessions`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chat_id: chatId, state, data, updated_at: new Date().toISOString() }),
  });
}
async function clearSession(chatId: number) {
  await sb(`bot_sessions?chat_id=eq.${chatId}`, { method: "DELETE" });
}

// ============================================================
//  الأندية
// ============================================================
async function getClubs() {
  return sbJson(`clubs?select=slug,name,logo_url&order=sort_order`);
}
function clubsKeyboard(clubs: any[], prefix: string) {
  return {
    inline_keyboard: clubs.map((c) => [{ text: c.name || c.slug, callback_data: `${prefix}:${c.slug}` }]),
  };
}

// ============================================================
//  رفع الشعار
// ============================================================
async function downloadTelegramFile(fileId: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const info = await tg("getFile", { file_id: fileId });
  const filePath: string = info.result.file_path;
  const ext = filePath.split(".").pop() || "jpg";
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  return { bytes: buf, ext };
}
async function uploadLogo(club: string, bytes: Uint8Array, ext: string) {
  const key = `${club}-${Date.now()}.${ext}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${LOGO_BUCKET}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-upsert": "true",
      "Content-Type": ext === "png" ? "image/png" : "image/jpeg",
    },
    body: bytes,
  });
  if (!up.ok) throw new Error(`storage upload failed: ${up.status} ${await up.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${key}`;
}

// ============================================================
//  الأوامر
// ============================================================
async function handleStart(chatId: number) {
  await clearSession(chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "أهلاً 👋 هذا بوت أدمن زون-ميلان — يتحكم بنفس بيانات لوحة الأدمن مباشرة.\n\n" +
      "الأوامر:\n" +
      "🖼 /logo — تغيير شعار نادي\n" +
      "⚽ /newmatch — إضافة مباراة\n" +
      "📋 /matches — عرض آخر المباريات وحذفها\n" +
      "🏷 /clubs — عرض الأندية\n" +
      "❌ /cancel — إلغاء أي عملية جارية",
  });
}

async function handleLogoCmd(chatId: number) {
  const clubs = await getClubs();
  await setSession(chatId, "logo:pick_club", {});
  await tg("sendMessage", {
    chat_id: chatId,
    text: "لأي نادي تبي تغيّر الشعار؟",
    reply_markup: clubsKeyboard(clubs, "logo"),
  });
}

async function handleClubsCmd(chatId: number) {
  const clubs = await getClubs();
  const lines = clubs.map((c: any) => `• ${c.name || c.slug}${c.logo_url ? " 🖼" : " ⚠️ بدون شعار"}`);
  await tg("sendMessage", { chat_id: chatId, text: lines.join("\n") || "ما فيه أندية بعد." });
}

async function handleNewMatchCmd(chatId: number) {
  const clubs = await getClubs();
  await setSession(chatId, "newmatch:club", {});
  await tg("sendMessage", {
    chat_id: chatId,
    text: "مباراة جديدة — لأي نادي؟",
    reply_markup: clubsKeyboard(clubs, "nm_club"),
  });
}

async function handleMatchesCmd(chatId: number) {
  const clubs = await getClubs();
  await setSession(chatId, "matches:pick_club", {});
  await tg("sendMessage", {
    chat_id: chatId,
    text: "مباريات أي نادي تبي تشوف؟",
    reply_markup: clubsKeyboard(clubs, "mlist"),
  });
}

async function listMatches(chatId: number, club: string) {
  const rows = await sbJson(
    `matches?club=eq.${club}&select=id,home_team,away_team,status,kickoff_at&order=kickoff_at.desc&limit=10`
  );
  if (!rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما فيه مباريات لهذا النادي." });
    return;
  }
  for (const m of rows) {
    const date = m.kickoff_at ? new Date(m.kickoff_at).toLocaleString("ar-SA") : "—";
    await tg("sendMessage", {
      chat_id: chatId,
      text: `⚽ ${m.home_team} × ${m.away_team}\n🕐 ${date}\n📌 ${m.status || "—"}`,
      reply_markup: { inline_keyboard: [[{ text: "🗑 حذف", callback_data: `delm:${m.id}` }]] },
    });
  }
}

// ============================================================
//  استقبال الصور (رفع الشعار)
// ============================================================
async function handlePhoto(chatId: number, photos: any[], session: any) {
  if (!session || session.state !== "logo:awaiting_photo") {
    await tg("sendMessage", { chat_id: chatId, text: "ما طلبت شعار حالياً. ابدأ بـ /logo أولاً." });
    return;
  }
  const club = session.data.club;
  const best = photos[photos.length - 1]; // أعلى جودة
  await tg("sendMessage", { chat_id: chatId, text: "⏳ جاري رفع الشعار..." });
  const { bytes, ext } = await downloadTelegramFile(best.file_id);
  const url = await uploadLogo(club, bytes, ext);
  await sbJson(`clubs?slug=eq.${club}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ logo_url: url }),
  });
  await clearSession(chatId);
  await tg("sendMessage", { chat_id: chatId, text: "✅ تم تحديث الشعار بنجاح." });
}

// ============================================================
//  استقبال النصوص أثناء تدفّق إضافة مباراة
// ============================================================
const NM_STEPS: Record<string, { next: string; prompt: string; field?: string }> = {
  "newmatch:home_team": { next: "newmatch:away_team", prompt: "اسم الفريق الضيف؟", field: "home_team" },
  "newmatch:away_team": { next: "newmatch:competition", prompt: "اسم البطولة؟", field: "away_team" },
  "newmatch:competition": { next: "newmatch:kickoff", prompt: "موعد المباراة؟ (مثال: 2026-08-20 21:00)", field: "competition" },
  "newmatch:kickoff": { next: "newmatch:stream_url", prompt: "رابط البث المباشر؟", field: "kickoff_at" },
};

async function handleText(chatId: number, text: string, session: any) {
  if (!session) return; // ما فيه محادثة جارية، تجاهل
  const state: string = session.state;

  if (state.startsWith("newmatch:") && state !== "newmatch:club") {
    const step = NM_STEPS[state];
    if (step) {
      const data = { ...session.data, [step.field!]: text.trim() };
      await setSession(chatId, step.next, data);
      await tg("sendMessage", { chat_id: chatId, text: step.prompt });
      return;
    }
    if (state === "newmatch:stream_url") {
      const data = { ...session.data, stream_url: text.trim() };
      await setSession(chatId, "newmatch:confirm", data);
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `تأكيد المباراة:\n` +
          `🏟 ${data.home_team} × ${data.away_team}\n` +
          `🏆 ${data.competition}\n` +
          `🕐 ${data.kickoff_at}\n` +
          `🔗 ${data.stream_url}`,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ حفظ", callback_data: "nm_confirm" },
            { text: "❌ إلغاء", callback_data: "nm_cancel" },
          ]],
        },
      });
      return;
    }
  }
}

// ============================================================
//  أزرار الاختيار (callback_query)
// ============================================================
async function handleCallback(cb: any) {
  const chatId = cb.message.chat.id;
  const data: string = cb.data;
  await tg("answerCallbackQuery", { callback_query_id: cb.id });

  if (data.startsWith("logo:")) {
    const club = data.split(":")[1];
    await setSession(chatId, "logo:awaiting_photo", { club });
    await tg("sendMessage", { chat_id: chatId, text: `أرسل الآن صورة شعار "${club}".` });
    return;
  }

  if (data.startsWith("nm_club:")) {
    const club = data.split(":")[1];
    await setSession(chatId, "newmatch:home_team", { club });
    await tg("sendMessage", { chat_id: chatId, text: "اسم الفريق المضيف؟" });
    return;
  }

  if (data === "nm_confirm") {
    const session = await getSession(chatId);
    const d = session.data;
    const match = await sbJson(`matches`, {
      method: "POST",
      body: JSON.stringify({
        club: d.club,
        home_team: d.home_team,
        away_team: d.away_team,
        competition: d.competition,
        kickoff_at: isNaN(Date.parse(d.kickoff_at)) ? null : new Date(d.kickoff_at).toISOString(),
        status: "upcoming",
      }),
    });
    const matchId = match[0].id;
    await sbJson(`match_sources`, {
      method: "POST",
      body: JSON.stringify({ match_id: matchId, tab: "full", label: "بث مباشر", url: d.stream_url, sort_order: 0 }),
    });
    await clearSession(chatId);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تمت إضافة المباراة." });
    return;
  }

  if (data === "nm_cancel") {
    await clearSession(chatId);
    await tg("sendMessage", { chat_id: chatId, text: "أُلغيت العملية." });
    return;
  }

  if (data.startsWith("mlist:")) {
    const club = data.split(":")[1];
    await clearSession(chatId);
    await listMatches(chatId, club);
    return;
  }

  if (data.startsWith("delm:")) {
    const id = data.split(":")[1];
    await sb(`match_sources?match_id=eq.${id}`, { method: "DELETE" });
    await sb(`matches?id=eq.${id}`, { method: "DELETE" });
    await tg("sendMessage", { chat_id: chatId, text: "🗑 تم الحذف." });
    return;
  }
}

// ============================================================
//  نقطة الدخول
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      if (String(chatId) !== ADMIN_CHAT_ID) return new Response("ok");
      await handleCallback(update.callback_query);
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg) return new Response("ok");
    const chatId = msg.chat.id;
    if (String(chatId) !== ADMIN_CHAT_ID) return new Response("ok"); // يتجاهل أي حد غير الأدمن تماماً

    if (msg.photo) {
      const session = await getSession(chatId);
      await handlePhoto(chatId, msg.photo, session);
      return new Response("ok");
    }

    const text: string = msg.text || "";
    if (text === "/start" || text === "/help") await handleStart(chatId);
    else if (text === "/logo") await handleLogoCmd(chatId);
    else if (text === "/clubs") await handleClubsCmd(chatId);
    else if (text === "/newmatch") await handleNewMatchCmd(chatId);
    else if (text === "/matches") await handleMatchesCmd(chatId);
    else if (text === "/cancel") {
      await clearSession(chatId);
      await tg("sendMessage", { chat_id: chatId, text: "تم الإلغاء." });
    } else {
      const session = await getSession(chatId);
      await handleText(chatId, text, session);
    }
  } catch (e) {
    console.error(e);
    try {
      await tg("sendMessage", { chat_id: ADMIN_CHAT_ID, text: `⚠️ خطأ: ${e}` });
    } catch {}
  }

  return new Response("ok");
});
