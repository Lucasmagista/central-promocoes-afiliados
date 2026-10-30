import { useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { ProductImage } from '../ui/ProductImage';
import { useSession } from '../session';
import { ago, money, platformName } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHead, useAction, useDialogs, useLoad } from '../ui/ui';

export default function Watchlist() {
  const { canOperate } = useSession(); const { confirm } = useDialogs(); const { run, busy } = useAction();
  const q = useLoad(() => api().listWatchItems(), [], 30000);
  const [url, setUrl] = useState(''); const [target, setTarget] = useState(''); const [drop, setDrop] = useState('10');
  const add = async () => { if (await run('a', () => api().saveWatchItem(url.trim(), target === '' ? null : Number(target), drop === '' ? null : Number(drop)), 'Produto acompanhado')) { setUrl(''); setTarget(''); void q.reload(); } };
  const list = q.data ?? [];
  return (
    <>
      <PageHead title="Produtos acompanhados" sub="O worker confere o preço a cada 30 minutos e cria uma oferta quando o produto cai o suficiente ou chega ao seu preço-alvo." />
      <div className="col" style={{ gap: 14 }}>
        {canOperate && <Card title="Acompanhar um produto">
          <div className="col">
            <Field label="Endereço do produto" hint="Mercado Livre, Shopee, Amazon, AliExpress ou Magalu. Precisa ser de uma loja com conector configurado para a oferta sair com o seu link."><input value={url} placeholder="https://www.amazon.com.br/dp/B0…" onChange={(e) => setUrl(e.target.value)} /></Field>
            <div className="grid g3">
              <Field label="Preço-alvo (R$, opcional)" hint="Cria a oferta quando chegar nele ou ficar abaixo."><input type="number" min={0} step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
              <Field label="Queda mínima (%)" hint="Em relação ao último preço visto."><input type="number" min={1} max={90} value={drop} onChange={(e) => setDrop(e.target.value)} /></Field>
              <div style={{ alignSelf: 'end' }}><Button variant="primary" icon={<Plus size={15} />} busy={busy === 'a'} disabled={!/^https?:\/\//i.test(url.trim())} onClick={add}>Acompanhar</Button></div>
            </div>
          </div>
        </Card>}
        <Card title={`Acompanhados (${list.length})`} flush>
          {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : list.length === 0 ? <Empty icon={<Eye size={30} />}>Nenhum produto acompanhado ainda.</Empty> :
            <div className="tablewrap"><table><thead><tr><th>Produto</th><th>Loja</th><th>Último preço</th><th>Preço-alvo</th><th>Queda mín.</th><th>Verificado</th><th>Última oferta</th><th /></tr></thead>
              <tbody>{list.map((w) => <tr key={w.id}><td style={{ maxWidth: 340 }}><div className="row" style={{ gap: 10 }}><ProductImage src={w.image_url} size={40} /><a href={w.url} target="_blank" rel="noreferrer noopener" className="truncate" style={{ display: 'block', minWidth: 0 }}>{w.title ?? w.url}</a></div></td>
                <td><Badge tone="accent">{platformName[w.platform] ?? w.platform}</Badge></td><td><b>{w.last_price != null ? money(w.last_price) : '—'}</b></td><td>{w.target_price != null ? money(w.target_price) : '—'}</td><td>{w.min_drop_pct}%</td>
                <td className="small muted">{w.last_checked_at ? ago(w.last_checked_at) : 'ainda não'}</td><td className="small muted">{w.last_offer_at ? ago(w.last_offer_at) : '—'}</td>
                <td>{canOperate && <Button size="sm" variant="ghost" aria-label="Parar de acompanhar" icon={<Trash2 size={14} />} onClick={async () => { if (await confirm({ title: 'Parar de acompanhar?', danger: true, confirmLabel: 'Parar', body: w.title ?? w.url })) if (await run('d', () => api().deleteWatchItem(w.id), 'Removido')) void q.reload(); }} />}</td></tr>)}</tbody></table></div>}
        </Card>
      </div>
    </>);
}
