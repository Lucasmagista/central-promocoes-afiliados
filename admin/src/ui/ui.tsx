import { api } from '../lib/api';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Loader2, Inbox } from 'lucide-react';

export function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

/* ---------- hooks ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try { const r = await fn(); if (my === seq.current) { setData(r); setError(null); } }
    catch (e) { if (my === seq.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  useEffect(() => { if (!pollMs) return; const t = setInterval(() => void run(true), pollMs); return () => clearInterval(t); }, [pollMs, run]);
  return { data, error, loading, reload: () => run(true), reloadLoud: () => run(false) };
}

/* ---------- toasts + diálogos ---------- */
interface Toast { id: number; kind: 'ok' | 'err' | 'info'; msg: string }
interface Dialogs {
  toast: (msg: string, kind?: Toast['kind']) => void;
  confirm: (o: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; label: string; placeholder?: string; required?: boolean; confirmLabel?: string; multiline?: boolean; initial?: string }) => Promise<string | null>;
}
const Ctx = createContext<Dialogs>(null as never);
export const useDialogs = () => useContext(Ctx);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<null | { kind: 'confirm' | 'prompt'; o: any; resolve: (v: any) => void }>(null);
  const [val, setVal] = useState('');
  const n = useRef(0);
  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = ++n.current; setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3800);
  }, []);
  const api: Dialogs = {
    toast,
    confirm: (o) => new Promise((resolve) => setDlg({ kind: 'confirm', o, resolve })),
    prompt: (o) => new Promise((resolve) => { setVal(o.initial ?? ''); setDlg({ kind: 'prompt', o, resolve }); }),
  };
  const close = (v: unknown) => { dlg?.resolve(v); setDlg(null); };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={cx('toast', t.kind === 'err' && 'err', t.kind === 'ok' && 'ok')}>{t.msg}</div>)}</div>
      {dlg && (
        <Modal title={dlg.o.title} onClose={() => close(dlg.kind === 'confirm' ? false : null)}
          footer={<>
            <Button onClick={() => close(dlg.kind === 'confirm' ? false : null)}>Cancelar</Button>
            <Button variant={dlg.o.danger ? 'danger' : 'primary'} disabled={dlg.kind === 'prompt' && dlg.o.required && !val.trim()}
              onClick={() => close(dlg.kind === 'confirm' ? true : val.trim())}>{dlg.o.confirmLabel ?? 'Confirmar'}</Button></>}>
          {dlg.kind === 'confirm' ? <div>{dlg.o.body}</div> : (
            <label className="f">{dlg.o.label}
              {dlg.o.multiline ? <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={dlg.o.placeholder} />
                : <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={dlg.o.placeholder}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (!dlg.o.required || val.trim())) close(val.trim()); }} />}
            </label>)}
        </Modal>)}
    </Ctx.Provider>
  );
}

/* ---------- primitivos ---------- */
export function Button({ variant = 'default', size, icon, busy, children, ...p }:
  { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm'; icon?: ReactNode; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} disabled={p.disabled || busy} className={cx('btn', variant !== 'default' && variant, size, !children && 'icon', p.className)}>
    {busy ? <Loader2 size={15} className="spin-i" style={{ animation: 'sp .7s linear infinite' }} /> : icon}{children}</button>;
}
export const Badge = ({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'accent'; children: ReactNode }) => <span className={cx('badge', tone)}>{children}</span>;
export function Card({ title, actions, children, flush, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={cx('card', className)}>{(title || actions) && <div className="hd"><h2>{title}</h2><div className="right row">{actions}</div></div>}<div className={cx('bd', flush && 'flush')}>{children}</div></section>;
}
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="toggle" onClick={() => onChange(!checked)} />;
}
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="f">{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return <div className="seg" role="group">{options.map((o) => <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>;
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { v: T; label: string }[] }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.v} role="tab" aria-selected={value === t.v} onClick={() => onChange(t.v)}>{t.label}</button>)}</div>;
}
export const Empty = ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => <div className="empty">{icon ?? <Inbox size={30} />}<div>{children}</div></div>;
export const Loading = () => <div className="loading"><span className="spin" role="progressbar" aria-label="Carregando" /></div>;
export const ErrorBox = ({ error, retry }: { error: string; retry?: () => void }) =>
  <div className="alert critical" role="alert"><div style={{ flex: 1 }}>{error}</div>{retry && <Button size="sm" onClick={retry}>Tentar de novo</Button>}</div>;
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return <div className="pagehead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="right row wrap">{children}</div></div>;
}

