import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Database, FileText, Gauge, PauseCircle, PlayCircle, Save, ShieldCheck, SlidersHorizontal, Smartphone, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import type { SecretInfo, SettingsMap } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Field, Loading, PageHead, Seg, useAction, useDialogs, useLoad } from '../ui/ui';
import { statusOf } from '../components/integrations';
import WhatsAppTab from './settings/WhatsAppTab';
import TelegramTab from './settings/TelegramTab';
import N8nTab from './settings/N8nTab';
import DatabaseTab from './settings/DatabaseTab';

type Tab = 'operacao' | 'whatsapp' | 'telegram' | 'n8n' | 'banco' | 'compliance' | 'avancado';
const TABS: { v: Tab; label: string; icon: JSX.Element }[] = [
  { v: 'operacao', label: 'Operação', icon: <Gauge size={16} /> },
  { v: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} /> },
  { v: 'telegram', label: 'Telegram', icon: <Bot size={16} /> },
  { v: 'n8n', label: 'n8n', icon: <Workflow size={16} /> },
  { v: 'banco', label: 'Banco de dados', icon: <Database size={16} /> },
  { v: 'compliance', label: 'Regras de publicação', icon: <FileText size={16} /> },
  { v: 'avancado', label: 'Avançado', icon: <SlidersHorizontal size={16} /> },
];

function Save1({ k, value, saved, onSaved, label = 'Salvar' }: { k: string; value: unknown; saved: unknown; onSaved: () => void; label?: string }) {
  const { run, busy } = useAction();
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  return <Button variant="primary" size="sm" icon={<Save size={14} />} disabled={!dirty} busy={busy === k} onClick={async () => { if (await run(k, () => api().setSetting(k, value), 'Configuração salva')) onSaved(); }}>{label}</Button>;
}

function Operacao({ s, reload }: { s: SettingsMap; reload: () => void }) {
  const { confirm, prompt } = useDialogs(); const { run } = useAction();
  const [thr, setThr] = useState(Number(s.auto_approve_threshold ?? 90)); const [age, setAge] = useState(Number(s.max_price_age_minutes ?? 720)); const [base, setBase] = useState(String(s.shortlink_base ?? ''));
  useEffect(() => { setThr(Number(s.auto_approve_threshold ?? 90)); setAge(Number(s.max_price_age_minutes ?? 720)); setBase(String(s.shortlink_base ?? '')); }, [s.auto_approve_threshold, s.max_price_age_minutes, s.shortlink_base]);
  const mode = String(s.mode ?? 'simulation') as 'simulation' | 'review' | 'auto'; const paused = s.paused === true;
  const setMode = async (m: typeof mode) => {
    if (m === mode) return;
    if (m === 'auto' && !(await confirm({ title: 'Ativar modo automático?', danger: true, confirmLabel: 'Ativar automático', body: 'No modo automático, ofertas acima da nota de corte são aprovadas sem revisão humana. Só ative depois de semanas de operação assistida com métricas boas.' }))) return;
    if (await run('mode', () => api().setSetting('mode', m), 'Modo alterado')) reload();
  };
  const togglePause = async () => {
    if (!paused) { const why = await prompt({ title: 'Pausar todos os envios', label: 'Motivo (opcional)', confirmLabel: 'Pausar tudo' }); if (why === null) return; if (await run('pause', () => api().setPaused(true, why || undefined), 'Envios pausados')) reload(); }
    else if (await run('pause', () => api().setPaused(false), 'Envios retomados')) reload();
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="Modo de operação">
        <div className="col"><Seg value={mode} onChange={setMode} options={[{ v: 'simulation', label: 'Simulação' }, { v: 'review', label: 'Revisão humana' }, { v: 'auto', label: 'Automático' }]} />
          <div className="small muted">{mode === 'simulation' ? 'Nada vai para canais reais: o fluxo roda de ponta a ponta e as publicações são marcadas como simuladas.' : mode === 'review' ? 'Toda oferta passa pela fila de aprovação antes de ser enviada. É o modo recomendado.' : 'Ofertas com score acima da nota de corte são aprovadas sozinhas (as regras duras continuam valendo).'}</div>
          {mode === 'auto' && <div className="row wrap"><Field label="Nota de corte da aprovação automática"><input type="number" min={50} max={100} value={thr} onChange={(e) => setThr(+e.target.value)} style={{ maxWidth: 120 }} /></Field><div style={{ alignSelf: 'end' }}><Save1 k="auto_approve_threshold" value={thr} saved={s.auto_approve_threshold} onSaved={reload} /></div></div>}</div></Card>
      <Card title="Pausa geral de envios" actions={<Badge tone={paused ? 'bad' : 'ok'}>{paused ? 'pausado' : 'enviando normalmente'}</Badge>}>
        <div className="row wrap"><div style={{ flex: 1, minWidth: 240 }} className="small muted">Interrompe na hora todas as publicações, respostas e testes de envio. Leituras (status, QR code, buscar grupos) continuam funcionando. Use em caso de erro, bloqueio ou dúvida.</div>
          <Button variant={paused ? 'primary' : 'danger'} icon={paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />} onClick={togglePause}>{paused ? 'Retomar envios' : 'Pausar todos os envios'}</Button></div></Card>
      <div className="grid g2">
        <Card title="Frescor do preço"><div className="col"><Field label="Idade máxima do preço (minutos)" hint="Ofertas com preço mais velho que isso não são aprovadas nem publicadas."><input type="number" min={5} value={age} onChange={(e) => setAge(+e.target.value)} /></Field><div><Save1 k="max_price_age_minutes" value={age} saved={s.max_price_age_minutes} onSaved={reload} /></div></div></Card>
        <Card title="Link curto / redirecionador"><div className="col"><Field label="URL base" hint="Ex.: https://go.seudominio.com.br. Vazio desliga o link curto."><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://" /></Field><div><Save1 k="shortlink_base" value={base} saved={s.shortlink_base ?? ''} onSaved={reload} /></div></div></Card>
      </div>
    </div>);
}

