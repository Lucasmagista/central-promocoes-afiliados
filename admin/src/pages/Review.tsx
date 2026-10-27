import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, PartyPopper, Eye, Kanban as KanbanIcon, List, RotateCcw, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { money, ago, pct, platformName } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Kbd, Loading, PageHead, PriceTag, useAction, useDialogs, useHotkeys, useLoad } from '../ui/ui';
import { PlatformTag, Score } from '../ui/badges';
import { AffiliateLinkForm, ApproveModal, PreviewPane } from '../components/Approve';
import { OfferDrawer } from '../components/OfferDrawer';
import { CatIcon } from '../components/CategoryPicker';
import { DEFAULT_CATEGORIES, categorySlug } from '../lib/categories';
import type { Offer, Platform } from '../lib/types';

type ColId = 'review' | 'queue' | 'published' | 'rejected';
const COLS: { id: ColId; title: string; hint: string; statuses: Offer['status'][] }[] = [
  { id: 'review', title: 'Para revisar', hint: 'Aguardando decisão', statuses: ['needs_review'] },
  { id: 'queue', title: 'Aprovadas', hint: 'Na fila de envio', statuses: ['approved', 'scheduled'] },
  { id: 'published', title: 'Publicadas', hint: 'Já enviadas', statuses: ['published'] },
  { id: 'rejected', title: 'Rejeitadas', hint: 'Arraste para reabrir', statuses: ['rejected'] },
];

function CatSelect({ o, onChanged, disabled }: { o: Offer; onChanged: () => void; disabled?: boolean }) {
  const { run } = useAction();
  const cats = useLoad(() => api().listCategories(), []).data ?? DEFAULT_CATEGORIES;
  const slug = categorySlug(o.category, cats) ?? 'outros';
  return <label className="catsel"><CatIcon name={cats.find((c) => c.slug === slug)?.icon ?? 'tag'} size={13} />
    <select aria-label="Tipo de produto" disabled={disabled} value={slug} onClick={(e) => e.stopPropagation()} onChange={async (e) => { if (await run('cat', () => api().setOfferCategory(o.id, e.target.value), 'Tipo atualizado')) onChanged(); }}>
      {cats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</select></label>;
}

function Board({ onChanged }: { onChanged: () => void }) {
  const { canOperate } = useSession();
  const { prompt, toast } = useDialogs();
  const { run } = useAction();
  const q = useLoad(async () => (await Promise.all(['needs_review', 'approved', 'scheduled', 'published', 'rejected'].map((st) => api().listOffers({ status: st as Offer['status'], limit: 100 })))).flat(), [], 20000);
  const [plat, setPlat] = useState<Platform | 'all'>('all');
  const [cat, setCat] = useState('all');
  const [text, setText] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [drag, setDrag] = useState<Offer | null>(null);
  const [over, setOver] = useState<ColId | null>(null);
  const [approving, setApproving] = useState<Offer | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const cats = useLoad(() => api().listCategories(), []).data ?? DEFAULT_CATEGORIES;
  const all = q.data ?? [];
  const t = text.trim().toLowerCase();
  const filtered = useMemo(() => all.filter((o) => (plat === 'all' || o.platform === plat) && (cat === 'all' || (categorySlug(o.category, cats) ?? 'outros') === cat)
    && (o.score ?? 0) >= minScore && (!t || o.title.toLowerCase().includes(t))), [all, plat, cat, minScore, t, cats]);
  const colOf = (o: Offer): ColId | null => COLS.find((c) => c.statuses.includes(o.status))?.id ?? null;
  const refresh = async () => { await q.reload(); onChanged(); };

  const reject = async (o: Offer) => {
    const r = await prompt({ title: 'Rejeitar oferta', label: 'Motivo da rejeição', required: true, multiline: true, confirmLabel: 'Rejeitar' });
    if (r && await run(o.id, () => api().rejectOffer(o.id, r), 'Oferta rejeitada')) void refresh();
  };
  const approve = (o: Offer) => { if (!o.affiliate_url) { toast('Adicione o link de afiliado antes de aprovar (abra a oferta).', 'err'); return; } setApproving(o); };
  const reopen = async (o: Offer) => { if (await run(o.id, () => api().reopenOffer(o.id), 'Oferta reaberta para revisão')) void refresh(); };
  const drop = (to: ColId) => {
    const o = drag; setDrag(null); setOver(null);
    if (!o || !canOperate) return;
    const from = colOf(o);
    if (from === to) return;
    if (from === 'review' && to === 'queue') return approve(o);
    if (from === 'review' && to === 'rejected') return void reject(o);
    if (from === 'rejected' && to === 'review') return void reopen(o);
    toast('Movimento não permitido. Só dá para aprovar/rejeitar o que está em revisão ou reabrir o que foi rejeitado.', 'err');
  };
  const allowed = (o: Offer | null, to: ColId) => { if (!o) return false; const f = colOf(o); return (f === 'review' && (to === 'queue' || to === 'rejected')) || (f === 'rejected' && to === 'review'); };

  return <>
    <Card flush>
      <div className="tools">
        <label className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} />
          <input aria-label="Buscar no quadro" placeholder="Buscar título" style={{ paddingLeft: 32 }} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <select aria-label="Plataforma" value={plat} onChange={(e) => setPlat(e.target.value as Platform | 'all')}><option value="all">Todas as plataformas</option>{Object.entries(platformName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Tipo de produto" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">Todos os tipos</option>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</select>
        <label className="row small muted">Score ≥ <input aria-label="Score mínimo" type="number" min={0} max={100} style={{ width: 70, minWidth: 0 }} value={minScore} onChange={(e) => setMinScore(Number(e.target.value) || 0)} /></label>
        {canOperate && <span className="small muted right">Arraste: <b>Para revisar → Aprovadas / Rejeitadas</b> · <b>Rejeitadas → Para revisar</b></span>}
      </div>
    </Card>
    {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> :
      <div className="kanban">{COLS.map((c) => {
        const items = filtered.filter((o) => colOf(o) === c.id).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const ok = allowed(drag, c.id);
        return <section key={c.id} className="kcol" data-over={over === c.id && ok} data-ok={drag ? ok : undefined} aria-label={c.title}
          onDragOver={(e) => { if (ok) { e.preventDefault(); setOver(c.id); } }} onDragLeave={() => setOver((x) => (x === c.id ? null : x))} onDrop={(e) => { e.preventDefault(); drop(c.id); }}>
          <header><b>{c.title}</b><span className="kcount">{items.length}</span><div className="small muted">{c.hint}</div></header>
          <div className="kbody">{items.length === 0 ? <div className="small muted kempty">Nada aqui.</div> : items.map((o) =>
            <article key={o.id} className="kcard" draggable={canOperate && (c.id === 'review' || c.id === 'rejected')} onDragStart={() => setDrag(o)} onDragEnd={() => { setDrag(null); setOver(null); }}
              data-dragging={drag?.id === o.id}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}><Score v={o.score} /><button className="ktitle" onClick={() => setDetail(o.id)} title="Abrir detalhes">{o.title}</button></div>
              <div className="row wrap small" style={{ gap: 8 }}><b>{money(o.current_price)}</b>{o.discount_pct != null && <span className="up">-{o.discount_pct}%</span>}<PlatformTag p={o.platform} /><span className="muted">{ago(o.price_observed_at)}</span></div>
              <CatSelect o={o} onChanged={() => void refresh()} disabled={!canOperate || !['needs_review', 'approved', 'scheduled', 'discovered'].includes(o.status)} />
              {c.id === 'rejected' && o.rejected_reason && <div className="small muted truncate" title={o.rejected_reason}>Motivo: {o.rejected_reason}</div>}
              {canOperate && c.id === 'review' && <div className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => approve(o)}>Aprovar</Button><Button size="sm" icon={<XCircle size={14} />} onClick={() => reject(o)}>Rejeitar</Button></div>}
              {canOperate && c.id === 'rejected' && <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => reopen(o)}>Reabrir</Button>}
            </article>)}</div>
        </section>; })}</div>}
    {approving && <ApproveModal offer={approving} onClose={() => setApproving(null)} onDone={() => void refresh()} />}
    {detail && <OfferDrawer id={detail} onClose={() => setDetail(null)} onChanged={() => void refresh()} />}
  </>;
}

