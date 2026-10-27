import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Moon, Sun, Tag as TagIcon, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { int } from '../lib/format';
import type { Channel } from '../lib/types';
import { Button, useLoad } from '../ui/ui';
import Messenger from './Messenger';
import GroupsView from './GroupsView';

/** Tela cheia das conversas: pensada para ficar aberta em outra aba/monitor, sem o menu lateral. */
export default function ConversasFull() {
  const { dark, toggleDark } = useSession();
  const [sp, setSp] = useSearchParams();
  const channel: Channel = sp.get('canal') === 'telegram' ? 'telegram' : 'whatsapp';
  const view = sp.get('v') === 'grupos' ? 'grupos' : 'conversas';
  const wa = useLoad(() => api().channelOverview('whatsapp'), [], 6000);
  const tg = useLoad(() => api().channelOverview('telegram'), [], 6000);
  const set = (patch: Record<string, string | null>) => setSp((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return n; });
  useEffect(() => { const total = (wa.data?.unread ?? 0) + (tg.data?.unread ?? 0); document.title = total ? `(${total}) Conversas — Central de Promoções` : 'Conversas — Central de Promoções'; }, [wa.data, tg.data]);
  const o = channel === 'whatsapp' ? wa.data : tg.data;
  const tabs: [Channel, string, number | undefined][] = [['whatsapp', 'WhatsApp', wa.data?.unread], ['telegram', 'Telegram', tg.data?.unread]];

  return (
    <div className="fullapp">
      <header className="fulltop">
        <Link to="/" className="row" style={{ gap: 10, color: 'inherit', textDecoration: 'none', fontFamily: 'var(--display)', fontWeight: 700 }} title="Voltar ao painel">
          <span className="logo" style={{ width: 30, height: 30, borderRadius: '9px 9px 9px 3px', background: 'var(--tag)', color: 'var(--tag-ink)', display: 'grid', placeItems: 'center' }}><TagIcon size={16} strokeWidth={2.4} /></span>
          <span className="hide-sm">Conversas</span></Link>
        <div className="seg" role="tablist" aria-label="Canal">
          {tabs.map(([c, l, n]) => <button key={c} role="tab" aria-selected={channel === c} aria-pressed={channel === c} onClick={() => set({ canal: c, c: null })}>{l}{n ? <span className="count" style={{ marginLeft: 6 }}>{n}</span> : null}</button>)}
        </div>
        <div className="seg" role="tablist" aria-label="Visão">
          <button aria-pressed={view === 'conversas'} onClick={() => set({ v: null })}><MessageCircle size={14} style={{ verticalAlign: -2 }} /> Conversas</button>
          <button aria-pressed={view === 'grupos'} onClick={() => set({ v: 'grupos' })}><Users size={14} style={{ verticalAlign: -2 }} /> Grupos</button>
        </div>
        <div className="row hide-sm" style={{ gap: 20, marginLeft: 'auto' }}>
          <span className="small muted"><b style={{ color: 'var(--ink)' }}>{o ? int(o.groups) : '—'}</b> grupos</span>
          <span className="small muted"><b style={{ color: 'var(--ink)' }}>{o ? int(o.participants) : '—'}</b> pessoas</span>
          <span className="small muted"><b style={{ color: 'var(--ink)' }}>{o ? int(o.messages_in_24h) : '—'}</b> recebidas (24 h)</span>
          <span className="small muted"><b style={{ color: 'var(--ink)' }}>{o ? int(o.outbox_pending) : '—'}</b> na fila</span>
        </div>
        <Button variant="ghost" aria-label={dark ? 'Tema claro' : 'Tema escuro'} onClick={toggleDark} icon={dark ? <Sun size={18} /> : <Moon size={18} />} />
        <Link className="btn" to="/"><ArrowLeft size={15} /><span className="hide-sm">Painel</span></Link>
      </header>
      <main className="fullmain">
        {view === 'conversas' ? <Messenger key={channel} channel={channel} full /> : <GroupsView key={channel} channel={channel} onOpen={(id) => set({ v: null, c: id })} />}
      </main>
    </div>);
}
