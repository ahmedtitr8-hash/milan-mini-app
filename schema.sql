-- ============================================================
--  ZONE  —  Supabase schema
--  شغّل هذا الملف كامل داخل: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- جدول المباريات ----------
create table if not exists public.matches (
  id             uuid primary key default gen_random_uuid(),
  club           text not null check (club in ('milan','barca')),
  title          text default '',
  home_team      text not null default '',
  away_team      text not null default '',
  home_logo      text default '',
  away_logo      text default '',
  competition    text default '',
  round          text default '',
  kickoff_at     timestamptz,
  status         text not null default 'upcoming' check (status in ('live','upcoming','finished')),
  type           text not null default 'vod' check (type in ('live','vod')),
  thumbnail_url  text default '',
  category       text default '',
  category_order int default 0,
  is_banner      boolean default false,
  sort_order     int default 0,
  -- نص حر يتحكم به الأدمن يظهر للمباريات القادمة بدلاً من إجباره على إضافة رابط مشغل
  -- (مثال: القناة الناقلة، الملعب، أي ملاحظة يريد عرضها قبل انطلاق المباراة)
  upcoming_note  text default '',
  -- النتيجة النهائية (تُعرض بدل الوقت/التاريخ على البطاقة عندما تكون حالة المباراة "منتهية")
  home_score     int,
  away_score     int,
  created_at     timestamptz default now()
);

-- ترقية قاعدة بيانات قديمة كانت موجودة قبل هذا التحديث
alter table public.matches add column if not exists upcoming_note text default '';
alter table public.matches add column if not exists home_score int;
alter table public.matches add column if not exists away_score int;

-- ---------- روابط المشاهدة (سيرفرات بث / كاملة / ملخص) ----------
create table if not exists public.match_sources (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  tab         text not null check (tab in ('live','full','highlight')),
  label       text not null default 'سيرفر 1',
  url         text not null,
  sort_order  int default 0,
  -- نوع الرابط الفعلي (مباشر / مسجل): auto = يكتشفه المشغل تلقائيًا من الرابط
  stream_type text not null default 'auto' check (stream_type in ('auto','live','vod')),
  -- جودات إضافية اختيارية لهذا السيرفر (روابط بديلة بجودات مختلفة يختارها المستخدم يدويًا من المشغل)
  -- شكل القيمة: [{"label":"1080p","url":"https://..."}, ...]
  qualities   jsonb not null default '[]'::jsonb,
  created_at  timestamptz default now()
);

-- ترقية قاعدة بيانات قديمة كانت موجودة قبل هذا التحديث (لا يفعل شيء إن كانت الأعمدة موجودة أصلاً)
alter table public.match_sources add column if not exists stream_type text not null default 'auto';
alter table public.match_sources add column if not exists qualities jsonb not null default '[]'::jsonb;
alter table public.match_sources add column if not exists drm_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'match_sources_stream_type_check') then
    alter table public.match_sources add constraint match_sources_stream_type_check check (stream_type in ('auto','live','vod'));
  end if;
end $$;

-- ---------- مباريات مرتبطة (تظهر تحت مشغل الفيديو المسجل) ----------
create table if not exists public.match_related (
  id               uuid primary key default gen_random_uuid(),
  match_id         uuid not null references public.matches(id) on delete cascade,
  related_match_id uuid not null references public.matches(id) on delete cascade,
  sort_order       int default 0
);

-- ---------- إعدادات شعار كل نادٍ (يضبطها الأدمن مرة واحدة) ----------
create table if not exists public.club_settings (
  club     text primary key check (club in ('milan','barca')),
  logo_url text default ''
);
insert into public.club_settings (club) values ('milan'),('barca') on conflict do nothing;

create index if not exists idx_matches_club on public.matches(club);
create index if not exists idx_matches_status on public.matches(status);
create index if not exists idx_sources_match on public.match_sources(match_id);
create index if not exists idx_related_match on public.match_related(match_id);

