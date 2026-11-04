import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register' && !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      return setError('Логин: 3–32 символа, латиница, цифры и _')
    }
    if (mode === 'register' && password.length < 6) return setError('Пароль минимум 6 символов')
    setBusy(true)
    try {
      await (mode === 'login' ? signIn(username.trim(), password) : signUp(username.trim(), password))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="card narrow">
      <h1>Splitter</h1>
      <p className="muted">Делите траты с друзьями</p>
      <form onSubmit={submit}>
        <label>
          Логин
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
        {mode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}
      </button>
    </main>
  )
}
