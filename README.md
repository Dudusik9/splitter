# Splitter

Аналог Splitwise: аккаунты (логин + пароль), группы, траты поровну или по точным суммам, балансы и расчёты. Фронт — GitHub Pages, данные и авторизация — Supabase.

Раздел «Бюджет»: личный бюджет на месяц делится поровну на дни, остаток или перерасход дня переносится на следующий.

Участника в группу добавляют по логину или по числовому ID (виден в шапке после входа).

## Настройка
1. Supabase → SQL Editor: выполнить по порядку `supabase/migrations/001_init.sql` , `002_lock_down_helpers.sql` , `003_budget.sql` и `004_delete_group.sql`.
2. Authentication → Providers → Email: выключить **Confirm email**.
3. Локально: `.env.local` с `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, затем `npm run dev`.
4. Деплой: в репо Settings → Pages → Source = GitHub Actions; Settings → Variables → те же две переменные.

`npm test` — тесты логики деления и балансов.
