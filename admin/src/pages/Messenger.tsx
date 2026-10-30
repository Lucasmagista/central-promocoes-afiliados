import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, BellOff, Bell, Hash, Info, Link2, Lock, MessageCircle, Megaphone, Send, Users, X, Clock, ExternalLink, Search, ShieldCheck, Settings2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { previewHtml } from '../lib/template';
import { channelName, int } from '../lib/format';
import type { Channel, Chat, ChatKind, ChatMessage } from '../lib/types';
import GroupManager from '../components/GroupManager';
import { Avatar, Badge, Button, Empty, ErrorBox, Kbd, Loading, useAction, useDialogs, useLoad } from '../ui/ui';

const TZ = 'America/Sao_Paulo';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
function dayLabel(iso: string) {
  const k = dayKey(iso), today = dayKey(new Date().toISOString()), y = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (k === today) return 'Hoje'; if (k === y) return 'Ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: 'long' });
}
const listTime = (iso: string | null) => !iso ? '' : dayKey(iso) === dayKey(new Date().toISOString()) ? hhmm(iso) : new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });

function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a> : <Fragment key={i}>{p}</Fragment>)}</>;
}

const KINDS: Record<ChatKind, { label: string; icon: React.ReactNode }> = {
  group: { label: 'Grupo', icon: <Users size={13} /> }, channel: { label: 'Canal', icon: <Megaphone size={13} /> }, private: { label: 'Privada', icon: <Lock size={13} /> },
};
const kindFilters = (c: Channel): { v: ChatKind | 'all'; label: string }[] => c === 'telegram'
  ? [{ v: 'all', label: 'Todas' }, { v: 'channel', label: 'Canais' }, { v: 'group', label: 'Grupos' }, { v: 'private', label: 'Privadas' }]
  : [{ v: 'all', label: 'Todas' }, { v: 'group', label: 'Grupos' }, { v: 'private', label: 'Privadas' }];

function Stat({ k, v }: { k: string; v: string }) { return <div style={{ minWidth: 0 }}><div className="small muted">{k}</div><div style={{ fontFamily: 'var(--display)', fontWeight: 650, fontSize: 20 }}>{v}</div></div>; }

