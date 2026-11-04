import { supabase } from './supabase'
import type { Part } from './split'

export interface Profile {
  id: number
  username: string
  display_name: string | null
}
export interface Group {
  id: number
  name: string
  currency: string
}
export interface Expense {
  id: number
  description: string
  amount_cents: number
  split_type: 'equal' | 'exact'
  spent_at: string
  created_by: number
  created_at: string
  expense_payers: { user_id: number; amount_cents: number }[]
  expense_shares: { user_id: number; amount_cents: number }[]
}
export interface Settlement {
  id: number
  from_user: number
  to_user: number
  amount_cents: number
  created_at: string
}

const toRows = (parts: Part[]) => parts.map((p) => ({ user_id: p.userId, cents: p.cents }))

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

export const usernameToEmail = (username: string) => `${username.toLowerCase()}@example.com`

export const api = {
  myProfile: (authId: string) =>
    ok(supabase.from('profiles').select('id, username, display_name').eq('auth_id', authId).single()),

  groups: () => ok(supabase.from('groups').select('id, name, currency').order('id', { ascending: false })),
  group: (id: number) => ok(supabase.from('groups').select('id, name, currency').eq('id', id).single()),
  createGroup: (name: string, currency: string) =>
    ok(supabase.rpc('create_group', { p_name: name, p_currency: currency })) as Promise<number>,

  members: async (groupId: number): Promise<Profile[]> => {
    const rows = await ok(
      supabase
        .from('group_members')
        .select('profiles(id, username, display_name)')
        .eq('group_id', groupId),
    )
    return (rows as unknown as { profiles: Profile }[]).map((r) => r.profiles)
  },
  addMember: (groupId: number, identifier: string) =>
    ok(supabase.rpc('add_group_member', { p_group_id: groupId, p_identifier: identifier })),
  leaveGroup: (groupId: number) => ok(supabase.rpc('leave_group', { p_group_id: groupId })),

  expenses: async (groupId: number): Promise<Expense[]> =>
    (await ok(
      supabase
        .from('expenses')
        .select('*, expense_payers(user_id, amount_cents), expense_shares(user_id, amount_cents)')
        .eq('group_id', groupId)
        .order('spent_at', { ascending: false })
        .order('id', { ascending: false }),
    )) as unknown as Expense[],
  saveExpense: (
    groupId: number,
    editId: number | null,
    e: { description: string; amount: number; splitType: 'equal' | 'exact'; date: string; payers: Part[]; shares: Part[] },
  ) =>
    editId === null
      ? ok(
          supabase.rpc('create_expense', {
            p_group_id: groupId,
            p_description: e.description,
            p_amount_cents: e.amount,
            p_split_type: e.splitType,
            p_spent_at: e.date,
            p_payers: toRows(e.payers),
            p_shares: toRows(e.shares),
          }),
        )
      : ok(
          supabase.rpc('update_expense', {
            p_expense_id: editId,
            p_description: e.description,
            p_amount_cents: e.amount,
            p_split_type: e.splitType,
            p_spent_at: e.date,
            p_payers: toRows(e.payers),
            p_shares: toRows(e.shares),
          }),
        ),
  deleteExpense: (id: number) => ok(supabase.rpc('delete_expense', { p_expense_id: id })),

  settlements: async (groupId: number): Promise<Settlement[]> =>
    (await ok(
      supabase
        .from('settlements')
        .select('id, from_user, to_user, amount_cents, created_at')
        .eq('group_id', groupId)
        .order('id', { ascending: false }),
    )) as Settlement[],
  createSettlement: (groupId: number, from: number, to: number, cents: number) =>
    ok(supabase.rpc('create_settlement', { p_group_id: groupId, p_from_user: from, p_to_user: to, p_amount_cents: cents })),
  deleteSettlement: (id: number) => ok(supabase.rpc('delete_settlement', { p_settlement_id: id })),

  balances: async (groupId: number): Promise<Map<number, number>> => {
    const rows = (await ok(supabase.rpc('group_balances', { p_group_id: groupId }))) as {
      user_id: number
      net_cents: number
    }[]
    return new Map(rows.map((r) => [r.user_id, Number(r.net_cents)]))
  },
}
