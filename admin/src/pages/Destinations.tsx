import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FlaskConical, Trash2, Pencil, ShieldAlert, Moon, MessageCircle, Radio, Search, Send, Gauge } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, channelName } from '../lib/format';
import type { Channel, Destination } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Toggle, useAction, useDialogs, useLoad } from '../ui/ui';
import { ChannelTag } from '../ui/badges';
import { CategoryChips, CategoryPicker } from '../components/CategoryPicker';
import { DestinationWizard } from '../components/DestinationWizard';
import { DEFAULT_CATEGORIES } from '../lib/categories';

type Draft = Partial<Destination> & Pick<Destination, 'channel' | 'external_id' | 'name'>;

function Editor({ initial, cats, onClose, onSaved }: { initial: Draft; cats: typeof DEFAULT_CATEGORIES; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const { run, busy } = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const quiet = !!(d.quiet_start && d.quiet_end);
  return (
    <Modal wide title="Editar destino" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={busy === 's'} disabled={!d.name.trim()}
        onClick={async () => { if (await run('s', () => api().saveDestination({ ...d, quiet_start: quiet ? d.quiet_start : null, quiet_end: quiet ? d.quiet_end : null }), 'Destino salvo')) { onSaved(); onClose(); } }}>Salvar</Button></>}>
      <div className="col">
        <div className="row wrap"><ChannelTag c={d.channel} /><span className="mono small muted truncate">{d.external_id}</span><span className="small muted">(o identificador não muda; para trocar de grupo, crie outro destino)</span></div>
        <div className="grid g2"><Field label="Nome"><input value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Descrição"><input value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field></div>
        <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Tipos de produto aceitos</div><CategoryPicker cats={cats} value={d.categories ?? []} onChange={(v) => set('categories', v)} /></div>
        <div className="grid g3">
          <Field label="Máx. por hora"><input type="number" min={1} value={d.max_per_hour} onChange={(e) => set('max_per_hour', +e.target.value)} /></Field>
          <Field label="Máx. por dia"><input type="number" min={1} value={d.max_per_day} onChange={(e) => set('max_per_day', +e.target.value)} /></Field>
          <Field label="Intervalo mínimo (s)"><input type="number" min={0} value={d.min_interval_s} onChange={(e) => set('min_interval_s', +e.target.value)} /></Field>
        </div>
        <div className="grid g3">
          <Field label="Silêncio — início"><input type="time" value={d.quiet_start ?? ''} onChange={(e) => set('quiet_start', e.target.value || null)} /></Field>
          <Field label="Silêncio — fim"><input type="time" value={d.quiet_end ?? ''} onChange={(e) => set('quiet_end', e.target.value || null)} /></Field>
          <Field label="Risco do canal"><select value={d.risk_tier} onChange={(e) => set('risk_tier', e.target.value as Destination['risk_tier'])}><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto (WhatsApp)</option></select></Field>
        </div>
        <div className="small muted">Horário de silêncio no fuso de São Paulo. Em canais de risco alto, comece com limites baixos e aumente aos poucos.</div>
      </div>
    </Modal>);
}

