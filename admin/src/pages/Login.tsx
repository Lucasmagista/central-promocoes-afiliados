import { useState } from 'react';
import { Clock, FlaskConical } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { Button, Field, PriceTag } from '../ui/ui';

export default function Login() {
  const { state, refresh } = useSession();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const demo = api().mode === 'demo';

  if (state?.status === 'pending') return (
    <div className="login"><div className="formside" style={{ gridColumn: '1 / -1' }}><div className="card col" style={{ textAlign: 'center', alignItems: 'center', maxWidth: 420 }}>
      <Clock size={36} color="var(--warn)" /><h1>Conta aguardando aprovação</h1>
      <p className="muted">A conta <b>{state.email}</b> foi criada, mas ainda não está ativa. Peça a um administrador para liberar seu acesso.</p>
      <Button onClick={async () => { await api().auth.signOut(); await refresh(); }}>Sair</Button></div></div></div>);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
    try {
      if (mode === 'in') { await api().auth.signIn(email, pass); await refresh(); }
      else { await api().auth.signUp(email, pass, name); setInfo('Conta criada. Ela só será ativada depois que um administrador aprovar.'); setMode('in'); }
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="hero" aria-hidden="true">
        <div className="row" style={{ gap: 10, fontFamily: 'var(--display)', fontWeight: 700, fontSize: 18 }}><PriceTag value="%" size="sm" />Central de Promoções</div>
        <div>
          <h1>Só entra oferta que você aprovou.</h1>
          <p>Mercado Livre, Shopee e Amazon num único painel, com revisão, fila de envio e conversas do WhatsApp e do Telegram.</p>
          <div className="tags"><PriceTag value="R$ 149" /><PriceTag value="-32%" /><PriceTag value="R$ 89,90" /></div>
        </div>
        <div className="small" style={{ color: 'var(--side-text)' }}>Hubly Soluções Web</div>
      </div>
      <div className="formside"><form className="card col" onSubmit={submit} style={{ gap: 14 }}>
        <div><h1 style={{ fontSize: 22 }}>{mode === 'in' ? 'Entrar' : 'Criar conta'}</h1><div className="muted small">Painel administrativo</div></div>
        {demo && <div className="alert info"><FlaskConical size={16} style={{ flex: 'none', marginTop: 2 }} />Modo demonstração: use qualquer e-mail/senha ou entre direto como administrador.</div>}
        {mode === 'up' && <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
        <Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required={!demo} /></Field>
        <Field label="Senha"><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required={!demo} minLength={demo ? 0 : 8} /></Field>
        {err && <div className="alert critical" role="alert">{err}</div>}{info && <div className="alert info">{info}</div>}
        <Button variant="primary" type="submit" busy={busy}>{mode === 'in' ? 'Entrar' : 'Criar conta'}</Button>
        {demo && mode === 'in' && <Button type="button" onClick={async () => { setBusy(true); await api().auth.signIn('lucas.magista1@gmail.com', 'demo'); await refresh(); }}>Entrar como administrador (demo)</Button>}
        <button type="button" className="btn ghost" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null); }}>{mode === 'in' ? 'Não tem conta? Criar' : 'Já tem conta? Entrar'}</button>
      </form></div>
    </div>);
}
