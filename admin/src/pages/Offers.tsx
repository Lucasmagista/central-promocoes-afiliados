import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Search, Tag, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { ProductImage } from '../ui/ProductImage';
import { useSession } from '../session';
import { money, ago, offerStatusLabel, platformName } from '../lib/format';
import { Button, Card, Empty, ErrorBox, Loading, PageHead, Pager, Th, useAction, useDialogs, useLoad, useSelection, useTable } from '../ui/ui';
import { OfferStatus, PlatformTag, Score } from '../ui/badges';
import { OfferDrawer } from '../components/OfferDrawer';
import type { OfferStatus as S, Platform } from '../lib/types';

export default function Offers() {
  const { canOperate } = useSession();
  const { prompt } = useDialogs();
  const { run, busy } = useAction();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<S | 'all'>('all');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(sp.get('abrir'));
  useEffect(() => { const a = sp.get('abrir'); if (a) { setOpen(a); setSp({}, { replace: true }); } }, [sp, setSp]);
  const q = useLoad(() => api().listOffers({ status, platform, q: text }), [status, platform, text]);
  const t = useTable(q.data ?? [], { score: (o) => o.score, title: (o) => o.title, platform: (o) => o.platform, price: (o) => o.current_price, status: (o) => o.status, seen: (o) => -new Date(o.price_observed_at).getTime() }, { key: 'score', dir: 'desc' }, 15);
  const sel = useSelection();
  const rejectable = (q.data ?? []).filter((o) => sel.has(o.id) && (o.status === 'needs_review' || o.status === 'approved'));

  const exportCsv = () => {
    const rows = [['id', 'titulo', 'plataforma', 'status', 'preco', 'desconto_pct', 'score', 'visto_em'], ...(q.data ?? []).map((o) => [o.id, o.title, o.platform, o.status, o.current_price, o.discount_pct ?? '', o.score ?? '', o.price_observed_at])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'ofertas.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  const bulkReject = async () => {
    const r = await prompt({ title: `Rejeitar ${rejectable.length} oferta(s)`, label: 'Motivo (vale para todas)', required: true, multiline: true, confirmLabel: 'Rejeitar' });
    if (!r) return;
    if (await run('bulk', async () => { for (const o of rejectable) await api().rejectOffer(o.id, r); }, `${rejectable.length} oferta(s) rejeitada(s)`)) { sel.clear(); void q.reload(); }
  };
  const pageIds = t.rows.map((o) => o.id);
  const allOn = pageIds.length > 0 && pageIds.every((i) => sel.has(i));

  return (
    <>
      <PageHead title="Ofertas" sub="Todas as ofertas conhecidas, com estado, origem e score.">
        <Button icon={<Download size={16} />} onClick={exportCsv} disabled={!q.data?.length}>Exportar CSV</Button></PageHead>
      <Card flush>
        <div className="tools">
          <div className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} />
            <input aria-label="Buscar por título" style={{ paddingLeft: 32 }} placeholder="Buscar por título" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value as S | 'all')}><option value="all">Todos os status</option>{Object.entries(offerStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Filtrar por plataforma" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'all')}><option value="all">Todas as plataformas</option>{(['mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu'] as const).map((p) => <option key={p} value={p}>{platformName[p]}</option>)}</select>
        </div>
        {sel.count > 0 && <div className="bulkbar" role="status"><span>{sel.count} selecionada(s)</span>
          {canOperate && <Button size="sm" icon={<XCircle size={15} />} disabled={rejectable.length === 0} busy={busy === 'bulk'} onClick={bulkReject}>Rejeitar {rejectable.length || ''}</Button>}
          <Button size="sm" onClick={sel.clear}>Limpar seleção</Button></div>}
        {q.loading && !q.data ? <Loading /> : q.error ? <div style={{ padding: 16 }}><ErrorBox error={q.error} retry={q.reloadLoud} /></div> : !q.data?.length ? <Empty icon={<Tag size={30} />}>Nenhuma oferta com esses filtros.</Empty> : <>
          <div className="tablewrap"><table><thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" aria-label="Selecionar a página" checked={allOn} onChange={(e) => sel.setAll(pageIds, e.target.checked)} /></th>
            <Th t={t} k="score">Score</Th><Th t={t} k="title">Oferta</Th><Th t={t} k="platform">Plataforma</Th><Th t={t} k="price">Preço</Th><Th t={t} k="status">Status</Th><Th t={t} k="seen">Visto</Th></tr></thead>
            <tbody>{t.rows.map((o) => <tr key={o.id} className="click" tabIndex={0} onClick={() => setOpen(o.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.id)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${o.title}`} checked={sel.has(o.id)} onChange={() => sel.toggle(o.id)} /></td>
              <td><Score v={o.score} /></td><td style={{ maxWidth: 400 }}><div className="row" style={{ gap: 10 }}><ProductImage src={o.image_url} size={44} /><div style={{ minWidth: 0 }}><div className="truncate" style={{ fontWeight: 600 }}>{o.title}</div><div className="small muted">{o.category ?? 'Sem categoria'}</div></div></div></td>
              <td><PlatformTag p={o.platform} /></td><td className="nowrap"><b>{money(o.current_price)}</b>{o.discount_pct != null && <div className="small up">-{o.discount_pct}%</div>}</td>
              <td><OfferStatus s={o.status} /></td><td className="small muted nowrap">{ago(o.price_observed_at)}</td></tr>)}</tbody></table></div>
          <Pager t={t} label="ofertas" /></>}
      </Card>
      {open && <OfferDrawer id={open} onClose={() => setOpen(null)} onChanged={q.reload} />}
    </>);
}