export default function Destinations() {
  const { isAdmin, canOperate } = useSession();
  const { confirm } = useDialogs();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = useLoad(() => api().listDestinations(), [], 8000);
  const catsQ = useLoad(() => api().listCategories(), []);
  const chatsWa = useLoad(() => api().listChats({ channel: 'whatsapp', kind: 'all' }), [], 15000);
  const chatsTg = useLoad(() => api().listChats({ channel: 'telegram', kind: 'all' }), [], 15000);
  const cats = catsQ.data ?? DEFAULT_CATEGORIES;
  const [edit, setEdit] = useState<Draft | null>(null);
  const [wizard, setWizard] = useState<{ chat: string | null } | null>(null);
  const [text, setText] = useState(''); const [ch, setCh] = useState<Channel | 'all'>('all'); const [cat, setCat] = useState('all'); const [st, setSt] = useState<'all' | 'on' | 'off' | 'untested'>('all');
  useEffect(() => { const n = sp.get('novo'); if (n && isAdmin) { setWizard({ chat: n }); setSp({}, { replace: true }); } }, [sp, setSp, isAdmin]);
  const chatOf = (d: Destination) => [...(chatsWa.data ?? []), ...(chatsTg.data ?? [])].find((c) => c.channel === d.channel && c.external_id === d.external_id);

  const list = useMemo(() => (q.data ?? []).filter((d) =>
    (ch === 'all' || d.channel === ch) && (cat === 'all' || (cat === 'none' ? d.categories.length === 0 : d.categories.includes(cat))) &&
    (st === 'all' || (st === 'on' ? d.enabled : st === 'off' ? !d.enabled : !d.tested_at)) &&
    (!text || (d.name + ' ' + d.external_id).toLowerCase().includes(text.toLowerCase()))), [q.data, ch, cat, st, text]);
  const all = q.data ?? [];

  return (
    <>
      <PageHead title="Destinos" sub="Canais e grupos que recebem as ofertas, cada um com seus tipos de produto e limites. Só é possível ativar um destino depois de testado.">
        {isAdmin && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setWizard({ chat: null })}>Novo destino</Button>}</PageHead>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        {[['Destinos', all.length, ''], ['Ativos', all.filter((d) => d.enabled).length, 'recebendo ofertas'], ['Sem teste', all.filter((d) => !d.tested_at).length, 'não podem ser ativados'], ['Com filtro de tipo', all.filter((d) => d.categories.length).length, 'só aceitam certos produtos']].map(([k, v, sub]) => (
          <div key={k as string} className="card stat"><div className="small muted" style={{ fontWeight: 600 }}>{k}</div><div className="v">{v}</div><div className="d muted">{sub}</div></div>))}
      </div>
      <Card flush>
        <div className="tools">
          <div className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} /><input aria-label="Buscar destino" placeholder="Buscar destino" style={{ paddingLeft: 32 }} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <select aria-label="Canal" value={ch} onChange={(e) => setCh(e.target.value as Channel | 'all')}><option value="all">Todos os canais</option>{Object.entries(channelName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Tipo de produto" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">Todos os tipos de produto</option><option value="none">Aceitam qualquer tipo</option>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</select>
          <select aria-label="Situação" value={st} onChange={(e) => setSt(e.target.value as typeof st)}><option value="all">Qualquer situação</option><option value="on">Ativos</option><option value="off">Desligados</option><option value="untested">Nunca testados</option></select>
          <span className="right small muted">{list.length} de {all.length}</span>
        </div>
      </Card>
      <div style={{ height: 14 }} />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : !all.length ? <Card><Empty icon={<Radio size={30} />}>Nenhum destino ainda. {isAdmin ? 'Clique em “Novo destino” para escolher ou criar um grupo.' : 'Peça a um administrador para criar o primeiro.'}</Empty></Card> : !list.length ? <Card><Empty>Nenhum destino com esses filtros.</Empty></Card> :
        <div className="grid g2">{list.map((d) => { const chat = chatOf(d); return (
          <Card key={d.id} title={<span className="row wrap">{d.name}<ChannelTag c={d.channel} /></span>} actions={<>
            <span className="small muted">{d.enabled ? 'Ativo' : 'Desligado'}</span>
            <Toggle label={`Ativar ${d.name}`} checked={d.enabled} disabled={!isAdmin || busy === d.id || (!d.enabled && !d.tested_at)}
              onChange={async (v) => { if (v && !d.tested_at) return; const base = { channel: d.channel, external_id: d.external_id, name: d.name, id: d.id }; if (await run(d.id, () => api().saveDestination({ ...base, enabled: v }), v ? 'Destino ativado' : 'Destino desligado')) void q.reload(); }} /></>}>
            <div className="col" style={{ gap: 11 }}>
              <div className="small muted mono truncate">{d.external_id}{chat?.participant_count != null ? ` · ${chat.participant_count} participantes` : ''}</div>
              {d.description && <div className="small">{d.description}</div>}
              <div className="row wrap" style={{ gap: 6 }}><CategoryChips cats={cats} value={d.categories} /></div>
              <div className="row wrap" style={{ gap: 6 }}>
                <Badge><Gauge size={12} />{d.max_per_hour}/h · {d.max_per_day}/dia</Badge><Badge>intervalo {Math.round(d.min_interval_s / 60)} min</Badge>
                {d.quiet_start && <Badge><Moon size={12} />{d.quiet_start}–{d.quiet_end}</Badge>}
                {d.risk_tier === 'high' && <Badge tone="warn"><ShieldAlert size={12} />risco alto</Badge>}
              </div>
              <div className="row">{d.tested_at ? <Badge tone="ok">testado {ago(d.tested_at)}</Badge> : <Badge tone="warn">nunca testado — não pode ser ativado</Badge>}</div>
              <div className="row wrap">
                {canOperate && <Button size="sm" busy={busy === 't' + d.id} icon={<FlaskConical size={14} />} onClick={async () => { if (await run('t' + d.id, () => api().requestDestinationTest(d.id), 'Teste solicitado: o worker envia uma mensagem de teste em instantes')) setTimeout(q.reload, 3000); }}>Enviar teste</Button>}
                {chat && <Button size="sm" icon={d.channel === 'whatsapp' ? <MessageCircle size={14} /> : <Send size={14} />} onClick={() => nav(`/${d.channel}?c=${chat.id}`)}>Conversa</Button>}
                {isAdmin && <><Button size="sm" icon={<Pencil size={14} />} onClick={() => setEdit(d)}>Editar</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { if (await confirm({ title: `Excluir "${d.name}"?`, body: 'Só é possível excluir destinos sem histórico de publicações; caso contrário, desligue-o.', danger: true, confirmLabel: 'Excluir' }) && await run('d' + d.id, () => api().deleteDestination(d.id), 'Destino excluído')) void q.reload(); }}>Excluir</Button></>}
              </div>
            </div>
          </Card>); })}</div>}
      {edit && <Editor initial={edit} cats={cats} onClose={() => setEdit(null)} onSaved={q.reload} />}
      {wizard && <DestinationWizard cats={cats} initialChat={wizard.chat} onClose={() => setWizard(null)} onSaved={() => void q.reload()} />}
    </>);
}
