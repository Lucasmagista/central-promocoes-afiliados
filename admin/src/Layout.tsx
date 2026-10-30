import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Tag, Send, Radio, Plug, FileText, BarChart3, ScrollText, HeartPulse, Settings, Users, Menu, Moon, Sun, LogOut, PauseCircle, PlayCircle, FlaskConical, MessageCircle, Search, Radar, Workflow, Eye, PanelLeftClose, PanelLeftOpen, Tag as TagIcon, ChevronDown, ExternalLink, Plus } from 'lucide-react';
import { api } from './lib/api';
import { useSession } from './session';
import { Avatar, Button, Kbd, useAction, useDialogs, useLoad } from './ui/ui';
import { roleLabel } from './lib/format';
import { CommandPalette } from './components/CommandPalette';
import { Shortcuts } from './components/Shortcuts';
import { Notifications } from './components/Notifications';

type Badge = 'review' | 'alerts' | 'wa' | 'tg';
const NAV: { group: string; items: { to: string; label: string; icon: React.ReactNode; badge?: Badge; full?: string }[] }[] = [
  { group: 'Operação', items: [
    { to: '/', label: 'Visão geral', icon: <LayoutDashboard size={18} /> },
    { to: '/revisao', label: 'Fila de aprovação', icon: <ListChecks size={18} />, badge: 'review' },
    { to: '/ofertas', label: 'Ofertas', icon: <Tag size={18} /> },
    { to: '/publicacoes', label: 'Publicações', icon: <Send size={18} />, badge: 'alerts' },
  ] },
  { group: 'Conversas', items: [
    { to: '/whatsapp', label: 'WhatsApp', icon: <MessageCircle size={18} />, badge: 'wa', full: 'whatsapp' },
    { to: '/telegram', label: 'Telegram', icon: <Send size={18} style={{ transform: 'rotate(-20deg)' }} />, badge: 'tg', full: 'telegram' },
  ] },
  { group: 'Automação', items: [
    { to: '/radar', label: 'Radar de grupos', icon: <Radar size={18} /> },
    { to: '/automacao', label: 'Regras e automação', icon: <Workflow size={18} /> },
    { to: '/acompanhar', label: 'Produtos acompanhados', icon: <Eye size={18} /> },
  ] },
  { group: 'Configuração', items: [
    { to: '/destinos', label: 'Destinos', icon: <Radio size={18} /> },
    { to: '/conectores', label: 'Conectores', icon: <Plug size={18} /> },
    { to: '/templates', label: 'Templates', icon: <FileText size={18} /> },
    { to: '/configuracoes', label: 'Configurações', icon: <Settings size={18} /> },
  ] },
  { group: 'Análise e controle', items: [
    { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
    { to: '/saude', label: 'Saúde do sistema', icon: <HeartPulse size={18} /> },
    { to: '/auditoria', label: 'Auditoria', icon: <ScrollText size={18} /> },
    { to: '/usuarios', label: 'Usuários', icon: <Users size={18} /> },
  ] },
];
const GOTO: Record<string, string> = { v: '/', r: '/revisao', o: '/ofertas', p: '/publicacoes', w: '/whatsapp', t: '/telegram', d: '/destinos', a: '/analytics' };

export default function Layout() {
  const { state, dark, toggleDark, refresh, canOperate, isAdmin } = useSession();
  const { prompt, confirm } = useDialogs();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('mini') === '1'; } catch { return false; } });
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('navclosed') ?? '[]'); } catch { return []; } });
  const toggleGroup = (g: string) => setClosed((c) => { const n = c.includes(g) ? c.filter((x) => x !== g) : [...c, g]; try { localStorage.setItem('navclosed', JSON.stringify(n)); } catch { /* sem storage */ } return n; });
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const dash = useLoad(() => api().dashboard(), [], 15000);
  const wa = useLoad(() => api().channelOverview('whatsapp'), [], 8000);
  const tg = useLoad(() => api().channelOverview('telegram'), [], 8000);
  const d = dash.data;

  const togglePause = async () => {
    if (!d) return;
    if (d.paused) {
      if (!isAdmin) return;
      if (!(await confirm({ title: 'Retomar publicações?', body: 'O worker volta a enviar o que estiver na fila, respeitando limites e horário de silêncio.', confirmLabel: 'Retomar' }))) return;
      await run('pause', () => api().setPaused(false), 'Publicações retomadas'); void dash.reload();
    } else {
      if (!canOperate) return;
      const reason = await prompt({ title: 'Pausar todas as publicações', label: 'Motivo (fica na auditoria)', required: true, confirmLabel: 'Pausar tudo', placeholder: 'Ex.: instabilidade no WhatsApp' });
      if (reason === null) return;
      await run('pause', () => api().setPaused(true, reason), 'Publicações pausadas'); void dash.reload();
    }
  };
  const pauseRef = useRef(togglePause); pauseRef.current = togglePause;

  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setMini((m) => !m); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  useEffect(() => { try { localStorage.setItem('mini', mini ? '1' : '0'); } catch { /* sem storage */ } }, [mini]);
  useEffect(() => {
    let g = 0;
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') { setHelp(true); return; }
      if (g && Date.now() - g < 1200) { const to = GOTO[e.key.toLowerCase()]; g = 0; if (to) { e.preventDefault(); nav(to); } return; }
      if (e.key === 'g') g = Date.now();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [nav]);

  if (state?.status !== 'ready') return null;
  const profile = state.profile;
  const worst = d?.heartbeats.some((h) => h.status === 'down') ? 'down' : d?.heartbeats.some((h) => h.status === 'degraded') ? 'degraded' : 'ok';
  const sys = !d ? { tone: '', label: 'Carregando…', detail: '' }
    : d.paused ? { tone: 'warn', label: 'Publicação pausada', detail: 'Nada está sendo enviado' }
    : worst === 'down' ? { tone: 'bad', label: 'Serviço fora do ar', detail: 'Veja Saúde do sistema' }
    : worst === 'degraded' ? { tone: 'warn', label: 'Serviço instável', detail: 'Veja Saúde do sistema' }
    : { tone: 'ok', label: d.mode === 'auto' ? 'Automático' : d.mode === 'review' ? 'Revisão humana' : 'Simulação', detail: `${d.publications.pending} na fila · ${d.publications.sent_24h} enviadas em 24 h` };
  const count = (b?: Badge) => {
    if (!b) return null;
    const n = b === 'review' ? d?.offers.needs_review : b === 'alerts' ? (d ? d.publications.unknown + d.publications.failed : 0) : b === 'wa' ? wa.data?.unread : tg.data?.unread;
    return n ? <span className={`count${b === 'alerts' ? ' bad' : ''}`}>{n}</span> : null;
  };
  return (
    <div className={`shell${mini ? ' mini' : ''}`}>
      <button type="button" className="edgehandle" onClick={() => setMini(!mini)} aria-label={mini ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={mini ? 'Expandir menu (Ctrl B)' : 'Recolher menu (Ctrl B)'}>{mini ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side${open ? ' open' : ''}`} aria-label="Navegação principal">
        <div className="brand"><span className="logo"><TagIcon size={18} strokeWidth={2.4} /></span><span>Central de Promoções</span></div>
        <button className="sidesearch" onClick={() => setPalette(true)} aria-label="Buscar ou ir para" data-tip="Buscar (Ctrl K)"><Search size={16} /><span className="lbl">Buscar ou ir para…</span><Kbd>Ctrl K</Kbd></button>
        {canOperate && <NavLink to="/ofertas/nova" className="sidecta" onClick={() => setOpen(false)} data-tip="Nova oferta" aria-label="Nova oferta"><Plus size={18} strokeWidth={2.6} /><span className="lbl">Nova oferta</span></NavLink>}
        <nav className="navscroll">
          {NAV.map((g) => { const shut = closed.includes(g.group) && !mini; return (
            <div key={g.group} className="navsec">
              <button className="navgroup" aria-expanded={!shut} onClick={() => toggleGroup(g.group)}><span>{g.group}</span><ChevronDown size={14} style={{ transform: shut ? 'rotate(-90deg)' : 'none' }} /></button>
              {!shut && g.items.map((i) => (
                <div key={i.to} className="navrow">
                  <NavLink to={i.to} end={i.to === '/' || i.to === '/ofertas'} data-tip={i.label} aria-label={i.label}
                    className={({ isActive }) => `nav${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>{i.icon}<span className="lbl">{i.label}</span>{count(i.badge)}</NavLink>
                  {i.full && !mini && <a className="navext" href={`#/conversas?canal=${i.full}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${i.label} em tela cheia, em nova aba`} title="Abrir em tela cheia (nova aba)"><ExternalLink size={14} /></a>}
                </div>))}
            </div>); })}
        </nav>
        <div className={`sidestatus ${sys.tone}`} title={sys.detail}><span className="dot" /><span className="lbl"><b>{sys.label}</b><small>{sys.detail}</small></span></div>
        <div className="sideuser">
          <Avatar name={profile.name ?? profile.email} size="sm" color="#2b3b5e" />
          <span className="lbl"><b>{profile.name ?? profile.email}</b><small>{roleLabel[profile.role]} · {api().mode === 'demo' ? 'demonstração' : 'Supabase'}</small></span>
          <Button size="sm" variant="ghost" aria-label={mini ? 'Expandir menu' : 'Recolher menu'} title={mini ? 'Expandir menu (Ctrl B)' : 'Recolher menu (Ctrl B)'} onClick={() => setMini(!mini)} icon={mini ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />} />
        </div>
      </aside>
      <div className="main">
        {api().mode === 'demo' && <div className="banner demo"><FlaskConical size={17} />Modo demonstração: dados fictícios em memória. Nada é enviado de verdade e nada é salvo.</div>}
        {d?.paused && <div className="banner pause" role="alert"><PauseCircle size={18} />Publicação pausada globalmente.
          {isAdmin && <Button size="sm" className="right" onClick={togglePause} busy={busy === 'pause'} icon={<PlayCircle size={15} />}>Retomar</Button>}</div>}
        <header className="top">
          <Button className="menu" variant="ghost" aria-label="Abrir menu" onClick={() => setOpen(true)} icon={<Menu size={19} />} />
          <button className="search" onClick={() => setPalette(true)} aria-label="Abrir busca e comandos"><Search size={16} /><span>Buscar oferta ou ir para…</span><Kbd>Ctrl K</Kbd></button>
          {d && <span className={`badge ${d.mode === 'auto' ? 'warn' : d.mode === 'review' ? 'accent' : 'info'}`} title="Modo de operação (Configurações)"><span className="hide-sm">Modo: </span>{d.mode === 'auto' ? 'Automático' : d.mode === 'review' ? 'Revisão humana' : 'Simulação'}</span>}
          <div className="right row" style={{ gap: 4 }}>
            {canOperate && d && !d.paused && <Button size="sm" onClick={togglePause} busy={busy === 'pause'} icon={<PauseCircle size={15} />}><span className="hide-sm">Pausar tudo</span></Button>}
            <Notifications dash={d} wa={wa.data} tg={tg.data} />
            <Button variant="ghost" aria-label={dark ? 'Tema claro' : 'Tema escuro'} onClick={toggleDark} icon={dark ? <Sun size={18} /> : <Moon size={18} />} />
            <div className="hide-sm" style={{ textAlign: 'right', lineHeight: 1.2, marginLeft: 6 }}><div style={{ fontWeight: 650 }}>{profile.name ?? profile.email}</div><div className="small muted">{roleLabel[profile.role]}</div></div>
            <Button variant="ghost" aria-label="Sair" onClick={async () => { await api().auth.signOut(); await refresh(); }} icon={<LogOut size={18} />} />
          </div>
        </header>
        <main className="content"><Outlet context={{ dash }} /></main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} onTogglePause={() => void pauseRef.current()} onHelp={() => setHelp(true)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}
