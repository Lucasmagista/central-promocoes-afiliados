import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleAlert, Eye, EyeOff, Pencil, Plus, RefreshCw, Search, Users, X, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, channelName, money, platformName } from '../lib/format';
import type { CapturedLink, Channel, Chat, PromoSource, PromoSourceInput, RadarTestResult } from '../lib/types';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, Toggle, useAction, useDialogs, useLoad } from '../ui/ui';
import { ChannelTag } from '../ui/badges';
import { ProductImage } from '../ui/ProductImage';
import { ActionBanner, useIntAction } from '../components/integrations';

const PLATFORMS = ['mercadolivre', 'shopee', 'amazon', 'aliexpress'] as const;
const STATUS: Record<CapturedLink['status'], { label: string; tone?: 'ok' | 'warn' | 'bad' | 'info' }> = {
  offer_created: { label: 'Oferta criada', tone: 'ok' }, duplicate: { label: 'Já na fila', tone: 'info' }, ineligible: { label: 'Fora do seu programa', tone: 'warn' },
  filtered: { label: 'Filtrada', tone: 'warn' }, ignored: { label: 'Ignorada' }, error: { label: 'Erro', tone: 'bad' }, new: { label: 'Nova' },
};
const DEFAULTS: PromoSourceInput = { enabled: true, mode: 'review', platforms: [], min_discount_pct: null, blocked_words: [], max_per_hour: 20, notes: null };
type Target = { id: string; title: string; channel: Channel; kind?: Chat['kind']; we_are_admin?: boolean };