-- ============================================================
--  ملاحظة أمان: بعد تطبيق هذا الملف، التعديل عبر admin.html لن يعمل
--  إلا بعد تسجيل الدخول بحساب Supabase Auth (راجع README لخطوة إنشاء المستخدم).
-- ============================================================

-- ============================================================
--  الصلاحيات (RLS)
--  القراءة عامة (يحتاجها الميني تطبيق للعرض بدون تسجيل دخول).
--  الكتابة (إضافة/تعديل/حذف) مسموحة فقط لمستخدم مسجّل دخول عبر Supabase Auth
--  (هذا هو مستخدم لوحة الأدمن الذي ستنشئه في الخطوة التالية).
-- ============================================================

alter table public.matches enable row level security;
alter table public.match_sources enable row level security;
alter table public.match_related enable row level security;

drop policy if exists "public read matches" on public.matches;
create policy "public read matches" on public.matches for select using (true);
drop policy if exists "public write matches" on public.matches;
drop policy if exists "auth write matches" on public.matches;
create policy "auth write matches" on public.matches for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read sources" on public.match_sources;
create policy "public read sources" on public.match_sources for select using (true);
drop policy if exists "public write sources" on public.match_sources;
drop policy if exists "auth write sources" on public.match_sources;
create policy "auth write sources" on public.match_sources for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read related" on public.match_related;
create policy "public read related" on public.match_related for select using (true);
drop policy if exists "public write related" on public.match_related;
drop policy if exists "auth write related" on public.match_related;
create policy "auth write related" on public.match_related for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table public.club_settings enable row level security;
drop policy if exists "public read club_settings" on public.club_settings;
create policy "public read club_settings" on public.club_settings for select using (true);
drop policy if exists "auth write club_settings" on public.club_settings;
create policy "auth write club_settings" on public.club_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
--  إعدادات عامة للتطبيق (غير مرتبطة بنادٍ معيّن): روابط قناتي تيليجرام + سطر الحقوق
--  صف واحد ثابت (id=1) يُحدَّث دائمًا، لا يُضاف له صفوف جديدة
-- ============================================================
create table if not exists public.app_settings (
  id int primary key default 1,
  telegram_link_1  text default '',
  telegram_label_1 text default 'القناة الأولى',
  telegram_link_2  text default '',
  telegram_label_2 text default 'القناة الثانية',
  rights_text      text default '© 2026 BarMi ZONE — جميع الحقوق محفوظة',
  constraint app_settings_single_row check (id = 1)
);
insert into public.app_settings (id) values (1) on conflict do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "public read app_settings" on public.app_settings;
create policy "public read app_settings" on public.app_settings for select using (true);
drop policy if exists "auth write app_settings" on public.app_settings;
create policy "auth write app_settings" on public.app_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
--  شريط إخباري متحرك (ticker) يظهر بالمساحة الآمنة أعلى الصفحة في وضع الفول سكرين بتيليجرام
-- ============================================================
alter table public.app_settings add column if not exists ticker_text text default '';

-- ============================================================
--  رابط قناة تيليجرام الخاصة بكل نادٍ (تظهر أسفل صفحة المباراة)
-- ============================================================
alter table public.club_settings add column if not exists telegram_link  text default '';
alter table public.club_settings add column if not exists telegram_label text default 'قناة النادي على تيليجرام';

