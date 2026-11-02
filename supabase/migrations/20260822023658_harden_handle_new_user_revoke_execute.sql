-- La función solo debe correr como trigger, no llamarse por API
revoke execute on function public.handle_new_user() from anon, authenticated, public;
