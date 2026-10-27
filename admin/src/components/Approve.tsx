import { categorySlug } from '../lib/categories';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { Destination, Offer } from '../lib/types';
import { previewHtml } from '../lib/template';
import { Button, Field, Modal, useAction, useLoad } from '../ui/ui';
import { ChannelTag } from '../ui/badges';

export function Bubble({ text, channel }: { text: string; channel: 'telegram' | 'whatsapp' }) {
  return <div className="phone"><div className="bubble" dangerouslySetInnerHTML={{ __html: previewHtml(text, channel) }} /></div>;
}

export function PreviewPane({ offer, destinations }: { offer: Offer; destinations: Destination[] }) {
  const [destId, setDestId] = useState(destinations[0]?.id ?? '');
  const { data, error } = useLoad(() => (destId ? api().previewText(offer.id, destId) : Promise.resolve('')), [offer.id, offer.affiliate_url, destId]);
  const dest = destinations.find((d) => d.id === destId);
  if (!destinations.length) return <div className="muted small">Nenhum destino habilitado para pré-visualizar.</div>;
  return <div className="col" style={{ gap: 8 }}>
    <select aria-label="Destino da prévia" value={destId} onChange={(e) => setDestId(e.target.value)}>{destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
    {error ? <div className="alert critical">{error}</div> : data != null && dest ? <Bubble text={data} channel={dest.channel} /> : <div className="skeleton" style={{ height: 120 }} />}
  </div>;
}

export function eligible(offer: Offer, d: Destination) {
  const sl = categorySlug(offer.category);
  return d.enabled && (!d.categories.length || (!!sl && d.categories.includes(sl)));
}

export function ApproveModal({ offer, onClose, onDone }: { offer: Offer; onClose: () => void; onDone: () => void }) {
  const dests = useLoad(() => api().listDestinations(), []);
  const [sel, setSel] = useState<string[]>([]);
  const [when, setWhen] = useState('');
  const { run, busy } = useAction();
  const list = dests.data ?? [];
  useEffect(() => { if (dests.data) setSel(dests.data.filter((d) => eligible(offer, d)).map((d) => d.id)); }, [dests.data, offer]);
  const chosen = list.filter((d) => sel.includes(d.id));
  const noLink = !offer.affiliate_url;
  return (
    <Modal wide title="Aprovar oferta" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon={<CheckCircle2 size={16} />} busy={busy === 'ok'} disabled={!sel.length || noLink}
          onClick={async () => { if (await run('ok', () => api().approveOffer(offer.id, sel, when ? new Date(when).toISOString() : undefined), 'Oferta aprovada e enfileirada')) { onDone(); onClose(); } }}>
          Aprovar para {sel.length} destino(s)</Button></>}>
      <div className="col">
        <div><b>{offer.title}</b></div>
        {noLink && <div className="alert warning"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />Esta oferta não tem link de afiliado. Informe o link antes de aprovar.</div>}
        <div>
          <div className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Destinos</div>
          <div className="col" style={{ gap: 6 }}>
            {list.map((d) => { const ok = eligible(offer, d); return (
              <label key={d.id} className="row" style={{ opacity: ok ? 1 : .5 }}>
                <input type="checkbox" disabled={!ok} checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />
                <span>{d.name}</span><ChannelTag c={d.channel} />
                {!d.enabled && <span className="small muted">desabilitado</span>}
                {d.enabled && !ok && <span className="small muted">categoria não aceita</span>}
              </label>); })}
          </div>
        </div>
        <Field label="Agendar para (opcional)" hint="Vazio = entra na fila agora; o worker ainda respeita limites e horário de silêncio."><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        {chosen.length > 0 && <div><div className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Prévia do que será enviado</div><PreviewPane offer={offer} destinations={chosen} /></div>}
      </div>
    </Modal>);
}

export function AffiliateLinkForm({ offer, onDone }: { offer: Offer; onDone: () => void }) {
  const [v, setV] = useState(offer.affiliate_url ?? '');
  const { run, busy } = useAction();
  return <div className="row"><input aria-label="Link de afiliado" value={v} onChange={(e) => setV(e.target.value)} placeholder="Cole o link de afiliado gerado no painel oficial" />
    <Button variant="primary" busy={busy === 'l'} disabled={!v.trim() || v === offer.affiliate_url} onClick={async () => { if (await run('l', () => api().setAffiliateUrl(offer.id, v), 'Link salvo')) onDone(); }}>Salvar</Button></div>;
}