/** Cola um link de promoção e vê, etapa por etapa, o que o Radar faria com ele (nada é criado). */
function LinkTester() {
  const [url, setUrl] = useState(''); const act = useIntAction(); const r = act.result as unknown as RadarTestResult | null;
  return (
    <Card title="Testar um link">
      <div className="col">
        <div className="small muted">Cole o link de uma promoção (pode ser encurtado). O Radar segue o link até a loja, consulta o produto na API e mostra se dá para gerar o <b>seu</b> link de afiliado. Nada é criado.</div>
        <div className="row"><input aria-label="Link da promoção" style={{ flex: 1, minWidth: 0 }} placeholder="https://s.shopee.com.br/…  ou  https://amzn.to/…  ou  https://meli.la/…" value={url} onChange={(e) => setUrl(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter' && url) act.start('worker', 'radar_test', { url }, 'Testando o link'); }} />
          <Button variant="primary" icon={<Search size={14} />} busy={act.running} disabled={!/^https?:\/\//i.test(url)} onClick={() => act.start('worker', 'radar_test', { url }, 'Testando o link')}>Testar</Button></div>
        <ActionBanner act={act} okText={() => ''} />
        {act.job?.status === 'done' && r && <div className="col" style={{ gap: 8 }}>
          {r.steps.map((s) => <div key={s.label} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>{s.ok ? <Check size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} /> : <XCircle size={16} style={{ color: 'var(--bad)', flex: 'none', marginTop: 2 }} />}<div><b>{s.label}</b><div className="small muted">{s.detail}</div></div></div>)}
          {r.item && <div className="prod"><ProductImage src={r.item.image} size={56} /><div style={{ minWidth: 0, flex: 1 }}><b className="truncate" style={{ display: 'block' }}>{r.item.title}</b><div className="row wrap small" style={{ gap: 8 }}><b>{money(r.item.price)}</b>{r.item.previous && <s className="muted">{money(r.item.previous)}</s>}{r.item.discount_pct ? <Badge tone="ok">−{Math.round(r.item.discount_pct)}%</Badge> : null}{r.item.commission_pct != null && <Badge tone="info">comissão {r.item.commission_pct}%</Badge>}</div></div></div>}
          <Badge tone={r.ok ? 'ok' : 'warn'}>{r.ok ? 'O Radar criaria uma oferta com o seu link' : 'O Radar descartaria este link'}</Badge>
        </div>}
      </div>
    </Card>);
}

/** Configuração de um grupo monitorado: o que fazer com o que for encontrado, quais lojas, filtros e limites. */
function SourceModal({ chat, src, onClose, onSaved }: { chat: Target; src?: PromoSource; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Required<Omit<PromoSourceInput, 'notes'>> & { notes: string }>({
    enabled: src?.enabled ?? true, mode: src?.mode ?? 'review', platforms: src?.platforms ?? [], min_discount_pct: src?.min_discount_pct ?? null,
    blocked_words: src?.blocked_words ?? [], max_per_hour: src?.max_per_hour ?? 20, notes: src?.notes ?? '' });
  const [word, setWord] = useState(''); const { run, busy } = useAction();
  const addWord = () => { const w = word.trim().toLowerCase(); if (w.length < 2 || f.blocked_words.includes(w) || f.blocked_words.length >= 40) return; setF({ ...f, blocked_words: [...f.blocked_words, w] }); setWord(''); };
  const save = async () => { if (await run('s', () => api().savePromoSource(chat.id, { ...f, notes: f.notes || null }), 'Monitoramento salvo')) { onSaved(); onClose(); } };
  const wa = chat.channel === 'whatsapp'; const admin = src?.we_are_admin ?? chat.we_are_admin;
  return (
    <Modal wide title="Monitorar grupo" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={busy === 's'} onClick={save}>Salvar</Button></>}>
      <div className="col">
        <div className="row" style={{ gap: 12 }}><Avatar name={chat.title} /><div style={{ minWidth: 0, flex: 1 }}><b className="truncate" style={{ display: 'block' }}>{chat.title}</b><div className="small muted"><ChannelTag c={chat.channel} /> {chat.kind === 'channel' ? 'canal' : 'grupo'}</div></div>
          <div className="row"><Toggle label="Monitoramento ativo" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span className="small">{f.enabled ? 'Ativo' : 'Pausado'}</span></div></div>
        {wa
          ? <div className="alert info small"><div><b>WhatsApp:</b> o número conectado precisa estar <b>dentro</b> deste grupo para ler as mensagens. As mensagens só chegam se o webhook estiver configurado (Configurações → WhatsApp).</div></div>
          : <div className={`alert ${admin ? 'info' : 'warning'} small`}><div><b>Telegram:</b> {admin ? 'o bot é administrador deste chat, então lê todas as mensagens.' : 'o bot só lê tudo se for administrador do grupo ou se o modo de privacidade estiver desligado (@BotFather → /setprivacy → Disable). Sem isso, ele só vê comandos e menções.'}</div></div>}
        <div className="col" style={{ gap: 6 }}><span style={{ fontWeight: 650 }}>O que fazer com as ofertas encontradas</span>
          <div className="grid g2">
            <button type="button" className={`optcard${f.mode === 'review' ? ' on' : ''}`} aria-pressed={f.mode === 'review'} onClick={() => setF({ ...f, mode: 'review' })}><b>Revisar antes (recomendado)</b><span className="small muted">Tudo cai na Fila de aprovação e você decide.</span></button>
            <button type="button" className={`optcard${f.mode === 'auto' ? ' on' : ''}`} aria-pressed={f.mode === 'auto'} onClick={() => setF({ ...f, mode: 'auto' })}><b>Aprovar sozinho</b><span className="small muted">Ofertas com nota alta seguem direto (ajuste em Automação).</span></button>
          </div></div>
        <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Lojas aceitas</div><div className="row wrap" style={{ gap: 6 }}>{PLATFORMS.map((p) => <button key={p} type="button" className="chip" aria-pressed={f.platforms.includes(p)} onClick={() => setF({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] })}>{platformName[p]}</button>)}</div>
          <div className="small muted" style={{ marginTop: 4 }}>{f.platforms.length ? 'Só estas lojas.' : 'Nenhuma marcada = todas as lojas com conector ligado.'}</div></div>
        <div className="grid g2">
          <Field label="Desconto mínimo (%)" hint="Vazio = usa o do conector da loja."><input type="number" min={0} max={95} value={f.min_discount_pct ?? ''} onChange={(e) => setF({ ...f, min_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Máx. ofertas por hora" hint="Protege a fila contra um grupo muito ativo."><input type="number" min={1} max={200} value={f.max_per_hour} onChange={(e) => setF({ ...f, max_per_hour: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Palavras bloqueadas no título" hint="Se o título do produto na loja tiver alguma, a oferta é descartada (ex.: réplica, usado).">
          <div className="col" style={{ gap: 8 }}><div className="row wrap" style={{ gap: 6 }}>{f.blocked_words.map((w) => <Badge key={w} tone="accent">{w}<button type="button" aria-label={`Remover ${w}`} className="xbtn" onClick={() => setF({ ...f, blocked_words: f.blocked_words.filter((x) => x !== w) })}><X size={11} /></button></Badge>)}</div>
            <div className="row"><input aria-label="Nova palavra bloqueada" placeholder="ex.: réplica" value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWord(); } }} style={{ flex: 1, minWidth: 0 }} /><Button icon={<Plus size={14} />} disabled={word.trim().length < 2} onClick={addWord}>Adicionar</Button></div></div></Field>
        <Field label="Observações"><input value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>);
}

/** Lista os grupos e canais conhecidos do canal escolhido e deixa ligar/desligar o monitoramento de cada um. */
function GroupPicker({ channel, sources, isAdmin, onEdit, onChanged }: { channel: Channel; sources: PromoSource[]; isAdmin: boolean; onEdit: (t: Target, s?: PromoSource) => void; onChanged: () => void }) {
  const chats = useLoad(() => api().listChats({ channel, kind: 'all' }), [channel], 15000);
  const { run } = useAction(); const { toast } = useDialogs();
  const [q, setQ] = useState(''); const [sel, setSel] = useState<Set<string>>(new Set()); const [only, setOnly] = useState<'all' | 'on' | 'off'>('all'); const [syncing, setSyncing] = useState(false);
  const bySrc = useMemo(() => new Map(sources.map((s) => [s.chat_id, s])), [sources]);
  const rows = useMemo(() => {
    const out: { t: Target; chat?: Chat; src?: PromoSource }[] = [];
    const seen = new Set<string>();
    for (const c of (chats.data ?? []).filter((x) => x.channel === channel && (x.kind === 'group' || x.kind === 'channel'))) { seen.add(c.id); out.push({ t: { id: c.id, title: c.title, channel: c.channel, kind: c.kind, we_are_admin: c.we_are_admin }, chat: c, src: bySrc.get(c.id) }); }
    for (const s of sources) if (!seen.has(s.chat_id)) out.push({ t: { id: s.chat_id, title: s.title, channel: s.channel, kind: s.kind, we_are_admin: s.we_are_admin }, src: s });
    return out.filter((r) => (!q || r.t.title.toLowerCase().includes(q.toLowerCase())) && (only === 'all' || (only === 'on') === !!r.src?.enabled))
      .sort((a, b) => Number(!!b.src?.enabled) - Number(!!a.src?.enabled) || a.t.title.localeCompare(b.t.title));
  }, [chats.data, sources, bySrc, q, only, channel]);
  const free = rows.filter((r) => !r.src && !r.chat?.destination_id);
  const toggle = async (r: (typeof rows)[number]) => {
    if (r.src) { if (await run('t' + r.t.id, () => api().savePromoSource(r.t.id, { enabled: !r.src!.enabled, mode: r.src!.mode, platforms: r.src!.platforms, min_discount_pct: r.src!.min_discount_pct, blocked_words: r.src!.blocked_words, max_per_hour: r.src!.max_per_hour, notes: r.src!.notes }), r.src.enabled ? 'Monitoramento pausado' : 'Monitorando')) onChanged(); }
    else if (await run('t' + r.t.id, () => api().savePromoSource(r.t.id, DEFAULTS), 'Agora monitorando este grupo')) { onChanged(); onEdit(r.t); }
  };
  const bulk = async () => {
    const ids = [...sel]; let ok = 0;
    for (const id of ids) { try { await api().savePromoSource(id, DEFAULTS); ok++; } catch { /* segue com os demais */ } }
    toast(`${ok} grupo(s) em monitoramento`, ok ? 'ok' : 'err'); setSel(new Set()); onChanged();
  };
  const sync = async () => {
    setSyncing(true);
    try { await api().requestGroupRefresh(channel); toast('Buscando os grupos no ' + channelName[channel] + '…', 'info'); setTimeout(() => { void chats.reload(); setSyncing(false); }, 6000); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); setSyncing(false); }
  };
  const on = sources.filter((s) => s.enabled).length;
  return (
    <Card title={`Grupos do ${channelName[channel]}`} actions={<Badge tone={on ? 'ok' : undefined}>{on} monitorado(s)</Badge>} flush>
      <div className="col" style={{ padding: 14, gap: 12 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="row" style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={15} style={{ position: 'absolute', left: 11, color: 'var(--muted)' }} /><input aria-label="Buscar grupo" placeholder="Buscar grupo pelo nome…" style={{ paddingLeft: 34, width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Seg value={only} onChange={setOnly} options={[{ v: 'all', label: 'Todos' }, { v: 'on', label: 'Monitorados' }, { v: 'off', label: 'Não monitorados' }]} />
          {isAdmin && <Button icon={<RefreshCw size={14} style={syncing ? { animation: 'sp .7s linear infinite' } : undefined} />} disabled={syncing} onClick={sync}>Sincronizar grupos</Button>}
        </div>
        {isAdmin && sel.size > 0 && <div className="alert info" style={{ alignItems: 'center' }}><div style={{ flex: 1 }}><b>{sel.size}</b> grupo(s) selecionado(s)</div><Button size="sm" onClick={() => setSel(new Set())}>Limpar</Button><Button size="sm" variant="primary" icon={<Eye size={14} />} onClick={bulk}>Monitorar selecionados</Button></div>}
        {isAdmin && sel.size === 0 && free.length > 1 && <div className="small"><button type="button" className="linkbtn" onClick={() => setSel(new Set(free.map((r) => r.t.id)))}>Selecionar todos os {free.length} não monitorados</button></div>}
        {chats.loading && !chats.data ? <Loading /> : chats.error ? <ErrorBox error={chats.error} retry={chats.reloadLoud} /> : rows.length === 0 ?
          <Empty icon={<Users size={30} />}>{(chats.data ?? []).length ? 'Nenhum grupo com esse filtro.' : `Nenhum grupo do ${channelName[channel]} conhecido ainda. Conecte o ${channelName[channel]} e clique em “Sincronizar grupos”.`}</Empty> :
          <div className="srcgrid">{rows.map((r) => {
            const dest = !!r.chat?.destination_id; const sOn = !!r.src?.enabled; const busy = false;
            return (
              <div key={r.t.id} className={`srccard${sOn ? ' on' : ''}`}>
                {isAdmin && !r.src && !dest && <input type="checkbox" aria-label={`Selecionar ${r.t.title}`} checked={sel.has(r.t.id)} onChange={(e) => setSel((p) => { const n = new Set(p); if (e.target.checked) n.add(r.t.id); else n.delete(r.t.id); return n; })} style={{ marginTop: 10 }} />}
                <Avatar name={r.t.title} />
                <div className="grow">
                  <div className="nm" title={r.t.title}>{r.t.title}</div>
                  <div className="small muted">{r.chat?.participant_count != null ? `${r.chat.participant_count} participantes` : r.t.kind === 'channel' ? 'canal' : 'grupo'}{channel === 'telegram' && r.t.we_are_admin ? ' · bot é admin' : ''}</div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {dest ? <Badge tone="info">é um destino seu</Badge> : sOn ? <Badge tone="ok"><Eye size={11} /> monitorando</Badge> : r.src ? <Badge tone="warn"><EyeOff size={11} /> pausado</Badge> : <Badge>não monitorado</Badge>}
                    {r.src && sOn && <span className="small muted">{r.src.seen_7d} links · {r.src.offers_7d} ofertas (7 d)</span>}
                  </div>
                  {isAdmin && !dest && r.src && <div style={{ marginTop: 8 }}><Button size="sm" icon={<Pencil size={13} />} onClick={() => onEdit(r.t, r.src)}>Configurar</Button></div>}
                </div>
                {isAdmin && !dest && <Toggle label={`Monitorar ${r.t.title}`} checked={sOn} disabled={busy} onChange={() => void toggle(r)} />}
              </div>);
          })}</div>}
      </div>
    </Card>);
}

export default function Radar() {
  const { isAdmin } = useSession();
  const sources = useLoad(() => api().listPromoSources(), [], 20000); const links = useLoad(() => api().listCapturedLinks(100), [], 20000);
  const cfg = useLoad(() => api().getSettings(), [], 30000);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [edit, setEdit] = useState<{ chat: Target; src?: PromoSource } | null>(null);
  const list = sources.data ?? []; const reload = () => { void sources.reload(); void links.reload(); };
  const tot = list.reduce((a, s) => ({ seen: a.seen + s.seen_7d, offers: a.offers + s.offers_7d, pub: a.pub + s.published_7d, clicks: a.clicks + s.clicks_7d }), { seen: 0, offers: 0, pub: 0, clicks: 0 });
  const waState = String((cfg.data?.int_status_evolution as { state?: string } | undefined)?.state ?? '');
  const tgOk = (cfg.data?.int_status_telegram as { ok?: boolean } | undefined)?.ok === true;
  const off = !!cfg.data && (channel === 'whatsapp' ? waState !== 'open' : !tgOk);
  const mine = list.filter((s) => s.channel === channel);
  const cnt = (c: Channel) => list.filter((s) => s.channel === c && s.enabled).length;
  return (
    <>
      <PageHead title="Monitorar grupos" sub="Escolha os grupos do WhatsApp e do Telegram de onde o Radar vai pegar promoções. O link é trocado pelo seu de afiliado (só se o produto estiver no seu programa) e a oferta vai para a fila de aprovação." />
      <div className="grid g4" style={{ marginBottom: 14 }}>
        {[['Links vistos (7 d)', tot.seen], ['Ofertas criadas', tot.offers], ['Publicadas', tot.pub], ['Cliques', tot.clicks]].map(([k, v]) => <div key={String(k)} className="card stat"><div className="k">{k}</div><div className="v">{v}</div></div>)}
      </div>
      <div className="col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <Seg value={channel} onChange={setChannel} options={[{ v: 'whatsapp', label: `WhatsApp (${cnt('whatsapp')})` }, { v: 'telegram', label: `Telegram (${cnt('telegram')})` }]} />
        </div>
        {off && <div className="alert warning" role="status"><div><b>{channel === 'whatsapp' ? 'O WhatsApp não está conectado.' : 'O Telegram não está conectado.'}</b> Sem isso o Radar não recebe as mensagens dos grupos. <Link to="/configuracoes">Abrir Configurações</Link> e use o botão “Conectar”.</div></div>}
        {channel === 'telegram' && <div className="alert info small"><div><b>Grupo ou canal em que você não consegue colocar o bot?</b> Encaminhe as mensagens dele para o seu bot (conversa privada). Cada origem aparece aqui como “↪ nome do grupo”, e você liga o Radar nela como em qualquer outro grupo.</div></div>}
        <GroupPicker channel={channel} sources={mine} isAdmin={isAdmin} onChanged={reload} onEdit={(t, s) => setEdit({ chat: t, src: s })} />
        <LinkTester />
        <Card title="Últimos links capturados" actions={<Link to="/revisao" className="small">Abrir fila de aprovação</Link>} flush>
          {links.loading && !links.data ? <Loading /> : (links.data ?? []).length === 0 ? <div className="empty">Nada capturado ainda. Quando alguém postar um link de loja num grupo monitorado, ele aparece aqui com o resultado.</div> :
            <div className="tablewrap"><table><thead><tr><th>Produto</th><th>Quando</th><th>Fonte</th><th>Resultado</th><th>Motivo</th></tr></thead>
              <tbody>{(links.data ?? []).map((l) => <tr key={l.id}>
                <td><div className="row" style={{ gap: 10 }}><ProductImage src={l.image_url} size={40} />{l.product_title ? <div style={{ minWidth: 0 }}><div className="truncate" style={{ maxWidth: 260 }}>{l.product_title}</div>{l.score != null && <div className="small muted">nota {l.score}</div>}</div> : <span className="muted small truncate" style={{ display: 'inline-block', maxWidth: 220 }}>{l.original_url}</span>}</div></td>
                <td className="nowrap small">{ago(l.created_at)}</td><td className="small">{l.source_title ?? '—'}{l.channel && <span className="muted"> · {channelName[l.channel]}</span>}</td>
                <td><Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge></td><td className="small muted" style={{ maxWidth: 300 }}>{l.reason ?? '—'}</td></tr>)}</tbody></table></div>}
        </Card>
        <div className="alert warning small"><CircleAlert size={15} style={{ flex: 'none', marginTop: 2 }} /><div>Use o Radar com responsabilidade: o texto e a imagem da mensagem original <b>não são copiados</b> (a oferta é refeita com os dados da loja), e só entra produto do seu programa de afiliados. Confira os termos de cada programa e, no WhatsApp, prefira um número dedicado e limites baixos.</div></div>
      </div>
      {edit && <SourceModal chat={edit.chat} src={edit.src} onClose={() => setEdit(null)} onSaved={reload} />}
    </>);
}
