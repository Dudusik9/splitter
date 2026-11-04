import { describe, expect, it } from 'vitest'
import { computeNets, simplifyDebts } from './balances'
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
