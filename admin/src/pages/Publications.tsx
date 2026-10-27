import { useMemo, useState } from 'react';
import { AlarmClock, Ban, CalendarClock, Download, HelpCircle, Pencil, RotateCcw, Search, Send, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, dateTime, download, pubStatusLabel, channelName, toCsv } from '../lib/format';
import type { Channel, Publication, PublicationStatus } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, Th, useAction, useDialogs, useHotkeys, useLoad, useSelection, useTable } from '../ui/ui';
import { ChannelTag, PubStatus } from '../ui/badges';
import { Bubble } from '../components/Approve';

const OPEN: PublicationStatus[] = ['pending', 'retry_scheduled'];
const isOpen = (p: Publication) => OPEN.includes(p.status);
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Timeline({ p }: { p: Publication }) {
  const ev: { at: string | null; label: string; tone?: string }[] = [
    { at: p.created_at, label: 'Entrou na fila' },
    { at: p.scheduled_for, label: 'Agendada para' },
    ...(p.attempt_count ? [{ at: null, label: `${p.attempt_count} tentativa(s) de envio` }] : []),
    ...(p.status === 'retry_scheduled' ? [{ at: p.next_attempt_at, label: 'Próxima tentativa' }] : []),
    ...(p.sent_at ? [{ at: p.sent_at, label: 'Enviada ao canal', tone: 'ok' }] : []),
    ...(p.status === 'failed_permanent' ? [{ at: null, label: `Falhou: ${p.last_error_code ?? 'erro'}`, tone: 'bad' }] : []),
    ...(p.status === 'unknown' ? [{ at: null, label: 'Resultado ambíguo — reconciliar', tone: 'bad' }] : []),
    ...(p.status === 'cancelled' ? [{ at: null, label: 'Cancelada', tone: 'warn' }] : []),
  ];
  return <ol className="tline">{ev.map((e, i) => <li key={i} data-tone={e.tone}><b>{e.label}</b>{e.at && <span className="small muted"> · {dateTime(e.at)}</span>}</li>)}</ol>;
}

