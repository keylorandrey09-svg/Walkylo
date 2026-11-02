-- Guardar el largo de la contraseña para reflejar los puntos en Configuración.
-- (Se setea al registrarse y al cambiarla; nunca se guarda la contraseña en sí.)
alter table public.profiles add column if not exists password_length int;
