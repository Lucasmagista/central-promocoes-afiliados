import { useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { ProductImage } from '../ui/ProductImage';
import { useSession } from '../session';
import { money, dateFull, ago, sourceLabel, pct } from '../lib/format';
import { Badge, Button, Drawer, ErrorBox, Loading, useAction, useDialogs, useLoad } from '../ui/ui';
import { OfferStatus, PlatformTag, PubStatus, Score, ChannelTag } from '../ui/badges';
import { PriceChart } from '../ui/charts';
import { AffiliateLinkForm, ApproveModal, PreviewPane } from './Approve';

export function OfferDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { canOperate } = useSession();
  const { prompt } = useDialogs();
  const { run, busy } = useAction();
  const q = useLoad(() => api().getOffer(id), [id]);
  const dests = useLoad(() => api().listDestinations(), []);
  const [approve, setApprove] = useState(false);
  const o = q.data?.offer;
  const open = o && ['needs_review', 'approved', 'scheduled'].includes(o.status);
  const changed = () => { void q.reload(); onChanged(); };
  return (
    <Drawer onClose={onClose} footer={o && q.data && canOperate && open && o.status === 'needs_review' ? <>{o.status === 'needs_review' && <><Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => setApprove(true)}>Aprovar…</Button>
                <Button variant="danger" busy={busy === 'rej'} icon={<XCircle size={16} />} onClick={async () => {
                  const r = await prompt({ title: 'Rejeitar oferta', label: 'Motivo da rejeição', required: true, multiline: true, confirmLabel: 'Rejeitar' });
                  if (r && await run('rej', () => api().rejectOffer(o.id, r), 'Oferta rejeitada')) changed(); }}>Rejeitar</Button></>}</> : undefined} title={o ? <div className="col" style={{ gap: 6 }}><div className="row wrap"><OfferStatus s={o.status} /><PlatformTag p={o.platform} />{o.is_simulated && <Badge tone="info">Simulada</Badge>}</div><h2 style={{ fontSize: 17 }}>{o.title}</h2></div> : 'Oferta'}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : o && q.data && (
        <div className="col" style={{ gap: 20 }}>
          {o.image_url && <div style={{ display: 'flex', justifyContent: 'center' }}><ProductImage src={o.image_url} size={160} radius={14} alt={o.title} /></div>}
          <div className="row wrap" style={{ gap: 20 }}>
            <div><div className="small muted">Preço</div><div style={{ fontSize: 28, fontWeight: 700 }}>{money(o.current_price)}</div></div>
            {o.previous_price != null && <div><div className="small muted">Anterior ({o.previous_price_source === 'own_history' ? 'histórico próprio' : 'fonte oficial'})</div><div style={{ fontSize: 18 }}>{money(o.previous_price)} <Badge tone="ok">-{pct(o.discount_pct, 1)}</Badge></div></div>}
            <div className="right"><Score v={o.score} /></div>
          </div>
          {o.rejected_reason && <div className="alert critical">Rejeitada: {o.rejected_reason}</div>}
          {o.validation_notes.map((n) => <div key={n} className="alert warning">{n}</div>)}
          {o.score_reasons.length > 0 && <section><h3>Por que esse score</h3>
            <div className="col" style={{ gap: 6, marginTop: 8 }}>{o.score_reasons.map((r) => <div key={r.code} className="row small"><Badge tone={r.points > 0 ? 'ok' : undefined}>+{r.points}</Badge><span>{r.label}</span></div>)}</div></section>}
          <section><h3>Histórico de preço</h3><div style={{ marginTop: 8 }}><PriceChart points={q.data.observations.map((x) => ({ t: new Date(x.observed_at).getTime(), v: x.price }))} /></div>
            <div className="small muted">{q.data.observations.length} observação(ões). Preço anterior só é usado quando vem de fonte oficial ou do histórico próprio (≥5 observações em ≥3 dias).</div></section>
          <section><h3>Dados</h3>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Fonte</dt><dd>{o.source_name ?? '—'} · camada {o.source_layer} · {sourceLabel[q.data.observations[0]?.source_kind ?? 'admin_declared']}</dd>
              <dt>Preço visto</dt><dd>{dateFull(o.price_observed_at)} ({ago(o.price_observed_at)})</dd>
              <dt>Categoria</dt><dd>{o.category ?? '—'}</dd><dt>Vendedor</dt><dd>{o.seller_name ?? '—'}</dd>
              <dt>Cupom</dt><dd>{o.coupon_code ? <>{o.coupon_code} {o.coupon_confirmed ? <Badge tone="ok">confirmado</Badge> : <Badge tone="warn">não confirmado (não será publicado)</Badge>}</> : '—'}</dd>
              <dt>Expira</dt><dd>{o.expires_at ? dateFull(o.expires_at) : '—'}</dd>
              <dt>Link original</dt><dd><a href={o.original_url} target="_blank" rel="noreferrer noopener">{o.original_url} <ExternalLink size={12} /></a></dd>
              <dt>Link de afiliado</dt><dd>{canOperate && open ? <AffiliateLinkForm offer={o} onDone={changed} /> : (o.affiliate_url ?? '—')}</dd>
            </dl></section>
          {dests.data && <section><h3>Prévia</h3><div style={{ marginTop: 8 }}><PreviewPane offer={o} destinations={dests.data.filter((d) => d.enabled)} /></div></section>}
          <section><h3>Publicações desta oferta</h3>
            {q.data.publications.length === 0 ? <div className="muted small" style={{ marginTop: 6 }}>Ainda não publicada.</div> :
              <div className="col" style={{ gap: 6, marginTop: 8 }}>{q.data.publications.map((p) => <div key={p.id} className="row wrap small"><ChannelTag c={p.channel} /><span>{p.destination_name}</span><PubStatus s={p.status} /><span className="muted right">{p.clicks} cliques</span></div>)}</div>}</section>
          {approve && <ApproveModal offer={o} onClose={() => setApprove(false)} onDone={changed} />}
        </div>)}
    </Drawer>);
}
