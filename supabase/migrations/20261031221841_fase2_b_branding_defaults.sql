alter table public.widgets alter column theme set default 'light';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.notifications (user_id, tag, title, body)
  values (new.id, 'NOVEDAD', 'Bienvenido a Walkylet',
    'Este es tu centro de notificaciones. Acá te vamos a avisar de novedades, nuevas funciones y actualizaciones importantes. ¡Gracias por ser de los primeros!');
  return new;
end;
$$;
