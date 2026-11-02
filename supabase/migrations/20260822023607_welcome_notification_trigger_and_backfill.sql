-- Al registrarse: crear profile + notificación de bienvenida
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.notifications (user_id, tag, title, body)
  values (new.id, 'NOVEDAD', 'Bienvenido a WalkyUp',
    'Este es tu centro de notificaciones. Acá te vamos a avisar de novedades, nuevas funciones y actualizaciones importantes. ¡Gracias por ser de los primeros!');
  return new;
end;
$$;

-- Backfill: darles la bienvenida a los usuarios que ya existían
insert into public.notifications (user_id, tag, title, body)
select p.id, 'NOVEDAD', 'Bienvenido a WalkyUp',
  'Este es tu centro de notificaciones. Acá te vamos a avisar de novedades, nuevas funciones y actualizaciones importantes. ¡Gracias por ser de los primeros!'
from public.profiles p
where not exists (select 1 from public.notifications n where n.user_id = p.id);