-- ============================================================
--  تتبّع المشاهدين (نبضة حياة periodic heartbeat) — لعرض عدد المستخدمين الإجمالي والحاليين ونشاطهم بلوحة الإدارة
-- ============================================================
create table if not exists public.viewer_heartbeats (
  id bigint generated always as identity primary key,
  session_id text not null unique,       -- معرف ثابت للمستخدم: رقم تيليجرام إن توفر، وإلا معرف عشوائي محفوظ بالجهاز
  tg_username text,                       -- اسم مستخدم تيليجرام إن توفر (للعرض فقط)
  club text,                              -- milan / barca
  match_id uuid,
  match_label text,                       -- "ميلان × إنتر ميلان" — نص جاهز للعرض بلوحة الإدارة بلا أي join
  source_label text,                      -- "سيرفر 2" مثلاً
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists viewer_heartbeats_last_seen_idx on public.viewer_heartbeats(last_seen);

alter table public.viewer_heartbeats enable row level security;
-- أي زائر (حتى بدون تسجيل دخول) يقدر يرسل/يحدّث نبضة حياته الخاصة بس (بحسب session_id يحدده هو بنفسه)
drop policy if exists "public upsert own heartbeat" on public.viewer_heartbeats;
create policy "public upsert own heartbeat" on public.viewer_heartbeats for insert with check (true);
drop policy if exists "public update own heartbeat" on public.viewer_heartbeats;
create policy "public update own heartbeat" on public.viewer_heartbeats for update using (true) with check (true);
-- القراءة (لوحة الإحصائيات) للأدمن المسجّل دخول فقط
drop policy if exists "auth read viewer_heartbeats" on public.viewer_heartbeats;
create policy "auth read viewer_heartbeats" on public.viewer_heartbeats for select using (auth.role() = 'authenticated');

-- ============================================================
--  ترقية: الأندية تصير بيانات ديناميكية بجدول clubs بدل قيمتين ثابتتين
--  (milan/barca) كانتا مكتوبتين داخل الكود وقيود قاعدة البيانات.
--  بعد هذي الترقية: أي عدد أندية يُضاف/يُحذف بالكامل من لوحة الأدمن مباشرة.
--  شغّل هذا القسم كامل مرة واحدة إضافية فوق قاعدة بياناتك الحالية —
--  آمن للتشغيل أكثر من مرة (كل خطوة تتحقق قبل ما تنفّذ).
-- ============================================================

create table if not exists public.clubs (
  slug           text primary key,
  name           text not null default '',
  subtitle       text default '',              -- نص فرعي صغير تحت الاسم بشاشة اختيار النادي (مثال: "AC Milan")
  logo_url       text default '',
  accent_color   text default '#E87B00',
  accent_color2  text default '#FF9520',
  telegram_link  text default '',
  telegram_label text default 'قناة النادي على تيليجرام',
  sort_order     int default 0,
  is_active      boolean not null default true,
  created_at     timestamptz default now()
);

-- ترحيل النادييْن الحاليين (لو ماكانوا موجودين بجدول clubs من قبل) بنفس الألوان/الأسماء المستخدمة بالكود القديم
insert into public.clubs (slug, name, subtitle, accent_color, accent_color2, sort_order)
values
  ('milan','ميلان','AC Milan','#E2101A','#FF4747', 1),
  ('barca','برشلونة','FC Barcelona','#A50044','#1E6DE0', 2)
on conflict (slug) do nothing;

-- نسخ الشعار/روابط تيليجرام الفعلية المحفوظة سابقًا بجدول club_settings (إن كان موجودًا) فوق القيم الافتراضية أعلاه
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='club_settings') then
    update public.clubs c set
      logo_url       = coalesce(nullif(cs.logo_url, ''), c.logo_url),
      telegram_link  = coalesce(nullif(cs.telegram_link, ''), c.telegram_link),
      telegram_label = coalesce(nullif(cs.telegram_label, ''), c.telegram_label)
    from public.club_settings cs
    where cs.club = c.slug;
  end if;
end $$;

-- فكّ القيد الثابت القديم على matches.club (كان يسمح فقط بـ 'milan'/'barca') أيًا كان اسمه الفعلي بقاعدة بياناتك
do $$
declare r record;
begin
  for r in
    select conname, oid from pg_constraint
    where conrelid = 'public.matches'::regclass and contype = 'c'
  loop
    if pg_get_constraintdef(r.oid) ilike '%club%' then
      execute format('alter table public.matches drop constraint %I', r.conname);
    end if;
  end loop;
end $$;

-- ربط matches.club بجدول clubs الجديد (بدل القيد الثابت): حذف نادٍ من الأدمن يحذف مبارياته تلقائيًا معه
alter table public.matches drop constraint if exists matches_club_fkey;
alter table public.matches add constraint matches_club_fkey
  foreign key (club) references public.clubs(slug) on delete cascade;

