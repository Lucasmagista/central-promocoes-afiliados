import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Modal } from '../ui/ui';

interface Poll { state: 'open' | 'connecting'; qr?: string | null; pairing_code?: string | null; phone?: string | null; profile?: string | null }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pede uma tarefa ao worker e espera o resultado (o painel nunca fala direto com a Evolution). */
async function runJob(provider: 'evolution', action: string, payload?: Record<string, unknown>, timeoutMs = 45000): Promise<Record<string, unknown>> {
  const id = await api().requestIntegrationAction(provider, action, payload); const t0 = Date.now();
  for (;;) {
    const j = await api().getJob(id);
    if (j.status === 'done') return (j.result ?? {}) as Record<string, unknown>;
    if (j.status === 'failed' || j.status === 'cancelled') throw new Error(j.last_error || 'A ação falhou.');
    if (Date.now() - t0 > timeoutMs) throw new Error('O worker não respondeu a tempo. Confira se ele está no ar (Configurações → Worker).');
    await sleep(900);
  }
}

/** Botão “Conectar WhatsApp”: mostra o QR code (ou o código de pareamento) ao vivo e fecha sozinho quando o celular conecta. */
export function ConnectWhatsAppModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [poll, setPoll] = useState<Poll | null>(null); const [err, setErr] = useState(''); const [method, setMethod] = useState<'qr' | 'code'>('qr');
  const [phone, setPhone] = useState(''); const [activePhone, setActivePhone] = useState(''); const [updated, setUpdated] = useState(0); const [, tick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    alive.current = true;
    if (method === 'code' && !activePhone) return () => { alive.current = false; };
    const loop = async () => {
      while (alive.current) {
        try {
          const r = (await runJob('evolution', 'connect_poll', method === 'code' ? { pairing_number: activePhone } : undefined)) as unknown as Poll;
          if (!alive.current) return; setPoll(r); setErr(''); setUpdated(Date.now());
          if (r.state === 'open') { onConnected(); return; }
        } catch (e) { if (!alive.current) return; setErr(e instanceof Error ? e.message : String(e)); }
        await sleep(2500);
      }
    };
    void loop();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, activePhone]);
  const open = poll?.state === 'open'; const ago = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  return (
    <Modal wide title="Conectar o WhatsApp" onClose={onClose} footer={<Button variant={open ? 'primary' : 'default'} onClick={onClose}>{open ? 'Concluir' : 'Fechar'}</Button>}>
      {open ? (
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: '18px 0' }}>
          <CheckCircle2 size={54} style={{ color: 'var(--ok)' }} />
          <h2 style={{ margin: 0 }}>WhatsApp conectado!</h2>
          <div className="muted">{poll?.phone ? `Número +${poll.phone}` : 'Número conectado'}{poll?.profile ? ` · ${poll.profile}` : ''}</div>
          <div className="small muted">Já pode publicar nos grupos e receber as conversas. Esta janela pode ser fechada.</div>
        </div>
      ) : (
        <div className="col">
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="chip" aria-pressed={method === 'qr'} onClick={() => setMethod('qr')}><QrCode size={14} /> QR code</button>
            <button type="button" className="chip" aria-pressed={method === 'code'} onClick={() => setMethod('code')}><Smartphone size={14} /> Código no celular (sem câmera)</button>
          </div>
          <div className="grid g2" style={{ alignItems: 'center' }}>
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 270, borderRadius: 14, background: '#fff', padding: 12 }}>
              {method === 'code'
                ? (poll?.pairing_code && activePhone ? <div style={{ textAlign: 'center', color: '#111' }}><div className="small" style={{ opacity: .7 }}>Digite este código no WhatsApp</div><div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 34, fontWeight: 700, letterSpacing: 4 }}>{poll.pairing_code}</div></div>
                  : activePhone ? <Loader2 size={30} style={{ animation: 'sp .7s linear infinite', color: '#111' }} /> : <div style={{ color: '#111', padding: 14, textAlign: 'center' }} className="small">Informe o número do WhatsApp que vai ser conectado e gere o código.</div>)
                : poll?.qr ? <img src={poll.qr} alt="QR code para conectar o WhatsApp" style={{ width: 246, height: 246, imageRendering: 'pixelated' }} /> : <div style={{ color: '#111', textAlign: 'center' }}><Loader2 size={30} style={{ animation: 'sp .7s linear infinite' }} /><div className="small" style={{ marginTop: 8 }}>Gerando o QR code…</div></div>}
            </div>
            <div className="col" style={{ gap: 10 }}>
              {method === 'qr'
                ? <ol className="guide"><li className="step"><span className="stepn">1</span><div>No celular, abra o <b>WhatsApp</b>.</div></li><li className="step"><span className="stepn">2</span><div>Toque em <b>Configurações → Aparelhos conectados → Conectar um aparelho</b>.</div></li><li className="step"><span className="stepn">3</span><div>Aponte a câmera para o QR code ao lado.</div></li></ol>
                : <div className="col"><div className="small muted">No WhatsApp: <b>Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone</b> e digite o código.</div>
                  <div className="row"><input aria-label="Número do WhatsApp" inputMode="numeric" placeholder="5511999990001" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} style={{ flex: 1, minWidth: 0 }} /><Button variant="primary" disabled={phone.length < 10} onClick={() => { setPoll(null); setActivePhone(phone); }}>Gerar código</Button></div></div>}
              <div className="small muted">{ago != null ? `Atualizado há ${ago}s · ` : ''}o código se renova sozinho; esta janela fecha quando o celular conectar.</div>
              {err && <div className="alert critical small" role="alert"><div>{err}</div></div>}
            </div>
          </div>
        </div>)}
    </Modal>);
}
