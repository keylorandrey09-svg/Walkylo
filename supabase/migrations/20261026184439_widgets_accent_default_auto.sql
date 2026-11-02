alter table public.widgets
  alter column accent set default 'auto';

alter table public.widgets
  add constraint widgets_accent_check
  check (accent = 'auto' or accent ~ '^#[0-9A-Fa-f]{6}$');
