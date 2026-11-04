import { describe, expect, it } from 'vitest'
import { computeNets, simplifyDebts } from './balances'
import { budgetDays, localISODate, monthStats, shiftMonth } from './budget'
import { formatMoney, parseMoney } from './money'
import { isValidSplit, remainder, splitEqual, sumParts } from './split'

describe('money', () => {
  it('parses amounts', () => {
    expect(parseMoney('12,5')).toBe(1250)
    expect(parseMoney('12.50')).toBe(1250)
    expect(parseMoney('1 200')).toBe(120000)
    expect(parseMoney('0.05')).toBe(5)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
  })
  it('formats amounts', () => {
    expect(formatMoney(5, 'USD')).toBe('0,05 $')
    expect(formatMoney(-1250)).toContain('-12,50')
  })
})

describe('split', () => {
  it('splits equally with kopeck remainder to first members', () => {
    const parts = splitEqual(1000, [1, 2, 3])
    expect(parts.map((p) => p.cents)).toEqual([334, 333, 333])
    expect(sumParts(parts)).toBe(1000)
  })
  it('validates exact splits', () => {
    expect(isValidSplit(100, [{ userId: 1, cents: 60 }, { userId: 2, cents: 40 }])).toBe(true)
    expect(isValidSplit(100, [{ userId: 1, cents: 60 }, { userId: 2, cents: 30 }])).toBe(false)
    expect(remainder(100, [{ userId: 1, cents: 60 }])).toBe(40)
  })
})

describe('balances', () => {
  it('nets for equal split', () => {
    // 1 платит 900 за троих
    const nets = computeNets([1, 2, 3], [{ userId: 1, cents: 900 }], splitEqual(900, [1, 2, 3]), [])
    expect([...nets]).toEqual([[1, 600], [2, -300], [3, -300]])
  })
  it('multiple payers and settlements', () => {
    const nets = computeNets(
      [1, 2],
      [{ userId: 1, cents: 600 }, { userId: 2, cents: 400 }],
      [{ userId: 1, cents: 500 }, { userId: 2, cents: 500 }],
      [{ from: 2, to: 1, cents: 100 }],
    )
    expect(nets.get(1)).toBe(0)
    expect(nets.get(2)).toBe(0)
  })
  it('simplifies debts and conserves money', () => {
    const nets = new Map([[1, 700], [2, -300], [3, -400], [4, 0]])
    const t = simplifyDebts(nets)
    expect(t).toEqual([{ from: 3, to: 1, cents: 400 }, { from: 2, to: 1, cents: 300 }])
  })
  it('no transfers when settled', () => {
    expect(simplifyDebts(new Map([[1, 0], [2, 0]]))).toEqual([])
  })
})

describe('budget', () => {
  const entry = (spent_on: string, amount_cents: number) => ({ spent_on, amount_cents })

  it('daily allowances sum to the budget for 28/30/31-day months', () => {
    for (const [month, n] of [['2026-02', 28], ['2026-11', 30], ['2026-12', 31]] as const) {
      const rows = budgetDays(100_001, month, [])
      expect(rows).toHaveLength(n)
      expect(rows.reduce((s, r) => s + r.allowance, 0)).toBe(100_001)
      expect(rows[0].allowance).toBeGreaterThanOrEqual(rows[n - 1].allowance)
    }
  })
  it('carries leftover and overspend to the next day', () => {
    // ноябрь: 30 000 ₽ = 1000 ₽ в день
    const rows = budgetDays(3_000_000, '2026-11', [
      entry('2026-11-01', 80_000),
      entry('2026-11-02', 100_000),
      entry('2026-11-02', 30_000),
    ])
    expect(rows[1].available).toBe(120_000) // 1000 + 200 остатка
    expect(rows[1].left).toBe(-10_000) // потратил 1300
    expect(rows[2].available).toBe(90_000) // 1000 − 100 перерасхода
    expect(rows[29].left).toBe(3_000_000 - 210_000)
  })
  it('month stats and per-day allowance for remaining days', () => {
    const rows = budgetDays(3_000_000, '2026-11', [entry('2026-11-01', 500_000)])
    const s = monthStats(3_000_000, rows, '2026-11-21')
    expect(s).toEqual({ budget: 3_000_000, spent: 500_000, remaining: 2_500_000, baseDaily: 100_000, daysLeft: 10, perDayLeft: 250_000 })
    expect(monthStats(3_000_000, rows, '2026-12-01').perDayLeft).toBeNull()
  })
  it('local dates and month shifting', () => {
    expect(localISODate(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04')
    expect(localISODate(new Date(2026, 10, 5, 0, 1))).toBe('2026-11-05')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})