function Detail({ p, onClose, onChanged }: { p: Publication; onClose: () => void; onChanged: () => void }) {
  const { canOperate } = useSession();
  const { confirm, prompt } = useDialogs();
  const { run, busy } = useAction();
  const [text, setText] = useState(p.rendered_text);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(toLocalInput(new Date(Math.max(Date.now() + 3600_000, new Date(p.scheduled_for).getTime()))));
  const editable = isOpen(p);
  const done = () => { onChanged(); onClose(); };
  const whenMs = new Date(when).getTime();
  const whenOk = whenMs > Date.now() - 60_000 && whenMs <= Date.now() + 30 * 86_400_000;
  return (
    <Modal wide title={p.offer_title} onClose={onClose}
      footer={canOperate && (editable || p.status === 'failed_permanent' || p.status === 'unknown') ? <>
        {editable && <Button variant="danger" busy={busy === 'c'} icon={<Ban size={15} />} onClick={async () => { if (await confirm({ title: 'Cancelar publicação?', body: 'A mensagem não será enviada.', danger: true, confirmLabel: 'Cancelar envio' }) && await run('c', () => api().cancelPublication(p.id), 'Publicação cancelada')) done(); }}>Cancelar envio</Button>}
        {editable && <Button variant="primary" busy={busy === 'n'} icon={<Zap size={15} />} onClick={async () => { if (await run('n', () => api().reschedulePublication(p.id, new Date().toISOString()), 'Antecipada: sai no próximo ciclo do envio')) done(); }}>Enviar agora</Button>}
        {p.status === 'failed_permanent' && <Button busy={busy === 'r'} icon={<RotateCcw size={15} />} onClick={async () => { if (await confirm({ title: 'Reenfileirar?', body: 'Confirme que o problema que causou a falha (ex.: destino inválido) foi corrigido.', confirmLabel: 'Reenfileirar' }) && await run('r', () => api().retryPublication(p.id), 'Reenfileirada')) done(); }}>Reenfileirar</Button>}
        {p.status === 'unknown' && <>
          <Button busy={busy === 'u1'} icon={<Send size={15} />} onClick={async () => { const id = await prompt({ title: 'Marcar como enviada', label: 'ID da mensagem no canal (opcional)', confirmLabel: 'Marcar enviada' }); if (id !== null && await run('u1', () => api().resolveUnknown(p.id, 'sent', id || undefined), 'Marcada como enviada')) done(); }}>Chegou no canal</Button>
          <Button variant="danger" busy={busy === 'u2'} onClick={async () => { if (await confirm({ title: 'Marcar como não enviada?', body: 'Use somente depois de conferir no canal que a mensagem NÃO apareceu. O sistema nunca reenvia sozinho.', danger: true, confirmLabel: 'Não chegou' }) && await run('u2', () => api().resolveUnknown(p.id, 'cancelled'), 'Marcada como cancelada')) done(); }}>Não chegou</Button></>}
      </> : undefined}>
      <div className="grid split">
        <div className="col">
          <div className="row wrap"><ChannelTag c={p.channel} /><span>{p.destination_name}</span><PubStatus s={p.status} />{p.is_simulated && <Badge tone="info">Simulada</Badge>}</div>
          {p.status === 'unknown' && <div className="alert critical"><HelpCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>Resultado ambíguo.</b> O sistema não sabe se a mensagem chegou. Confira no canal e reconcilie manualmente — nunca é reenviada automaticamente (evita duplicar).</span></div>}
          {p.status === 'failed_permanent' && <div className="alert critical">Falha permanente <code>{p.last_error_code}</code>. Corrija a causa (destino, permissões) antes de reenfileirar.</div>}
          <div className="row"><h3>Mensagem</h3>{canOperate && editable && !editing && <Button className="right" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Editar texto</Button>}</div>
          {editing ? <Field label="Texto final (validado contra termos proibidos ao salvar)"><textarea style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="row"><Button variant="primary" busy={busy === 'e'} onClick={async () => { if (await run('e', () => api().editPublicationText(p.id, text), 'Texto atualizado')) done(); }}>Salvar texto</Button><Button onClick={() => { setEditing(false); setText(p.rendered_text); }}>Descartar</Button></span></Field>
            : <Bubble text={p.rendered_text} channel={p.channel} />}
          {p.note && <div className="small muted">Nota: {p.note}</div>}
        </div>
        <div className="col">
          <div className="card" style={{ padding: 14 }}><div style={{ fontWeight: 650, marginBottom: 8 }}>Linha do tempo</div><Timeline p={p} /></div>
          <dl className="kv"><dt>Cliques</dt><dd>{p.clicks}</dd><dt>Tentativas</dt><dd>{p.attempt_count}</dd>{p.external_message_id && <><dt>ID da mensagem</dt><dd><code>{p.external_message_id}</code></dd></>}</dl>
          {canOperate && editable && <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}><CalendarClock size={15} style={{ verticalAlign: -2 }} /> Reagendar</div>
            <div className="col"><Field label="Novo horário" hint="Entre agora e 30 dias."><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
              <Button disabled={!whenOk} busy={busy === 'w'} icon={<AlarmClock size={15} />} onClick={async () => { if (await run('w', () => api().reschedulePublication(p.id, new Date(when).toISOString()), 'Publicação reagendada')) done(); }}>Reagendar</Button></div></div>}
        </div>
      </div>
    </Modal>);
}

