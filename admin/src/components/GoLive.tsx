import { Link } from 'react-router-dom';
import { Check, CircleDashed } from 'lucide-react';
import { api } from '../lib/api';
import type { StoreStatus } from '../lib/types';
import { Card, useLoad } from '../ui/ui';

/** Checklist “colocar no ar”: só aparece enquanto falta algo essencial. */
export function GoLive() {
  const conns = useLoad(() => api().listConnectors(), [], 30000); const dests = useLoad(() => api().listDestinations(), [], 30000);
  const settings = useLoad(() => api().getSettings(), [], 30000); const dash = useLoad(() => api().dashboard(), [], 30000);
  const srcs = useLoad(() => api().listPromoSources().catch(() => []), [], 60000);
  if (!conns.data || !dests.data || !settings.data || !dash.data) return null;
  const s = settings.data; const hb = dash.data.heartbeats.find((h) => h.service === 'worker');
  const connected = conns.data.some((c) => ['mercadolivre', 'shopee', 'amazon', 'aliexpress'].includes(c.platform) && (s[`int_status_${c.platform}`] as StoreStatus | undefined)?.connected === true && (s[`int_status_${c.platform}`] as StoreStatus | undefined)?.ok === true);
  const collecting = conns.data.some((c) => c.mode === 'api_ready');
  const destOk = dests.data.some((d) => d.enabled);
  const mode = String(s.mode ?? 'simulation');
  const items: { ok: boolean; req: boolean; label: string; to: string; hint: string }[] = [
    { ok: !!hb && hb.age_seconds < 150, req: true, label: 'Worker no ar', to: '/configuracoes?aba=worker', hint: 'Sem ele nada coleta nem envia.' },
    { ok: connected, req: true, label: 'Uma loja conectada e testada', to: '/conectores', hint: 'Conecte o Mercado Livre, Shopee, Amazon ou AliExpress.' },
    { ok: collecting, req: true, label: 'Coleta automática ligada', to: '/conectores', hint: 'Ligue no cartão da loja depois da amostra.' },
    { ok: destOk, req: true, label: 'Um destino testado e ativo', to: '/destinos', hint: 'Comece por um grupo de teste.' },
    { ok: mode !== 'simulation', req: true, label: 'Modo “revisão” (sai de simulação)', to: '/configuracoes', hint: 'Em simulação nada é enviado de verdade.' },
    { ok: !!String(s.shortlink_base ?? ''), req: false, label: 'Link curto configurado (cliques e rastreio por grupo)', to: '/configuracoes', hint: 'Use https://worker.hubly.software/r' },
    { ok: (srcs.data ?? []).some((x) => x.enabled), req: false, label: 'Radar de grupos com uma fonte', to: '/radar', hint: 'Opcional: captura promoções de outros grupos.' },
  ];
  const req = items.filter((i) => i.req); const done = req.filter((i) => i.ok).length;
  if (done === req.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Card title={`Colocar no ar — ${done} de ${req.length} passos essenciais`}>
        <div className="bar" style={{ marginBottom: 12 }}><i style={{ width: `${(done / req.length) * 100}%` }} /></div>
        <div className="col" style={{ gap: 8 }}>{items.map((i) => (
          <div key={i.label} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            {i.ok ? <Check size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} /> : <CircleDashed size={16} style={{ color: 'var(--muted)', flex: 'none', marginTop: 2 }} />}
            <div style={{ minWidth: 0 }}>{i.ok ? <span className="muted">{i.label}</span> : <><Link to={i.to} style={{ fontWeight: 650 }}>{i.label}</Link>{!i.req && <span className="small muted"> (opcional)</span>}<div className="small muted">{i.hint}</div></>}</div>
          </div>))}</div>
      </Card>
    </div>);
}
