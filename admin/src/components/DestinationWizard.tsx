import { useEffect, useRef, useState } from 'react';
import { Check, Crown, Info, Loader2, MessageCircle, Plus, RefreshCw, Search, Send, UserPlus, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { int } from '../lib/format';
import { categorySlug } from '../lib/categories';
import type { Channel, Contact, Destination, DiscoveredGroup, ProductCategory } from '../lib/types';
import { Avatar, Badge, Button, Empty, ErrorBox, Field, Loading, Modal, useAction, useJob, useLoad } from '../ui/ui';
import { CategoryPicker } from './CategoryPicker';

export type DestDraft = Partial<Destination> & Pick<Destination, 'channel' | 'external_id' | 'name'>;
const STEPS = ['Canal', 'Grupo ou canal', 'Tipos de produto', 'Regras de envio'];
const digits = (s: string) => s.replace(/\D/g, '');
/** Aceita 11999990001 (DDD+número) e completa com o DDI 55; aceita número já com DDI. */
const normPhone = (s: string) => { const d = digits(s); if (d.length === 10 || d.length === 11) return '55' + d; return /^\d{12,15}$/.test(d) ? d : null; };

/** Linha de progresso de uma tarefa do n8n (buscar grupos, criar grupo, verificar chat). */
function JobProgress({ steps, status, error }: { steps: string[]; status: string; error?: string | null }) {
  const at = status === 'pending' ? 0 : status === 'claimed' ? 1 : steps.length - 1;
  return (
    <div className="progress" role="status" aria-live="polite">
      {steps.map((s, i) => { const ok = status === 'done' ? true : i < at; const on = i === at && status !== 'done' && status !== 'failed';
        return <div key={s} className={`st${ok ? ' ok' : on ? ' on' : ''}`}>{ok ? <Check size={15} /> : on ? <Loader2 size={15} style={{ animation: 'sp .7s linear infinite' }} /> : <span style={{ width: 15 }} />}{s}</div>; })}
      {status === 'failed' && <div className="alert critical">{error ?? 'A tarefa falhou.'}</div>}
    </div>);
}

export function DestinationWizard({ cats, initialChat, onClose, onSaved }: { cats: ProductCategory[]; initialChat?: string | null; onClose: () => void; onSaved: (created: Destination | null) => void }) {
  const { run, busy } = useAction();
  const [step, setStep] = useState(initialChat ? 1 : 0);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [mode, setMode] = useState<'existing' | 'create' | 'verify' | 'manual'>('existing');
  const [picked, setPicked] = useState<DiscoveredGroup | null>(null);
  const [manualId, setManualId] = useState('');
  const [gq, setGq] = useState('');
  const [refreshJob, setRefreshJob] = useState<string | null>(null);
  const refresh = useJob(refreshJob);
  const groups = useLoad(() => api().listDiscoveredGroups(channel), [channel, refresh?.status]);

  // criar grupo (WhatsApp)
  const [gName, setGName] = useState(''); const [gDesc, setGDesc] = useState('');
  const [people, setPeople] = useState<Contact[]>([]); const [cq, setCq] = useState(''); const [phone, setPhone] = useState('');
  const contacts = useLoad(() => api().listContacts(channel, cq), [channel, cq]);
  const key = useRef(crypto.randomUUID());
  const [createJob, setCreateJob] = useState<string | null>(null);
  const creating = useJob(createJob);
  // verificar (Telegram)
  const [ref, setRef] = useState(''); const [verifyJob, setVerifyJob] = useState<string | null>(null); const verifying = useJob(verifyJob);

  // regras
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [categories, setCategories] = useState<string[]>([]);
  const [perHour, setPerHour] = useState(2); const [perDay, setPerDay] = useState(6); const [interval, setIntervalMin] = useState(30);
  const [quiet, setQuiet] = useState(true); const [qs, setQs] = useState('22:00'); const [qe, setQe] = useState('08:00');
  const [risk, setRisk] = useState<Destination['risk_tier']>('high');
  const [testNow, setTestNow] = useState(true);
  const queue = useLoad(() => api().listOffers({ status: 'needs_review' }), []);

  const [slugCounts, setSlugCounts] = useState<Record<string, number>>({});
  useEffect(() => { const m: Record<string, number> = {}; for (const o of queue.data ?? []) { const sl = categorySlug(o.category, cats); if (sl) m[sl] = (m[sl] ?? 0) + 1; } setSlugCounts(m); }, [queue.data, cats]);

  useEffect(() => { // atalho vindo da tela de grupos: ?novo=<chat>
    if (!initialChat) return;
    void api().getChat(initialChat).then(({ chat }) => { setChannel(chat.channel); setPicked({ chat_id: chat.id, external_id: chat.external_id, title: chat.title, kind: chat.kind, username: chat.username, participant_count: chat.participant_count, we_are_admin: chat.we_are_admin, destination_id: chat.destination_id, destination_name: chat.destination_name }); });
  }, [initialChat]);
  useEffect(() => { if (picked && !name) setName(picked.title); }, [picked, name]);
  useEffect(() => { setRisk(channel === 'whatsapp' ? 'high' : 'low'); setPerDay(channel === 'whatsapp' ? 6 : 12); setIntervalMin(channel === 'whatsapp' ? 30 : 15); setMode('existing'); setPicked(null); }, [channel]);
  // grupo criado ou verificado: seleciona sozinho
  useEffect(() => {
    const done = creating?.status === 'done' ? creating : verifying?.status === 'done' ? verifying : null;
    const id = (done?.result as { chat_id?: string } | null)?.chat_id; if (!id) return;
    void api().listDiscoveredGroups(channel).then((g) => { const f = g.find((x) => x.chat_id === id); if (f) { setPicked(f); setMode('existing'); void groups.reload(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating?.status, verifying?.status]);

  const list = (groups.data ?? []).filter((g) => !gq || g.title.toLowerCase().includes(gq.toLowerCase()));
  const externalId = mode === 'manual' ? manualId.trim() : picked?.external_id ?? '';
  const canNext = step === 0 ? true : step === 1 ? !!externalId && !(mode !== 'manual' && picked?.destination_id) : step === 2 ? true : !!name.trim();
  const addPhone = () => { const n = normPhone(phone); if (!n) return; if (!people.some((p) => digits(p.external_id) === n)) setPeople([...people, { external_id: n, display_name: `+${n}` }]); setPhone(''); };
  const togglePerson = (c: Contact) => setPeople((ps) => ps.some((p) => p.external_id === c.external_id) ? ps.filter((p) => p.external_id !== c.external_id) : [...ps, c]);
  const jobRunning = (j: ReturnType<typeof useJob>) => !!j && ['pending', 'claimed'].includes(j.status);

  const save = async () => {
    const d: DestDraft = { channel, external_id: externalId, name: name.trim(), description: desc.trim() || null, categories, enabled: false,
      max_per_hour: perHour, max_per_day: perDay, min_interval_s: interval * 60, quiet_start: quiet ? qs : null, quiet_end: quiet ? qe : null, risk_tier: risk };
    let created: Destination | null = null;
    if (await run('save', async () => { await api().saveDestination(d); const all = await api().listDestinations(); created = all.find((x) => x.channel === channel && x.external_id === externalId) ?? null;
      if (testNow && created) await api().requestDestinationTest(created.id); }, testNow ? 'Destino criado; mensagem de teste solicitada' : 'Destino criado')) { onSaved(created); onClose(); }
  };

  return (
    <Modal wide title="Novo destino" onClose={onClose} footer={<>
      {step > 0 && <Button onClick={() => setStep(step - 1)}>Voltar</Button>}<span className="right" />
      <Button onClick={onClose}>Cancelar</Button>
      {step < 3 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continuar</Button>
        : <Button variant="primary" busy={busy === 'save'} disabled={!canNext} onClick={save}>Criar destino</Button>}</>}>
      <ol className="steps" aria-label="Etapas">{STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><b>{i < step ? <Check size={12} /> : i + 1}</b>{s}</li>)}</ol>

      {step === 0 && <div className="col">
        <div className="small muted">Onde as ofertas serão publicadas?</div>
        <div className="choice">
          <button type="button" aria-pressed={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}><b><MessageCircle size={16} style={{ verticalAlign: -3 }} /> WhatsApp</b><span>Grupo do número conectado na Evolution API. Você pode escolher um grupo que já existe ou criar um novo aqui.</span></button>
          <button type="button" aria-pressed={channel === 'telegram'} onClick={() => setChannel('telegram')}><b><Send size={16} style={{ verticalAlign: -3 }} /> Telegram</b><span>Canal ou grupo em que o seu bot é administrador. O Telegram não deixa bots criarem canais: crie no aplicativo e o painel encontra.</span></button>
        </div></div>}

      {step === 1 && <div className="col">
        <div className="choice">
          <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}><b>Escolher um que já existe</b><span>Lista o que o {channel === 'whatsapp' ? 'número' : 'bot'} já conhece, inclusive o que você criou pelo celular.</span></button>
          {channel === 'whatsapp' ? <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}><b><Plus size={15} style={{ verticalAlign: -2 }} /> Criar um grupo novo</b><span>Define nome e participantes aqui; o n8n cria o grupo no WhatsApp.</span></button>
            : <button type="button" aria-pressed={mode === 'verify'} onClick={() => setMode('verify')}><b>Adicionei o bot em um canal novo</b><span>Informe o @canal ou o ID e o painel confirma que o bot enxerga o chat.</span></button>}
          <button type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}><b>Informar o identificador</b><span>Avançado: {channel === 'whatsapp' ? 'JID do grupo (120363…@g.us)' : 'ID numérico ou @canal'}.</span></button>
        </div>

        {mode === 'existing' && <div className="col" style={{ gap: 10 }}>
          <div className="row wrap">
            <div className="row" style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} /><input aria-label="Buscar grupo" placeholder="Buscar grupo" style={{ paddingLeft: 32 }} value={gq} onChange={(e) => setGq(e.target.value)} /></div>
            <Button icon={<RefreshCw size={15} />} busy={busy === 'rf' || jobRunning(refresh)} onClick={async () => { let id = ''; if (await run('rf', async () => { id = await api().requestGroupRefresh(channel); })) setRefreshJob(id); }}>Buscar no aplicativo</Button>
          </div>
          {refresh && refresh.status !== 'done' && <JobProgress steps={['Pedido enviado', `Consultando o ${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}`, 'Grupos atualizados']} status={refresh.status} error={refresh.last_error} />}
          {refresh?.status === 'done' && <div className="small" style={{ color: 'var(--ok)' }}><Check size={14} style={{ verticalAlign: -2 }} /> Lista atualizada.</div>}
          {groups.loading && !groups.data ? <Loading /> : groups.error ? <ErrorBox error={groups.error} retry={groups.reloadLoud} /> : list.length === 0 ? <Empty icon={<Users size={26} />}>Nenhum grupo encontrado. Clique em “Buscar no aplicativo” para sincronizar o que existe no {channel === 'whatsapp' ? 'celular' : 'Telegram'}.</Empty> :
            <div className="glist" role="listbox" aria-label="Grupos disponíveis">{list.map((g) => { const blocked = !!g.destination_id; return (
              <button key={g.chat_id} type="button" role="option" aria-selected={picked?.chat_id === g.chat_id} aria-pressed={picked?.chat_id === g.chat_id} className="grow" disabled={blocked} onClick={() => setPicked(g)}>
                <Avatar name={g.title} square /><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 650 }} className="truncate">{g.title}</div>
                  <div className="small muted">{g.kind === 'channel' ? 'Canal' : 'Grupo'}{g.participant_count != null ? ` · ${int(g.participant_count)} participantes` : ''}{g.username ? ` · @${g.username}` : ''}</div></div>
                {blocked ? <Badge tone="info">já é destino: {g.destination_name}</Badge> : g.we_are_admin ? <Badge tone="ok"><Crown size={12} />administrador</Badge> : <Badge tone="warn">somos membros</Badge>}</button>); })}</div>}
          {picked && !picked.we_are_admin && <div className="alert warning"><Info size={16} style={{ flex: 'none', marginTop: 2 }} /><span>{channel === 'telegram' && picked.kind === 'channel' ? 'Em canais do Telegram só administradores publicam: adicione o bot como administrador antes de ativar.' : 'Somos apenas membros. Se o grupo estiver configurado para só administradores enviarem, as mensagens falharão. O teste do próximo passo confirma.'}</span></div>}
        </div>}

        {mode === 'create' && channel === 'whatsapp' && <div className="col" style={{ gap: 12 }}>
          {createJob && creating ? <JobProgress steps={['Pedido enviado', 'Criando o grupo no WhatsApp', 'Grupo criado']} status={creating.status} error={creating.last_error} /> : <>
            <div className="grid g2"><Field label="Nome do grupo" hint="3 a 100 caracteres."><input value={gName} maxLength={100} onChange={(e) => setGName(e.target.value)} placeholder="Ex.: Ofertas Carro BR" /></Field>
              <Field label="Descrição (opcional)"><input value={gDesc} maxLength={500} onChange={(e) => setGDesc(e.target.value)} placeholder="Regras e tipo de oferta" /></Field></div>
            <div>
              <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Participantes ({people.length})</div>
              {people.length > 0 && <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>{people.map((p) => <span key={p.external_id} className="badge accent">{p.display_name}<button type="button" aria-label={`Remover ${p.display_name}`} onClick={() => togglePerson(p)} style={{ border: 0, background: 'none', cursor: 'pointer', display: 'grid', color: 'inherit' }}><X size={12} /></button></span>)}</div>}
              <div className="grid g2">
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} /><input aria-label="Buscar contato" placeholder="Buscar nos contatos conhecidos" style={{ paddingLeft: 32 }} value={cq} onChange={(e) => setCq(e.target.value)} /></div>
                  <div className="glist" style={{ maxHeight: 190 }}>{(contacts.data ?? []).length === 0 ? <div className="small muted" style={{ padding: 12 }}>Nenhum contato conhecido ainda. Adicione pelo número ao lado.</div> :
                    (contacts.data ?? []).map((c) => { const on = people.some((p) => p.external_id === c.external_id); return (
                      <button key={c.external_id} type="button" className="grow" aria-pressed={on} onClick={() => togglePerson(c)}><Avatar name={c.display_name} size="sm" /><span className="truncate" style={{ flex: 1 }}>{c.display_name}</span>{on && <Check size={15} />}</button>); })}</div>
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <Field label="Adicionar por número" hint="DDD + número (o DDI 55 é completado)."><span className="row"><input value={phone} inputMode="tel" placeholder="11 99999-0001" onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPhone())} /><Button type="button" icon={<UserPlus size={15} />} disabled={!normPhone(phone)} onClick={addPhone}>Adicionar</Button></span></Field>
                  <div className="small muted">Só adicione quem consentiu em entrar. Convites em massa para quem não conhece o número aumentam o risco de bloqueio.</div>
                </div>
              </div>
            </div>
            <div className="small muted">Limite de 3 grupos criados por dia (proteção do número). Requer perfil administrador.</div>
            <div><Button variant="primary" icon={<Plus size={15} />} busy={busy === 'cg'} disabled={gName.trim().length < 3 || people.length < 1}
              onClick={async () => { let id = ''; if (await run('cg', async () => { id = await api().requestGroupCreation({ channel, name: gName, description: gDesc, participants: people, key: key.current }); }, 'Criação do grupo solicitada')) setCreateJob(id); }}>Criar grupo no WhatsApp</Button></div></>}
          {creating?.status === 'failed' && <Button onClick={() => { setCreateJob(null); key.current = crypto.randomUUID(); }}>Tentar de novo</Button>}
          {creating?.status === 'done' && <div className="alert info"><Check size={16} style={{ flex: 'none', marginTop: 2 }} />Grupo criado e selecionado. Continue para escolher os tipos de produto.</div>}
        </div>}

        {mode === 'verify' && channel === 'telegram' && <div className="col" style={{ gap: 12 }}>
          <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}><li>No Telegram, crie o canal ou grupo.</li><li>Adicione o seu bot como <b>administrador</b> com permissão de postar.</li><li>Informe abaixo o @usuário (canais públicos) ou o ID numérico.</li></ol>
          <div className="row"><input aria-label="Canal ou ID" style={{ flex: 1 }} placeholder="@ofertas_carro ou -1001234567890" value={ref} onChange={(e) => setRef(e.target.value)} />
            <Button variant="primary" busy={busy === 'vf' || jobRunning(verifying)} disabled={!ref.trim()} onClick={async () => { let id = ''; if (await run('vf', async () => { id = await api().requestChatVerify(channel, ref); })) setVerifyJob(id); }}>Verificar</Button></div>
          {verifying && <JobProgress steps={['Pedido enviado', 'Perguntando ao Telegram', 'Chat encontrado']} status={verifying.status} error={verifying.last_error} />}
        </div>}

        {mode === 'manual' && <Field label={channel === 'whatsapp' ? 'JID do grupo' : 'ID do chat ou @canal'} hint={channel === 'whatsapp' ? 'Ex.: 120363000000000001@g.us (Evolution API → grupos).' : 'Ex.: -1001234567890 ou @meucanal. O bot precisa ser administrador.'}><input value={manualId} onChange={(e) => setManualId(e.target.value)} /></Field>}
        {picked && mode !== 'manual' && <div className="alert info"><Check size={16} style={{ flex: 'none', marginTop: 2 }} />Selecionado: <b>{picked.title}</b></div>}
      </div>}

      {step === 2 && <div className="col">
        <div><b>Que tipos de produto este destino recebe?</b><div className="small muted">Ex.: um grupo só de itens para carro recebe apenas ofertas de “Carro e moto”. O número ao lado mostra quantas ofertas da fila de aprovação combinam agora.</div></div>
        <CategoryPicker cats={cats} value={categories} onChange={setCategories} counts={slugCounts} />
      </div>}

      {step === 3 && <div className="col">
        <div className="grid g2"><Field label="Nome do destino"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Descrição"><input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>
        <div className="grid g3"><Field label="Máx. por hora"><input type="number" min={1} value={perHour} onChange={(e) => setPerHour(+e.target.value)} /></Field>
          <Field label="Máx. por dia"><input type="number" min={1} value={perDay} onChange={(e) => setPerDay(+e.target.value)} /></Field>
          <Field label="Intervalo mínimo (min)"><input type="number" min={0} value={interval} onChange={(e) => setIntervalMin(+e.target.value)} /></Field></div>
        <div className="grid g3"><Field label="Risco do canal"><select value={risk} onChange={(e) => setRisk(e.target.value as Destination['risk_tier'])}><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto (WhatsApp)</option></select></Field>
          <Field label="Horário de silêncio"><label className="row"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />Respeitar</label></Field>
          {quiet && <Field label="Das / até"><span className="row"><input type="time" value={qs} onChange={(e) => setQs(e.target.value)} /><input type="time" value={qe} onChange={(e) => setQe(e.target.value)} /></span></Field>}</div>
        <label className="row"><input type="checkbox" checked={testNow} onChange={(e) => setTestNow(e.target.checked)} />Enviar uma mensagem de teste assim que criar (o destino só pode ser ativado depois de testado)</label>
        <div className="card" style={{ padding: 14 }}><div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Resumo</div>
          <div className="row wrap" style={{ gap: 8 }}><Badge tone="info">{channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}</Badge><b>{picked?.title ?? externalId}</b>
            <span className="muted">· {categories.length ? categories.map((s) => cats.find((c) => c.slug === s)?.label ?? s).join(', ') : 'todos os tipos'}</span><span className="muted">· {perHour}/h, {perDay}/dia</span></div></div>
      </div>}
    </Modal>);
}