function ListView({ onChanged }: { onChanged: () => void }) {
  const { canOperate } = useSession();
  const { prompt } = useDialogs();
  const { run, busy } = useAction();
  const q = useLoad(() => api().listOffers({ status: 'needs_review' }), [], 20000);
  const dests = useLoad(() => api().listDestinations(), []);
  const [approving, setApproving] = useState<Offer | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const list = (q.data ?? []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const enabled = (dests.data ?? []).filter((d) => d.enabled);
  const o = list.find((x) => x.id === cur) ?? list[0] ?? null;
  useEffect(() => { if (list.length && !list.some((x) => x.id === cur)) setCur(list[0].id); }, [list, cur]);
  const idx = o ? list.findIndex((x) => x.id === o.id) : -1;
  const refresh = async () => { await q.reload(); onChanged(); };
  const reject = async (x: Offer) => {
    const r = await prompt({ title: 'Rejeitar oferta', label: 'Motivo da rejeição', required: true, multiline: true, confirmLabel: 'Rejeitar' });
    if (r && await run(x.id, () => api().rejectOffer(x.id, r), 'Oferta rejeitada')) void refresh();
  };
  const modal = !!approving || !!detail;
  useHotkeys({
    j: () => list[idx + 1] && setCur(list[idx + 1].id), k: () => list[idx - 1] && setCur(list[idx - 1].id),
    a: () => { if (o && canOperate && o.affiliate_url) setApproving(o); }, r: () => { if (o && canOperate) void reject(o); }, d: () => o && setDetail(o.id),
  }, !modal);
  return <>
    {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : !o ?
      <Card><Empty icon={<PartyPopper size={32} />}>Fila vazia. Nenhuma oferta aguardando revisão.</Empty></Card> :
      <div className="review">
        <section className="card list" aria-label="Ofertas aguardando revisão">
          {list.map((x) => (
            <div key={x.id} className="rrow" role="button" tabIndex={0} aria-current={x.id === o.id} onClick={() => setCur(x.id)} onKeyDown={(e) => e.key === 'Enter' && setCur(x.id)}>
              <Score v={x.score} />
              <div style={{ minWidth: 0, flex: 1 }}><div className="t">{x.title}</div>
                <div className="row small muted" style={{ gap: 8, marginTop: 3 }}><b style={{ color: 'var(--ink)' }}>{money(x.current_price)}</b>{x.discount_pct != null && <span className="up">-{x.discount_pct}%</span>}<span>{ago(x.price_observed_at)}</span></div></div>
            </div>))}
        </section>
        <section className="card"><div className="reviewcard">
          <div className="l col" style={{ gap: 14 }}>
            <div className="row wrap"><Score v={o.score} /><div style={{ minWidth: 0, flex: 1 }}><h2 style={{ fontSize: 17 }}>{o.title}</h2>
              <div className="row wrap small muted" style={{ gap: 8 }}><PlatformTag p={o.platform} /><span>visto {ago(o.price_observed_at)}</span>{o.is_simulated && <Badge tone="info">Simulada</Badge>}</div></div></div>
            <CatSelect o={o} onChanged={() => void refresh()} disabled={!canOperate} />
            <div className="row wrap" style={{ gap: 14 }}><PriceTag value={money(o.current_price)} size="lg" />
              {o.previous_price != null ? <span className="muted">antes {money(o.previous_price)} <Badge tone="ok">-{pct(o.discount_pct, 1)}</Badge></span> : <Badge>sem desconto comprovado</Badge>}
              {o.coupon_code && <Badge tone={o.coupon_confirmed ? 'ok' : 'warn'}>cupom {o.coupon_code}{o.coupon_confirmed ? '' : ' (não confirmado)'}</Badge>}</div>
            <div className="col" style={{ gap: 4 }}>{o.score_reasons.filter((r) => r.points > 0).map((r) => <div key={r.code} className="small muted">+{r.points} · {r.label}</div>)}</div>
            {o.validation_notes.map((n) => <div key={n} className="alert warning small">{n}</div>)}
            {!o.affiliate_url && canOperate && <AffiliateLinkForm offer={o} onDone={refresh} />}
            <div className="row wrap">
              {canOperate && <><Button variant="primary" icon={<CheckCircle2 size={16} />} disabled={!o.affiliate_url} onClick={() => setApproving(o)}>Aprovar…</Button>
                <Button icon={<XCircle size={16} />} busy={busy === o.id} onClick={() => reject(o)}>Rejeitar</Button></>}
              <Button variant="ghost" icon={<Eye size={16} />} onClick={() => setDetail(o.id)}>Detalhes e histórico</Button></div>
          </div>
          <div className="r"><div className="small muted" style={{ fontWeight: 600, marginBottom: 8 }}>Prévia da mensagem</div>
            <PreviewPane offer={o} destinations={enabled} /></div>
        </div></section>
      </div>}
    {approving && <ApproveModal offer={approving} onClose={() => setApproving(null)} onDone={() => void refresh()} />}
    {detail && <OfferDrawer id={detail} onClose={() => setDetail(null)} onChanged={() => void refresh()} />}
  </>;
}

export default function Review() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('v') === 'kanban' ? 'kanban' : 'lista';
  const counts = useLoad(() => api().listOffers({ status: 'needs_review' }), [], 20000);
  return (
    <>
      <PageHead title="Fila de aprovação" sub="Nada é publicado sem passar por aqui (no modo Revisão). Ordenada por score.">
        <div className="seg" role="group" aria-label="Modo de visualização">
          <button aria-pressed={view === 'lista'} onClick={() => setSp({}, { replace: true })}><List size={14} style={{ verticalAlign: -2 }} /> Revisão{counts.data?.length ? ` (${counts.data.length})` : ''}</button>
          <button aria-pressed={view === 'kanban'} onClick={() => setSp({ v: 'kanban' }, { replace: true })}><KanbanIcon size={14} style={{ verticalAlign: -2 }} /> Kanban</button></div>
        {view === 'lista' && <span className="small muted row" style={{ gap: 6 }}><Kbd>j</Kbd><Kbd>k</Kbd> navegar <Kbd>a</Kbd> aprovar <Kbd>r</Kbd> rejeitar</span>}
      </PageHead>
      {view === 'kanban' ? <Board onChanged={counts.reload} /> : <ListView onChanged={counts.reload} />}
    </>);
}
