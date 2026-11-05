-- Двухнедельный режим: месяц делится на 1–15 и 16–конец, у каждой половины свой бюджет.
-- amount_cents остаётся суммой за месяц в обоих режимах.
alter table public.budgets
  add column mode text not null default 'month' check (mode in ('month', 'halves')),
  add column first_half_cents bigint check (first_half_cents > 0),
  add column second_half_cents bigint check (second_half_cents > 0),
  add constraint budgets_halves_consistent check (
    mode = 'month'
    or (first_half_cents is not null and second_half_cents is not null
        and amount_cents = first_half_cents + second_half_cents));
