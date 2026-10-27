import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, LogOut, PlugZap, QrCode, RefreshCw, RotateCcw, Smartphone, TriangleAlert, Webhook, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { createDemoDirectClient, createDirectClient, DirectError, type DirectClient, type DirectInfo } from '../lib/evolutionDirect';
import { Badge, Button, Field, useDialogs } from '../ui/ui';
import { StateDot } from './integrations';

const KEY_STORE = 'central.evo.key';
const read = () => { try { return sessionStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
const write = (v: string) => { try { if (v) sessionStorage.setItem(KEY_STORE, v); else sessionStorage.removeItem(KEY_STORE); } catch { /* sem armazenamento: fica só em memória */ } };
const QR_TTL = 20; // segundos até pedir um QR novo (o do WhatsApp vale ~60 s, mas renova em ciclos curtos)

const LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' }> = {
  open: { text: 'Conectado', tone: 'ok' }, connecting: { text: 'Aguardando leitura do QR', tone: 'warn' }, close: { text: 'Desconectado', tone: 'bad' }, missing: { text: 'Instância não existe', tone: 'warn' },
};

/** Conexão direta navegador → Evolution: pede o QR na hora, renova sozinho e detecta a leitura. */
export default function DirectConnect({ baseUrl, instance, webhookUrl, isAdmin }: { baseUrl: string; instance: string; webhookUrl: string; isAdmin: boolean }) {
  const { confirm } = useDialogs();
  const demo = api().mode === 'demo';
  const [key, setKey] = useState(read()); const [typed, setTyped] = useState('');
  const [info, setInfo] = useState<DirectInfo | null>(null); const [err, setErr] = useState<DirectError | null>(null);
  const [qr, setQr] = useState<string | null>(null); const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(''); const [pair, setPair] = useState(''); const [until, setUntil] = useState(0); const [, tick] = useState(0);
  const [list, setList] = useState<{ name: string; state: string; phone: string | null }[] | null>(null);
  const [info2, setInfo2] = useState('');
  const showing = useRef(false);

  const client = useMemo<DirectClient | null>(() => {
    if (!instance.trim()) return null;
    if (demo) return createDemoDirectClient(instance.trim());
    if (!key) return null;
    try { return createDirectClient(baseUrl, key, instance); } catch (e) { return null; }
  }, [demo, key, baseUrl, instance]);
  const ready = !!client;
  const fail = useCallback((e: unknown) => setErr(e instanceof DirectError ? e : new DirectError(e instanceof Error ? e.message : String(e))), []);

  const refresh = useCallback(async () => {
    if (!client) return null;
    try { const i = await client.info(); setInfo(i); setErr(null); if (i.state === 'open') { showing.current = false; setQr(null); setCode(null); } return i; } catch (e) { fail(e); return null; }
  }, [client, fail]);

  // confere o estado a cada 3 s enquanto há QR na tela e a cada 15 s no resto do tempo
  useEffect(() => {
    if (!client) { setInfo(null); return; }
    void refresh(); let stop = false; let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(async () => { if (stop) return; await refresh(); loop(); }, showing.current ? 3000 : 15000); };
    loop(); return () => { stop = true; clearTimeout(t); };
  }, [client, refresh]);

  // renova o QR sozinho
  useEffect(() => {
    if (!qr || !client) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const r = setInterval(async () => { try { const q = await client.connect(); if (q.qr) { setQr(q.qr); setUntil(Date.now() + QR_TTL * 1000); } if (q.pairingCode) setCode(q.pairingCode); } catch (e) { fail(e); } }, QR_TTL * 1000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [qr, client, fail]);

  const exec = async (label: string, fn: (c: DirectClient) => Promise<void>) => {
    if (!client) return; setBusy(label); setErr(null); setInfo2('');
    try { await fn(client); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const begin = (n?: string) => exec(n ? 'code' : 'qr', async (c) => {
    const i = await c.info(); setInfo(i);
    if (i.state === 'open') { setInfo2('O número já está conectado.'); return; }
    const q = i.state === 'missing' ? await c.create() : await c.connect(n);
    if (!q.qr && !q.pairingCode) throw new DirectError('A Evolution não devolveu o QR code. Tente reiniciar a instância.');
    setQr(q.qr); setCode(q.pairingCode); setUntil(Date.now() + QR_TTL * 1000); showing.current = true; await refresh();
  });
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const st = info ? LABEL[info.state] : null; const open = info?.state === 'open';

  if (!demo && !key) {
    return (
      <div className="col">
        <div className="small muted">Neste modo o navegador fala direto com <b>{baseUrl || 'a Evolution'}</b>: o QR aparece na hora e atualiza sozinho. A chave fica só nesta aba (some ao fechar) e não vai para o banco.</div>
        <div className="row" style={{ alignItems: 'end' }}>
          <div style={{ flex: 1 }}><Field label="Chave de acesso (apikey)" hint="Manager → Instâncias → sua instância → API Key, ou a chave global do servidor."><input type="password" autoComplete="new-password" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { write(typed.trim()); setKey(typed.trim()); setTyped(''); } }} placeholder="Cole aqui" /></Field></div>
          <Button variant="primary" icon={<KeyRound size={14} />} disabled={!typed.trim() || !instance.trim() || !baseUrl.trim()} onClick={() => { write(typed.trim()); setKey(typed.trim()); setTyped(''); }}>Usar nesta aba</Button>
        </div>
        {(!instance.trim() || !baseUrl.trim()) && <div className="small muted">Informe e salve o endereço e o nome da instância no passo 1.</div>}
      </div>);
  }

  return (
    <div className="col">
      {demo && <div className="alert info">Modo demonstração: o servidor da Evolution é simulado e o QR abaixo é só ilustrativo (a leitura “acontece” sozinha em alguns segundos).</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <Smartphone size={18} />
        {st ? <Badge tone={st.tone === 'off' ? undefined : st.tone}><StateDot tone={st.tone} />{st.text}</Badge> : <Badge><StateDot tone="off" />Verificando…</Badge>}
        {info?.phone && <span className="small"><b>+{info.phone}</b>{info.profile ? ` · ${info.profile}` : ''}</span>}
        <span className="right row">
          <Button size="sm" icon={<RefreshCw size={13} />} disabled={!ready || !!busy} onClick={() => void refresh()}>Atualizar</Button>
          {!demo && <Button size="sm" onClick={() => { write(''); setKey(''); setQr(null); setInfo(null); }}>Esquecer chave</Button>}
        </span>
      </div>
      {err && <div className="alert critical" role="alert"><XCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{err.message}{err.kind === 'cors' && <div className="small" style={{ fontWeight: 400, marginTop: 4 }}>Dica: se preferir não mexer no servidor, use “Via n8n” ao lado.</div>}</div></div>}
      {info2 && <div className="alert info" role="status">{info2}</div>}
      <div className="row wrap">
        <Button variant="primary" icon={busy === 'qr' ? <Loader2 size={14} style={{ animation: 'sp .7s linear infinite' }} /> : <QrCode size={14} />} disabled={!isAdmin || !ready || !!busy || open} onClick={() => void begin()}>{qr ? 'Gerar novo QR code' : 'Conectar com QR code'}</Button>
        <Button icon={<PlugZap size={14} />} disabled={!isAdmin || !ready || !!busy || info?.state !== 'missing' && !!info} onClick={() => exec('create', async (c) => { const q = await c.create(); setQr(q.qr); setCode(q.pairingCode); setUntil(Date.now() + QR_TTL * 1000); showing.current = !!q.qr; await refresh(); })}>Criar instância</Button>
        <Button icon={<RotateCcw size={14} />} disabled={!isAdmin || !ready || !!busy} onClick={() => exec('restart', async (c) => { await c.restart(); setInfo2('Instância reiniciada.'); await refresh(); })}>Reiniciar</Button>
        <Button variant="danger" icon={<LogOut size={14} />} disabled={!isAdmin || !ready || !!busy || !open} onClick={async () => { if (await confirm({ title: 'Desconectar o número?', danger: true, confirmLabel: 'Desconectar', body: 'As ofertas deixam de ser enviadas pelo WhatsApp até você ler um novo QR code.' })) void exec('logout', async (c) => { await c.logout(); setInfo2('Número desconectado.'); await refresh(); }); }}>Desconectar número</Button>
        <Button icon={<Webhook size={14} />} disabled={!isAdmin || !ready || !!busy || !webhookUrl} title={webhookUrl ? undefined : 'Salve o endereço do webhook no passo 3'} onClick={() => exec('hook', async (c) => { await c.setWebhook(webhookUrl); setInfo2('Webhook configurado na Evolution.'); })}>Configurar webhook</Button>
        <Button disabled={!ready || !!busy} onClick={() => exec('list', async (c) => { setList(await c.listInstances()); })}>Ver instâncias</Button>
      </div>
      {list && <div className="row wrap">{list.length === 0 ? <span className="small muted">Nenhuma instância neste servidor.</span> : list.map((i) => <span key={i.name} className="pillbtn"><StateDot tone={i.state === 'open' ? 'ok' : 'warn'} />{i.name}{i.phone && <span className="muted"> +{i.phone}</span>}</span>)}</div>}
      {open && !qr && <div className="alert info" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }} role="status"><Smartphone size={16} style={{ flex: 'none', marginTop: 2 }} /><div>Número conectado e pronto para enviar.</div></div>}
      {qr && !open && (
        <div className="qrwrap">
          <div className="qrbox"><img src={qr} alt="QR code para conectar o WhatsApp" width={232} height={232} /></div>
          <ol className="howto">
            <li>No celular, abra o <b>WhatsApp</b>.</li>
            <li>Toque em <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>.</li>
            <li>Aponte a câmera para o QR code{code ? ' ou digite o código ao lado' : ''}.</li>
            <li className="muted">Novo QR automático em {left}s. A tela avisa quando o celular ler.</li>
          </ol>
          {code && <div className="paircode" aria-label="Código de pareamento">{code}</div>}
        </div>)}
      <div className="row wrap" style={{ alignItems: 'end' }}>
        <Field label="Sem câmera? Conectar por código" hint="Número do WhatsApp com DDI+DDD (só dígitos)."><input value={pair} onChange={(e) => setPair(e.target.value.replace(/\D/g, ''))} placeholder="5511999990001" inputMode="numeric" style={{ maxWidth: 220 }} /></Field>
        <Button disabled={!isAdmin || !ready || !!busy || pair.length < 10 || open} onClick={() => void begin(pair)}>Gerar código</Button>
      </div>
      {!demo && <div className="small muted"><TriangleAlert size={12} style={{ verticalAlign: -2 }} /> Estas chamadas partem do seu navegador e não ficam na auditoria do painel. Para envios e grupos, o painel continua usando o n8n.</div>}
    </div>);
}
