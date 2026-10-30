import { Link, useOutletContext } from 'react-router-dom';
import { MessageCircle, Send as SendIcon, AlertTriangle, Info, OctagonAlert, ArrowUpRight, ArrowDownRight, ListChecks, Send, MousePointerClick, Percent } from 'lucide-react';
import type { DashboardSummary } from '../lib/types';
import { api } from '../lib/api';
import { int, minutesLabel, pct, ago, channelName } from '../lib/format';
import { Badge, Card, ErrorBox, Loading, PageHead, useLoad } from '../ui/ui';
import { ConnectorMode } from '../ui/badges';
import { LineChart } from '../ui/charts';
import { GoLive } from '../components/GoLive';

const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
function Stat({ k, v, sub, icon, trend, to }: { k: string; v: string; sub?: string; icon: React.ReactNode; trend?: number | null; to?: string }) {
  const body = <div className="card stat"><div className="row muted small" style={{ fontWeight: 600 }}>{icon}{k}</div><div className="v">{v}</div>
    <div className="d">{trend != null ? <span className={trend >= 0 ? 'up' : 'down'}>{trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(trend)}% vs. 24 h anteriores</span> : <span className="muted">{sub}</span>}</div></div>;
  return to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : body;
}

export default function Dashboard() {
  const { dash } = useOutletContext<{ dash: ReturnType<typeof useLoad<DashboardSummary>> }>();
  const an = useLoad(() => api().analytics(14), [], 30000);
  const wa = useLoad(() => api().channelOverview('whatsapp'), [], 15000);
  const tg = useLoad(() => api().channelOverview('telegram'), [], 15000);
  const d = dash.data;
  if (dash.loading && !d) return <Loading />;
  if (dash.error || !d) return <ErrorBox error={dash.error ?? 'Sem dados'} retry={dash.reloadLoud} />;
  const icon = { critical: <OctagonAlert size={17} />, warning: <AlertTriangle size={17} />, info: <Info size={17} /> };
  return (
    <>
      <PageHead title="Visão geral" sub="O que precisa de atenção agora e como a operação está indo." />
      <GoLive />
      {d.alerts.length > 0 && <div className="col" style={{ marginBottom: 16, gap: 8 }}>{d.alerts.map((a) => <div key={a.code + a.message} className={`alert ${a.level}`} role={a.level === 'critical' ? 'alert' : undefined}>{icon[a.level]}<span>{a.message}</span></div>)}</div>}
      <div className="grid g4">
        <Stat k="Aguardando revisão" v={int(d.offers.needs_review)} icon={<ListChecks size={15} />} sub={d.oldest_review_minutes != null ? `mais antiga há ${minutesLabel(d.oldest_review_minutes)}` : 'fila vazia'} to="/revisao" />
        <Stat k="Enviadas (24 h)" v={int(d.publications.sent_24h)} icon={<Send size={15} />} trend={delta(d.publications.sent_24h, d.publications.sent_prev_24h)} sub="sem base de comparação" />
        <Stat k="Cliques (24 h)" v={int(d.clicks.last_24h)} icon={<MousePointerClick size={15} />} trend={delta(d.clicks.last_24h, d.clicks.prev_24h)} sub="sem base de comparação" />
        <Stat k="Taxa de aprovação (7 d)" v={pct(d.approval_rate_7d, 1)} icon={<Percent size={15} />} sub={`${d.offers.rejected_24h} rejeitada(s) em 24 h`} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        {([['whatsapp', 'WhatsApp', wa.data, <MessageCircle key="w" size={16} />], ['telegram', 'Telegram', tg.data, <SendIcon key="t" size={16} />]] as const).map(([ch, label, o, ic]) => (
          <Link key={ch} to={`/${ch}`} style={{ color: 'inherit', textDecoration: 'none' }}><div className="card stat">
            <div className="row" style={{ fontWeight: 650 }}>{ic}{label}<span className="right small muted">abrir conversas</span></div>
            <div className="row" style={{ gap: 26, marginTop: 10 }}>
              <div><div className="small muted">Grupos e canais</div><div className="v" style={{ fontSize: 24 }}>{o ? int(o.groups) : '—'}</div></div>
              <div><div className="small muted">Mensagens (24 h)</div><div className="v" style={{ fontSize: 24 }}>{o ? int(o.messages_in_24h + o.messages_out_24h) : '—'}</div></div>
              <div><div className="small muted">Não lidas</div><div className="v" style={{ fontSize: 24 }}>{o ? int(o.unread) : '—'}</div></div>
            </div></div></Link>))}
      </div>
      <div className="grid split" style={{ marginTop: 14 }}>
        <Card title="Cliques e envios — 14 dias">{an.data ? <div className="col" style={{ gap: 6 }}>
          <div className="row small"><span className="legend" style={{ background: 'var(--accent)' }} />Cliques por dia</div>
          <LineChart height={150} days={an.data.series.map((s) => s.day)} series={[{ name: 'Cliques', color: 'var(--accent)', values: an.data.series.map((s) => s.clicks) }]} />
          <div className="row small"><span className="legend" style={{ background: 'var(--ok)' }} />Envios por dia</div>
          <LineChart height={150} days={an.data.series.map((s) => s.day)} series={[{ name: 'Envios', color: 'var(--ok)', values: an.data.series.map((s) => s.sent) }]} /></div> : <Loading />}</Card>
        <Card title="Fila agora">
          <div className="col" style={{ gap: 10 }}>
            {[['Na fila / nova tentativa', d.publications.pending, undefined], ['Agendadas (ofertas)', d.offers.scheduled, undefined], ['Unknown a reconciliar', d.publications.unknown, d.publications.unknown ? 'bad' : undefined], ['Falhas permanentes', d.publications.failed, d.publications.failed ? 'warn' : undefined]].map(([l, v, t]) => (
              <div key={l as string} className="row"><span>{l}</span><span className="right"><Badge tone={t as 'bad' | 'warn' | undefined}>{v as number}</Badge></span></div>))}
            <Link to="/publicacoes" className="small">Abrir publicações →</Link>
          </div>
        </Card>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Destinos (24 h)" flush>
          {d.destinations.length === 0 ? <div className="empty">Nenhum destino cadastrado.</div> : <div className="tablewrap"><table><tbody>{d.destinations.map((x) => (
            <tr key={x.id}><td><b>{x.name}</b><div className="small muted">{channelName[x.channel]}</div></td><td>{x.enabled ? <Badge tone="ok">Ativo</Badge> : <Badge>Desabilitado</Badge>}</td>
              <td style={{ width: 160 }}><div className="small muted">{x.sent_24h} / {x.max_per_day} hoje</div><div className="bar"><i style={{ width: `${Math.min(100, (x.sent_24h / Math.max(1, x.max_per_day)) * 100)}%` }} /></div></td></tr>))}</tbody></table></div>}
        </Card>
        <Card title="Conectores" flush>
          <div className="tablewrap"><table><tbody>{d.connectors.map((c) => (
            <tr key={c.platform}><td><b>{c.display_name}</b></td><td><ConnectorMode s={c.mode} /></td>
              <td className="small muted">{c.review_due_at ? `revisar ${ago(c.review_due_at)}` : '—'}</td></tr>))}</tbody></table></div>
        </Card>
      </div>
    </>
  );
}
