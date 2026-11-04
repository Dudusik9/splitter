-- Личный месячный бюджет: виден и меняется только владельцем, без RPC
create table public.budgets (
  id bigint generated always as identity primary key,
  owner bigint not null references public.profiles (id) on delete cascade,
  month date not null check (extract(day from month) = 1),       -- первое число месяца
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'RUB' check (char_length(currency) between 3 and 5),
  created_at timestamptz not null default now(),
  unique (owner, month)
);

create table public.budget_entries (
  id bigint generated always as identity primary key,
  budget_id bigint not null references public.budgets (id) on delete cascade,
  spent_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  description text check (char_length(description) <= 200),
  created_at timestamptz not null default now()
);

create index on public.budget_entries (budget_id, spent_on);

alter table public.budgets enable row level security;
alter table public.budget_entries enable row level security;

create policy budgets_own on public.budgets for all to authenticated
  using (owner = public.current_profile_id())
  with check (owner = public.current_profile_id());

-- трата должна попадать в месяц своего бюджета
create policy budget_entries_own on public.budget_entries for all to authenticated
  using (exists (select 1 from public.budgets b
                 where b.id = budget_id and b.owner = public.current_profile_id()))
  with check (exists (select 1 from public.budgets b
                      where b.id = budget_id and b.owner = public.current_profile_id()
                        and date_trunc('month', spent_on)::date = b.month));

revoke all on public.budgets, public.budget_entries from anon;
