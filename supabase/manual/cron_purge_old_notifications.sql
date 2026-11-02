-- Tarea programada (pg_cron). Se creó a mano en Supabase, no por migración.
-- Corre todos los días a las 04:17 UTC.
-- OJO: borra TODAS las notificaciones de más de 30 días, incluidas las importantes.
-- Pendiente: decidir si excluir las importantes (important = true).
select cron.schedule(
  'purge-old-notifications',
  '17 4 * * *',
  $$delete from public.notifications where created_at < now() - interval '30 days'$$
);
