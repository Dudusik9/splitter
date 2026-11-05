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
  carryIn: number // остаток (или перерасход) предыдущего отрезка
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

/** Последний день первой половины месяца в двухнедельном режиме. */
export const HALF_LAST_DAY = 15

export const halfOf = (date: string): 1 | 2 => (Number(date.slice(8, 10)) <= HALF_LAST_DAY ? 1 : 2)

/** Бюджет на месяц целиком или по половинам (1–15 и 16–конец). */
export type Allocation = number | { first: number; second: number }

export const allocationTotal = (a: Allocation) => (typeof a === 'number' ? a : a.first + a.second)

/** Дневные лимиты (остаток копеек — первым дням отрезка); остаток дня, в т.ч. первой половины, переносится дальше. */
export function budgetDays(
  allocation: Allocation,
  month: string,
  entries: { spent_on: string; amount_cents: number }[],
): DayRow[] {
  const spentByDate = new Map<string, number>()
  for (const e of entries) spentByDate.set(e.spent_on, (spentByDate.get(e.spent_on) ?? 0) + e.amount_cents)
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => i + 1)
  const allowances =
    typeof allocation === 'number'
      ? splitEqual(allocation, days)
      : [
          ...splitEqual(allocation.first, days.slice(0, HALF_LAST_DAY)),
          ...splitEqual(allocation.second, days.slice(HALF_LAST_DAY)),
        ]
  let carry = 0
  return allowances.map(({ userId: day, cents: allowance }) => {
    const date = `${month}-${pad(day)}`
    const available = allowance + carry
    const spent = spentByDate.get(date) ?? 0
    const row = { date, allowance, carry, available, spent, left: available - spent }
    carry = row.left
    return row
  })
}

/** Сводка по отрезку дней (месяц или половина) с учётом переноса из предыдущего отрезка. */
export function periodStats(budget: number, carryIn: number, rows: DayRow[], today: string): MonthStats {
  const spent = rows.reduce((s, r) => s + r.spent, 0)
  const remaining = budget + carryIn - spent
  const daysLeft = rows.filter((r) => r.date >= today).length
  return {
    budget,
    carryIn,
    spent,
    remaining,
    baseDaily: Math.floor(budget / rows.length),
    daysLeft,
    perDayLeft: daysLeft > 0 ? Math.floor(remaining / daysLeft) : null,
  }
}

export const monthStats = (total: number, rows: DayRow[], today: string): MonthStats => periodStats(total, 0, rows, today)

/** Делит месячную сумму на половины пропорционально числу дней — для предзаполнения формы. */
export function splitHalves(total: number, month: string): { first: number; second: number } {
  const rows = budgetDays(total, month, [])
  const first = rows.slice(0, HALF_LAST_DAY).reduce((s, r) => s + r.allowance, 0)
  return { first, second: total - first }
}