function Compliance({ s, reload }: { s: SettingsMap; reload: () => void }) {
  const [disc, setDisc] = useState(String(s.affiliate_disclosure ?? '')); const [banned, setBanned] = useState(((s.banned_terms as string[]) ?? []).join('\n'));
  const [domains, setDomains] = useState<Record<string, string>>({});
  const sig = JSON.stringify([s.affiliate_disclosure, s.banned_terms, s.allowed_domains]);
  useEffect(() => {
    setDisc(String(s.affiliate_disclosure ?? '')); setBanned(((s.banned_terms as string[]) ?? []).join('\n'));
    setDomains(Object.fromEntries(Object.entries((s.allowed_domains as Record<string, string[]>) ?? {}).map(([k, v]) => [k, v.join(', ')])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const bannedArr = banned.split('\n').map((x) => x.trim()).filter(Boolean);
  const domObj = Object.fromEntries(Object.entries(domains).map(([k, v]) => [k, v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)]));
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="Aviso de afiliado" actions={<Badge tone="ok"><ShieldCheck size={12} />sempre anexado</Badge>}><div className="col"><textarea aria-label="Aviso de afiliado" value={disc} onChange={(e) => setDisc(e.target.value)} /><div><Save1 k="affiliate_disclosure" value={disc} saved={s.affiliate_disclosure} onSaved={reload} /></div></div></Card>
      <div className="grid g2">
        <Card title="Termos proibidos"><div className="col"><Field label="Um por linha" hint="Mensagens com qualquer um desses termos são bloqueadas na aprovação e na edição."><textarea style={{ minHeight: 170 }} value={banned} onChange={(e) => setBanned(e.target.value)} /></Field><div><Save1 k="banned_terms" value={bannedArr} saved={s.banned_terms} onSaved={reload} /></div></div></Card>
        <Card title="Domínios permitidos"><div className="col">{Object.keys(domains).map((p) => <Field key={p} label={p} hint="Separe por vírgula. Subdomínios são aceitos."><input value={domains[p]} onChange={(e) => setDomains({ ...domains, [p]: e.target.value })} /></Field>)}
          <div className="small muted">Confirme sempre o domínio oficial do programa antes de incluir um novo. Links fora da lista são recusados.</div><div><Save1 k="allowed_domains" value={domObj} saved={s.allowed_domains} onSaved={reload} /></div></div></Card>
      </div>
    </div>);
}

function Avancado({ s }: { s: SettingsMap }) {
  const keys = ['dedupe_window_hours', 'republish_drop_pct', 'min_history_observations', 'min_history_days', 'max_attempts', 'claim_lock_seconds', 'review_interval_days', 'retention_days_clicks', 'retention_days_audit', 'timezone'];
  const label: Record<string, string> = { dedupe_window_hours: 'Janela anti-repetição (h)', republish_drop_pct: 'Queda mínima para republicar (%)', min_history_observations: 'Observações mínimas de histórico', min_history_days: 'Dias mínimos de histórico', max_attempts: 'Tentativas máximas de envio', claim_lock_seconds: 'Trava de envio (s)', review_interval_days: 'Revisão de documentação (dias)', retention_days_clicks: 'Retenção de cliques (dias)', retention_days_audit: 'Retenção da auditoria (dias)', timezone: 'Fuso horário' };
  return (
    <Card title="Valores atuais (somente leitura)"><div className="grid g3 small">{keys.map((k) => <div key={k}><span className="muted">{label[k]}</span><div><b>{String(s[k] ?? '—')}</b></div></div>)}</div>
      <div className="small muted" style={{ marginTop: 12 }}>Estes parâmetros mudam o comportamento de segurança do sistema e por isso são ajustados por migração SQL, não por esta tela.</div></Card>);
}

export default function SettingsPage() {
  const { isAdmin } = useSession();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find((t) => t.v === sp.get('aba'))?.v ?? 'operacao') as Tab;
  const q = useLoad(async () => ({ s: await api().getSettings(), sec: await api().listIntegrationSecrets().catch(() => [] as SecretInfo[]) }), [], 8000);
  if (q.loading && !q.data) return <Loading />;
  if (q.error && !q.data) return <ErrorBox error={q.error} retry={q.reloadLoud} />;
  const s = q.data!.s, secrets = q.data!.sec; const reload = () => void q.reload();
  const evo = statusOf(s, 'evolution'), tg = statusOf(s, 'telegram');
  const dot = (tone: string) => <span className={`sdot ${tone}`} aria-hidden />;
  const evoTone = evo.state === 'open' ? 'ok' : evo.state ? 'bad' : 'off';
  const tgCfg = (s.int_telegram as { enabled?: boolean } | undefined)?.enabled; const tgTone = !tgCfg ? 'off' : tg.ok === true ? 'ok' : tg.ok === false ? 'bad' : 'warn';
  const props = { s, secrets, reload, isAdmin };
  return (
    <>
      <PageHead title="Configurações" sub={isAdmin ? 'Integrações, modo de operação e regras do sistema. Cada alteração é auditada.' : 'Somente administradores podem alterar. Você pode consultar.'} />
      <div className="setlayout">
        <nav className="setnav" aria-label="Seções das configurações">
          {TABS.map((t) => <button key={t.v} type="button" aria-current={tab === t.v ? 'page' : undefined} onClick={() => setSp(t.v === 'operacao' ? {} : { aba: t.v }, { replace: true })}>
            {t.icon}<span>{t.label}</span>{t.v === 'whatsapp' && dot(evoTone)}{t.v === 'telegram' && dot(tgTone)}</button>)}
        </nav>
        <div className="setbody" style={{ minWidth: 0 }}>
          {tab === 'operacao' && <fieldset disabled={!isAdmin} className="bare"><Operacao s={s} reload={reload} /></fieldset>}
          {tab === 'whatsapp' && <WhatsAppTab {...props} />}
          {tab === 'telegram' && <TelegramTab {...props} />}
          {tab === 'n8n' && <N8nTab {...props} />}
          {tab === 'banco' && <DatabaseTab isAdmin={isAdmin} />}
          {tab === 'compliance' && <fieldset disabled={!isAdmin} className="bare"><Compliance s={s} reload={reload} /></fieldset>}
          {tab === 'avancado' && <Avancado s={s} />}
        </div>
      </div>
    </>);
}
