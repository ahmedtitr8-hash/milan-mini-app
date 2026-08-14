-- ============================================================
--  إصلاح إشعارات الدخول (2026-08-14): رسالة واحدة تتحدّث بدل التكرار كل 4 ثواني
--  + عداد دخول ناجح لكل مستخدم/نادي، يُحسب "من آخر 3 فجر بتوقيت السعودية"
--  شغّل هذا الملف كامل مرة وحدة بـ SQL Editor قبل رفع كود check-subscription الجديد.
-- ============================================================

-- 1) يتذكر آخر رسالة تيليجرام أرسلناها لكل (مستخدم، نادي) — عشان نعدّلها بدل تكرارها
create table if not exists public.entry_notify_state (
  tg_user_id bigint not null,
  club       text   not null,
  message_id bigint,
  last_status text,              -- 'member' أو 'rejected'
  updated_at timestamptz not null default now(),
  primary key (tg_user_id, club)
);

-- يقرأ الحالة السابقة، ويحدد هل هذا "فحص جديد" (أكثر من 45 ثانية من آخر فحص لنفس الشخص/النادي)
create or replace function public.get_notify_state(p_tg_user_id bigint, p_club text)
returns table(message_id bigint, last_status text, is_new_visit boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from public.entry_notify_state
  where tg_user_id = p_tg_user_id and club = p_club;
  if r is null then
    return query select null::bigint, null::text, true;
  else
    return query select r.message_id, r.last_status, (now() - r.updated_at) > interval '45 seconds';
  end if;
end;
$$;
grant execute on function public.get_notify_state(bigint, text) to anon, authenticated, service_role;

-- يحفظ/يحدّث الحالة بعد كل فحص
create or replace function public.set_notify_state(p_tg_user_id bigint, p_club text, p_message_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entry_notify_state (tg_user_id, club, message_id, last_status, updated_at)
  values (p_tg_user_id, p_club, p_message_id, p_status, now())
  on conflict (tg_user_id, club) do update set
    message_id  = excluded.message_id,
    last_status = excluded.last_status,
    updated_at  = excluded.updated_at;
end;
$$;
grant execute on function public.set_notify_state(bigint, text, bigint, text) to anon, authenticated, service_role;

-- 2) سجل كل دخول ناجح فعلي (سطر لكل مرة، عشان نقدر نحسب "اليوم" بدقة بدون مهمة مجدولة)
create table if not exists public.club_entry_log (
  id bigint generated always as identity primary key,
  tg_user_id bigint not null,
  club       text   not null,
  entered_at timestamptz not null default now()
);
create index if not exists idx_club_entry_log_lookup on public.club_entry_log(tg_user_id, club, entered_at);

-- يسجّل دخول جديد ويرجع "كم مرة دخل هذا الشخص لهذا النادي من آخر 3 فجر بتوقيت السعودية"
create or replace function public.record_club_entry(p_tg_user_id bigint, p_club text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_boundary timestamptz;
begin
  insert into public.club_entry_log (tg_user_id, club) values (p_tg_user_id, p_club);

  -- حدود "اليوم": آخر ساعة 3 فجر بتوقيت السعودية قبل اللحظة الحالية
  v_boundary := (date_trunc('day', (now() at time zone 'Asia/Riyadh') - interval '3 hours')
                 + interval '3 hours') at time zone 'Asia/Riyadh';

  select count(*) into v_count
  from public.club_entry_log
  where tg_user_id = p_tg_user_id
    and club = p_club
    and entered_at >= v_boundary;

  return v_count;
end;
$$;
grant execute on function public.record_club_entry(bigint, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
