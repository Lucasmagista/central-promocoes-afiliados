import { useState } from 'react';
import { api } from '../lib/api';
import { int, money, channelName, platformName } from '../lib/format';
import { Badge, Card, ErrorBox, Loading, PageHead, Seg, useLoad } from '../ui/ui';
import { Funnel, HBars, LineChart } from '../ui/charts';
import { PlatformTag } from '../ui/badges';
import { CommissionsCard } from '../components/CommissionsCard';

export default function Analytics() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(14);
  const q = useLoad(() => api().analytics(days), [days], 60000);
  const a = q.data;
  const totalClicks = a?.series.reduce((x, y) => x + y.clicks, 0) ?? 0;
  const totalSent = a?.series.reduce((x, y) => x + y.sent, 0) ?? 0;
  return (
    <>
      <PageHead title="Analytics" sub="Cliques vêm do redirecionador próprio. A comissão da Shopee é sincronizada sozinha; nas outras lojas ela fica nos painéis oficiais.">
        <Seg value={String(days) as '7' | '14' | '30' | '90'} onChange={(v) => setDays(+v as 7 | 14 | 30 | 90)} options={[{ v: '7', label: '7 d' }, { v: '14', label: '14 d' }, { v: '30', label: '30 d' }, { v: '90', label: '90 d' }]} /></PageHead>
      {q.loading && !a ? <Loading /> : q.error || !a ? <ErrorBox error={q.error ?? 'Sem dados'} retry={q.reloadLoud} /> : <>
        <div className="grid g4" style={{ marginBottom: 14 }}>
          {[['Envios', int(totalSent)], ['Cliques', int(totalClicks)], ['Cliques por envio', totalSent ? (totalClicks / totalSent).toFixed(1).replace('.', ',') : '—'], ['Ofertas publicadas', int(a.funnel.published)]].map(([k, v]) => <div key={k} className="card stat"><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
        <div className="grid g2">
          <Card title={`Envios por dia — ${days} dias`} actions={<Badge tone="ok">{int(totalSent)} no período</Badge>}><LineChart height={190} days={a.series.map((s) => s.day)} series={[{ name: 'Envios', color: 'var(--ok)', values: a.series.map((s) => s.sent) }]} /></Card>
          <Card title={`Cliques por dia — ${days} dias`} actions={<Badge tone="info">{int(totalClicks)} no período</Badge>}><LineChart height={190} days={a.series.map((s) => s.day)} series={[{ name: 'Cliques', color: 'var(--accent)', values: a.series.map((s) => s.clicks) }]} /></Card></div>
        <div style={{ marginTop: 14 }}><CommissionsCard days={days} /></div>
        <div className="grid g3" style={{ marginTop: 14 }}>
          <Card title="Funil"><Funnel steps={[{ label: 'Ofertas recebidas', value: a.funnel.ingested }, { label: 'Aprovadas', value: a.funnel.approved }, { label: 'Publicadas', value: a.funnel.published }, { label: 'Com clique', value: a.funnel.clicked }]} /></Card>
          <Card title="Cliques por canal"><HBars rows={a.by_channel.map((c) => ({ label: channelName[c.channel] ?? c.channel, value: c.clicks }))} /></Card>
          <Card title="Cliques por plataforma"><HBars color="var(--ok)" rows={a.by_platform.map((c) => ({ label: platformName[c.platform] ?? c.platform, value: c.clicks }))} /></Card>
        </div>
        <div className="grid g2" style={{ marginTop: 14 }}>
          <Card title="Categorias que mais geram clique"><HBars color="#d97706" rows={a.by_category.slice(0, 8).map((c) => ({ label: c.category, value: c.clicks }))} /></Card>
          <Card title="Ofertas mais clicadas" flush>{a.top_offers.length ? <div className="tablewrap"><table><tbody>{a.top_offers.map((o, i) => (
            <tr key={o.offer_id}><td className="muted">{i + 1}</td><td style={{ maxWidth: 260 }}><div className="truncate" style={{ fontWeight: 600 }}>{o.title}</div><PlatformTag p={o.platform} /></td><td className="nowrap">{money(o.current_price)}</td><td><b>{int(o.clicks)}</b></td></tr>))}</tbody></table></div> : <div className="empty">Sem cliques no período.</div>}</Card>
        </div></>}
    </>);
}
