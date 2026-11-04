import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { api, type Expense, type Group, type Profile, type Settlement } from '../lib/api'
import { simplifyDebts } from '../lib/balances'
import { formatMoney } from '../lib/money'
import { ExpenseForm } from './ExpenseForm'

type Tab = 'expenses' | 'balances' | 'members'

export function GroupPage() {
  const groupId = Number(useParams().id)
  const { me } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('expenses')
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [nets, setNets] = useState<Map<number, number>>(new Map())
  const [form, setForm] = useState<{ editing: Expense | null } | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const [g, m, e, s, n] = await Promise.all([
        api.group(groupId),
        api.members(groupId),
        api.expenses(groupId),
        api.settlements(groupId),
        api.balances(groupId),
      ])
      setGroup(g)
      setMembers(m)
      setExpenses(e)
      setSettlements(s)
      setNets(n)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [groupId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const who = (id: number) => {
    const m = byId.get(id)
    return m ? m.display_name || m.username : `#${id}`
  }
  const transfers = useMemo(() => simplifyDebts(nets), [nets])

  if (!group || !me) return error ? <p className="error">{error}</p> : <p className="muted">Загрузка…</p>
  const money = (c: number) => formatMoney(c, group.currency)

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const feed = [
    ...expenses.map((e) => ({ kind: 'expense' as const, key: `e${e.id}`, date: e.spent_at, e })),
    ...settlements.map((s) => ({ kind: 'settlement' as const, key: `s${s.id}`, date: s.created_at.slice(0, 10), s })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <p><Link to="/">← Все группы</Link></p>
      <h2>{group.name}</h2>
      <div className="tabs">
        {(['expenses', 'balances', 'members'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ expenses: 'Траты', balances: 'Балансы', members: 'Участники' }[t]}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'expenses' && (
        <>
          {form ? (
            <ExpenseForm
              groupId={groupId}
              currency={group.currency}
              members={members}
              meId={me.id}
              editing={form.editing}
              onCancel={() => setForm(null)}
              onDone={() => { setForm(null); void reload() }}
            />
          ) : (
            <button onClick={() => setForm({ editing: null })}>+ Добавить трату</button>
          )}
          <ul className="list">
            {feed.length === 0 && <li className="muted">Трат пока нет</li>}
            {feed.map((item) =>
              item.kind === 'expense' ? (
                <li key={item.key}>
                  <div className="grow">
                    <strong>{item.e.description}</strong>
                    <div className="muted">
                      {item.date} · платил(и): {item.e.expense_payers.map((p) => who(p.user_id)).join(', ')}
                    </div>
                  </div>
                  <div className="right">
                    {money(item.e.amount_cents)}
                    <div>
                      <button className="link" onClick={() => setForm({ editing: item.e })}>изм.</button>
                      <button
                        className="link danger"
                        onClick={() => confirm('Удалить трату?') && run(() => api.deleteExpense(item.e.id))}
                      >
                        удал.
                      </button>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={item.key} className="settle">
                  <div className="grow">
                    {who(item.s.from_user)} → {who(item.s.to_user)}
                    <div className="muted">{item.date} · расчёт</div>
                  </div>
                  <div className="right">
                    {money(item.s.amount_cents)}
                    <div>
                      <button
                        className="link danger"
                        onClick={() => confirm('Удалить расчёт?') && run(() => api.deleteSettlement(item.s.id))}
                      >
                        удал.
                      </button>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {tab === 'balances' && (
        <>
          <section className="card">
            <h3>Баланс участников</h3>
            <ul className="list">
              {members.map((m) => {
                const n = nets.get(m.id) ?? 0
                return (
                  <li key={m.id}>
                    <span className="grow">{who(m.id)}</span>
                    <span className={n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'}>
                      {n > 0 ? 'ему должны ' : n < 0 ? 'должен ' : 'в расчёте '}
                      {n !== 0 && money(Math.abs(n))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
          <section className="card">
            <h3>Кто кому должен</h3>
            {transfers.length === 0 ? (
              <p className="muted">Все в расчёте 🎉</p>
            ) : (
              <ul className="list">
                {transfers.map((t) => (
                  <li key={`${t.from}-${t.to}`}>
                    <span className="grow">{who(t.from)} → {who(t.to)}: <strong>{money(t.cents)}</strong></span>
                    <button
                      onClick={() =>
                        confirm(`${who(t.from)} отдал ${who(t.to)} ${money(t.cents)}?`) &&
                        run(() => api.createSettlement(groupId, t.from, t.to, t.cents))
                      }
                    >
                      Рассчитались
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === 'members' && (
        <>
          <section className="card">
            <h3>Участники</h3>
            <ul className="list">
              {members.map((m) => (
                <li key={m.id}>
                  <span className="grow">{m.display_name || m.username}</span>
                  <span className="muted">@{m.username} · ID {m.id}</span>
                </li>
              ))}
            </ul>
          </section>
          <AddMember onAdd={(ident) => run(() => api.addMember(groupId, ident))} />
          <button
            className="secondary"
            onClick={() =>
              confirm('Покинуть группу?') &&
              api.leaveGroup(groupId).then(() => nav('/')).catch((e) => setError(e.message))
            }
          >
            Покинуть группу
          </button>
          {group.created_by === me.id && (
            <button
              className="danger"
              onClick={() =>
                confirm(`Удалить группу «${group.name}» со всеми тратами и расчётами? Это нельзя отменить.`) &&
                api.deleteGroup(groupId).then(() => nav('/')).catch((e) => setError(e.message))
              }
            >
              Удалить группу
            </button>
          )}
        </>
      )}
    </>
  )
}

function AddMember({ onAdd }: { onAdd: (identifier: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await onAdd(value)
    setValue('')
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3>Добавить участника</h3>
      <div className="row">
        <input placeholder="логин или числовой ID" value={value} onChange={(e) => setValue(e.target.value)} required />
        <button>Добавить</button>
      </div>
    </form>
  )
}
