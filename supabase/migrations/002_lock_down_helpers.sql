-- Хелперы RLS и триггер не должны вызываться анонимно через /rest/v1/rpc
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_group_member(bigint) from public, anon;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_group_member(bigint) to authenticated;
