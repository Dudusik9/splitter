export interface Transfer {
  from: number
  to: number
  cents: number
}

/** Чистый баланс участника: плательщики + (отдал по расчётам) − доли − (получил по расчётам). */
export function computeNets(
  memberIds: number[],
  payers: { userId: number; cents: number }[],
  shares: { userId: number; cents: number }[],
  settlements: { from: number; to: number; cents: number }[],
): Map<number, number> {
  const nets = new Map<number, number>(memberIds.map((id) => [id, 0]))
  const add = (id: number, delta: number) => nets.set(id, (nets.get(id) ?? 0) + delta)
  payers.forEach((p) => add(p.userId, p.cents))
  shares.forEach((s) => add(s.userId, -s.cents))
  settlements.forEach((s) => {
    add(s.from, s.cents)
    add(s.to, -s.cents)
  })
  return nets
}

/** Жадное упрощение долгов: наибольший должник платит наибольшему кредитору. */
export function simplifyDebts(nets: Map<number, number>): Transfer[] {
  const debtors = [...nets].filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }))
  const creditors = [...nets].filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }))
  const byLeftDesc = (a: { left: number }, b: { left: number }) => b.left - a.left
  const transfers: Transfer[] = []

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byLeftDesc)
    creditors.sort(byLeftDesc)
    const d = debtors[0]
    const c = creditors[0]
    const cents = Math.min(d.left, c.left)
    transfers.push({ from: d.id, to: c.id, cents })
    d.left -= cents
    c.left -= cents
    if (d.left === 0) debtors.shift()
    if (c.left === 0) creditors.shift()
  }
  return transfers
}
