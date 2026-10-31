import { categorySlug } from '../lib/categories';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { ApproveAllResult, Destination, Offer } from '../lib/types';
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

export function approveAllText(r: ApproveAllResult) {
  const n = r.ignorados.length;
  return `Aprovada para ${r.destinos_ok} grupo(s)/canal(is)` + (n ? ` · ${n} ignorado(s): ${r.ignorados.slice(0, 2).map((x) => `${x.destino} (${x.motivo})`).join('; ')}${n > 2 ? '…' : ''}` : '');
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
  const channels = (['telegram', 'whatsapp'] as const).map((ch) => { const all = list.filter((d) => d.channel === ch && eligible(offer, d)); return { ch, all, on: all.filter((d) => sel.includes(d.id)).length }; }).filter((x) => x.all.length > 0);
  const toggleChannel = (ch: 'telegram' | 'whatsapp', on: boolean) => { const ids = list.filter((d) => d.channel === ch && eligible(offer, d)).map((d) => d.id); setSel(on ? Array.from(new Set([...sel, ...ids])) : sel.filter((x) => !ids.includes(x))); };
  const noLink = !offer.affiliate_url;
  const everywhere = async () => { if (await run('all', async () => { const r = await api().approveOfferAll(offer.id, when ? new Date(when).toISOString() : undefined); return r; }, 'Oferta aprovada e enfileirada em todos os grupos')) { onDone(); onClose(); } };
  const nAll = list.filter((d) => d.enabled).length;
  return (
    <Modal wide title="Aprovar oferta" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon={<CheckCircle2 size={16} />} busy={busy === 'all'} disabled={!nAll || noLink} onClick={() => void everywhere()}>Enviar para todos ({nAll})</Button>
        <Button icon={<CheckCircle2 size={16} />} busy={busy === 'ok'} disabled={!sel.length || noLink}
          onClick={async () => { if (await run('ok', () => api().approveOffer(offer.id, sel, when ? new Date(when).toISOString() : undefined), 'Oferta aprovada e enfileirada')) { onDone(); onClose(); } }}>
          Só os {sel.length} marcado(s)</Button></>}>
      <div className="col">
        <div><b>{offer.title}</b></div>
        {noLink && <div className="alert warning"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />Esta oferta não tem link de afiliado. Informe o link antes de aprovar.</div>}
        <div>
          <div className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Destinos</div>
          {channels.length > 0 && <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>{channels.map((x) => { const full = x.on === x.all.length;
            return <label key={x.ch} className="row" style={{ gap: 6, border: '1px solid var(--line)', borderRadius: 99, padding: '3px 10px' }}><input type="checkbox" checked={full} ref={(el) => { if (el) el.indeterminate = x.on > 0 && !full; }} onChange={(e) => toggleChannel(x.ch, e.target.checked)} />
              <ChannelTag c={x.ch} /><span className="small muted">{x.on}/{x.all.length} grupo(s)</span></label>; })}
            <span className="small muted">Cada canal sai ao mesmo tempo, com o seu próprio ritmo e limites.</span></div>}
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