-- id القناة الرقمي الخاص بكل نادي (شكله -100xxxxxxxxxx) — يُستخدم لفحص الاشتراك الإجباري
-- قبل دخول قسم النادي. يختلف عن telegram_link (رابط الدعوة اللي يظهر للمستخدم بالزر)
alter table public.clubs add column if not exists telegram_channel_id text default '';

alter table public.clubs enable row level security;
drop policy if exists "public read clubs" on public.clubs;
create policy "public read clubs" on public.clubs for select using (true);
drop policy if exists "auth write clubs" on public.clubs;
create policy "auth write clubs" on public.clubs for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists idx_matches_club_fk on public.matches(club);

-- ============================================================
--  أقسام حرة بالصفحة الرئيسية (قبل اختيار النادي): يديرها الأدمن بالكامل —
--  إضافة/حذف/إعادة ترتيب أي عدد من: شبكة أندية، فيديو، بانر صورة قابل للنقر.
-- ============================================================
create table if not exists public.home_sections (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('clubs_grid','video','banner')),
  title       text default '',
  -- clubs_grid: {"club_slugs": ["milan","barca"]}  — فاضي = كل الأندية النشطة تلقائيًا
  -- video:      {"url": "https://...mp4"}
  -- banner:     {"image_url": "https://...jpg", "link_url": "https://..." }
  config      jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

alter table public.home_sections enable row level security;
drop policy if exists "public read home_sections" on public.home_sections;
create policy "public read home_sections" on public.home_sections for select using (true);
drop policy if exists "auth write home_sections" on public.home_sections;
create policy "auth write home_sections" on public.home_sections for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- قسم افتراضي وحيد (شبكة كل الأندية) — يحافظ على شكل الصفحة الحالي تمامًا كما هو بعد الترقية مباشرة
insert into public.home_sections (type, title, config, sort_order)
select 'clubs_grid', 'اختر ناديك', '{}'::jsonb, 1
where not exists (select 1 from public.home_sections);

create index if not exists idx_home_sections_sort on public.home_sections(sort_order);

-- ============================================================
--  جدولة النشر (publish_at): يستخدمها admin.html على المباراة نفسها وعلى كل سيرفر بث تحديدًا —
--  فاضي = يظهر فورًا، وقت مستقبلي = يبقى مخفيًا عن المستخدمين حتى يحين هذا الوقت
-- ============================================================
alter table public.matches add column if not exists publish_at timestamptz;
alter table public.match_sources add column if not exists publish_at timestamptz;
create index if not exists idx_matches_publish_at on public.matches(publish_at);
create index if not exists idx_match_sources_publish_at on public.match_sources(publish_at);

-- ============================================================
--  جلسات مشاهدة مفصّلة (viewer_sessions): بعكس viewer_heartbeats اللي يحتفظ بصف واحد فقط
--  لكل جهاز (يُستبدل باستمرار — يصلح فقط لمعرفة "مين يشاهد الآن")، هذا الجدول يسجّل كل
--  جلسة مشاهدة متصلة على حدة مع مدتها، عشان نقدر نحسب: إحصائيات اليوم، وقت الذروة بالساعة،
--  وكم مستخدم استمر بالمشاهدة متواصلة 30/60/90/120 دقيقة.
--  المشغل (player.html) يرسل نبضة كل 25 ثانية لنفس watch_session_id طول ما الصفحة مفتوحة
--  (يتجدد watch_session_id من جديد عند إعادة فتح الصفحة = جلسة جديدة).
-- ============================================================
create table if not exists public.viewer_sessions (
  id               bigint generated always as identity primary key,
  watch_session_id text not null unique,
  session_id       text,
  tg_username      text,
  club             text,
  match_id         uuid,
  match_label      text,
  source_label     text,
  started_at       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  duration_seconds int not null default 0
);
create index if not exists idx_viewer_sessions_club on public.viewer_sessions(club);
create index if not exists idx_viewer_sessions_started_at on public.viewer_sessions(started_at);
create index if not exists idx_viewer_sessions_last_seen on public.viewer_sessions(last_seen);
create index if not exists idx_viewer_sessions_session_id on public.viewer_sessions(session_id);

