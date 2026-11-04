import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { api, type Budget, type BudgetEntry } from '../lib/api'
import { budgetDays, localISODate, monthStats, shiftMonth, type DayRow } from '../lib/budget'
import { formatMoney, parseMoney } from '../lib/money'

const monthTitle = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
const dayTitle = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' })
}
const sign = (c: number) => (c > 0 ? 'pos' : c < 0 ? 'neg' : 'muted')
const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(',00', '')

export function BudgetPage() {
  const { me } = useAuth()
  const today = localISODate()
  const month = useParams().month ?? today.slice(0, 7)
  const [budget, setBudget] = useState<Budget | null | undefined>(undefined)
  const [entries, setEntries] = useState<BudgetEntry[]>([])
  const [editingBudget, setEditingBudget] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const b = await api.budget(month)
      setEntries(b ? await api.budgetEntries(b.id) : [])
      setBudget(b)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [month])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBudget(undefined)
    void reload()
  }, [reload])

  const rows = budget ? budgetDays(budget.amount_cents, month, entries) : []

  if (!me) return null
  const money = (c: number) => formatMoney(c, budget?.currency)

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const nav = (
    <div className="row month-nav">
      <Link to={`/budget/${shiftMonth(month, -1)}`}>←</Link>
      <h2 className="grow center-text">{monthTitle(month)}</h2>
      <Link to={`/budget/${shiftMonth(month, 1)}`}>→</Link>
    </div>
  )

  if (budget === undefined) return <>{nav}{error ? <p className="error">{error}</p> : <p className="muted">Загрузка…</p>}</>

  if (budget === null || editingBudget) {
    return (
      <>
        {nav}
        <BudgetForm
          initial={budget}
          onCancel={budget ? () => setEditingBudget(false) : undefined}
          onSave={(cents, currency) =>
            run(async () => {
              await api.saveBudget(me.id, month, cents, currency)
              setEditingBudget(false)
            })
          }
        />
        {error && <p className="error">{error}</p>}
      </>
    )
  }

  const stats = monthStats(budget.amount_cents, rows, today)
  const todayRow = rows.find((r) => r.date === today)
  const onAdd = (date: string, cents: number, description: string | null) =>
    run(() => api.addBudgetEntry(budget.id, { spent_on: date, amount_cents: cents, description }))
  const onUpdate = (id: number, cents: number, description: string | null) =>
    run(() => api.updateBudgetEntry(id, { amount_cents: cents, description }))
  const onDelete = (id: number) => confirm('Удалить трату?') && run(() => api.deleteBudgetEntry(id))

  return (
    <>
      {nav}
      {error && <p className="error">{error}</p>}

      {todayRow && (
        <section className="card today-card">
          <p className="muted">{todayRow.left >= 0 ? 'Можно потратить сегодня' : 'Перерасход сегодня'}</p>
          <p className={`big ${sign(todayRow.left)}`}>{money(Math.abs(todayRow.left))}</p>
          <p className="muted small">
            лимит {money(todayRow.allowance)}
            {todayRow.carry !== 0 &&
              (todayRow.carry > 0
                ? ` + ${money(todayRow.carry)} с прошлых дней`
                : ` − ${money(-todayRow.carry)} перерасход прошлых дней`)}
            {todayRow.spent > 0 && ` · потрачено ${money(todayRow.spent)}`}
          </p>
          <DayEntries
            date={today}
            entries={entries.filter((e) => e.spent_on === today)}
            money={money}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        </section>
      )}

      <details className="card panel" open={!todayRow}>
        <summary>
          <span className="grow">Бюджет на месяц</span>
          <span className="muted">{money(stats.remaining)} из {money(stats.budget)}</span>
        </summary>
        <ul className="list">
          <li><span className="grow">Бюджет</span>{money(stats.budget)}</li>
          <li><span className="grow">Лимит в день</span>{money(stats.baseDaily)}</li>
          <li><span className="grow">Потрачено</span>{money(stats.spent)}</li>
          <li><span className="grow">Осталось на месяц</span><span className={sign(stats.remaining)}>{money(stats.remaining)}</span></li>
          {stats.perDayLeft !== null && (
            <li>
              <span className="grow">В среднем на оставшиеся {stats.daysLeft} дн.</span>
              <span className={sign(stats.perDayLeft)}>{money(stats.perDayLeft)}</span>
            </li>
          )}
        </ul>
        <button className="link" onClick={() => setEditingBudget(true)}>Изменить бюджет</button>
      </details>

      <details className="card panel">
        <summary>
          <span className="grow">Статистика по дням</span>
        </summary>
        <ul className="list days">
          {rows.map((r) => (
            <DayItem
              key={r.date}
              row={r}
              isToday={r.date === today}
              open={openDay === r.date}
              entries={entries.filter((e) => e.spent_on === r.date)}
              money={money}
              onToggle={() => setOpenDay(openDay === r.date ? null : r.date)}
              onAdd={onAdd}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </details>
    </>
  )
}

function BudgetForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Budget | null
  onSave: (cents: number, currency: string) => Promise<void>
  onCancel?: () => void
}) {
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amount_cents) : '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'RUB')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const cents = parseMoney(amount)
    if (!cents) return setError('Введите сумму больше нуля')
    setError('')
    await onSave(cents, currency)
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3>Бюджет на месяц</h3>
      <p className="muted">Сумма делится поровну на все дни месяца; остаток или перерасход дня переносится на следующий.</p>
      <div className="row">
        <input placeholder="Сумма" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="amount">
          <option>RUB</option>
          <option>USD</option>
          <option>EUR</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row actions">
        <button>Сохранить</button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}
      </div>
    </form>
  )
}