export default function Publications() {
  const { canOperate } = useSession();
  const { confirm, toast } = useDialogs();
  const [status, setStatus] = useState<PublicationStatus | 'all'>('all');
  const [channel, setChannel] = useState<Channel | 'all'>('all');
  const [dest, setDest] = useState('all');
  const [text, setText] = useState('');
  const [period, setPeriod] = useState('all');
  const [sel, setSel] = useState<Publication | null>(null);
  const [bulk, setBulk] = useState(false);
  const checked = useSelection();
  const q = useLoad(() => api().listPublications({ status: 'all', channel }), [channel], 10000);
  const all = q.data ?? [];
  const count = (s: PublicationStatus[]) => all.filter((p) => s.includes(p.status)).length;
  const dests = useMemo(() => [...new Map(all.map((p) => [p.destination_id, p.destination_name])).entries()], [all]);
  const rows = useMemo(() => {
    const now = Date.now(); const lim: Record<string, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
    const t = text.trim().toLowerCase();
    return all.filter((p) => (status === 'all' || p.status === status) && (dest === 'all' || p.destination_id === dest)
      && (period === 'all' || now - new Date(p.sent_at ?? p.scheduled_for).getTime() <= lim[period] && new Date(p.sent_at ?? p.scheduled_for).getTime() <= now + 30 * 86_400_000)
      && (!t || p.offer_title.toLowerCase().includes(t) || p.destination_name.toLowerCase().includes(t)));
  }, [all, status, dest, text, period]);
  const tbl = useTable(rows, {
    offer: (p) => p.offer_title, dest: (p) => p.destination_name, status: (p) => p.status, when: (p) => new Date(p.sent_at ?? p.scheduled_for).getTime(), clicks: (p) => p.clicks,
  }, { key: 'when', dir: 'desc' }, 20);
  const attention = count(['unknown', 'failed_permanent']);
  const selected = rows.filter((p) => checked.has(p.id));
  const selOpen = selected.filter(isOpen);
  const pageIds = tbl.rows.map((p) => p.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((i) => checked.has(i));

  const bulkRun = async (kind: 'cancel' | 'now') => {
    if (!selOpen.length) return;
    if (kind === 'cancel' && !(await confirm({ title: `Cancelar ${selOpen.length} publicação(ões)?`, body: 'As mensagens não serão enviadas.', danger: true, confirmLabel: 'Cancelar envios' }))) return;
    setBulk(true); let ok = 0; let fail = 0;
    for (const p of selOpen) { try { if (kind === 'cancel') await api().cancelPublication(p.id); else await api().reschedulePublication(p.id, new Date().toISOString()); ok++; } catch { fail++; } }
    setBulk(false); checked.clear(); await q.reload();
    toast(`${ok} ${kind === 'cancel' ? 'cancelada(s)' : 'antecipada(s)'}${fail ? ` · ${fail} falharam` : ''}`, fail ? 'err' : 'ok');
  };
  useHotkeys({ '/': () => document.getElementById('pub-search')?.focus() });
  const tile = (label: string, n: number, s: PublicationStatus | 'all', tone?: string) =>
    <button className="stat card tilebtn" aria-pressed={status === s} onClick={() => { setStatus(s); checked.clear(); }}><span className="k">{label}</span><span className="v" style={tone ? { color: tone } : undefined}>{n}</span></button>;
  const exportCsv = () => download(`publicacoes-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows.map((p) => ({
    oferta: p.offer_title, destino: p.destination_name, canal: p.channel, status: pubStatusLabel[p.status], agendada: p.scheduled_for, enviada: p.sent_at ?? '', tentativas: p.attempt_count, cliques: p.clicks, erro: p.last_error_code ?? '' }))));

  return (
    <>
      <PageHead title="Publicações" sub="Cada linha é um envio para um destino. Acompanhe, antecipe, reagende, corrija e reconcilie.">
        <Button icon={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Exportar CSV</Button>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        {tile('Na fila', count(['pending', 'retry_scheduled', 'claimed']), 'pending')}
        {tile('Enviadas', count(['sent']), 'sent')}
        {tile('Precisam de ação', attention, attention ? 'unknown' : 'failed_permanent', attention ? 'var(--bad)' : undefined)}
        {tile('Todas', all.length, 'all')}
      </div>
      {attention > 0 && <div className="alert critical" style={{ marginBottom: 14 }}>{attention} publicação(ões) precisam da sua ação (resultado desconhecido ou falha permanente). Filtre por “Unknown” ou “Falha permanente”.</div>}
      <Card flush>
        <div className="tools">
          <label className="searchbox"><Search size={15} /><input id="pub-search" aria-label="Buscar publicação" placeholder="Buscar oferta ou destino ( / )" value={text} onChange={(e) => setText(e.target.value)} /></label>
          <select aria-label="Filtrar por status" value={status} onChange={(e) => { setStatus(e.target.value as PublicationStatus | 'all'); checked.clear(); }}><option value="all">Todos os status</option>{Object.entries(pubStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Filtrar por canal" value={channel} onChange={(e) => setChannel(e.target.value as Channel | 'all')}><option value="all">Todos os canais</option>{Object.entries(channelName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Filtrar por destino" value={dest} onChange={(e) => setDest(e.target.value)}><option value="all">Todos os destinos</option>{dests.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">Qualquer data</option><option value="24h">Últimas 24 h</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select>
        </div>
        {canOperate && checked.count > 0 && <div className="bulkbar"><b>{checked.count} selecionada(s)</b><span className="muted small">{selOpen.length} podem ser alteradas</span>
          <span className="right row"><Button size="sm" icon={<Zap size={14} />} disabled={!selOpen.length} busy={bulk} onClick={() => bulkRun('now')}>Enviar agora</Button>
            <Button size="sm" variant="danger" icon={<Ban size={14} />} disabled={!selOpen.length} busy={bulk} onClick={() => bulkRun('cancel')}>Cancelar</Button>
            <Button size="sm" variant="ghost" onClick={checked.clear}>Limpar</Button></span></div>}
        {q.loading && !q.data ? <Loading /> : q.error ? <div style={{ padding: 16 }}><ErrorBox error={q.error} retry={q.reloadLoud} /></div> : !rows.length ? <Empty icon={<Send size={30} />}>{all.length ? 'Nenhuma publicação com esses filtros.' : 'Nenhuma publicação ainda. Aprove uma oferta na fila de aprovação para ela aparecer aqui.'}</Empty> :
          <><div className="tablewrap"><table><thead><tr>
            {canOperate && <th style={{ width: 34 }}><input type="checkbox" aria-label="Selecionar página" checked={allOnPage} onChange={(e) => checked.setAll(pageIds, e.target.checked)} /></th>}
            <Th t={tbl} k="offer">Oferta</Th><Th t={tbl} k="dest">Destino</Th><Th t={tbl} k="status">Status</Th><Th t={tbl} k="when">Quando</Th><Th t={tbl} k="clicks">Cliques</Th></tr></thead>
            <tbody>{tbl.rows.map((p) => <tr key={p.id} className="click" tabIndex={0} onClick={() => setSel(p)} onKeyDown={(e) => e.key === 'Enter' && setSel(p)}>
              {canOperate && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${p.offer_title}`} checked={checked.has(p.id)} onChange={() => checked.toggle(p.id)} /></td>}
              <td style={{ maxWidth: 340 }}><div className="truncate" style={{ fontWeight: 600 }}>{p.offer_title}</div>{p.is_simulated && <span className="small muted">simulada</span>}</td>
              <td><div className="row" style={{ gap: 6 }}><ChannelTag c={p.channel} /><span className="small">{p.destination_name}</span></div></td>
              <td><PubStatus s={p.status} />{p.last_error_code && <div className="small muted mono">{p.last_error_code}</div>}{p.attempt_count > 1 && <div className="small muted">{p.attempt_count} tentativas</div>}</td>
              <td className="small nowrap">{p.sent_at ? <>{dateTime(p.sent_at)}<div className="muted">enviada {ago(p.sent_at)}</div></> : <>{dateTime(p.scheduled_for)}<div className="muted">{new Date(p.scheduled_for).getTime() > Date.now() ? 'agendada' : 'prevista'} {ago(p.scheduled_for)}</div></>}</td><td>{p.clicks}</td></tr>)}</tbody></table></div>
            <Pager t={tbl} label="publicações" /></>}
      </Card>
      {sel && <Detail p={sel} onClose={() => setSel(null)} onChanged={q.reload} />}
    </>);
}