export default function Messenger({ channel, full }: { channel: Channel; full?: boolean }) {
  const { canOperate, isAdmin } = useSession();
  const { confirm } = useDialogs();
  const { run, busy } = useAction();
  const [sp, setSp] = useSearchParams();
  const [kind, setKind] = useState<ChatKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const [info, setInfo] = useState(true);
  const [manage, setManage] = useState(false);
  const [text, setText] = useState('');
  const [pq, setPq] = useState('');
  const selId = sp.get('c');
  const pick = (id: string | null, replace = false) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('c', id); else n.delete('c'); return n; }, { replace });
  const [find, setFind] = useState('');
  const reset = useRef(channel);
  useEffect(() => { if (reset.current !== channel) { reset.current = channel; setKind('all'); setQ(''); setUnreadOnly(false); setArchived(false); setText(''); pick(null, true); } }, [channel]);

  const ov = useLoad(() => api().channelOverview(channel), [channel], 5000);
  const list = useLoad(() => api().listChats({ channel, kind, q, archived, unreadOnly }), [channel, kind, q, archived, unreadOnly], 4000);
  const dests = useLoad(() => api().listDestinations(), []);
  const chats = (list.data ?? []).filter((c) => c.channel === channel);   // a lista antiga do outro canal não pode ser usada enquanto a nova carrega
  const sel = chats.find((c) => c.id === selId) ?? null;
  const detail = useLoad(() => (selId ? api().getChat(selId) : Promise.resolve(null)), [selId], 5000);
  const msgs = useLoad(() => (selId ? api().listMessages(selId) : Promise.resolve([] as ChatMessage[])), [selId], 3000);
  const chat: Chat | null = (detail.data?.chat && detail.data.chat.channel === channel ? detail.data.chat : null) ?? sel;

  // selecionar a primeira conversa por padrão (desktop) e marcar como lida ao abrir
  useEffect(() => { if (!selId && chats.length && window.innerWidth > 860) pick(chats[0].id, true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, selId]);
  const lastLen = useRef(0);
  const stream = useRef<HTMLDivElement>(null);
  const unread = chat?.unread_count ?? 0;
  useEffect(() => { if (selId && unread > 0) void api().markChatRead(selId).then(() => { void list.reload(); void ov.reload(); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, unread]);
  useEffect(() => { lastLen.current = 0; setFind(''); }, [selId]);
  useEffect(() => {
    const n = msgs.data?.length ?? 0;
    if (n !== lastLen.current && stream.current) { stream.current.scrollTop = stream.current.scrollHeight; lastLen.current = n; }
  }, [msgs.data]);

  const pending = detail.data?.outbox.filter((o) => o.status === 'pending' || o.status === 'claimed') ?? [];
  const failed = detail.data?.outbox.filter((o) => o.status === 'failed') ?? [];
  const limit = channel === 'telegram' ? 4096 : 4000;
  const blocked = chat?.kind === 'channel' && !chat.we_are_admin;
  const send = async () => {
    if (!selId || !text.trim()) return;
    if (await run('send', () => api().queueChatMessage(selId, text), 'Mensagem na fila de envio')) { setText(''); void detail.reload(); }
  };

  const shown = useMemo(() => (find.trim() ? (msgs.data ?? []).filter((m) => (m.body + ' ' + (m.sender_name ?? '')).toLowerCase().includes(find.trim().toLowerCase())) : (msgs.data ?? [])), [msgs.data, find]);
  const groupsByDay = useMemo(() => {
    const out: { day: string; items: ChatMessage[] }[] = [];
    for (const m of shown) { const k = dayKey(m.sent_at); const g = out[out.length - 1]; if (g && g.day === k) g.items.push(m); else out.push({ day: k, items: [m] }); }
    return out;
  }, [shown]);
  const people = (detail.data?.participants ?? []).filter((p) => !pq || (p.display_name ?? p.external_id).toLowerCase().includes(pq.toLowerCase()));
  const o = ov.data;
  const title = channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';

  return (
    <>
      {!full && <div className="pagehead"><div><h1>{title}</h1><p>{channel === 'whatsapp' ? 'Grupos e conversas do número dedicado. Respostas manuais respeitam a pausa global.' : 'Canais, grupos e conversas dos seus bots. Respostas manuais respeitam a pausa global.'}</p></div>
        <div className="right row wrap" style={{ gap: 22 }}>
          <Stat k="Grupos e canais" v={o ? int(o.groups) : '—'} /><Stat k="Participantes" v={o ? int(o.participants) : '—'} />
          <Stat k="Recebidas (24 h)" v={o ? int(o.messages_in_24h) : '—'} /><Stat k="Enviadas (24 h)" v={o ? int(o.messages_out_24h) : '—'} />
          <Stat k="Na fila de envio" v={o ? int(o.outbox_pending) : '—'} />
          <a className="btn" href={`#/conversas?canal=${channel}${selId ? `&c=${selId}` : ''}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />Tela cheia em nova aba</a></div></div>}

      <section className={`card msgr${full ? ' full' : ''}${selId ? ' show-convo' : ''}${info ? '' : ' noinfo'}`}>
        {/* lista */}
        <div className="clist">
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, color: 'var(--muted)' }} />
              <input aria-label="Buscar conversa" placeholder="Buscar conversa" style={{ paddingLeft: 34 }} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="pill-list">
              {kindFilters(channel).map((f) => <button key={f.v} className="chip" aria-pressed={kind === f.v} onClick={() => setKind(f.v)}>{f.label}</button>)}
              <button className="chip" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>Não lidas</button>
              <button className="chip" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={13} />Arquivadas</button>
            </div>
          </div>
          <div className="items">
            {list.loading && !list.data ? <Loading /> : list.error ? <div style={{ padding: 12 }}><ErrorBox error={list.error} retry={list.reloadLoud} /></div> : chats.length === 0 ?
              <Empty icon={<MessageCircle size={28} />}>{archived ? 'Nenhuma conversa arquivada.' : unreadOnly ? 'Nada não lido. Bom sinal.' : 'Nenhuma conversa ainda. Elas aparecem quando o worker começar a enviar os webhooks.'}</Empty> :
              chats.map((c) => (
                <div key={c.id} className="citem" role="button" tabIndex={0} aria-current={c.id === selId} onClick={() => pick(c.id)} onKeyDown={(e) => e.key === 'Enter' && pick(c.id)}>
                  <Avatar name={c.title} square={c.kind !== 'private'} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6 }}><span className="tt truncate" style={{ flex: 1 }}>{c.title}</span><span className="small muted nowrap">{listTime(c.last_message_at)}</span></div>
                    <div className="row" style={{ gap: 6 }}><span className="pv truncate" style={{ flex: 1 }}>{c.last_message_preview ?? 'Sem mensagens'}</span>
                      {c.muted && <BellOff size={13} color="var(--muted)" />}{c.unread_count > 0 && <span className={`unread${c.muted ? ' muted' : ''}`}>{c.unread_count}</span>}</div>
                    {(c.destination_name || c.kind !== 'private') && <div className="row" style={{ gap: 5, marginTop: 3 }}><span className="small muted row" style={{ gap: 3 }}>{KINDS[c.kind].icon}{KINDS[c.kind].label}</span>{c.destination_name && <Badge tone="accent"><Send size={10} />destino</Badge>}</div>}
                  </div>
                </div>))}
          </div>
        </div>

        {/* conversa */}
        <div className="convo">
          {!chat ? <Empty icon={<MessageCircle size={34} />}>Escolha uma conversa à esquerda para ler as mensagens.</Empty> : <>
            <div className="head">
              <Button className="menu" variant="ghost" aria-label="Voltar para a lista" onClick={() => pick(null)} icon={<ArrowLeft size={18} />} style={{ display: window.innerWidth <= 860 ? 'inline-flex' : 'none' }} />
              <Avatar name={chat.title} square={chat.kind !== 'private'} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}><h2 className="truncate" style={{ fontSize: 16 }}>{chat.title}</h2><Badge>{KINDS[chat.kind].icon}{KINDS[chat.kind].label}</Badge></div>
                <div className="small muted truncate">{chat.participant_count != null && chat.kind !== 'private' ? `${int(chat.participant_count)} participantes · ` : ''}{chat.username ? `@${chat.username} · ` : ''}{chat.we_are_admin ? 'somos administradores' : 'somos membros'}</div>
              </div>
              <div className="row hide-sm" style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 9, color: 'var(--muted)' }} /><input aria-label="Buscar na conversa" placeholder="Buscar na conversa" value={find} onChange={(e) => setFind(e.target.value)} style={{ paddingLeft: 28, width: full ? 220 : 150, minHeight: 34 }} /></div>
              {canOperate && <>
                <Button size="sm" variant="ghost" aria-label={chat.muted ? 'Reativar notificações' : 'Silenciar'} title={chat.muted ? 'Reativar notificações' : 'Silenciar'} icon={chat.muted ? <Bell size={16} /> : <BellOff size={16} />}
                  onClick={async () => { if (await run('f', () => api().setChatFlags(chat.id, { muted: !chat.muted }))) void Promise.all([list.reload(), detail.reload()]); }} />
                <Button size="sm" variant="ghost" aria-label={chat.archived ? 'Desarquivar' : 'Arquivar'} title={chat.archived ? 'Desarquivar' : 'Arquivar'} icon={chat.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  onClick={async () => { if (await run('f', () => api().setChatFlags(chat.id, { archived: !chat.archived }), chat.archived ? 'Conversa desarquivada' : 'Conversa arquivada')) { pick(null); void list.reload(); } }} /></>}
              <Button size="sm" variant="ghost" aria-label="Informações da conversa" aria-pressed={info} onClick={() => setInfo(!info)} icon={<Info size={16} />} />
            </div>
            <div className="stream" ref={stream} tabIndex={0} aria-label="Mensagens" aria-live="polite">
              {msgs.loading && !msgs.data ? <Loading /> : msgs.error ? <ErrorBox error={msgs.error} retry={msgs.reloadLoud} /> : groupsByDay.length === 0 ? <Empty icon={<MessageCircle size={28} />}>Sem mensagens nesta conversa.</Empty> :
                groupsByDay.map((g) => <Fragment key={g.day}><div className="daysep">{dayLabel(g.items[0].sent_at)}</div>
                  {g.items.map((m, i) => { const prev = g.items[i - 1]; const showWho = m.direction === 'in' && (!prev || prev.sender_name !== m.sender_name || prev.direction !== 'in');
                    return <div key={m.id} className={`msg ${m.direction}${m.kind === 'offer' ? ' offer' : ''}`}>
                      {m.kind === 'offer' && <div className="row small" style={{ gap: 6, marginBottom: 4, fontWeight: 650 }}><Badge tone="accent">Oferta publicada</Badge>{m.publication_id && <Link to="/publicacoes" className="row" style={{ gap: 3 }}>ver envio <ExternalLink size={12} /></Link>}</div>}
                      {showWho && <div className="who" style={{ color: 'var(--link)' }}>{m.sender_name ?? m.sender_external_id}</div>}
                      {m.kind === 'offer' ? <div dangerouslySetInnerHTML={{ __html: previewHtml(m.body, channel) }} /> : <Linkify text={m.body} />}
                      <div className="at">{m.direction === 'out' && m.kind !== 'offer' && <span>{m.sender_name ?? 'Painel'}</span>}<span>{hhmm(m.sent_at)}</span></div></div>; })}</Fragment>)}
            </div>
            {pending.map((p) => <div key={p.id} className="queued"><Clock size={14} /><span className="truncate" style={{ flex: 1 }}>Na fila de envio: {p.body}</span>
              {p.status === 'pending' && <Button size="sm" variant="ghost" onClick={async () => { if (await run('c' + p.id, () => api().cancelOutbox(p.id), 'Envio cancelado')) void detail.reload(); }}>Cancelar</Button>}</div>)}
            {failed.map((p) => <div key={p.id} className="queued" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}><X size={14} /><span className="truncate" style={{ flex: 1 }}>Falhou: {p.body} — {p.last_error ?? 'erro desconhecido'}. Confira no {title} antes de tentar de novo.</span></div>)}
            {canOperate ? (
              <div className="composer">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <textarea aria-label="Escrever mensagem" rows={1} disabled={blocked} value={text} maxLength={limit} placeholder={blocked ? 'Somos apenas membros deste canal: não é possível publicar' : 'Escreva uma resposta (Ctrl+Enter envia)'}
                    onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
                  {text.length > limit * 0.8 && <div className="small muted">{text.length}/{limit}</div>}
                </div>
                <Button variant="primary" icon={<Send size={16} />} busy={busy === 'send'} disabled={blocked || !text.trim()} onClick={send}>Enviar</Button>
              </div>) : <div className="composer"><span className="small muted">Seu perfil é somente leitura: você pode acompanhar, mas não responder.</span></div>}
          </>}
        </div>

        {/* informações */}
        {info && chat && (
          <aside className="info" aria-label="Informações da conversa">
            <section>
              <div className="row"><Avatar name={chat.title} size="lg" square={chat.kind !== 'private'} /><div style={{ minWidth: 0 }}><h3 className="truncate">{chat.title}</h3><div className="small muted">{channelName[chat.channel]} · {KINDS[chat.kind].label}</div></div></div>
              {chat.description && <p className="small" style={{ margin: '12px 0 0' }}>{chat.description}</p>}
              {chat.kind !== 'private' && isAdmin && <Button style={{ marginTop: 12 }} icon={<Settings2 size={14} />} onClick={() => setManage(true)}>Gerenciar {chat.channel === 'whatsapp' ? 'grupo' : 'chat'}</Button>}
              <dl className="kv" style={{ gridTemplateColumns: '90px 1fr', marginTop: 12, fontSize: 12.5 }}>
                <dt>ID</dt><dd className="mono">{chat.external_id}</dd>{chat.username && <><dt>Usuário</dt><dd>@{chat.username}</dd></>}
                <dt>Participantes</dt><dd>{chat.participant_count != null ? int(chat.participant_count) : '—'}</dd>
                <dt>Permissão</dt><dd>{chat.we_are_admin ? <Badge tone="ok"><ShieldCheck size={12} />administrador</Badge> : <Badge>membro</Badge>}</dd>
              </dl>
            </section>
            <section>
              <h3 className="row"><Link2 size={15} />Destino de ofertas</h3>
              {chat.destination_id ? <div className="row" style={{ marginTop: 8 }}><Badge tone="accent"><Send size={11} />{chat.destination_name}</Badge><Link className="small right" to="/destinos">gerenciar</Link></div>
                : <p className="small muted" style={{ margin: '8px 0 0' }}>Esta conversa não recebe ofertas automáticas.</p>}
              {isAdmin && <select aria-label="Vincular destino" style={{ marginTop: 10 }} value={chat.destination_id ?? ''} disabled={busy === 'link'}
                onChange={async (e) => { const v = e.target.value || null; if (v && !(await confirm({ title: 'Vincular destino?', body: 'A conversa passa a ser o espelho deste destino: ofertas enviadas aparecem aqui.', confirmLabel: 'Vincular' }))) return;
                  if (await run('link', () => api().linkChatDestination(chat.id, v), 'Vínculo atualizado')) void Promise.all([detail.reload(), list.reload()]); }}>
                <option value="">Sem destino</option>{(dests.data ?? []).filter((d) => d.channel === chat.channel).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            </section>
            {chat.kind !== 'private' && <section>
              <h3 className="row"><Hash size={15} />Participantes</h3>
              {(detail.data?.participants.length ?? 0) === 0 ? <p className="small muted" style={{ margin: '8px 0 0' }}>A lista completa ainda não foi sincronizada pelo worker.</p> : <>
                <input aria-label="Buscar participante" placeholder="Buscar participante" style={{ margin: '10px 0' }} value={pq} onChange={(e) => setPq(e.target.value)} />
                <div className="col" style={{ gap: 8, maxHeight: 260, overflow: 'auto' }}>{people.map((p) => <div key={p.external_id} className="row"><Avatar name={p.display_name ?? p.external_id} size="sm" />
                  <span className="truncate" style={{ flex: 1 }}>{p.display_name ?? p.external_id}</span>{p.role !== 'member' && <Badge tone={p.role === 'owner' ? 'ok' : 'info'}>{p.role === 'owner' ? 'dono' : 'admin'}</Badge>}</div>)}
                  {people.length === 0 && <span className="small muted">Ninguém com esse nome.</span>}</div></>}
            </section>}
            <section><div className="small muted">Mensagens manuais passam pela mesma lista de termos proibidos das ofertas e ficam na auditoria. Mensagens antigas (exceto ofertas publicadas) são apagadas após o prazo de retenção.</div><div className="small muted" style={{ marginTop: 8 }}><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> envia a resposta.</div></section>
          </aside>)}
      </section>
      {manage && chat && <GroupManager channel={chat.channel} externalId={chat.external_id} title={chat.title} canEdit={isAdmin} onClose={() => setManage(false)} onChanged={() => { void detail.reload(); void list.reload(); }} />}
    </>);
}
