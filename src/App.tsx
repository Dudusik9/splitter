import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { isConfigured } from './lib/supabase'
import { AuthPage } from './pages/AuthPage'
import { BudgetPage } from './pages/BudgetPage'
import { GroupPage } from './pages/GroupPage'
import { GroupsPage } from './pages/GroupsPage'
import './App.css'

function Shell() {
  const { loading, me, signOut } = useAuth()
  if (loading) return <p className="muted center">Загрузка…</p>
  if (!me) return <AuthPage />
  return (
    <div className="shell">
      <header>
        <strong>Splitter</strong>
        <nav className="row">
          <NavLink to="/" end>Группы</NavLink>
          <NavLink to="/budget">Бюджет</NavLink>
        </nav>
        <span className="muted">
          @{me.username} · мой ID: <b>{me.id}</b>
        </span>
        <button className="link" onClick={signOut}>Выйти</button>
      </header>
      <Routes>
        <Route path="/" element={<GroupsPage />} />
        <Route path="/group/:id" element={<GroupPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/budget/:month" element={<BudgetPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  if (!isConfigured) {
    return <p className="error center">Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. README).</p>
  }
  return (
    <HashRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </HashRouter>
  )
}
