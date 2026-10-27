import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Tag, LayoutDashboard, ListChecks, PlusCircle, Send, Radio, Plug, FileText, BarChart3, ScrollText, HeartPulse, Settings, Users, MessageCircle, Moon, PauseCircle, Keyboard } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import type { Offer } from '../lib/types';
import { Kbd } from '../ui/ui';

interface Item { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }

export function CommandPalette({ onClose, onTogglePause, onHelp }: { onClose: () => void; onTogglePause: () => void; onHelp: () => void }) {
  const nav = useNavigate();
  const { toggleDark } = useSession();
  const [q, setQ] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setOffers([]); return; }
    let live = true; const t = setTimeout(() => { api().listOffers({ q, limit: 6 }).then((r) => live && setOffers(r)).catch(() => {}); }, 160);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const go = (to: string) => () => { nav(to); onClose(); };
  const base: Item[] = useMemo(() => [
    { id: 'n1', group: 'Ir para', label: 'Visão geral', icon: <LayoutDashboard size={16} />, run: go('/') },
    { id: 'n2', group: 'Ir para', label: 'Fila de aprovação', icon: <ListChecks size={16} />, run: go('/revisao') },
    { id: 'n3', group: 'Ir para', label: 'Ofertas', icon: <Tag size={16} />, run: go('/ofertas') },
    { id: 'n4', group: 'Ir para', label: 'Publicações', icon: <Send size={16} />, run: go('/publicacoes') },
    { id: 'n5', group: 'Ir para', label: 'WhatsApp — conversas e grupos', icon: <MessageCircle size={16} />, run: go('/whatsapp') },
    { id: 'n6', group: 'Ir para', label: 'Telegram — conversas e canais', icon: <Send size={16} />, run: go('/telegram') },
    { id: 'n7', group: 'Ir para', label: 'Destinos', icon: <Radio size={16} />, run: go('/destinos') },
    { id: 'n8', group: 'Ir para', label: 'Conectores', icon: <Plug size={16} />, run: go('/conectores') },
    { id: 'n9', group: 'Ir para', label: 'Templates', icon: <FileText size={16} />, run: go('/templates') },
    { id: 'n10', group: 'Ir para', label: 'Analytics', icon: <BarChart3 size={16} />, run: go('/analytics') },
    { id: 'n11', group: 'Ir para', label: 'Saúde do sistema', icon: <HeartPulse size={16} />, run: go('/saude') },
    { id: 'n12', group: 'Ir para', label: 'Auditoria', icon: <ScrollText size={16} />, run: go('/auditoria') },
    { id: 'n13', group: 'Ir para', label: 'Configurações', icon: <Settings size={16} />, run: go('/configuracoes') },
    { id: 'n14', group: 'Ir para', label: 'Usuários', icon: <Users size={16} />, run: go('/usuarios') },
    { id: 'a1', group: 'Ações', label: 'Cadastrar nova oferta', icon: <PlusCircle size={16} />, run: go('/ofertas/nova') },
    { id: 'a2', group: 'Ações', label: 'Pausar ou retomar publicações', icon: <PauseCircle size={16} />, run: () => { onClose(); onTogglePause(); } },
    { id: 'a3', group: 'Ações', label: 'Alternar tema claro/escuro', icon: <Moon size={16} />, run: () => { toggleDark(); onClose(); } },
    { id: 'a4', group: 'Ações', label: 'Ver atalhos de teclado', icon: <Keyboard size={16} />, run: () => { onClose(); onHelp(); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = base.filter((i) => !t || i.label.toLowerCase().includes(t));
    const o: Item[] = offers.map((x) => ({ id: 'o' + x.id, group: 'Ofertas', label: x.title, hint: x.status, icon: <Tag size={16} />, run: go('/ofertas?abrir=' + x.id) }));
    return [...o, ...f];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, offers, base]);
  useEffect(() => setIdx(0), [q]);
  useEffect(() => { ref.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [idx]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[idx]?.run(); }
    else if (e.key === 'Escape') onClose();
  };
  let last = '';
  return (
    <div className="overlay" style={{ alignItems: 'flex-start' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <div className="row" style={{ borderBottom: '1px solid var(--line)', paddingLeft: 16 }}><Search size={18} color="var(--muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Buscar oferta, ir para uma tela ou executar uma ação" aria-label="Buscar" style={{ borderBottom: 0 }} /></div>
        <ul ref={ref} role="listbox">
          {items.length === 0 && <li style={{ cursor: 'default', color: 'var(--muted)' }}>Nada encontrado para “{q}”.</li>}
          {items.map((it, i) => { const head = it.group !== last; last = it.group; return (
            <li key={it.id} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={it.run} style={head ? { marginTop: 0 } : undefined}>
              {it.icon}<span className="truncate">{it.label}</span><span className="hint">{it.hint ?? it.group}</span></li>); })}
        </ul>
        <div className="row small muted" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)' }}><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar <Kbd>Enter</Kbd> abrir <Kbd>Esc</Kbd> fechar</div>
      </div>
    </div>);
}
