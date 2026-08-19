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
//  محرر عام (يُستخدم لتعديل أي حقل نصي/رقمي/منطقي بأي جدول — إعدادات، أندية، مباريات)
// ============================================================
type FieldKind = "text" | "number" | "bool";
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
}
/** يبني قائمة أزرار لاختيار حقل، وقيمته الحالية تظهر جنب اسمه */
function fieldPickerKeyboard(fields: FieldDef[], row: Record<string, unknown>, prefix: string) {
  return {
    inline_keyboard: fields.map((f) => {
      let val = row[f.key];
      if (f.kind === "bool") val = val ? "✅" : "❌";
      const preview = val === null || val === undefined || val === "" ? "—" : String(val).slice(0, 20);
      return [{ text: `${f.label}: ${preview}`, callback_data: `${prefix}:${f.key}` }];
    }),
  };
}
/** يبدأ تعديل حقل: لو bool يقلبه فورًا، لو نص/رقم يطلب من المستخدم يكتب القيمة الجديدة */
async function startFieldEdit(
  chatId: number,
  table: string,
  idColumn: string,
  idValue: string,
  field: FieldDef,
  currentRow: Record<string, unknown>,
  onDoneMessage: string
) {
  if (field.kind === "bool") {
    const newVal = !currentRow[field.key];
    await sb(`${table}?${idColumn}=eq.${idValue}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ [field.key]: newVal }),
    });
    await tg("sendMessage", { chat_id: chatId, text: `${onDoneMessage} (${field.label}: ${newVal ? "✅" : "❌"})` });
    return;
  }
  await setSession(chatId, "field_edit:awaiting_value", { table, idColumn, idValue, field, onDoneMessage });
  await tg("sendMessage", { chat_id: chatId, text: `أرسل القيمة الجديدة لـ "${field.label}":` });
}
async function finishFieldEdit(chatId: number, text: string, data: any) {
  const { table, idColumn, idValue, field, onDoneMessage } = data;
  const value = field.kind === "number" ? (parseFloat(text.trim()) || 0) : text.trim();
  await sb(`${table}?${idColumn}=eq.${idValue}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ [field.key]: value }),
  });
  await clearSession(chatId);
  await tg("sendMessage", { chat_id: chatId, text: onDoneMessage });
}

// ============================================================
//  إعدادات التطبيق العامة (/settings)
// ============================================================
const APP_SETTINGS_FIELDS: FieldDef[] = [
  { key: "telegram_link_1", label: "رابط قناة تيليجرام 1", kind: "text" },
  { key: "telegram_label_1", label: "اسم القناة 1", kind: "text" },
  { key: "telegram_link_2", label: "رابط قناة تيليجرام 2", kind: "text" },
  { key: "telegram_label_2", label: "اسم القناة 2", kind: "text" },
  { key: "rights_text", label: "نص الحقوق", kind: "text" },
  { key: "ticker_text", label: "الشريط المتحرك", kind: "text" },
  { key: "ad_enabled", label: "الإعلان مفعّل", kind: "bool" },
  { key: "ad_image_url", label: "رابط صورة الإعلان", kind: "text" },
  { key: "ad_video_url", label: "رابط فيديو الإعلان", kind: "text" },
  { key: "ad_click_url", label: "رابط الضغط على الإعلان", kind: "text" },
  { key: "ad_duration_seconds", label: "مدة الإعلان (ث)", kind: "number" },
  { key: "ad_skip_after_seconds", label: "تخطي الإعلان بعد (ث)", kind: "number" },
  { key: "ad_network_script", label: "كود شبكة الإعلانات", kind: "text" },
];
async function handleSettingsCmd(chatId: number) {
  const rows = await sbJson(`app_settings?id=eq.1&select=*`);
  const row = rows[0] || {};
  await tg("sendMessage", {
    chat_id: chatId,
    text: "⚙️ إعدادات التطبيق العامة — اضغط على أي إعداد لتغييره:",
    reply_markup: fieldPickerKeyboard(APP_SETTINGS_FIELDS, row, "setf"),
  });
}

