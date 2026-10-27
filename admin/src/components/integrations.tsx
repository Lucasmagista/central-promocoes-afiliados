import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Copy, KeyRound, Loader2, TriangleAlert, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import type { IntProvider, SecretInfo, SecretKey, SettingsMap } from '../lib/types';
import { Badge, Button, useAction, useDialogs, useJob } from '../ui/ui';

/** Estado mais recente de uma integração, gravado pelo n8n em settings (int_status_<provedor>). */
export type IntStatus = Record<string, unknown> & { checked_at?: string };
export const statusOf = (s: SettingsMap, p: IntProvider): IntStatus => ((s[`int_status_${p}`] as IntStatus | undefined) ?? {});
export const cfgOf = <T,>(s: SettingsMap, p: 'evolution' | 'telegram' | 'n8n', fallback: T): T => ({ ...fallback, ...((s[`int_${p}`] as object | undefined) ?? {}) });

export function CopyBtn({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const { toast } = useDialogs();
  return <Button size="sm" icon={<Copy size={13} />} onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Copiado', 'ok'); } catch { toast('Não foi possível copiar. Selecione o texto e use Ctrl+C.', 'err'); } }}>{label}</Button>;
}

/** Dispara uma ação do painel (executada pelo n8n) e acompanha a tarefa até o fim. */
export function useIntAction() {
  const { toast } = useDialogs();
  const [jobId, setJobId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [starting, setStarting] = useState(false);
  const [since, setSince] = useState(0);
  const job = useJob(jobId);
  const start = async (provider: IntProvider, action: string, payload?: Record<string, unknown>, lbl = '') => {
    setStarting(true); setLabel(lbl);
    try { const id = await api().requestIntegrationAction(provider, action, payload); setSince(Date.now()); setJobId(id); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    finally { setStarting(false); }
  };
  const running = starting || (!!jobId && (!job || job.status === 'pending' || job.status === 'claimed'));
  return { start, job, running, label, since, clear: () => setJobId(null), result: (job?.status === 'done' ? job.result : null) as Record<string, any> | null };
}
export type IntAct = ReturnType<typeof useIntAction>;

/** Faixa de resultado da última ação: andamento, erro explicado ou sucesso. */
export function ActionBanner({ act, okText }: { act: IntAct; okText?: (r: Record<string, any>) => ReactNode }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!act.running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [act.running]);
  if (!act.job && !act.running) return null;
  if (act.running) {
    const waited = act.since ? (Date.now() - act.since) / 1000 : 0;
    return <div className="alert info" role="status"><Loader2 size={16} style={{ animation: 'sp .7s linear infinite', flex: 'none', marginTop: 2 }} />
      <div>{act.label || 'Executando'}… aguardando o n8n.{waited > 20 && <div className="small" style={{ fontWeight: 400 }}>Está demorando. Confira se o workflow “Central — Ações do painel” está ativo no n8n (Configurações → n8n).</div>}</div></div>;
  }
  const j = act.job!;
  if (j.status === 'failed') return <div className="alert critical" role="alert"><XCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{j.last_error || 'A ação falhou.'}</div></div>;
  if (j.status === 'cancelled') return <div className="alert warning"><div>Ação cancelada.</div></div>;
  const r = (j.result ?? {}) as Record<string, any>;
  if (r.ok === false && (r.checks || r.webhooks) && okText) return <div className="alert warning" role="status"><TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{okText(r)}</div></div>;
  if (r.ok === false) return <div className="alert critical" role="alert"><XCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{String(r.error ?? 'Não foi possível validar.')}</div></div>;
  return <div className={`alert ${r.partial ? 'warning' : 'info'}`} style={r.partial ? undefined : { background: 'var(--ok-soft)', color: 'var(--ok)' }} role="status">
    {r.partial ? <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /> : <CheckCircle2 size={16} style={{ flex: 'none', marginTop: 2 }} />}
    <div>{okText ? okText(r) : r.detail ? String(r.detail) : 'Concluído.'}</div></div>;
}

/** Campo de segredo só de escrita: o valor digitado vai direto ao cofre e nunca volta ao navegador. */
export function SecretField({ k, label, hint, info, disabled, placeholder, onChanged }: {
  k: SecretKey; label: string; hint?: ReactNode; info?: SecretInfo; disabled?: boolean; placeholder?: string; onChanged: () => void;
}) {
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  const [val, setVal] = useState(''); const [edit, setEdit] = useState(false);
  const isSet = !!info?.is_set; const showInput = !isSet || edit;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) ref.current?.focus(); }, [edit]);
  const save = async () => {
    if (!val.trim()) return;
    if (await run(`sec-${k}`, () => api().setIntegrationSecret(k, val), 'Chave guardada com segurança')) { setVal(''); setEdit(false); onChanged(); }
  };
  return (
    <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{label}</span>
      {showInput ? (
        <div className="row">
          <input ref={ref} type="password" autoComplete="new-password" spellCheck={false} aria-label={label} value={val} disabled={disabled}
            placeholder={placeholder ?? 'Cole aqui'} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} style={{ flex: 1, minWidth: 0 }} />
          <Button variant="primary" size="sm" icon={<KeyRound size={14} />} disabled={disabled || !val.trim()} busy={busy === `sec-${k}`} onClick={save}>Guardar</Button>
          {isSet && <Button size="sm" onClick={() => { setEdit(false); setVal(''); }}>Cancelar</Button>}
        </div>
      ) : (
        <div className="row wrap secretrow">
          <Badge tone="ok"><CheckCircle2 size={12} />guardada</Badge>
          <code>••••••••{info?.hint}</code>
          {info?.updated_at && <span className="small muted">alterada {ago(info.updated_at)}</span>}
          <span className="right row">
            <Button size="sm" disabled={disabled} onClick={() => setEdit(true)}>Trocar</Button>
            <Button size="sm" variant="danger" disabled={disabled} busy={busy === `clr-${k}`} onClick={async () => {
              if (await confirm({ title: 'Remover chave?', danger: true, confirmLabel: 'Remover', body: 'A integração para de funcionar até você informar a chave de novo.' }))
                if (await run(`clr-${k}`, () => api().clearIntegrationSecret(k), 'Chave removida')) onChanged();
            }}>Remover</Button></span>
        </div>)}
      {hint && <span className="hint">{hint}</span>}
    </div>);
}

export function StateDot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }) { return <span className={`sdot ${tone}`} aria-hidden />; }

export function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: ReactNode }) {
  return <li className={done ? 'step done' : 'step'}><span className="stepn">{done ? '✓' : n}</span><div><b>{title}</b>{children && <div className="small muted" style={{ marginTop: 2 }}>{children}</div>}</div></li>;
}

export const checkedAt = (st: IntStatus) => (st.checked_at ? `verificado ${ago(st.checked_at)}` : 'ainda não verificado');
