import { api } from '../lib/api';
import { int, money, platformName } from '../lib/format';
import { Card, Empty, Loading, useLoad } from '../ui/ui';
import { HBars } from '../ui/charts';

/** Comissão confirmada pelas lojas (hoje: relatório de conversões da Shopee), por loja e por grupo de destino. */
export function CommissionsCard({ days }: { days: number }) {
  const q = useLoad(() => api().commissionSummary(days), [days], 120000); const c = q.data;
  return (
    <Card title={`Comissão — ${days} dias`} actions={c ? <span className="small muted">{int(c.orders)} venda(s) · <b>{money(c.total)}</b></span> : undefined}>
      {q.loading && !c ? <Loading /> : !c || c.orders === 0 ? <Empty>Sem comissões sincronizadas ainda. A Shopee é lida automaticamente a cada 2 h; as outras lojas informam comissão só nos painéis oficiais.</Empty> :
        <div className="grid g2">
          <div><div style={{ fontWeight: 650, marginBottom: 8 }}>Por loja</div><HBars color="var(--ok)" rows={c.by_platform.map((p) => ({ label: platformName[p.platform] ?? p.platform, value: Math.round(p.amount) }))} /></div>
          <div><div style={{ fontWeight: 650, marginBottom: 8 }}>Por grupo de destino</div>
            <table><thead><tr><th>Destino</th><th>Vendas</th><th>Comissão</th></tr></thead><tbody>{c.by_sub.map((s) => <tr key={s.sub_id}><td>{s.destination ?? <span className="muted">sem identificação ({s.sub_id})</span>}</td><td>{s.orders}</td><td>{money(s.amount)}</td></tr>)}</tbody></table>
            <div className="small muted" style={{ marginTop: 6 }}>A atribuição por grupo usa o identificador do destino no link (precisa do link curto ligado).</div></div>
        </div>}
    </Card>);
}
