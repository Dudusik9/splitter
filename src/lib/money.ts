/** Деньги везде хранятся целым числом копеек (number, безопасно до ~9e13). */

/** "12,5" / "12.50" / "1 200" -> 1250 / 1250 / 120000; невалидное -> null. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/\s+/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

export function formatMoney(cents: number, currency = 'RUB'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toLocaleString('ru-RU')
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole},${frac} ${currencySymbol(currency)}`
}

function currencySymbol(currency: string): string {
  const symbols: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' }
  return symbols[currency] ?? currency
}
