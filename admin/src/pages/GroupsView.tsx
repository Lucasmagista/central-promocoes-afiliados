import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Eye, MessageCircle, Plus, RefreshCw, Search, Send, Settings2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { int } from '../lib/format';
import type { Channel, Chat } from '../lib/types';
import GroupManager from '../components/GroupManager';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Loading, Pager, Th, useAction, useJob, useLoad, useTable } from '../ui/ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Visão em tabela de todos os grupos e canais do WhatsApp/Telegram: função, tamanho, destino e atividade. */
export default function GroupsView({ channel, onOpen }: { channel: Channel; onOpen: (chatId: string) => void }) {
  const { canOperate, isAdmin } = useSession();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'admin' | 'member' | 'linked' | 'free'>('all');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const list = useLoad(() => api().listChats({ channel, kind: 'all', q }), [channel, q, job?.status], 6000);
  const rows = (list.data ?? []).filter((c) => c.kind !== 'private').filter((c) =>
    filter === 'admin' ? c.we_are_admin : filter === 'member' ? !c.we_are_admin : filter === 'linked' ? !!c.destination_id : filter === 'free' ? !c.destination_id : true);
  const t = useTable<Chat>(rows, { title: (c) => c.title, members: (c) => c.participant_count, role: (c) => (c.we_are_admin ? 1 : 0), dest: (c) => c.destination_name, last: (c) => (c.last_message_at ? -new Date(c.last_message_at).getTime() : null), unread: (c) => c.unread_count }, { key: 'title', dir: 'asc' }, 12);
  const all = (list.data ?? []).filter((c) => c.kind !== 'private');
  const [manage, setManage] = useState<Chat | null>(null);
  const running = !!job && ['pending', 'claimed'].includes(job.status);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid g4">
        {[['Grupos e canais', all.length], ['Onde somos administradores', all.filter((c) => c.we_are_admin).length], ['Já são destino de ofertas', all.filter((c) => c.destination_id).length], ['Pessoas alcançadas', all.reduce((a, c) => a + (c.participant_count ?? 0), 0)]].map(([k, v]) => (
          <div key={k as string} className="card stat"><div className="small muted" style={{ fontWeight: 600 }}>{k}</div><div className="v">{int(v as number)}</div></div>))}
      </div>
      <Card flush>
        <div className="tools">
          <div className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} /><input aria-label="Buscar grupo" placeholder="Buscar grupo" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="pill-list">{([['all', 'Todos'], ['admin', 'Sou admin'], ['member', 'Sou membro'], ['linked', 'Com destino'], ['free', 'Sem destino']] as const).map(([v, l]) => <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}</div>
          {canOperate && <Button className="right" icon={<RefreshCw size={15} />} busy={busy === 'r' || running} onClick={async () => { let id = ''; if (await run('r', async () => { id = await api().requestGroupRefresh(channel); })) setJobId(id); }}>
            {running ? 'Buscando no aplicativo…' : 'Buscar grupos no aplicativo'}</Button>}
        </div>
        {job?.status === 'done' && <div className="alert info" style={{ margin: 12 }}>Busca concluída: {String((job.result as { groups?: number } | null)?.groups ?? 0)} grupos e canais conhecidos.</div>}
        {job?.status === 'failed' && <div style={{ padding: 12 }}><ErrorBox error={job.last_error ?? 'A busca falhou'} /></div>}
        {list.loading && !list.data ? <Loading /> : list.error ? <div style={{ padding: 16 }}><ErrorBox error={list.error} retry={list.reloadLoud} /></div> : t.total === 0 ? <Empty icon={<Users size={30} />}>Nenhum grupo com esses filtros. Use “Buscar grupos no aplicativo” para sincronizar o que já existe no celular.</Empty> : <>
          <div className="tablewrap"><table><thead><tr><Th t={t} k="title">Grupo ou canal</Th><Th t={t} k="members">Participantes</Th><Th t={t} k="role">Nossa função</Th><Th t={t} k="dest">Destino de ofertas</Th><Th t={t} k="last">Última atividade</Th><Th t={t} k="unread">Não lidas</Th><th /></tr></thead>
            <tbody>{t.rows.map((c) => (
              <tr key={c.id}>
                <td><div className="row"><Avatar name={c.title} square /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 650 }} className="truncate">{c.title}</div><div className="small muted truncate">{c.kind === 'channel' ? 'Canal' : 'Grupo'}{c.username ? ` · @${c.username}` : ''}</div></div></div></td>
                <td>{c.participant_count != null ? int(c.participant_count) : '—'}</td>
                <td>{c.we_are_admin ? <Badge tone="ok"><Crown size={12} />administrador</Badge> : <Badge><Eye size={12} />membro</Badge>}</td>
                <td>{c.destination_name ? <Badge tone="accent"><Send size={11} />{c.destination_name}</Badge> : <span className="small muted">—</span>}</td>
                <td className="small nowrap">{when(c.last_message_at)}</td>
                <td>{c.unread_count > 0 ? <span className={`unread${c.muted ? ' muted' : ''}`}>{c.unread_count}</span> : <span className="muted">—</span>}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  <Button size="sm" icon={<MessageCircle size={14} />} onClick={() => onOpen(c.id)}>Abrir</Button>
                  {isAdmin && <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setManage(c)}>Gerenciar</Button>}
                  {isAdmin && !c.destination_id && c.we_are_admin && <Link className="btn sm" to={`/destinos?novo=${c.id}`} target="_blank"><Plus size={14} />Usar como destino</Link>}
                </div></td>
              </tr>))}</tbody></table></div>
          <Pager t={t} label="grupos" /></>}
      </Card>
      {manage && <GroupManager channel={manage.channel} externalId={manage.external_id} title={manage.title} canEdit={isAdmin} onClose={() => setManage(null)} onChanged={() => void list.reload()} />}
    </div>);
}