alter table public.viewer_sessions enable row level security;
drop policy if exists "public upsert own viewer_session" on public.viewer_sessions;
create policy "public upsert own viewer_session" on public.viewer_sessions for insert with check (true);
drop policy if exists "public update own viewer_session" on public.viewer_sessions;
create policy "public update own viewer_session" on public.viewer_sessions for update using (true) with check (true);
drop policy if exists "auth read viewer_sessions" on public.viewer_sessions;
create policy "auth read viewer_sessions" on public.viewer_sessions for select using (auth.role() = 'authenticated');

-- ============================================================
--  دالة إحصائيات مجمّعة (تُنفَّذ داخل قاعدة البيانات لسرعتها وصحتها بدل تجميعها بالمتصفح):
--  p_club = null → إحصائيات كل الأندية مجتمعة، p_club = 'milan' مثلاً → إحصائيات هذا النادي فقط.
--  التوقيت المستخدم لـ"اليوم" و"وقت الذروة" هو توقيت السعودية/الخليج (Asia/Riyadh).
-- ============================================================
create or replace function public.viewer_stats(p_club text default null)
returns table(
  watching_now    bigint,
  unique_today    bigint,
  unique_all_time bigint,
  peak_hour       int,
  watched_30      bigint,
  watched_60      bigint,
  watched_90      bigint,
  watched_120     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select * from public.viewer_sessions
    where p_club is null or club = p_club
  ),
  peak as (
    select extract(hour from (started_at at time zone 'Asia/Riyadh'))::int as hr, count(*) as cnt
    from base
    group by 1
    order by cnt desc, hr asc
    limit 1
  ),
  per_user_max as (
    select session_id, max(duration_seconds) as maxd
    from base
    where session_id is not null
    group by session_id
  )
  select
    (select count(*) from public.viewer_heartbeats h
      where h.last_seen >= now() - interval '2 minutes' and (p_club is null or h.club = p_club)),
    (select count(distinct session_id) from base
      where started_at >= date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'),
    (select count(distinct session_id) from base),
    (select hr from peak),
    (select count(*) from per_user_max where maxd >= 1800),
    (select count(*) from per_user_max where maxd >= 3600),
    (select count(*) from per_user_max where maxd >= 5400),
    (select count(*) from per_user_max where maxd >= 7200);
$$;

grant execute on function public.viewer_stats(text) to authenticated;

-- ============================================================
--  إزالة ميزة "Referer" المخصص لكل سيرفر — جُرّبت ولم تعمل بشكل موثوق، تمت إزالتها
--  نهائيًا من لوحة الأدمن ومن المشغل. هذا يحذف العمود (والعمود المرتبط proxy_mode
--  اللي ما كان مفعّل بأي واجهة أصلاً) من أي قاعدة بيانات كانت شغّلت النسخة القديمة.
-- ============================================================
alter table public.match_sources drop column if exists referer;
alter table public.match_sources drop column if exists proxy_mode;
alter table public.match_sources drop constraint if exists match_sources_proxy_mode_check;

-- ============================================================
--  دعم License Server لأنواع DRM إضافية (Widevine / PlayReady / FairPlay)
--  بجانب ClearKey الموجود مسبقًا (drm_key). drm_type يحدد الفك المطلوب،
--  license_url هو رابط سيرفر الترخيص، license_headers نص JSON اختياري
--  لأي هيدرز مطلوبة (توكن مصادقة ونحوه)، fairplay_cert_url مطلوب فقط
--  لـFairPlay (رابط شهادة FairPlay .cer).
-- ============================================================
alter table public.match_sources add column if not exists drm_type text default 'clearkey';
alter table public.match_sources add column if not exists license_url text;
alter table public.match_sources add column if not exists license_headers text;
alter table public.match_sources add column if not exists fairplay_cert_url text;