// ============================================================
//  إعدادات نادي (/club)
// ============================================================
const CLUB_FIELDS: FieldDef[] = [
  { key: "name", label: "الاسم", kind: "text" },
  { key: "subtitle", label: "الوصف الفرعي", kind: "text" },
  { key: "accent_color", label: "اللون الأساسي", kind: "text" },
  { key: "accent_color2", label: "اللون الثانوي", kind: "text" },
  { key: "telegram_link", label: "رابط تيليجرام النادي", kind: "text" },
  { key: "telegram_label", label: "اسم قناة تيليجرام", kind: "text" },
  { key: "telegram_channel_id", label: "معرّف قناة تيليجرام", kind: "text" },
  { key: "is_active", label: "ظاهر للمستخدمين", kind: "bool" },
];
async function handleClubCmd(chatId: number) {
  const clubs = await getClubs();
  await tg("sendMessage", {
    chat_id: chatId,
    text: "أي نادي تبي تعدّل إعداداته؟",
    reply_markup: clubsKeyboard(clubs, "clubedit"),
  });
}
async function showClubFields(chatId: number, slug: string) {
  const rows = await sbJson(`clubs?slug=eq.${slug}&select=*`);
  const row = rows[0] || {};
  await tg("sendMessage", {
    chat_id: chatId,
    text: `⚙️ إعدادات نادي "${row.name || slug}" — اضغط لتعديل:`,
    reply_markup: fieldPickerKeyboard(CLUB_FIELDS, row, `clubf:${slug}`),
  });
}

