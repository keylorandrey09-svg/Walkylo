create or replace function public.widgets_clear_ai_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.knowledge is distinct from old.knowledge
     and new.knowledge_ai_at is not distinct from old.knowledge_ai_at
  then
    new.knowledge_ai_at := null;
  end if;
  return new;
end $$;

create trigger widgets_clear_ai_stamp
before update of knowledge on public.widgets
for each row
execute function public.widgets_clear_ai_stamp();
