export interface Part {
  userId: number
  cents: number
}

/** Делит сумму поровну; остаток копеек раздаётся по одной первым участникам. */
export function splitEqual(total: number, userIds: number[]): Part[] {
  if (userIds.length === 0) return []
  const base = Math.floor(total / userIds.length)
  const extra = total - base * userIds.length
  return userIds.map((userId, i) => ({ userId, cents: base + (i < extra ? 1 : 0) }))
}

export const sumParts = (parts: Part[]): number => parts.reduce((s, p) => s + p.cents, 0)

/** Сколько ещё не распределено (положительное — недобор, отрицательное — перебор). */
export const remainder = (total: number, parts: Part[]): number => total - sumParts(parts)

export const isValidSplit = (total: number, parts: Part[]): boolean =>
  total > 0 && parts.length > 0 && parts.every((p) => p.cents >= 0) && remainder(total, parts) === 0
