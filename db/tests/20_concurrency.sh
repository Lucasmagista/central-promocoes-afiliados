#!/usr/bin/env bash
# Teste de concorrência real: 12 workers disputando a fila de UM destino com limite de 3 por hora.
set -euo pipefail
DB="${1:-promo_test}"
P="psql -v ON_ERROR_STOP=1 -q -t -A -d $DB"
$P <<'SQL'
update public.destinations set max_per_hour = 3, max_per_day = 50, min_interval_s = 0, quiet_start = null, quiet_end = null
 where channel = 'telegram';
update public.publications set status = 'cancelled' where status in ('pending', 'retry_scheduled', 'claimed');
do $$
declare v_dest uuid; v_offer uuid; i int; v_prod uuid;
begin
  select id into v_dest from public.destinations where channel = 'telegram' order by created_at limit 1;
  for i in 1..10 loop
    insert into public.products (platform, canonical_url, title) values ('shopee', 'https://shopee.com.br/conc-' || i, 'Conc ' || i) returning id into v_prod;
    insert into public.offers (product_id, status, original_url, affiliate_url, current_price, price_observed_at, is_simulated)
      values (v_prod, 'scheduled', 'https://shopee.com.br/conc-' || i, 'https://shopee.com.br/aff/' || i, 10, now(), false) returning id into v_offer;
    insert into public.publications (offer_id, destination_id, rendered_text, idempotency_key)
      values (v_offer, v_dest, 'texto ' || i, v_offer || ':' || v_dest || ':1');
  end loop;
end $$;
SQL
for w in $(seq 1 12); do
  ( $P -c "select public.claim_next_publication('w$w') is not null" > /tmp/claim_$w.txt ) &
done
wait
got=$(cat /tmp/claim_*.txt | grep -c '^t$' || true)
claimed=$($P -c "select count(*) from public.publications where status = 'claimed' and destination_id = (select id from public.destinations where channel='telegram' order by created_at limit 1)")
dups=$($P -c "select count(*) from (select offer_id from public.publications group by offer_id, destination_id having count(*) > 1) x")
rm -f /tmp/claim_*.txt
echo "workers que receberam envio: $got | reservadas no banco: $claimed | duplicadas: $dups"
[ "$claimed" -le 3 ] || { echo "FALHA: limite por hora estourado sob concorrência"; exit 1; }
[ "$claimed" -eq "$got" ] || { echo "FALHA: inconsistência entre workers e banco"; exit 1; }
[ "$dups" -eq 0 ] || { echo "FALHA: duplicatas"; exit 1; }
echo "ok 16: concorrência respeita o limite sem duplicar"
