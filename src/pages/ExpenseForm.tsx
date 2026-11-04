import { useMemo, useState, type FormEvent } from 'react'
import { api, type Expense, type Profile } from '../lib/api'
import { formatMoney, parseMoney } from '../lib/money'
import { isValidSplit, remainder, splitEqual, type Part } from '../lib/split'

interface Props {
  groupId: number
  currency: string
  members: Profile[]
  meId: number
  editing: Expense | null
  onDone: () => void
  onCancel: () => void
}

const centsToInput = (c: number) => (c / 100).toFixed(2)
const todayIso = () => new Date().toISOString().slice(0, 10)

export function ExpenseForm({ groupId, currency, members, meId, editing, onDone, onCancel }: Props) {
  const [description, setDescription] = useState(editing?.description ?? '')
  const [amountText, setAmountText] = useState(editing ? centsToInput(editing.amount_cents) : '')
  const [date, setDate] = useState(editing?.spent_at ?? todayIso())
  const [splitType, setSplitType] = useState<'equal' | 'exact'>(editing?.split_type ?? 'equal')
  const [multiPayers, setMultiPayers] = useState((editing?.expense_payers.length ?? 1) > 1)
  const [singlePayer, setSinglePayer] = useState(editing?.expense_payers[0]?.user_id ?? meId)
  const [payerTexts, setPayerTexts] = useState<Record<number, string>>(
    Object.fromEntries((editing?.expense_payers ?? []).map((p) => [p.user_id, centsToInput(p.amount_cents)])),
  )
  const [included, setIncluded] = useState<Set<number>>(
    new Set(editing ? editing.expense_shares.map((s) => s.user_id) : members.map((m) => m.id)),
  )
  const [shareTexts, setShareTexts] = useState<Record<number, string>>(
    Object.fromEntries((editing?.expense_shares ?? []).map((s) => [s.user_id, centsToInput(s.amount_cents)])),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const amount = parseMoney(amountText)
  const name = (m: Profile) => m.display_name || m.username

  const payers: Part[] = useMemo(() => {
    if (amount === null) return []
    if (!multiPayers) return [{ userId: singlePayer, cents: amount }]
    return members
      .map((m) => ({ userId: m.id, cents: parseMoney(payerTexts[m.id] ?? '') ?? 0 }))
      .filter((p) => p.cents > 0)
  }, [amount, multiPayers, singlePayer, members, payerTexts])

  const shares: Part[] = useMemo(() => {
    if (amount === null) return []
    if (splitType === 'equal') return splitEqual(amount, members.filter((m) => included.has(m.id)).map((m) => m.id))
    return members
      .filter((m) => included.has(m.id))
      .map((m) => ({ userId: m.id, cents: parseMoney(shareTexts[m.id] ?? '') ?? 0 }))
  }, [amount, splitType, members, included, shareTexts])

  const toggle = (id: number) =>
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (amount === null || amount <= 0) return setError('Введите сумму, например 1250,50')
    if (!isValidSplit(amount, payers)) return setError('Суммы плательщиков должны давать общую сумму')
    if (!isValidSplit(amount, shares)) return setError('Доли должны давать общую сумму')
    setBusy(true)
    try {
      await api.saveExpense(groupId, editing?.id ?? null, {
        description: description.trim(),
        amount,
        splitType,
        date,
        payers,
        shares,
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const left = amount === null ? null : remainder(amount, shares)
  const payLeft = amount === null ? null : remainder(amount, payers)

  return (
    <form className="card" onSubmit={submit}>
      <h3>{editing ? 'Изменить трату' : 'Новая трата'}</h3>
      <label>
        Описание
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={200} />
      </label>
      <div className="row">
        <label>
          Сумма, {currency}
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} required />
        </label>
        <label>
          Дата
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>

      <fieldset>
        <legend>Кто платил</legend>
        {!multiPayers ? (
          <select value={singlePayer} onChange={(e) => setSinglePayer(Number(e.target.value))}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{name(m)}</option>
            ))}
          </select>
        ) : (
          <>
            {members.map((m) => (
              <div className="row" key={m.id}>
                <span className="grow">{name(m)}</span>
                <input
                  className="amount"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={payerTexts[m.id] ?? ''}
                  onChange={(e) => setPayerTexts({ ...payerTexts, [m.id]: e.target.value })}
                />
              </div>
            ))}
            {payLeft !== null && payLeft !== 0 && (
              <p className="error">Осталось распределить: {formatMoney(payLeft, currency)}</p>
            )}
          </>
        )}
        <button type="button" className="link" onClick={() => setMultiPayers(!multiPayers)}>
          {multiPayers ? 'Платил один человек' : 'Платили несколько'}
        </button>
      </fieldset>

      <fieldset>
        <legend>Как делим</legend>
        <div className="tabs">
          <button type="button" className={splitType === 'equal' ? 'active' : ''} onClick={() => setSplitType('equal')}>
            Поровну
          </button>
          <button type="button" className={splitType === 'exact' ? 'active' : ''} onClick={() => setSplitType('exact')}>
            По суммам
          </button>
        </div>
        {members.map((m) => {
          const share = shares.find((s) => s.userId === m.id)
          return (
            <div className="row" key={m.id}>
              <label className="check grow">
                <input type="checkbox" checked={included.has(m.id)} onChange={() => toggle(m.id)} />
                {name(m)}
              </label>
              {included.has(m.id) &&
                (splitType === 'equal' ? (
                  <span className="muted">{share ? formatMoney(share.cents, currency) : ''}</span>
                ) : (
                  <input
                    className="amount"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={shareTexts[m.id] ?? ''}
                    onChange={(e) => setShareTexts({ ...shareTexts, [m.id]: e.target.value })}
                  />
                ))}
            </div>
          )
        })}
        {splitType === 'exact' && left !== null && left !== 0 && (
          <p className="error">Осталось распределить: {formatMoney(left, currency)}</p>
        )}
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={busy}>Сохранить</button>
        <button type="button" className="secondary" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
