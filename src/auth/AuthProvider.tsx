import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, usernameToEmail, type Profile } from '../lib/api'
import { supabase } from '../lib/supabase'

interface AuthState {
  loading: boolean
  me: Profile | null
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider missing')
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Profile | null>(null)

  useEffect(() => {
    const load = async (authId: string | undefined) => {
      setMe(authId ? await api.myProfile(authId).catch(() => null) : null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // вне колбэка, иначе supabase-js может дедлокнуться на своих же запросах
      setTimeout(() => load(session?.user.id), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signIn = async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Неверный логин или пароль' : error.message)
  }

  const signUp = async (username: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
      options: { data: { username } },
    })
    if (error) {
      throw new Error(/already|registered|duplicate|database error/i.test(error.message) ? 'Такой логин уже занят' : error.message)
    }
    if (!data.session) throw new Error('Регистрация прошла, но вход не выполнен: отключите Confirm email в Supabase')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return <Ctx.Provider value={{ loading, me, signIn, signUp, signOut }}>{children}</Ctx.Provider>
}
