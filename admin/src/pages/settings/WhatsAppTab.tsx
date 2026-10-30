import { useEffect, useState } from 'react';
import { Lock, Pencil, RefreshCw, Save, Send, Smartphone, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { EvolutionConfig } from '../../lib/types';
import { Badge, Button, Card, Field, Toggle, useAction, useDialogs } from '../../ui/ui';
import DirectConnect, { type LiveInfo } from '../../components/DirectConnect';
import { evoKey } from '../../lib/evolutionDirect';
import GroupDefaultsCard from '../../components/GroupDefaultsCard';
import { ActionBanner, StateDot, cfgOf, statusOf, useIntAction } from '../../components/integrations';
import { digitsOnly, secretOf, stable, type TabProps } from './shared';

const DEF: EvolutionConfig = { base_url: 'https://whatsapp.hubly.software', instance: '', webhook_url: '', send_delay_min_s: 4, send_delay_max_s: 12, alert_numbers: [], alerts: true };

const STATES: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'off'; help: string }> = {
  open: { label: 'Conectado', tone: 'ok', help: 'O número está online e pronto para enviar.' },
  connecting: { label: 'Aguardando leitura do QR', tone: 'warn', help: 'Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.' },
  close: { label: 'Desconectado', tone: 'bad', help: 'A instância existe, mas o número não está logado. Use “Conectar com QR code”.' },
  missing: { label: 'Instância não existe', tone: 'warn', help: 'Crie a instância para poder conectar o número.' },
};

