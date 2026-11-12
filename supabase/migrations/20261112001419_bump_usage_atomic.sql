create or replace function public.bump_usage(p_user uuid, p_month date, p_conv int, p_msgs int, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = public as $f$
  insert into public.usage_monthly (user_id, month, conversations, messages, tokens_in, tokens_out)
  values (p_user, p_month, greatest(p_conv,0), greatest(p_msgs,0), greatest(p_in,0), greatest(p_out,0))
  on conflict (user_id, month) do update set
    conversations = public.usage_monthly.conversations + excluded.conversations,
    messages      = public.usage_monthly.messages      + excluded.messages,
    tokens_in     = public.usage_monthly.tokens_in     + excluded.tokens_in,
    tokens_out    = public.usage_monthly.tokens_out    + excluded.tokens_out;
$f$;
revoke all on function public.bump_usage(uuid, date, int, int, bigint, bigint) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, date, int, int, bigint, bigint) to service_role;
