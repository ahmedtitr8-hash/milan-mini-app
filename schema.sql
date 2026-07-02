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
  created_at     timestamptz default now()
);

-- ترقية قاعدة بيانات قديمة كانت موجودة قبل هذا التحديث
alter table public.matches add column if not exists upcoming_note text default '';

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