export default function WhatsAppTab({ s, secrets, reload, isAdmin }: TabProps) {
  const cfg = cfgOf<EvolutionConfig>(s, 'evolution', DEF); const st = statusOf(s, 'evolution');
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  const toForm = (c: EvolutionConfig) => ({ ...c, nums: c.alert_numbers.join('\n') });
  const [f, setF] = useState(toForm(cfg));
  const sig = stable(cfg);
  const keyInfo = secretOf(secrets, 'evolution_api_key');
  const ready = !!(cfg.base_url && cfg.instance && keyInfo?.is_set);
  const [editing, setEditing] = useState(!ready); const [newKey, setNewKey] = useState('');
  const [savedTail, setSavedTail] = useState(''); const [key, setKey] = useState(evoKey.get()); const [live, setLive] = useState<LiveInfo | null>(null); const [nonce, setNonce] = useState(0);
  useEffect(() => { if (!editing) setF(toForm(cfg)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig, editing]);
  useEffect(() => { if (!ready) setEditing(true); }, [ready]);
  const nums = f.nums.split(/[\s,;]+/).map(digitsOnly).filter(Boolean);
  const out: EvolutionConfig = { base_url: f.base_url.trim(), instance: f.instance.trim(), webhook_url: f.webhook_url.trim(), send_delay_min_s: Number(f.send_delay_min_s), send_delay_max_s: Number(f.send_delay_max_s), alerts: f.alerts, alert_numbers: nums };
  const dirty = stable(out) !== stable(cfg);
  const connOk = !!(out.base_url && out.instance && (keyInfo?.is_set || newKey.trim()));

  const test = useIntAction();    // teste de envio (executado pelo n8n)
  const [testTo, setTestTo] = useState(''); const [testText, setTestText] = useState('Teste da Central de Promoções: a integração com o WhatsApp está funcionando.');
  const st2 = live ? STATES[live.state] : null;
  const sm = st2 ?? (!st.reachable && st.reachable !== undefined ? { label: 'Servidor sem resposta', tone: 'bad' as const, help: String(st.error ?? 'Confira o endereço e se o servidor está no ar.') } : STATES[String(st.state ?? '')]);
  const state = live?.state ?? String(st.state ?? '');
  const host = (() => { try { return new URL(cfg.base_url).host; } catch { return cfg.base_url || '—'; } })();
  const when = live ? new Date(live.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'ainda não verificado';

  const save = async () => { if (await run('save-evo', () => api().saveIntegration('evolution', out as unknown as Record<string, unknown>), 'Configuração do WhatsApp salva')) reload(); };
  const saveConn = async () => {
    const typed = newKey.trim();
    const ok = await run('save-conn', async () => {
      await api().saveIntegration('evolution', out as unknown as Record<string, unknown>);
      if (typed) await api().setIntegrationSecret('evolution_api_key', typed);
    }, 'Conexão salva');
    if (ok) { if (typed) { evoKey.set(typed); setKey(typed); setSavedTail(typed.slice(-4)); } setNewKey(''); setEditing(false); reload(); }
  };
  const cancel = () => { setF(toForm(cfg)); setNewKey(''); setEditing(false); };
  const removeKey = async () => {
    if (!(await confirm({ title: 'Remover a chave?', danger: true, confirmLabel: 'Remover', body: 'O WhatsApp para de funcionar até você informar a chave de novo.' }))) return;
    if (await run('clr-key', () => api().clearIntegrationSecret('evolution_api_key'), 'Chave removida')) { evoKey.set(''); setKey(''); setEditing(true); reload(); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="heroico"><Smartphone size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h2>WhatsApp (Evolution API)</h2>{sm ? <Badge tone={sm.tone === 'off' ? undefined : sm.tone}><StateDot tone={sm.tone} />{sm.label}</Badge> : <Badge><StateDot tone="off" />Não verificado</Badge>}</div>
              <div className="small muted">{sm?.help ?? (ready ? 'Clique em “Verificar agora” para consultar o servidor.' : 'Preencha a conexão abaixo para começar.')}</div>
            </div>
          </div>
          <div className="row wrap right">
            <Button icon={<RefreshCw size={14} />} disabled={!isAdmin || !ready || (!key && api().mode !== 'demo')} onClick={() => setNonce((n) => n + 1)}>Verificar agora</Button>
          </div>
        </div>
        <div className="facts">
          <div><span>Número</span><b>{live?.phone ? '+' + live.phone : st.phone ? '+' + String(st.phone) : '—'}</b></div>
          <div><span>Perfil</span><b>{live?.profile ?? String(st.profile ?? '—')}</b></div>
          <div><span>Instância</span><b>{cfg.instance || '—'}</b></div>
          <div><span>Servidor</span><b>{host}</b></div>
          <div><span>Última checagem</span><b>{when}</b></div>
        </div>
      </section>

      <Card title="1. Conexão com o servidor" actions={<Badge tone={ready ? 'ok' : 'warn'}>{ready ? <><Lock size={11} /> salva</> : 'incompleto'}</Badge>}>
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Endereço da Evolution API" hint="Só o domínio, sem /manager no fim."><input value={f.base_url} disabled={!editing} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://whatsapp.hubly.software" inputMode="url" /></Field>
            <Field label="Nome da instância" hint="Identifica o número dentro da Evolution. Ex.: central-ofertas"><input value={f.instance} disabled={!editing} onChange={(e) => setF({ ...f, instance: e.target.value })} placeholder="central-ofertas" /></Field>
          </div>
          <Field label="Chave de acesso (apikey)" hint={editing ? 'Manager → Instâncias → sua instância → API Key, ou a chave global do servidor. Fica guardada no banco e neste navegador.' : keyInfo?.is_set && !key && api().mode !== 'demo' ? 'Guardada no servidor, mas não neste navegador: clique em Alterar e cole de novo para conectar daqui.' : 'Guardada com segurança. Clique em Alterar para trocar.'}>
            {editing
              ? <input type="password" autoComplete="new-password" spellCheck={false} value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connOk && void saveConn()} placeholder={keyInfo?.is_set ? 'Deixe vazio para manter a chave atual' : 'Cole a chave aqui'} />
              : <input type="text" disabled readOnly value={keyInfo?.is_set ? `••••••••••••${keyInfo.hint ?? ''}` : savedTail ? `••••••••••••${savedTail}` : ''} aria-label="Chave de acesso guardada" />}
          </Field>
          <div className="row wrap">
            {!editing
              ? <Button icon={<Pencil size={14} />} disabled={!isAdmin} onClick={() => setEditing(true)}>Alterar</Button>
              : <>
                <Button variant="primary" icon={<Save size={14} />} disabled={!connOk || (!dirty && !newKey.trim())} busy={busy === 'save-conn'} onClick={saveConn}>Salvar conexão</Button>
                {ready && <Button icon={<X size={14} />} onClick={cancel}>Cancelar</Button>}
                {keyInfo?.is_set && <Button variant="danger" icon={<Trash2 size={14} />} busy={busy === 'clr-key'} onClick={removeKey}>Remover chave</Button>}
              </>}
            <a className="btn" href={`${cfg.base_url.replace(/\/+$/, '')}/manager`} target="_blank" rel="noreferrer noopener">Abrir o Manager ↗</a>
          </div>
        </div></fieldset>
      </Card>

      <Card title="2. Conectar o número" actions={state === 'open' ? <Badge tone="ok">conectado</Badge> : undefined}>
        <DirectConnect baseUrl={cfg.base_url} instance={cfg.instance} webhookUrl={cfg.webhook_url} isAdmin={isAdmin} apiKey={key} checkNonce={nonce} onInfo={setLive} />
      </Card>

      <Card title="3. Receber mensagens (webhook)" actions={st.webhook ? <Badge tone={(st.webhook as { matches?: boolean }).matches ? 'ok' : 'warn'}>{(st.webhook as { matches?: boolean }).matches ? 'configurado' : 'diferente do salvo'}</Badge> : undefined}>
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="small muted">É assim que as conversas dos grupos aparecem em <b>WhatsApp → Conversas</b>. Cole abaixo o endereço do webhook (do worker, ou o <i>Production URL</i> do n8n), salve e depois use <b>Configurar webhook</b> no passo 2. Com o worker no mesmo servidor use o endereço interno: <code>http://promo-worker:8787/hook/whatsapp-…</code> (aparece em <code>docker logs promo-worker</code>).</div>
          <Field label="Endereço do webhook" hint="http://promo-worker:8787/hook/whatsapp-… (rede interna) ou https://… público."><input value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} placeholder="http://promo-worker:8787/hook/whatsapp-…" inputMode="url" /></Field>
          <div className="row wrap">
            <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-evo'} onClick={save}>Salvar</Button>
          </div>
        </div></fieldset>
      </Card>

      <Card title="4. Envio e proteção do número">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Espera mínima entre mensagens (s)" hint="Evita parecer robô. Recomendado: 4 ou mais."><input type="number" min={1} max={120} value={f.send_delay_min_s} onChange={(e) => setF({ ...f, send_delay_min_s: +e.target.value })} /></Field>
            <Field label="Espera máxima entre mensagens (s)" hint="O worker sorteia um tempo entre o mínimo e o máximo."><input type="number" min={1} max={120} value={f.send_delay_max_s} onChange={(e) => setF({ ...f, send_delay_max_s: +e.target.value })} /></Field>
          </div>
          <div className="row"><Toggle label="Alertas de queda" checked={f.alerts} onChange={(v) => setF({ ...f, alerts: v })} /><span><b>Avisar quando o WhatsApp cair ou voltar</b><div className="small muted">O aviso vai para o chat do administrador no Telegram (aba Telegram).</div></span></div>
          <Field label="Números para alerta (um por linha, até 5)" hint="DDI+DDD+número. Reservado para avisos pelo WhatsApp."><textarea style={{ minHeight: 70 }} value={f.nums} onChange={(e) => setF({ ...f, nums: e.target.value })} placeholder={'5511999990001'} /></Field>
          <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-evo'} onClick={save}>Salvar</Button></div>
          <ul className="tips">
            <li><b>Aqueça o número</b>: nas primeiras semanas envie poucas mensagens por dia e aumente aos poucos.</li>
            <li><b>Use grupos seus</b>: enviar para quem não pediu aumenta a chance de denúncia e bloqueio.</li>
            <li><b>Evite rajadas</b>: a espera entre mensagens fica aqui; não zere esses valores.</li>
            <li><b>Nunca reenviamos no escuro</b>: se a Evolution não confirmar o envio, a publicação vai para “Incerta” e você confere no aplicativo.</li>
          </ul>
        </div></fieldset>
      </Card>

      <GroupDefaultsCard channel="whatsapp" s={s} reload={reload} isAdmin={isAdmin} />

      <Card title="5. Teste de envio">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Número de destino" hint="DDI+DDD+número, só dígitos. Mande para você mesmo."><input value={testTo} onChange={(e) => setTestTo(digitsOnly(e.target.value))} placeholder="5511999990001" inputMode="numeric" /></Field>
            <Field label="Mensagem"><input value={testText} maxLength={500} onChange={(e) => setTestText(e.target.value)} /></Field>
          </div>
          <div><Button icon={<Send size={14} />} disabled={!ready || state !== 'open' || testTo.length < 10} busy={test.running} onClick={() => test.start('evolution', 'send_test', { to: testTo, text: testText }, 'Enviando teste')}>Enviar teste</Button>{state !== 'open' && <span className="small muted" style={{ marginLeft: 10 }}>Disponível quando o número estiver conectado.</span>}</div>
          <ActionBanner act={test} okText={() => 'Mensagem enviada. Confira no celular.'} />
        </div></fieldset>
      </Card>
    </div>);
}
