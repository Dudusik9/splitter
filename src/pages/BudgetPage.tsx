import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { api, budgetAllocation, type Budget, type BudgetEntry } from '../lib/api'
import {
  budgetDays,
  daysInMonth,
  HALF_LAST_DAY,
  halfOf,
  localISODate,
  monthStats,
  periodStats,
  shiftMonth,
  splitHalves,
  type Allocation,
  type DayRow,
  type MonthStats,
} from '../lib/budget'
import { formatMoney, parseMoney } from '../lib/money'

type Mode = Budget['mode']

const monthTitle = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
/** "1–15 ноября" / "16–30 ноября" */
const halfTitle = (month: string, half: 1 | 2) => {
  const [y, m] = month.split('-').map(Number)
  const genitive = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(/^\d+\s*/, '')
  return half === 1 ? `1–${HALF_LAST_DAY} ${genitive}` : `${HALF_LAST_DAY + 1}–${daysInMonth(month)} ${genitive}`
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
  // режим, в котором открыта форма бюджета (null — форма закрыта)
  const [editMode, setEditMode] = useState<Mode | null>(null)
  // режим прошлого месяца — по умолчанию для месяца без бюджета
  const [prevMode, setPrevMode] = useState<Mode>('month')
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const b = await api.budget(month)
      setEntries(b ? await api.budgetEntries(b.id) : [])
      if (!b) setPrevMode((await api.budget(shiftMonth(month, -1)))?.mode ?? 'month')
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

  const rows = budget ? budgetDays(budgetAllocation(budget), month, entries) : []

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

  const activeMode: Mode = editMode ?? budget?.mode ?? prevMode
  const modeTabs = (
    <div className="tabs">
      {(['month', 'halves'] as const).map((m) => (
        <button
          key={m}
          className={activeMode === m ? 'active' : ''}
          onClick={() => setEditMode(budget && budget.mode === m ? null : m)}
        >
          {m === 'month' ? 'Месяц' : 'Две недели'}
        </button>
      ))}
    </div>
  )

  if (budget === null || editMode !== null) {
    return (
      <>
        {nav}
        {modeTabs}
        <BudgetForm
          key={activeMode}
          mode={activeMode}
          month={month}
          initial={budget}
          onCancel={budget ? () => setEditMode(null) : undefined}
          onSave={(allocation, currency) =>
            run(async () => {
              await api.saveBudget(me.id, month, allocation, currency)
              setEditMode(null)
            })
          }
        />
        {error && <p className="error">{error}</p>}
      </>
    )
  }

  const stats = monthStats(budget.amount_cents, rows, today)
  const allocation = budgetAllocation(budget)
  const thisMonth = today.slice(0, 7) === month
  const halves =
    typeof allocation === 'number'
      ? null
      : ([1, 2] as const).map((half) => ({
          half,
          stats: periodStats(
            half === 1 ? allocation.first : allocation.second,
            half === 1 ? 0 : rows[HALF_LAST_DAY - 1].left,
            rows.filter((r) => halfOf(r.date) === half),
            today,
          ),
        }))
  const todayRow = rows.find((r) => r.date === today)
  const onAdd = (date: string, cents: number, description: string | null) =>
    run(() => api.addBudgetEntry(budget.id, { spent_on: date, amount_cents: cents, description }))
  const onUpdate = (id: number, cents: number, description: string | null) =>
    run(() => api.updateBudgetEntry(id, { amount_cents: cents, description }))
  const onDelete = (id: number) => confirm('Удалить трату?') && run(() => api.deleteBudgetEntry(id))

  return (
    <>
      {nav}
      {modeTabs}
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

      {halves?.map(({ half, stats: hs }) => (
        <details key={half} className="card panel" open={thisMonth && halfOf(today) === half}>
          <summary>
            <span className="grow">{halfTitle(month, half)}</span>
            <span className="muted">{money(hs.remaining)} из {money(hs.budget + hs.carryIn)}</span>
          </summary>
          <StatsList stats={hs} money={money} remainingLabel="Осталось на период" />
        </details>
      ))}

      <details className="card panel" open={!todayRow}>
        <summary>
          <span className="grow">Бюджет на месяц</span>
          <span className="muted">{money(stats.remaining)} из {money(stats.budget)}</span>
        </summary>
        <StatsList stats={stats} money={money} remainingLabel="Осталось на месяц" />
        <button className="link" onClick={() => setEditMode(budget.mode)}>Изменить бюджет</button>
      </details>

      <details className="card panel">
        <summary>
          <span className="grow">Статистика по дням</span>
        </summary>
        <ul className="list days">
          {rows.map((r, i) => (
            <Fragment key={r.date}>
              {halves && (i === 0 || i === HALF_LAST_DAY) && (
                <li className="half-sep">{halfTitle(month, i === 0 ? 1 : 2)}</li>
              )}
              <DayItem
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
            </Fragment>
          ))}
        </ul>
      </details>
    </>
  )
}

