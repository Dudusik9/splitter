import { splitEqual } from './split'

/** Месяц в формате "YYYY-MM", даты — "YYYY-MM-DD". */
export interface DayRow {
  date: string
  allowance: number // лимит дня из бюджета
  carry: number // остаток (или перерасход) с прошлого дня
  available: number // allowance + carry
  spent: number
  left: number // available - spent, переносится на следующий день
}

export interface MonthStats {
  budget: number
  spent: number
  remaining: number
  baseDaily: number
  daysLeft: number // включая сегодня
  perDayLeft: number | null // сколько в среднем можно тратить в оставшиеся дни
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Дата в локальной таймзоне (toISOString дал бы UTC и сдвиг дня около полуночи). */
export const localISODate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** Дневные лимиты = бюджет / дней (остаток копеек — первым дням), остаток дня переносится дальше. */
export function budgetDays(total: number, month: string, entries: { spent_on: string; amount_cents: number }[]): DayRow[] {
  const spentByDate = new Map<string, number>()
  for (const e of entries) spentByDate.set(e.spent_on, (spentByDate.get(e.spent_on) ?? 0) + e.amount_cents)
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => i + 1)
  let carry = 0
  return splitEqual(total, days).map(({ userId: day, cents: allowance }) => {
    const date = `${month}-${pad(day)}`
    const available = allowance + carry
    const spent = spentByDate.get(date) ?? 0
    const row = { date, allowance, carry, available, spent, left: available - spent }
    carry = row.left
    return row
  })
}

export function monthStats(total: number, rows: DayRow[], today: string): MonthStats {
  const spent = rows.reduce((s, r) => s + r.spent, 0)
  const remaining = total - spent
  const daysLeft = rows.filter((r) => r.date >= today).length
  return {
    budget: total,
    spent,
    remaining,
    baseDaily: Math.floor(total / rows.length),
    daysLeft,
    perDayLeft: daysLeft > 0 ? Math.floor(remaining / daysLeft) : null,
  }
}
