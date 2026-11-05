import { allocationTotal, type Allocation } from './budget'
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
  created_by: number
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

export interface Budget {
  id: number
  month: string // первое число месяца, "YYYY-MM-01"
  amount_cents: number // сумма за месяц в обоих режимах
  currency: string
  mode: 'month' | 'halves'
  first_half_cents: number | null // 1–15, только в режиме halves
  second_half_cents: number | null // 16–конец
}

const BUDGET_COLUMNS = 'id, month, amount_cents, currency, mode, first_half_cents, second_half_cents'

export const budgetAllocation = (b: Budget): Allocation =>
  b.mode === 'halves' && b.first_half_cents !== null && b.second_half_cents !== null
    ? { first: b.first_half_cents, second: b.second_half_cents }
    : b.amount_cents
export interface BudgetEntry {
  id: number
  spent_on: string
  amount_cents: number
  description: string | null
}

const toRows =(parts: Part[]) => parts.map((p) => ({ user_id: p.userId, cents: p.cents }))

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

export const usernameToEmail = (username: string) => `${username.toLowerCase()}@example.com`

export const api = {
  myProfile: (authId: string) =>
    ok(supabase.from('profiles').select('id, username, display_name').eq('auth_id', authId).single()),

  groups: () => ok(supabase.from('groups').select('id, name, currency, created_by').order('id', { ascending: false })),
  group: (id: number) => ok(supabase.from('groups').select('id, name, currency, created_by').eq('id', id).single()),
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
  deleteGroup: (groupId: number) => ok(supabase.rpc('delete_group', { p_group_id: groupId })),

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

  // month: "YYYY-MM"; RLS отдаёт только бюджеты текущего пользователя
  budget: (month: string) =>
    ok(
      supabase.from('budgets').select(BUDGET_COLUMNS).eq('month', `${month}-01`).maybeSingle(),
    ) as Promise<Budget | null>,
  saveBudget: (ownerId: number, month: string, allocation: Allocation, currency: string) =>
    ok(
      supabase
        .from('budgets')
        .upsert(
          {
            owner: ownerId,
            month: `${month}-01`,
            amount_cents: allocationTotal(allocation),
            currency,
            mode: typeof allocation === 'number' ? 'month' : 'halves',
            first_half_cents: typeof allocation === 'number' ? null : allocation.first,
            second_half_cents: typeof allocation === 'number' ? null : allocation.second,
          },
          { onConflict: 'owner,month' },
        )
        .select(BUDGET_COLUMNS)
        .single(),
    ) as Promise<Budget>,
  budgetEntries: (budgetId: number) =>
    ok(
      supabase
        .from('budget_entries')
        .select('id, spent_on, amount_cents, description')
        .eq('budget_id', budgetId)
        .order('spent_on')
        .order('id'),
    ) as Promise<BudgetEntry[]>,
  addBudgetEntry: (budgetId: number, e: Omit<BudgetEntry, 'id'>) =>
    ok(supabase.from('budget_entries').insert({ budget_id: budgetId, ...e })),
  updateBudgetEntry: (id: number, e: Pick<BudgetEntry, 'amount_cents' | 'description'>) =>
    ok(supabase.from('budget_entries').update(e).eq('id', id)),
  deleteBudgetEntry: (id: number) => ok(supabase.from('budget_entries').delete().eq('id', id)),
}