// ============================================================
//  تعديل مباراة موجودة (يُستدعى من زر "✏️ تعديل" بقائمة /matches)
// ============================================================
const MATCH_FIELDS: FieldDef[] = [
  { key: "home_team", label: "الفريق المضيف", kind: "text" },
  { key: "away_team", label: "الفريق الضيف", kind: "text" },
  { key: "competition", label: "البطولة", kind: "text" },
  { key: "status", label: "الحالة (upcoming/live/finished)", kind: "text" },
];
async function showMatchFields(chatId: number, matchId: string) {
  const rows = await sbJson(`matches?id=eq.${matchId}&select=*`);
  const row = rows[0] || {};
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✏️ تعديل مباراة "${row.home_team} × ${row.away_team}" — اضغط لتعديل:`,
    reply_markup: fieldPickerKeyboard(MATCH_FIELDS, row, `matchf:${matchId}`),
  });
}

// ============================================================
//  إحصائيات المشاهدين (/stats)
// ============================================================
function fmtHour(h: number | null | undefined) {
  if (h === null || h === undefined) return "—";
  const period = h < 12 ? "ص" : "م";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:00 ${period}`;
}
async function handleStatsCmd(chatId: number) {
  const clubs = await getClubs();
  const keyboard = [
    [{ text: "🌍 كل الأندية", callback_data: "stats:__all__" }],
    ...clubs.map((c: any) => [{ text: c.name || c.slug, callback_data: `stats:${c.slug}` }]),
  ];
  await tg("sendMessage", { chat_id: chatId, text: "إحصائيات أي نادي؟", reply_markup: { inline_keyboard: keyboard } });
}
async function sendStats(chatId: number, club: string | null) {
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/viewer_stats`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_club: club }),
  });
  const agg = await rpcRes.json();
  const s = (Array.isArray(agg) && agg[0]) || {};
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      `👥 إحصائيات المشاهدين — ${club || "كل الأندية"}\n\n` +
      `🔴 يشاهدون الآن: ${s.watching_now ?? 0}\n` +
      `📅 اليوم: ${s.unique_today ?? 0}\n` +
      `📊 إجمالي (كل الوقت): ${s.unique_all_time ?? 0}\n` +
      `⏰ وقت الذروة: ${fmtHour(s.peak_hour)}\n\n` +
      `شاهدوا 30 دقيقة+: ${s.watched_30 ?? 0}\n` +
      `شاهدوا 60 دقيقة+: ${s.watched_60 ?? 0}\n` +
      `شاهدوا 90 دقيقة+: ${s.watched_90 ?? 0}\n` +
      `شاهدوا 120 دقيقة+: ${s.watched_120 ?? 0}`,
  });
}

// ============================================================
//  أقسام الصفحة الرئيسية (/sections)
// ============================================================
function sectionTypeLabel(t: string) {
  return t === "clubs_grid" ? "⚽ شبكة أندية" : t === "video" ? "🎬 فيديو" : t === "banner" ? "🖼 بانر" : t;
}
async function handleSectionsCmd(chatId: number) {
  const rows = await sbJson(`home_sections?select=*&order=sort_order`);
  if (!rows.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "ما فيه أقسام مضافة بعد.",
      reply_markup: { inline_keyboard: [[{ text: "➕ إضافة قسم", callback_data: "sec_new" }]] },
    });
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const cfg = s.config || {};
    let detail = "";
    if (s.type === "clubs_grid") detail = cfg.club_slugs?.length ? `أندية محدّدة (${cfg.club_slugs.length})` : "كل الأندية";
    else if (s.type === "video") detail = cfg.url || "—";
    else if (s.type === "banner") detail = cfg.image_url || "—";
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${sectionTypeLabel(s.type)}${s.title ? " — " + s.title : ""}\n${detail}${s.is_active === false ? "\n⚠️ معطّل" : ""}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "▲", callback_data: `sec_up:${s.id}` },
            { text: "▼", callback_data: `sec_down:${s.id}` },
            { text: "🗑 حذف", callback_data: `sec_del:${s.id}` },
          ],
        ],
      },
    });
  }
  await tg("sendMessage", { chat_id: chatId, text: "➕ إضافة قسم جديد؟", reply_markup: { inline_keyboard: [[{ text: "➕ إضافة قسم", callback_data: "sec_new" }]] } });
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
      "⚙️ /club — تعديل إعدادات نادي (اسم، ألوان، تيليجرام...)\n" +
      "⚽ /newmatch — إضافة مباراة\n" +
      "📋 /matches — عرض آخر المباريات، تعديلها وحذفها\n" +
      "🏷 /clubs — عرض الأندية\n" +
      "👥 /stats — إحصائيات المشاهدين\n" +
      "🛠 /settings — إعدادات التطبيق العامة\n" +
      "🏠 /sections — أقسام الصفحة الرئيسية\n" +
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
      reply_markup: { inline_keyboard: [[
        { text: "✏️ تعديل", callback_data: `editm:${m.id}` },
        { text: "🗑 حذف", callback_data: `delm:${m.id}` },
      ]] },
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

  if (state === "field_edit:awaiting_value") {
    await finishFieldEdit(chatId, text, session.data);
    return;
  }

  if (state.startsWith("secnew:")) {
    await handleSectionWizardText(chatId, text.trim(), state, session.data);
    return;
  }

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

async function handleSectionWizardText(chatId: number, text: string, state: string, data: any) {
  if (state === "secnew:video:url") {
    await insertHomeSection("video", null, { url: text });
    await clearSession(chatId);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تمت إضافة قسم الفيديو." });
    return;
  }
  if (state === "secnew:banner:image_url") {
    await setSession(chatId, "secnew:banner:link_url", { ...data, image_url: text });
    await tg("sendMessage", { chat_id: chatId, text: "رابط الضغط عند النقر؟ (اكتب - لو ما فيه)" });
    return;
  }
  if (state === "secnew:banner:link_url") {
    await insertHomeSection("banner", null, { image_url: data.image_url, link_url: text === "-" ? "" : text });
    await clearSession(chatId);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تمت إضافة قسم البانر." });
    return;
  }
}
async function insertHomeSection(type: string, title: string | null, config: Record<string, unknown>) {
  const rows = await sbJson(`home_sections?select=sort_order&order=sort_order.desc&limit=1`);
  const maxOrder = rows[0]?.sort_order ?? 0;
  await sbJson(`home_sections`, {
    method: "POST",
    body: JSON.stringify({ type, title, config, sort_order: maxOrder + 1 }),
  });
}
async function moveSectionOrder(id: string, dir: -1 | 1) {
  const rows = await sbJson(`home_sections?select=id,sort_order&order=sort_order`);
  const idx = rows.findIndex((r: any) => r.id === id);
  const otherIdx = idx + dir;
  if (idx < 0 || otherIdx < 0 || otherIdx >= rows.length) return;
  const a = rows[idx], b = rows[otherIdx];
  await sb(`home_sections?id=eq.${a.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sort_order: b.sort_order }) });
  await sb(`home_sections?id=eq.${b.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sort_order: a.sort_order }) });
}

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

  if (data.startsWith("editm:")) {
    const id = data.split(":")[1];
    await showMatchFields(chatId, id);
    return;
  }
  if (data.startsWith("matchf:")) {
    const [, matchId, fieldKey] = data.split(":");
    const rows = await sbJson(`matches?id=eq.${matchId}&select=*`);
    const row = rows[0] || {};
    const field = MATCH_FIELDS.find((f) => f.key === fieldKey)!;
    await startFieldEdit(chatId, "matches", "id", matchId, field, row, "✅ تم تعديل المباراة.");
    return;
  }

  if (data === "setf" || data.startsWith("setf:")) {
    const fieldKey = data.split(":")[1];
    if (!fieldKey) return; // احتياط، ما يفترض يصير
    const rows = await sbJson(`app_settings?id=eq.1&select=*`);
    const row = rows[0] || {};
    const field = APP_SETTINGS_FIELDS.find((f) => f.key === fieldKey)!;
    await startFieldEdit(chatId, "app_settings", "id", "1", field, row, "✅ تم حفظ الإعداد.");
    return;
  }

  if (data.startsWith("clubedit:")) {
    const slug = data.split(":")[1];
    await showClubFields(chatId, slug);
    return;
  }
  if (data.startsWith("clubf:")) {
    const [, slug, fieldKey] = data.split(":");
    const rows = await sbJson(`clubs?slug=eq.${slug}&select=*`);
    const row = rows[0] || {};
    const field = CLUB_FIELDS.find((f) => f.key === fieldKey)!;
    await startFieldEdit(chatId, "clubs", "slug", slug, field, row, "✅ تم حفظ إعدادات النادي.");
    return;
  }

  if (data.startsWith("stats:")) {
    const club = data.split(":")[1];
    await sendStats(chatId, club === "__all__" ? null : club);
    return;
  }

  if (data === "sec_new") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "أي نوع قسم؟",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚽ شبكة أندية", callback_data: "sec_type:clubs_grid" }],
          [{ text: "🎬 فيديو", callback_data: "sec_type:video" }],
          [{ text: "🖼 بانر", callback_data: "sec_type:banner" }],
        ],
      },
    });
    return;
  }
  if (data.startsWith("sec_type:")) {
    const type = data.split(":")[1];
    if (type === "clubs_grid") {
      await insertHomeSection("clubs_grid", null, { club_slugs: [] });
      await tg("sendMessage", { chat_id: chatId, text: "✅ تمت إضافة قسم شبكة الأندية (يعرض كل الأندية النشطة افتراضيًا — لتحديد أندية معيّنة استخدم لوحة الأدمن بالمتصفح)." });
      return;
    }
    if (type === "video") {
      await setSession(chatId, "secnew:video:url", { type });
      await tg("sendMessage", { chat_id: chatId, text: "رابط الفيديو؟" });
      return;
    }
    if (type === "banner") {
      await setSession(chatId, "secnew:banner:image_url", { type });
      await tg("sendMessage", { chat_id: chatId, text: "رابط صورة البانر؟" });
      return;
    }
  }
  if (data.startsWith("sec_up:") || data.startsWith("sec_down:")) {
    const [dirKey, id] = data.split(":");
    await moveSectionOrder(id, dirKey === "sec_up" ? -1 : 1);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تم تغيير الترتيب." });
    return;
  }
  if (data.startsWith("sec_del:")) {
    const id = data.split(":")[1];
    await sb(`home_sections?id=eq.${id}`, { method: "DELETE" });
    await tg("sendMessage", { chat_id: chatId, text: "🗑 تم حذف القسم." });
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
    else if (text === "/club") await handleClubCmd(chatId);
    else if (text === "/newmatch") await handleNewMatchCmd(chatId);
    else if (text === "/matches") await handleMatchesCmd(chatId);
    else if (text === "/stats") await handleStatsCmd(chatId);
    else if (text === "/settings") await handleSettingsCmd(chatId);
    else if (text === "/sections") await handleSectionsCmd(chatId);
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
