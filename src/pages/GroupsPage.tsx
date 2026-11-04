import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Group } from '../lib/api'

export function GroupsPage() {
  const nav = useNavigate()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('RUB')
  const [error, setError] = useState('')

  useEffect(() => {
    api.groups().then(setGroups).catch((e) => setError(e.message))
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      nav(`/group/${await api.createGroup(name, currency)}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <section className="card">
        <h2>Мои группы</h2>
        {groups === null ? (
          <p className="muted">Загрузка…</p>
        ) : groups.length === 0 ? (
          <p className="muted">Пока нет групп — создайте первую ниже.</p>
        ) : (
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <Link to={`/group/${g.id}`}>{g.name}</Link>
                <span className="muted">{g.currency}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Новая группа</h2>
        <form onSubmit={create} className="row">
          <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option>RUB</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
          <button>Создать</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </>
  )
}