interface EntryHandlers {
  onAdd: (date: string, cents: number, description: string | null) => Promise<void>
  onUpdate: (id: number, cents: number, description: string | null) => Promise<void>
  onDelete: (id: number) => void
}

function DayItem({
  row,
  isToday,
  open,
  onToggle,
  ...rest
}: {
  row: DayRow
  isToday: boolean
  open: boolean
  entries: BudgetEntry[]
  money: (c: number) => string
  onToggle: () => void
} & EntryHandlers) {
  return (
    <li className={`day${isToday ? ' today' : ''}`}>
      <button className="day-head" onClick={onToggle}>
        <span className="grow">{dayTitle(row.date)}{isToday && ' · сегодня'}</span>
        <span className="muted">{rest.money(row.spent)} / {rest.money(row.available)}</span>
        <span className={`day-left ${sign(row.left)}`}>{rest.money(row.left)}</span>
      </button>
      {open && (
        <div className="day-body">
          {rest.entries.length === 0 && <p className="muted">Трат нет</p>}
          <DayEntries date={row.date} {...rest} />
        </div>
      )}
    </li>
  )
}

/** Траты одного дня с правкой/удалением и форма добавления. */
function DayEntries({
  date,
  entries,
  money,
  onAdd,
  onUpdate,
  onDelete,
}: { date: string; entries: BudgetEntry[]; money: (c: number) => string } & EntryHandlers) {
  const [editing, setEditing] = useState<BudgetEntry | null>(null)
  return (
    <>
      {entries.map((e) =>
        editing?.id === e.id ? (
          <EntryForm
            key={e.id}
            initial={e}
            onCancel={() => setEditing(null)}
            onSave={async (c, d) => {
              await onUpdate(e.id, c, d)
              setEditing(null)
            }}
          />
        ) : (
          <div key={e.id} className="row entry">
            <span className="grow">{e.description || <span className="muted">без описания</span>}</span>
            <span>{money(e.amount_cents)}</span>
            <button className="link" onClick={() => setEditing(e)}>изм.</button>
            <button className="link danger" onClick={() => onDelete(e.id)}>удал.</button>
          </div>
        ),
      )}
      {!editing && <EntryForm onSave={(c, d) => onAdd(date, c, d)} />}
    </>
  )
}

function EntryForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: BudgetEntry
  onSave: (cents: number, description: string | null) => Promise<void>
  onCancel?: () => void
}) {
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amount_cents) : '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const cents = parseMoney(amount)
    if (!cents) return setError('Неверная сумма')
    setError('')
    await onSave(cents, description.trim() || null)
    if (!initial) {
      setAmount('')
      setDescription('')
    }
  }
  return (
    <form className="row entry-form" onSubmit={submit}>
      <input placeholder="На что" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      <input className="amount" placeholder="Сумма" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button>{initial ? 'OK' : 'Добавить'}</button>
      {onCancel && <button type="button" className="secondary" onClick={onCancel}>×</button>}
      {error && <span className="error">{error}</span>}
    </form>
  )
}
