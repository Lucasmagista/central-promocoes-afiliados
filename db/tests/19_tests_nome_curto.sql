-- Nome curto na mensagem e contagem da legenda do Telegram (migração 018)
do $$
declare s text;
begin
  assert public.short_title('Fone curto', 70) = 'Fone curto', 'título curto não muda';

  s := public.short_title('Clipes de cabo organizador gota suporte de fio gerenciamento de cabo auto-adesivo gerenciador de cabo braçadeira fixa enrolador de fio para carro de escritório em casa', 70);
  assert length(s) <= 70, 'respeita o limite';
  assert s = 'Clipes de cabo organizador gota suporte de fio gerenciamento de cabo', 'corta em palavra inteira: ' || s;

  s := public.short_title('Cabo USB-C resistente para carregar celular e', 20);
  assert s !~ '\s(e|de|para|com)$', 'não termina em conectivo: ' || s;

  s := public.short_title('Pulseira de silicone para apple watch (compatível com séries 3 4 5 6 7 8 9 ultra) 38mm 40mm', 50);
  assert position('(' in s) = 0 or position(')' in s) > 0, 'não deixa parêntese aberto: ' || s;

  assert length(public.short_title(repeat('x', 300), 70)) <= 70, 'palavra gigante também é cortada';

  assert public.visible_length('<b>a &amp; b</b> <a href="https://exemplo.com/aaaaaaaaaaaaaaaaaaaaaaaa">Ver</a>') = 9, 'legenda conta só o texto visível';
end $$;
