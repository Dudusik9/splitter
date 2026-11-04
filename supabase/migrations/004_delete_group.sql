-- Удалить группу может только создатель; траты, расчёты и участники удаляются каскадом
create function public.delete_group(p_group_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from groups where id = p_group_id and created_by = public.current_profile_id();
  if not found then raise exception 'only the group creator can delete it'; end if;
end $$;

revoke all on function public.delete_group from public, anon;
grant execute on function public.delete_group to authenticated;
