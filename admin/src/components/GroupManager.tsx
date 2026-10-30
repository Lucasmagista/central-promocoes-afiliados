import { useEffect, useRef, useState } from 'react';
import { Crown, Loader2, TriangleAlert, XCircle, LogOut, RefreshCw, Save, ShieldCheck, ShieldOff, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import type { Channel, ChatDetail, GroupAction, GroupActionResult } from '../lib/types';
import { Avatar, Badge, Button, Empty, Field, Modal, Tabs, Toggle, useDialogs, useJob } from '../ui/ui';
import { CopyBtn } from './integrations';


const EPH = [{ v: 0, l: 'Desligadas' }, { v: 86400, l: '24 horas' }, { v: 604800, l: '7 dias' }, { v: 7776000, l: '90 dias' }];
const digits = (v: string) => v.replace(/\D/g, '');

/** Executa uma ação de grupo pelo worker e acompanha a tarefa; quando termina, devolve o resultado. */
function useGroupCall(channel: Channel, externalId: string, onDone: (r: GroupActionResult, action: string) => void) {
  const { toast } = useDialogs();
  const [jobId, setJobId] = useState<string | null>(null); const [label, setLabel] = useState(''); const [starting, setStarting] = useState(false);
  const [since, setSince] = useState(0); const job = useJob(jobId); const act = useRef('');
  const start = async (action: GroupAction, params?: Record<string, unknown>, lbl = '') => {
    setStarting(true); setLabel(lbl); act.current = action;
    try { const id = await api().requestGroupAction(channel, externalId, action, params); setSince(Date.now()); setJobId(id); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    finally { setStarting(false); }
  };
  const doneId = useRef<string | null>(null);
  useEffect(() => { if (job?.status === 'done' && doneId.current !== job.id) { doneId.current = job.id; onDone((job.result ?? {}) as GroupActionResult, String((job.payload as { action?: string }).action ?? act.current)); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [job?.status, job?.id]);
  const running = starting || (!!jobId && (!job || job.status === 'pending' || job.status === 'claimed'));
  return { start, job, running, label, since };
}

export default function GroupManager({ channel, externalId, title, canEdit, onClose, onChanged }: {
  channel: Channel; externalId: string; title: string; canEdit: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const { confirm } = useDialogs();
  const wa = channel === 'whatsapp';
  const [tab, setTab] = useState<'geral' | 'pessoas' | 'convite'>('geral');
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [res, setRes] = useState<GroupActionResult>({});
  const [invite, setInvite] = useState<string | null>(null);
  const [name, setName] = useState(title); const [desc, setDesc] = useState('');
  const [nums, setNums] = useState(''); const [pq, setPq] = useState(''); const [inviteText, setInviteText] = useState('Entre no nosso grupo de ofertas');
  const [left, setLeft] = useState(false);
  const touched = useRef({ name: false, desc: false });
  const [, tick] = useState(0);

  const call = useGroupCall(channel, externalId, async (r, action) => {
    setRes((o) => ({ ...o, ...r, flags: { ...o.flags, ...r.flags } }));
    if (r.invite_url) setInvite(r.invite_url);
    if (r.left) setLeft(true);
    if (action === 'add_participants' || action === 'send_invite') setNums('');
    if (r.chat_id) { try { const d = await api().getChat(r.chat_id); setDetail(d); if (!touched.current.name) setName(d.chat.title); if (!touched.current.desc) setDesc(d.chat.description ?? '');
      if (action === 'set_subject' || action === 'set_title') touched.current.name = false; if (action === 'set_description') touched.current.desc = false;
      if (action === 'set_subject' || action === 'set_title') setName(d.chat.title); if (action === 'set_description') setDesc(d.chat.description ?? ''); } catch { /* o painel recarrega depois */ } }
    onChanged?.();
  });
  useEffect(() => { void call.start('info', undefined, 'Lendo o grupo'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (!call.running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [call.running]);

  const chat = detail?.chat; const admin = !!chat?.we_are_admin; const can = canEdit && admin && !left; const busy = call.running;
  const waited = call.since ? (Date.now() - call.since) / 1000 : 0;
  const flags = res.flags ?? {};
  const people = (detail?.participants ?? []).filter((p) => !pq || `${p.display_name ?? ''} ${p.external_id}`.toLowerCase().includes(pq.toLowerCase()));
  const list = [...new Set(nums.split(/[\s,;]+/).map(digits).filter((n) => n.length >= 10 && n.length <= 15))];
  const go = (a: GroupAction, p?: Record<string, unknown>, l?: string) => void call.start(a, p, l);

  const status = busy
    ? <div className="alert info" role="status"><Loader2 size={16} style={{ animation: 'sp .7s linear infinite', flex: 'none', marginTop: 2 }} /><div>{call.label || 'Executando'}… aguardando o worker.{waited > 20 && <div className="small" style={{ fontWeight: 400 }}>Está demorando. Confira se o worker está no ar.</div>}</div></div>
    : call.job?.status === 'failed' ? <div className="alert critical" role="alert"><XCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{call.job.last_error || 'A ação falhou.'}</div></div>
    : call.job?.status === 'done' && (res.pending_numbers?.length ?? 0) > 0 ? <div className="alert warning"><TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{res.added?.length ?? 0} adicionado(s). {res.pending_numbers!.length} número(s) não entraram: {res.pending_numbers!.join(', ')}. O WhatsApp pode recusar quem não tem seu contato; envie o convite por mensagem.</div></div>
    : null;

  const leave = async () => {
    if (!(await confirm({ title: 'Sair do grupo?', danger: true, confirmLabel: 'Sair do grupo', body: wa ? 'O número deixa de receber e enviar mensagens neste grupo. Para voltar, será preciso um novo convite.' : 'O bot deixa o chat e o destino de ofertas deixa de funcionar.' }))) return;
    go('leave', { confirm: true }, 'Saindo do grupo');
  };

  return (
    <Modal wide title={<span className="row" style={{ gap: 8 }}><Avatar name={chat?.title ?? title} square />Gerenciar {wa ? 'grupo' : 'chat'}: {chat?.title ?? title}</span>} onClose={onClose}
      footer={<><Button icon={<RefreshCw size={14} />} busy={busy && call.label === 'Atualizando'} disabled={busy || left} onClick={() => go('info', undefined, 'Atualizando')}>Atualizar do aplicativo</Button><Button variant="primary" onClick={onClose}>Fechar</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        {status}
        {left && <div className="alert warning">O sistema saiu deste {wa ? 'grupo' : 'chat'}. Ele foi arquivado nas conversas.</div>}
        {!left && chat && !admin && <div className="alert warning">Este {wa ? 'número' : 'bot'} não é administrador aqui: dá para consultar, mas {wa ? 'o WhatsApp' : 'o Telegram'} não deixa alterar nada.</div>}
        {!canEdit && <div className="alert info">Só administradores do painel alteram grupos.</div>}
        <div className="facts">
          <div><span>Participantes</span><b>{chat?.participant_count ?? '—'}</b></div>
          <div><span>Nossa função</span><b>{chat ? (admin ? 'administrador' : 'membro') : '—'}</b></div>
          {wa && <div><span>Quem envia</span><b>{flags.only_admins_send === undefined ? '—' : flags.only_admins_send ? 'só administradores' : 'todos'}</b></div>}
          {wa && <div><span>Quem edita dados</span><b>{flags.lock_info === undefined ? '—' : flags.lock_info ? 'só administradores' : 'todos'}</b></div>}
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ v: 'geral', label: 'Geral' }, { v: 'pessoas', label: wa ? 'Participantes' : 'Administradores' }, { v: 'convite', label: 'Convite' }]} />

        {tab === 'geral' && <fieldset disabled={!can} className="bare"><div className="col">
          <div className="row" style={{ alignItems: 'end' }}>
            <div style={{ flex: 1 }}><Field label={wa ? 'Nome do grupo' : 'Nome do chat'}><input value={name} maxLength={100} onChange={(e) => { touched.current.name = true; setName(e.target.value); }} /></Field></div>
            <Button icon={<Save size={14} />} disabled={busy || !name.trim() || name.trim() === chat?.title} onClick={() => go(wa ? 'set_subject' : 'set_title', { subject: name.trim() }, 'Alterando o nome')}>Salvar nome</Button>
          </div>
          <Field label="Descrição" hint={wa ? 'Até 2048 caracteres. Aparece para quem entra.' : 'Até 255 caracteres.'}><textarea rows={3} maxLength={wa ? 2048 : 255} value={desc} onChange={(e) => { touched.current.desc = true; setDesc(e.target.value); }} /></Field>
          <div><Button icon={<Save size={14} />} disabled={busy || desc.trim() === (chat?.description ?? '').trim()} onClick={() => go('set_description', { description: desc.trim() }, 'Alterando a descrição')}>Salvar descrição</Button></div>
          {wa ? <>
            <div className="row"><Toggle label="Só administradores enviam mensagens" checked={!!flags.only_admins_send} disabled={busy} onChange={(v) => go('set_only_admins_send', { value: v }, 'Alterando quem envia')} />
              <span><b>Só administradores enviam</b><div className="small muted">Recomendado para grupos de ofertas: evita spam e conversa paralela.</div></span></div>
            <div className="row"><Toggle label="Só administradores editam os dados do grupo" checked={!!flags.lock_info} disabled={busy} onChange={(v) => go('set_lock_info', { value: v }, 'Alterando quem edita')} />
              <span><b>Só administradores editam nome, foto e descrição</b><div className="small muted">Impede que membros troquem o nome do grupo.</div></span></div>
            <div className="row wrap" style={{ alignItems: 'end' }}>
              <label className="f" style={{ minWidth: 220 }}>Mensagens temporárias
                <select value={flags.ephemeral_seconds ?? 0} disabled={busy} onChange={(e) => go('set_ephemeral', { seconds: Number(e.target.value) }, 'Alterando mensagens temporárias')}>{EPH.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
              <Button disabled={busy} onClick={async () => { if (await confirm({ title: 'Aplicar os padrões?', confirmLabel: 'Aplicar', body: 'Reaplica neste grupo os padrões definidos em Configurações → WhatsApp → Grupos (quem envia, quem edita e mensagens temporárias).' })) go('apply_defaults', undefined, 'Aplicando padrões'); }}>Aplicar padrões do painel</Button>
            </div></> : <>
            <div className="row"><Toggle label="Membros podem enviar mensagens" checked={flags.only_admins_send === undefined ? true : !flags.only_admins_send} disabled={busy} onChange={(v) => go('set_permissions', { can_send_messages: v }, 'Alterando permissões')} />
              <span><b>Membros podem enviar mensagens</b><div className="small muted">Desligado, só administradores falam. Em canais esta opção não se aplica.</div></span></div>
            <div className="small muted">O Telegram não deixa bots adicionar ou remover pessoas: elas entram pelo link de convite.</div></>}
          <div className="dangerzone"><div><b>Sair {wa ? 'do grupo' : 'do chat'}</b><div className="small muted">O {wa ? 'número' : 'bot'} deixa {wa ? 'o grupo' : 'o chat'} e ele é arquivado aqui.</div></div>
            <Button variant="danger" icon={<LogOut size={14} />} disabled={busy} onClick={leave}>Sair</Button></div>
        </div></fieldset>}

        {tab === 'pessoas' && <div className="col">
          {!wa && <div className="small muted">O Telegram só informa os administradores ao bot. A contagem total aparece no topo.</div>}
          {(detail?.participants.length ?? 0) === 0 ? <Empty>{busy ? 'Lendo…' : 'Nenhum participante carregado ainda. Use “Atualizar do aplicativo”.'}</Empty> : <>
            <input aria-label="Buscar participante" placeholder="Buscar participante" value={pq} onChange={(e) => setPq(e.target.value)} />
            <div className="col" style={{ gap: 6, maxHeight: 280, overflow: 'auto' }}>{people.map((p) => (
              <div key={p.external_id} className="row">
                <Avatar name={p.display_name ?? p.external_id} size="sm" />
                <div style={{ minWidth: 0, flex: 1 }}><div className="truncate" style={{ fontWeight: 600 }}>{p.display_name ?? p.external_id}</div>{wa && <div className="small muted">+{p.external_id}</div>}</div>
                {p.role !== 'member' ? <Badge tone="ok"><Crown size={11} />{p.role === 'owner' ? 'dono' : 'admin'}</Badge> : <Badge>membro</Badge>}
                {wa && can && p.role !== 'owner' && <>
                  {p.role === 'member' ? <Button size="sm" icon={<ShieldCheck size={13} />} disabled={busy} onClick={() => go('promote', { numbers: [p.external_id] }, 'Promovendo')}>Tornar admin</Button>
                    : <Button size="sm" icon={<ShieldOff size={13} />} disabled={busy} onClick={() => go('demote', { numbers: [p.external_id] }, 'Rebaixando')}>Remover admin</Button>}
                  <Button size="sm" variant="danger" icon={<UserMinus size={13} />} disabled={busy} onClick={async () => { if (await confirm({ title: 'Remover do grupo?', danger: true, confirmLabel: 'Remover', body: `+${p.external_id} sai do grupo.` })) go('remove_participants', { numbers: [p.external_id] }, 'Removendo'); }}>Remover</Button></>}
              </div>))}</div></>}
          {wa && <fieldset disabled={!can} className="bare"><div className="col">
            <Field label="Adicionar ou convidar por número" hint="Um por linha ou separados por vírgula. DDI+DDD+número. Máx. 50 por vez; a adição é feita em lotes com espera para proteger o número."><textarea rows={3} value={nums} onChange={(e) => setNums(e.target.value)} placeholder={'5511999990001\n5511988880002'} /></Field>
            <div className="row wrap">
              <Button variant="primary" icon={<UserPlus size={14} />} disabled={busy || !list.length} onClick={() => go('add_participants', { numbers: list }, 'Adicionando participantes')}>Adicionar {list.length ? `(${list.length})` : ''}</Button>
              <Button disabled={busy || !list.length} onClick={() => go('send_invite', { numbers: list, text: inviteText }, 'Enviando convites')}>Enviar convite por mensagem {list.length ? `(${list.length})` : ''}</Button>
            </div>
            <Field label="Texto do convite"><input value={inviteText} maxLength={300} onChange={(e) => setInviteText(e.target.value)} /></Field>
            <div className="small muted">Adicionar pessoas que não têm você nos contatos aumenta o risco de denúncia. Prefira o link de convite ou o convite por mensagem.</div>
          </div></fieldset>}
        </div>}

        {tab === 'convite' && <fieldset disabled={!can} className="bare"><div className="col">
          <div className="small muted">Quem tiver o link entra {wa ? 'no grupo' : 'no chat'}. Gere um novo link se ele vazou: o anterior deixa de funcionar.</div>
          {invite ? <div className="row wrap"><code className="truncate" style={{ maxWidth: 380 }}>{invite}</code><CopyBtn text={invite} /></div> : <div className="small muted">O link ainda não foi carregado.</div>}
          <div className="row wrap">
            {wa ? <Button disabled={busy} onClick={() => go('invite_code', undefined, 'Buscando o link')}>Ver link atual</Button> : null}
            <Button disabled={busy || !can} onClick={() => go(wa ? 'revoke_invite' : 'create_invite', undefined, wa ? 'Gerando novo link' : 'Criando link')}>{wa ? 'Gerar novo link (revoga o antigo)' : 'Criar link de convite'}</Button>
            {!wa && invite && <Button variant="danger" disabled={busy || !can} onClick={async () => { if (await confirm({ title: 'Revogar este link?', danger: true, confirmLabel: 'Revogar', body: 'Quem ainda não entrou não conseguirá usar este link.' })) { go('revoke_invite', { link: invite }, 'Revogando'); setInvite(null); } }}>Revogar este link</Button>}
          </div>
          {!wa && <div className="small muted">O Telegram só mostra links criados pelo próprio bot.</div>}
        </div></fieldset>}
      </div>
    </Modal>);
}

