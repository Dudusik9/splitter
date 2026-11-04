-- Splitter: схема, RLS и RPC. Выполнить целиком в Supabase SQL Editor.
create extension if not exists citext with schema extensions;

-- ---------- Таблицы ----------
create table public.profiles (
  id bigint generated always as identity primary key,           -- числовой user id
  auth_id uuid not null unique references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    check (username ~ '^[A-Za-z0-9_]{3,32}$'),
  display_name text,
  created_at timestamptz not null default now()
);

create table public.groups (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 100),
  currency text not null default 'RUB' check (char_length(currency) between 3 and 5),
  created_by bigint not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id bigint not null references public.groups (id) on delete cascade,
  user_id bigint not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.expenses (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0),
  split_type text not null check (split_type in ('equal', 'exact')),
  spent_at date not null default current_date,
  created_by bigint not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.expense_payers (
  expense_id bigint not null references public.expenses (id) on delete cascade,
  user_id bigint not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (expense_id, user_id)
);

create table public.expense_shares (
  expense_id bigint not null references public.expenses (id) on delete cascade,
  user_id bigint not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  from_user bigint not null references public.profiles (id),
  to_user bigint not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  created_by bigint not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create index on public.group_members (user_id);
create index on public.expenses (group_id, spent_at desc);
create index on public.settlements (group_id, created_at desc);

-- ---------- Хелперы ----------
create function public.current_profile_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_id = auth.uid()
$$;

create function public.is_group_member(p_group_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = public.current_profile_id()
  )
$$;

-- ---------- Профиль при регистрации ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (auth_id, username, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username')
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- RLS: чтение участникам, запись только через RPC ----------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());

create policy groups_read on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy members_read on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy expenses_read on public.expenses for select to authenticated
  using (public.is_group_member(group_id));
create policy payers_read on public.expense_payers for select to authenticated
  using (exists (select 1 from public.expenses e
                 where e.id = expense_id and public.is_group_member(e.group_id)));
create policy shares_read on public.expense_shares for select to authenticated
  using (exists (select 1 from public.expenses e
                 where e.id = expense_id and public.is_group_member(e.group_id)));
create policy settlements_read on public.settlements for select to authenticated
  using (public.is_group_member(group_id));

-- профиль меняется только в display_name
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------- RPC ----------
create function public.create_group(p_name text, p_currency text default 'RUB') returns bigint
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_profile_id(); gid bigint;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into groups (name, currency, created_by) values (trim(p_name), upper(p_currency), me)
    returning id into gid;
  insert into group_members (group_id, user_id) values (gid, me);
  return gid;
end $$;

-- p_identifier: число -> user id, иначе username
create function public.add_group_member(p_group_id bigint, p_identifier text) returns bigint
language plpgsql security definer set search_path = public as $$
declare uid bigint; ident text := trim(p_identifier);
begin
  if not public.is_group_member(p_group_id) then raise exception 'not a group member'; end if;
  if ident ~ '^\d{1,18}$' then
    select id into uid from profiles where id = ident::bigint;
  else
    select id into uid from profiles where username = ident::extensions.citext;
  end if;
  if uid is null then raise exception 'user not found'; end if;
  insert into group_members (group_id, user_id) values (p_group_id, uid)
    on conflict do nothing;
  if not found then raise exception 'already in group'; end if;
  return uid;
end $$;

create function public.leave_group(p_group_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_profile_id(); net bigint;
begin
  select net_cents into net from public.group_balances(p_group_id) where user_id = me;
  if coalesce(net, 0) <> 0 then raise exception 'settle your balance before leaving'; end if;
  delete from group_members where group_id = p_group_id and user_id = me;
end $$;

-- payers/shares: [{"user_id": 1, "cents": 500}, ...]
create function public._check_expense(
  p_group_id bigint, p_amount bigint, p_split text, p_payers jsonb, p_shares jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare psum bigint; ssum bigint; bad int;
begin
  if p_split not in ('equal', 'exact') then raise exception 'bad split type'; end if;
  select coalesce(sum((x ->> 'cents')::bigint), 0) into psum from jsonb_array_elements(p_payers) x;
  select coalesce(sum((x ->> 'cents')::bigint), 0) into ssum from jsonb_array_elements(p_shares) x;
  if psum <> p_amount then raise exception 'payers sum % <> amount %', psum, p_amount; end if;
  if ssum <> p_amount then raise exception 'shares sum % <> amount %', ssum, p_amount; end if;
  if jsonb_array_length(p_payers) = 0 or jsonb_array_length(p_shares) = 0 then
    raise exception 'payers and shares required';
  end if;
  select count(*) into bad from (
    select (x ->> 'user_id')::bigint as uid from jsonb_array_elements(p_payers) x
    union all
    select (x ->> 'user_id')::bigint from jsonb_array_elements(p_shares) x
  ) u
  where not exists (select 1 from group_members m where m.group_id = p_group_id and m.user_id = u.uid);
  if bad > 0 then raise exception 'participant is not in the group'; end if;
end $$;
revoke all on function public._check_expense from public, anon, authenticated;

create function public._write_expense_parts(p_expense_id bigint, p_payers jsonb, p_shares jsonb) returns void
language sql security definer set search_path = public as $$
  insert into expense_payers (expense_id, user_id, amount_cents)
    select p_expense_id, (x ->> 'user_id')::bigint, (x ->> 'cents')::bigint
    from jsonb_array_elements(p_payers) x;
  insert into expense_shares (expense_id, user_id, amount_cents)
    select p_expense_id, (x ->> 'user_id')::bigint, (x ->> 'cents')::bigint
    from jsonb_array_elements(p_shares) x;
$$;
revoke all on function public._write_expense_parts from public, anon, authenticated;

create function public.create_expense(
  p_group_id bigint, p_description text, p_amount_cents bigint, p_split_type text,
  p_spent_at date, p_payers jsonb, p_shares jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
  if not public.is_group_member(p_group_id) then raise exception 'not a group member'; end if;
  perform public._check_expense(p_group_id, p_amount_cents, p_split_type, p_payers, p_shares);
  insert into expenses (group_id, description, amount_cents, split_type, spent_at, created_by)
    values (p_group_id, trim(p_description), p_amount_cents, p_split_type,
            coalesce(p_spent_at, current_date), public.current_profile_id())
    returning id into eid;
  perform public._write_expense_parts(eid, p_payers, p_shares);
  return eid;
end $$;

create function public.update_expense(
  p_expense_id bigint, p_description text, p_amount_cents bigint, p_split_type text,
  p_spent_at date, p_payers jsonb, p_shares jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare gid bigint;
begin
  select group_id into gid from expenses where id = p_expense_id;
  if gid is null or not public.is_group_member(gid) then raise exception 'not allowed'; end if;
  perform public._check_expense(gid, p_amount_cents, p_split_type, p_payers, p_shares);
  update expenses set description = trim(p_description), amount_cents = p_amount_cents,
    split_type = p_split_type, spent_at = coalesce(p_spent_at, spent_at)
    where id = p_expense_id;
  delete from expense_payers where expense_id = p_expense_id;
  delete from expense_shares where expense_id = p_expense_id;
  perform public._write_expense_parts(p_expense_id, p_payers, p_shares);
end $$;

create function public.delete_expense(p_expense_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare gid bigint;
begin
  select group_id into gid from expenses where id = p_expense_id;
  if gid is null or not public.is_group_member(gid) then raise exception 'not allowed'; end if;
  delete from expenses where id = p_expense_id;
end $$;

create function public.create_settlement(
  p_group_id bigint, p_from_user bigint, p_to_user bigint, p_amount_cents bigint
) returns bigint
language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  if not public.is_group_member(p_group_id) then raise exception 'not a group member'; end if;
  if not (select count(*) = 2 from group_members
          where group_id = p_group_id and user_id in (p_from_user, p_to_user)
            and p_from_user <> p_to_user) then
    raise exception 'both users must be distinct group members';
  end if;
  insert into settlements (group_id, from_user, to_user, amount_cents, created_by)
    values (p_group_id, p_from_user, p_to_user, p_amount_cents, public.current_profile_id())
    returning id into sid;
  return sid;
end $$;

create function public.delete_settlement(p_settlement_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare gid bigint;
begin
  select group_id into gid from settlements where id = p_settlement_id;
  if gid is null or not public.is_group_member(gid) then raise exception 'not allowed'; end if;
  delete from settlements where id = p_settlement_id;
end $$;

-- net > 0: группе должны этому участнику; net < 0: он должен
create function public.group_balances(p_group_id bigint)
returns table (user_id bigint, net_cents bigint)
language sql stable security definer set search_path = public as $$
  select m.user_id,
    coalesce((select sum(p.amount_cents) from expense_payers p join expenses e on e.id = p.expense_id
              where e.group_id = p_group_id and p.user_id = m.user_id), 0)
  - coalesce((select sum(s.amount_cents) from expense_shares s join expenses e on e.id = s.expense_id
              where e.group_id = p_group_id and s.user_id = m.user_id), 0)
  + coalesce((select sum(t.amount_cents) from settlements t
              where t.group_id = p_group_id and t.from_user = m.user_id), 0)
  - coalesce((select sum(t.amount_cents) from settlements t
              where t.group_id = p_group_id and t.to_user = m.user_id), 0) as net_cents
  from group_members m
  where m.group_id = p_group_id and public.is_group_member(p_group_id)
$$;

-- ---------- Права на RPC: только для залогиненных ----------
revoke all on function
  public.create_group, public.add_group_member, public.leave_group, public.create_expense,
  public.update_expense, public.delete_expense, public.create_settlement,
  public.delete_settlement, public.group_balances
from public, anon;
grant execute on function
  public.create_group, public.add_group_member, public.leave_group, public.create_expense,
  public.update_expense, public.delete_expense, public.create_settlement,
  public.delete_settlement, public.group_balances
to authenticated;
