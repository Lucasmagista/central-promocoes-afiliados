import { useOutletContext } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { DashboardSummary } from '../lib/types';
import { ago, connectorModeLabel } from '../lib/format';
import { Badge, Card, ErrorBox, Loading, PageHead, type useLoad } from '../ui/ui';

export default function Health() {
  const { dash } = useOutletContext<{ dash: ReturnType<typeof useLoad<DashboardSummary>> }>();
  const d = dash.data;
  if (dash.loading && !d) return <Loading />;
  if (dash.error || !d) return <ErrorBox error={dash.error ?? 'Sem dados'} retry={dash.reloadLoud} />;
  const hbIcon = (s: string) => s === 'ok' ? <CheckCircle2 size={18} color="var(--ok)" /> : s === 'degraded' ? <AlertTriangle size={18} color="var(--warn)" /> : <XCircle size={18} color="var(--bad)" />;
  const checks = [
    { ok: !d.paused, label: 'Publicação ativa', detail: d.paused ? 'Pausada globalmente' : 'Fila liberada' },
    { ok: d.publications.unknown === 0, label: 'Sem envios unknown', detail: d.publications.unknown ? `${d.publications.unknown} aguardando reconciliação` : 'Nenhum' },
    { ok: d.publications.failed === 0, label: 'Sem falhas permanentes', detail: d.publications.failed ? `${d.publications.failed} falha(s)` : 'Nenhuma' },
    { ok: (d.oldest_review_minutes ?? 0) < 1440, label: 'Revisão em dia', detail: d.oldest_review_minutes == null ? 'Fila vazia' : `mais antiga: ${Math.round(d.oldest_review_minutes / 60)} h` },
    { ok: d.destinations.some((x) => x.enabled), label: 'Há destino ativo', detail: `${d.destinations.filter((x) => x.enabled).length} ativo(s)` },
  ];
  return (
    <>
      <PageHead title="Saúde do sistema" sub="Sinais de vida dos serviços e verificações automáticas. Atualiza a cada 15 s." />
      <div className="grid g2">
        <Card title="Serviços (heartbeat)" flush>{d.heartbeats.length ? <div className="tablewrap"><table><tbody>{d.heartbeats.map((h) => (
          <tr key={h.service}><td style={{ width: 30 }}>{hbIcon(h.status)}</td><td><b>{h.service}</b></td><td className="small muted">visto {ago(h.last_seen)}</td>
            <td><Badge tone={h.age_seconds > 300 ? 'bad' : h.status === 'ok' ? 'ok' : 'warn'}>{h.age_seconds > 300 ? 'sem sinal' : h.status}</Badge></td></tr>))}</tbody></table></div> :
          <div className="empty">Nenhum serviço reportou ainda. Os o worker envia o heartbeat a cada minuto (Fase 2).</div>}</Card>
        <Card title="Verificações">
          <div className="col" style={{ gap: 12 }}>{checks.map((c) => <div key={c.label} className="row">{c.ok ? <CheckCircle2 size={18} color="var(--ok)" /> : <AlertTriangle size={18} color="var(--warn)" />}<div><div style={{ fontWeight: 600 }}>{c.label}</div><div className="small muted">{c.detail}</div></div></div>)}</div></Card>
      </div>
      <div style={{ marginTop: 14 }}><Card title="Conectores" flush><div className="tablewrap"><table><thead><tr><th>Plataforma</th><th>Modo</th><th>Último sucesso</th><th>Último erro</th><th>Revisão de termos</th></tr></thead>
        <tbody>{d.connectors.map((c) => <tr key={c.platform}><td><b>{c.display_name}</b></td><td>{connectorModeLabel[c.mode]}</td><td className="small">{ago(c.last_success_at)}</td><td className="small">{ago(c.last_error_at)}</td>
          <td className="small">{c.review_due_at ? (new Date(c.review_due_at).getTime() < Date.now() ? <Badge tone="bad">vencida</Badge> : ago(c.review_due_at)) : '—'}</td></tr>)}</tbody></table></div></Card></div>
    </>);
}
