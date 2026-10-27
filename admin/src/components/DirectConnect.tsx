import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, LogOut, PlugZap, QrCode, RefreshCw, RotateCcw, Smartphone, Webhook, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { createDemoDirectClient, createDirectClient, DirectError, type DirectClient, type DirectInfo } from '../lib/evolutionDirect';
import { Badge, Button, Field, useDialogs } from '../ui/ui';
import { StateDot } from './integrations';

const QR_TTL = 20; // segundos até pedir um QR novo (o do WhatsApp vale ~60 s)

const LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' }> = {
  open: { text: 'Conectado', tone: 'ok' }, connecting: { text: 'Aguardando leitura do QR', tone: 'warn' }, close: { text: 'Desconectado', tone: 'bad' }, missing: { text: 'Instância ainda não criada', tone: 'warn' },
};
export type LiveInfo = DirectInfo & { at: number; error?: string };

/** Conexão direta navegador → Evolution: um botão gera o QR na hora, renova sozinho e avisa quando o celular lê. */
export default function DirectConnect({ baseUrl, instance, webhookUrl, isAdmin, apiKey, checkNonce = 0, onInfo }: {
  baseUrl: string; instance: string; webhookUrl: string; isAdmin: boolean; apiKey: string; checkNonce?: number; onInfo?: (i: LiveInfo | null) => void;
}) {
  const { confirm } = useDialogs();
  const demo = api().mode === 'demo';
  const [info, setInfo] = useState<DirectInfo | null>(null); const [err, setErr] = useState<DirectError | null>(null);
  const [qr, setQr] = useState<string | null>(null); const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(''); const [pair, setPair] = useState(''); const [until, setUntil] = useState(0); const [, tick] = useState(0);
  const [list, setList] = useState<{ name: string; state: string; phone: string | null }[] | null>(null);
  const [note, setNote] = useState('');
  const showing = useRef(false);

  const client = useMemo<DirectClient | null>(() => {
    if (!instance.trim()) return null;
    if (demo) return createDemoDirectClient(instance.trim());
    if (!apiKey) return null;
    try { return createDirectClient(baseUrl, apiKey, instance); } catch { return null; }
  }, [demo, apiKey, baseUrl, instance]);
  const ready = !!client;
  const fail = useCallback((e: unknown) => { const x = e instanceof DirectError ? e : new DirectError(e instanceof Error ? e.message : String(e)); setErr(x); onInfo?.(null); }, [onInfo]);

  const refresh = useCallback(async () => {
    if (!client) return null;
    try {
      const i = await client.info(); setInfo(i); setErr(null); onInfo?.({ ...i, at: Date.now() });
      if (i.state === 'open') { showing.current = false; setQr(null); setCode(null); }
      return i;
    } catch (e) { fail(e); return null; }
  }, [client, fail, onInfo]);

  // confere o estado a cada 3 s enquanto há QR na tela e a cada 15 s no resto do tempo
  useEffect(() => {
    if (!client) { setInfo(null); onInfo?.(null); return; }
    void refresh(); let stop = false; let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(async () => { if (stop) return; await refresh(); loop(); }, showing.current ? 3000 : 15000); };
    loop(); return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, refresh]);
  useEffect(() => { if (checkNonce > 0) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [checkNonce]);

  // renova o QR sozinho
  useEffect(() => {
    if (!qr || !client) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const r = setInterval(async () => { try { const q = await client.connect(); if (q.qr) { setQr(q.qr); setUntil(Date.now() + QR_TTL * 1000); } if (q.pairingCode) setCode(q.pairingCode); } catch (e) { fail(e); } }, QR_TTL * 1000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [qr, client, fail]);

  const exec = async (label: string, fn: (c: DirectClient) => Promise<void>) => {
    if (!client) return; setBusy(label); setErr(null); setNote('');
    try { await fn(client); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const begin = (n?: string) => exec(n ? 'code' : 'qr', async (c) => {
    const i = await c.info(); setInfo(i);
    if (i.state === 'open') { setNote('O número já está conectado.'); return; }
    const q = i.state === 'missing' ? await c.create() : await c.connect(n);
    if (!q.qr && !q.pairingCode) throw new DirectError('A Evolution não devolveu o QR code. Clique em “Reiniciar” e tente de novo.');
    setQr(q.qr); setCode(q.pairingCode); setUntil(Date.now() + QR_TTL * 1000); showing.current = true; await refresh();
  });
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const st = info ? LABEL[info.state] : null; const open = info?.state === 'open';

  if (!demo && !instance.trim()) return <div className="alert info"><div>Informe e salve o nome da instância no passo 1 para conectar.</div></div>;
  if (!demo && !apiKey) return (
    <div className="alert warning" role="status"><KeyRound size={16} style={{ flex: 'none', marginTop: 2 }} />
      <div><b>A chave não está salva neste navegador.</b><div className="small" style={{ fontWeight: 400 }}>No passo 1 clique em <b>Alterar</b>, cole a chave e salve. Depois o botão de conexão aparece aqui.</div></div></div>);

  return (
    <div className="col">
      {demo && <div className="alert info">Modo demonstração: o servidor da Evolution é simulado e o QR abaixo é só ilustrativo (a leitura “acontece” sozinha em alguns segundos).</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <Smartphone size={18} />
        {st ? <Badge tone={st.tone === 'off' ? undefined : st.tone}><StateDot tone={st.tone} />{st.text}</Badge> : <Badge><StateDot tone="off" />Verificando…</Badge>}
        {info?.phone && <span className="small"><b>+{info.phone}</b>{info.profile ? ` · ${info.profile}` : ''}</span>}
        <span className="right row"><Button size="sm" icon={<RefreshCw size={13} />} disabled={!ready || !!busy} onClick={() => void refresh()}>Atualizar</Button></span>
      </div>
      {err && <div className="alert critical" role="alert"><XCircle size={16} style={{ flex: 'none', marginTop: 2 }} /><div>{err.message}{err.kind === 'cors' && <div className="small" style={{ fontWeight: 400, marginTop: 4 }}>Na Evolution (arquivo .env do servidor) defina <code>CORS_ORIGIN=*</code> ou o endereço deste painel e reinicie o container da Evolution.</div>}</div></div>}
      {note && <div className="alert info" role="status">{note}</div>}

      {!open && (
        <div className="row wrap">
          <Button variant="primary" icon={busy === 'qr' ? <Loader2 size={14} style={{ animation: 'sp .7s linear infinite' }} /> : <QrCode size={14} />} disabled={!isAdmin || !ready || !!busy} onClick={() => void begin()}>{qr ? 'Gerar novo QR code' : 'Conectar com QR code'}</Button>
          <span className="small muted">Cria a instância sozinho se ela ainda não existir.</span>
        </div>)}
      {open && <div className="alert info" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }} role="status"><Smartphone size={16} style={{ flex: 'none', marginTop: 2 }} /><div>Número conectado e pronto para enviar.</div></div>}

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

      <div className="row wrap">
        <Button icon={<RotateCcw size={14} />} disabled={!isAdmin || !ready || !!busy} onClick={() => exec('restart', async (c) => { await c.restart(); setNote('Instância reiniciada.'); await refresh(); })}>Reiniciar</Button>
        <Button variant="danger" icon={<LogOut size={14} />} disabled={!isAdmin || !ready || !!busy || !open} onClick={async () => { if (await confirm({ title: 'Desconectar o número?', danger: true, confirmLabel: 'Desconectar', body: 'As ofertas deixam de ser enviadas pelo WhatsApp até você ler um novo QR code.' })) void exec('logout', async (c) => { await c.logout(); setNote('Número desconectado.'); await refresh(); }); }}>Desconectar número</Button>
        <Button icon={<Webhook size={14} />} disabled={!isAdmin || !ready || !!busy || !webhookUrl} title={webhookUrl ? undefined : 'Salve o endereço do webhook no passo 3'} onClick={() => exec('hook', async (c) => { await c.setWebhook(webhookUrl); setNote('Webhook configurado na Evolution.'); })}>Configurar webhook</Button>
        <Button icon={<PlugZap size={14} />} disabled={!ready || !!busy} onClick={() => exec('list', async (c) => { setList(await c.listInstances()); })}>Ver instâncias</Button>
      </div>
      {list && <div className="row wrap">{list.length === 0 ? <span className="small muted">Nenhuma instância neste servidor.</span> : list.map((i) => <span key={i.name} className="pillbtn"><StateDot tone={i.state === 'open' ? 'ok' : 'warn'} />{i.name}{i.phone && <span className="muted"> +{i.phone}</span>}</span>)}</div>}

      {!open && (
        <div className="row wrap" style={{ alignItems: 'end' }}>
          <Field label="Sem câmera? Conectar por código" hint="Número do WhatsApp com DDI+DDD (só dígitos)."><input value={pair} onChange={(e) => setPair(e.target.value.replace(/\D/g, ''))} placeholder="5511999990001" inputMode="numeric" style={{ maxWidth: 220 }} /></Field>
          <Button disabled={!isAdmin || !ready || !!busy || pair.length < 10} onClick={() => void begin(pair)}>Gerar código</Button>
        </div>)}
    </div>);
}
