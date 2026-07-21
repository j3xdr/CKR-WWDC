-- CKR WWDC — token model schema (no credentials in this file)
-- Roles: admin | normal
-- No self-registration — admin creates users via Render API (service role)
-- 1 token = 1 farm run
-- Keeps legacy rental columns on profiles for Login_j3xdr compatibility

-- ---------------------------------------------------------------------------
-- profiles extensions
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists token_balance integer not null default 0
    check (token_balance >= 0);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

create index if not exists profiles_token_balance_idx
  on public.profiles (token_balance);

-- ---------------------------------------------------------------------------
-- token ledger (append-only credit/debit history)
-- ---------------------------------------------------------------------------
create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  reason text not null default '',
  balance_after integer null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists token_ledger_user_id_idx
  on public.token_ledger (user_id, created_at desc);

alter table public.token_ledger enable row level security;

drop policy if exists "token_ledger_select_own" on public.token_ledger;
create policy "token_ledger_select_own"
  on public.token_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- no direct insert/update from clients — service role / security definer RPCs only
revoke insert, update, delete on public.token_ledger from authenticated, anon;
grant select on public.token_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- run jobs (farm run audit)
-- ---------------------------------------------------------------------------
create table if not exists public.run_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  score integer null,
  coin integer null,
  exp integer null,
  result jsonb null,
  error text null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null
);

create index if not exists run_jobs_user_id_idx
  on public.run_jobs (user_id, created_at desc);

alter table public.run_jobs enable row level security;

drop policy if exists "run_jobs_select_own" on public.run_jobs;
create policy "run_jobs_select_own"
  on public.run_jobs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.run_jobs from authenticated, anon;
grant select on public.run_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic consume: 1 token = 1 farm run. Fails if balance < 1.
-- ---------------------------------------------------------------------------
create or replace function public.consume_token(
  p_reason text default 'farm_run'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  bal integer;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select token_balance into bal
  from public.profiles
  where id = uid
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_missing');
  end if;

  if bal < 1 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_tokens', 'token_balance', bal);
  end if;

  update public.profiles
  set token_balance = token_balance - 1
  where id = uid
  returning token_balance into bal;

  insert into public.token_ledger (user_id, delta, reason, balance_after, created_by)
  values (uid, -1, coalesce(nullif(trim(p_reason), ''), 'farm_run'), bal, uid);

  return jsonb_build_object('ok', true, 'token_balance', bal);
end;
$$;

revoke all on function public.consume_token(text) from public;
grant execute on function public.consume_token(text) to authenticated;
grant execute on function public.consume_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Admin credit tokens by user id (or called from Render with service role)
-- ---------------------------------------------------------------------------
create or replace function public.admin_credit_tokens(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'admin_credit'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bal integer;
  caller uuid := auth.uid();
  jwt_role text := coalesce(auth.role(), '');
begin
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  -- service_role (Render backend) OR authenticated admin only — never anon
  if jwt_role = 'service_role' then
    null;
  elsif caller is not null and public.is_admin() then
    null;
  else
    return jsonb_build_object('ok', false, 'reason', 'admin_only');
  end if;

  update public.profiles
  set token_balance = greatest(token_balance + p_amount, 0)
  where id = p_user_id
  returning token_balance into bal;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  insert into public.token_ledger (user_id, delta, reason, balance_after, created_by)
  values (
    p_user_id,
    p_amount,
    coalesce(nullif(trim(p_reason), ''), 'admin_credit'),
    bal,
    caller
  );

  return jsonb_build_object('ok', true, 'id', p_user_id, 'token_balance', bal);
end;
$$;

revoke all on function public.admin_credit_tokens(uuid, integer, text) from public;
grant execute on function public.admin_credit_tokens(uuid, integer, text) to authenticated;
grant execute on function public.admin_credit_tokens(uuid, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Admin lookup by email or username
-- ---------------------------------------------------------------------------
create or replace function public.admin_lookup_user(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
  row_json jsonb;
  jwt_role text := coalesce(auth.role(), '');
begin
  if jwt_role = 'service_role' then
    null;
  elsif auth.uid() is not null and public.is_admin() then
    null;
  else
    return jsonb_build_object('ok', false, 'reason', 'admin_only');
  end if;
  if length(q) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'query_too_short');
  end if;

  select jsonb_build_object(
    'ok', true,
    'id', p.id,
    'email', p.email,
    'username', p.username,
    'display_name', p.display_name,
    'role', p.role,
    'token_balance', p.token_balance,
    'created_at', p.created_at
  )
  into row_json
  from public.profiles p
  where lower(coalesce(p.email, '')) = q
     or lower(coalesce(p.username, '')) = q
     or lower(coalesce(p.display_name, '')) = q
  order by p.created_at desc
  limit 1;

  if row_json is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return row_json;
end;
$$;

revoke all on function public.admin_lookup_user(text) from public;
grant execute on function public.admin_lookup_user(text) to authenticated;
grant execute on function public.admin_lookup_user(text) to service_role;

-- Refresh admin list to include token fields (existing fn returns setof profiles)
create or replace function public.admin_list_profiles()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.profiles p
  where public.is_admin()
  order by p.created_at desc;
$$;