function StatsList({ stats, money, remainingLabel }: { stats: MonthStats; money: (c: number) => string; remainingLabel: string }) {
  return (
    <ul className="list">
      <li><span className="grow">Бюджет</span>{money(stats.budget)}</li>
      {stats.carryIn !== 0 && (
        <li>
          <span className="grow">{stats.carryIn > 0 ? 'Остаток с 1-й половины' : 'Перерасход 1-й половины'}</span>
          <span className={sign(stats.carryIn)}>{money(stats.carryIn)}</span>
        </li>
      )}
      <li><span className="grow">Лимит в день</span>{money(stats.baseDaily)}</li>
      <li><span className="grow">Потрачено</span>{money(stats.spent)}</li>
      <li><span className="grow">{remainingLabel}</span><span className={sign(stats.remaining)}>{money(stats.remaining)}</span></li>
      {stats.perDayLeft !== null && (
        <li>
          <span className="grow">В среднем на оставшиеся {stats.daysLeft} дн.</span>
          <span className={sign(stats.perDayLeft)}>{money(stats.perDayLeft)}</span>
        </li>
      )}
    </ul>
  )
}

function BudgetForm({
  mode,
  month,
  initial,
  onSave,
  onCancel,
}: {
  mode: Mode
  month: string
  initial: Budget | null
  onSave: (allocation: Allocation, currency: string) => Promise<void>
  onCancel?: () => void
}) {
  // при смене режима сумма месяца делится на половины пропорционально дням (и наоборот — складывается)
  const prefill = initial
    ? initial.mode === 'halves' && initial.first_half_cents !== null && initial.second_half_cents !== null
      ? { first: initial.first_half_cents, second: initial.second_half_cents }
      : splitHalves(initial.amount_cents, month)
    : null
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amount_cents) : '')
  const [first, setFirst] = useState(prefill ? centsToInput(prefill.first) : '')
  const [second, setSecond] = useState(prefill ? centsToInput(prefill.second) : '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'RUB')
  const [error, setError] = useState('')
  const firstCents = parseMoney(first)
  const secondCents = parseMoney(second)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'halves') {
      if (!firstCents || !secondCents) return setError('Введите обе суммы больше нуля')
      setError('')
      return onSave({ first: firstCents, second: secondCents }, currency)
    }
    const cents = parseMoney(amount)
    if (!cents) return setError('Введите сумму больше нуля')
    setError('')
    await onSave(cents, currency)
  }
  const currencySelect = (
    <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="amount">
      <option>RUB</option>
      <option>USD</option>
      <option>EUR</option>
    </select>
  )
  if (mode === 'halves') {
    return (
      <form className="card" onSubmit={submit}>
        <h3>Бюджет по двум неделям</h3>
        <p className="muted">
          У каждой половины месяца свой бюджет, он делится поровну на её дни. Остаток или перерасход переносится на следующий
          день, в том числе из первой половины во вторую.
        </p>
        <label>
          {halfTitle(month, 1)}
          <input placeholder="Сумма" inputMode="decimal" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
        </label>
        <label>
          {halfTitle(month, 2)}
          <input placeholder="Сумма" inputMode="decimal" value={second} onChange={(e) => setSecond(e.target.value)} />
        </label>
        <div className="row">
          <span className="grow muted">
            {firstCents && secondCents ? `За месяц: ${formatMoney(firstCents + secondCents, currency)}` : ''}
          </span>
          {currencySelect}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row actions">
          <button>Сохранить</button>
          {onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}
        </div>
      </form>
    )
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3>Бюджет на месяц</h3>
      <p className="muted">Сумма делится поровну на все дни месяца; остаток или перерасход дня переносится на следующий.</p>
      <div className="row">
        <input placeholder="Сумма" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        {currencySelect}
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
