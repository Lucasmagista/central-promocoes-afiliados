import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, OctagonAlert, AlertTriangle, Info, MessageCircle, CheckCircle2 } from 'lucide-react';
import type { ChannelOverview, DashboardSummary } from '../lib/types';
import { Button } from '../ui/ui';

const target: Record<string, string> = { unknown: '/publicacoes', failed: '/publicacoes', stale_review: '/revisao', paused: '/configuracoes', no_destination: '/destinos', connector_paused: '/conectores', connector_error: '/conectores', review_due: '/conectores', heartbeat: '/saude' };

export function Notifications({ dash, wa, tg }: { dash: DashboardSummary | null; wa: ChannelOverview | null; tg: ChannelOverview | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const alerts = dash?.alerts.filter((a) => a.level !== 'info') ?? [];
  const msgs: { to: string; text: string }[] = [];
  if (wa?.unread) msgs.push({ to: '/whatsapp', text: `${wa.unread} mensagem(ns) não lida(s) no WhatsApp` });
  if (tg?.unread) msgs.push({ to: '/telegram', text: `${tg.unread} mensagem(ns) não lida(s) no Telegram` });
  if (dash?.offers.needs_review) msgs.push({ to: '/revisao', text: `${dash.offers.needs_review} oferta(s) esperando aprovação` });
  const n = alerts.length + msgs.length;
  const ic = { critical: <OctagonAlert size={17} color="var(--bad)" />, warning: <AlertTriangle size={17} color="var(--warn)" />, info: <Info size={17} /> };
  return (
    <div className="relw" ref={ref}>
      <Button variant="ghost" aria-label={`Notificações${n ? `, ${n} pendentes` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} icon={<Bell size={18} />} />
      {n > 0 && <span className="bellbadge" aria-hidden>{n}</span>}
      {open && <div className="pop" role="dialog" aria-label="Notificações">
        {n === 0 ? <div className="empty" style={{ padding: 28 }}><CheckCircle2 size={26} />Tudo em dia por aqui.</div> : <>
          {alerts.map((a) => <Link key={a.code + a.message} className="it" to={target[a.code] ?? '/saude'} onClick={() => setOpen(false)}>{ic[a.level]}<span>{a.message}</span></Link>)}
          {msgs.map((m) => <Link key={m.to} className="it" to={m.to} onClick={() => setOpen(false)}><MessageCircle size={17} color="var(--muted)" /><span>{m.text}</span></Link>)}</>}
      </div>}
    </div>);
}