function useEsc(fn: () => void) { useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && fn(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [fn]); }
export function Modal({ title, children, footer, onClose, wide }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEsc(onClose);
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="hd"><h2>{title}</h2><Button className="right" variant="ghost" aria-label="Fechar" onClick={onClose} icon={<X size={18} />} /></div>
      <div className="bd">{children}</div>{footer && <div className="ft">{footer}</div>}</div></div>;
}
export function Drawer({ title, children, onClose, footer }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEsc(onClose);
  return <><div className="overlay" style={{ zIndex: 50 }} onMouseDown={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true"><div className="hd"><div style={{ flex: 1, minWidth: 0 }}>{title}</div>
      <Button variant="ghost" aria-label="Fechar" onClick={onClose} icon={<X size={18} />} /></div><div className="bd">{children}</div>{footer && <div className="ft">{footer}</div>}</aside></>;
}

/* ---------- ações assíncronas com tratamento de erro ---------- */
export function useAction() {
  const { toast } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try { await fn(); if (okMsg) toast(okMsg, 'ok'); return true; }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); return false; }
    finally { setBusy(null); }
  };
  return { busy, run };
}

/* ---------- peças do novo sistema visual ---------- */
export const Kbd = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

export function PriceTag({ value, size }: { value: string; size?: 'sm' | 'lg' }) {
  return <span className={cx('ptag', size)}>{value}</span>;
}

const AV = ['#2563eb', '#7c3aed', '#db2777', '#0f766e', '#c2410c', '#4d7c0f', '#0369a1', '#a21caf', '#b45309'];
export function Avatar({ name, size, square, color }: { name: string; size?: 'sm' | 'lg'; square?: boolean; color?: string }) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ini = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? '').join('') || '?';
  return <span className={cx('avatar', size, square && 'sq')} style={{ background: color ?? AV[h % AV.length] }} aria-hidden>{ini}</span>;
}

/* ordenação + paginação client-side */
export function useTable<T>(rows: T[], accessors: Record<string, (r: T) => string | number | null>, initial?: { key: string; dir: 'asc' | 'desc' }, pageSize = 15) {
  const [sort, setSort] = useState(initial ?? null);
  const [page, setPage] = useState(0);
  const sorted = (() => {
    if (!sort) return rows;
    const g = accessors[sort.key]; if (!g) return rows;
    return rows.slice().sort((a, b) => {
      const x = g(a), y = g(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return sort.dir === 'asc' ? c : -c;
    });
  })();
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  return {
    rows: sorted.slice(cur * pageSize, cur * pageSize + pageSize), total: sorted.length, page: cur, pages, setPage, sort,
    toggle: (key: string) => { setPage(0); setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' })); },
  };
}
export function Th({ t, k, children, className }: { t: ReturnType<typeof useTable<any>>; k: string; children: ReactNode; className?: string }) {
  const on = t.sort?.key === k;
  return <th className={cx('sortable', className)} aria-sort={on ? (t.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => t.toggle(k)} tabIndex={0}
    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && t.toggle(k)}>{children}<span className="arr">{on ? (t.sort!.dir === 'asc' ? '▲' : '▼') : ''}</span></th>;
}
export function Pager({ t, label = 'itens' }: { t: ReturnType<typeof useTable<any>>; label?: string }) {
  if (t.total === 0) return null;
  return <div className="pager"><span>{t.total} {label}</span><span className="right row">
    <Button size="sm" disabled={t.page === 0} onClick={() => t.setPage(t.page - 1)}>Anterior</Button>
    <span>{t.page + 1} de {t.pages}</span>
    <Button size="sm" disabled={t.page >= t.pages - 1} onClick={() => t.setPage(t.page + 1)}>Próxima</Button></span></div>;
}
export function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  return {
    sel, count: sel.size, has: (id: string) => sel.has(id), clear: () => setSel(new Set()),
    toggle: (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; }),
  };
}
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map); ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = ref.current[e.key]; if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}

/** Acompanha uma tarefa de canal (buscar grupos, criar grupo…) até terminar. */
export function useJob(id: string | null) {
  const [job, setJob] = useState<import('../lib/types').ChannelJob | null>(null);
  useEffect(() => {
    setJob(null); if (!id) return;
    let stop = false; let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const j = await api().getJob(id); if (stop) return; setJob(j); if (['done', 'failed', 'cancelled'].includes(j.status)) return; } catch { /* tenta de novo */ }
      t = setTimeout(tick, 1000);
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  return job;
}
