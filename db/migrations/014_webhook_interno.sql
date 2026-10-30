-- ============================================================================
-- 014 — Webhook da Evolution pela rede interna do Docker
--
-- A Evolution roda no mesmo servidor e na mesma rede Docker (hubly-network) do worker.
-- Ela pode chamar http://promo-worker:8787/hook/whatsapp-… sem sair do servidor.
-- Aceito só nome de serviço Docker (sem ponto) + porta: nada de http para a internet.
-- O webhook do Telegram continua exigindo https público (quem chama é o Telegram).
-- ============================================================================
create or replace function public.valid_webhook_url(p text) returns boolean
language sql immutable as $$
  select public.valid_https_url(p) or p ~ '^http://[a-z0-9]([a-z0-9-]*[a-z0-9])?:[0-9]{2,5}(/[A-Za-z0-9._~%/-]*)?$'
$$;
revoke all on function public.valid_webhook_url(text) from public, anon;
grant execute on function public.valid_webhook_url(text) to authenticated, service_role;

do $$
declare d text; old constant text := $a$if s <> '' and not public.valid_https_url(s) then raise exception 'Endereço do webhook inválido (precisa ser https)'; end if;$a$;
  new constant text := $b$if s <> '' and not public.valid_webhook_url(s) then raise exception 'Endereço do webhook inválido: use https://… ou, na rede interna do servidor, http://nome-do-servico:porta/…'; end if;$b$;
  p integer;
begin
  d := pg_get_functiondef('public.save_integration(text,jsonb)'::regprocedure);
  p := position(old in d);   -- a 1ª ocorrência é a da Evolution; a do Telegram segue exigindo https
  if p = 0 then raise exception 'Migração 014: trecho esperado não encontrado em save_integration'; end if;
  execute substr(d, 1, p - 1) || new || substr(d, p + length(old));
end $$;
