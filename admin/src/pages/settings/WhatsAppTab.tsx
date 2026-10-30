import { useEffect, useState } from 'react';
import { Lock, LogOut, QrCode, RefreshCw, RotateCw, Save, Send, ShieldCheck, Smartphone, Webhook } from 'lucide-react';
import { api } from '../../lib/api';
import type { EvolutionConfig } from '../../lib/types';
import { Badge, Button, Card, Field, Toggle, useAction, useDialogs } from '../../ui/ui';
import GroupDefaultsCard from '../../components/GroupDefaultsCard';
import { ConnectWhatsAppModal } from '../../components/WhatsAppConnect';
import { ActionBanner, CopyBtn, SecretField, StateDot, cfgOf, checkedAt, statusOf, useIntAction } from '../../components/integrations';
import { digitsOnly, secretOf, stable, type TabProps } from './shared';

const DEF: EvolutionConfig = { base_url: '', instance: '', webhook_url: '', send_delay_min_s: 4, send_delay_max_s: 12, alert_numbers: [], alerts: true };

const STATES: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'off'; help: string }> = {
  open: { label: 'Conectado', tone: 'ok', help: 'O número está online e pronto para enviar e receber.' },
  connecting: { label: 'Aguardando leitura do QR', tone: 'warn', help: 'Clique em “Conectar WhatsApp” e leia o QR code com o celular.' },
  close: { label: 'Desconectado', tone: 'bad', help: 'O número não está logado. Clique em “Conectar WhatsApp” para ler o QR code.' },
  missing: { label: 'Ainda não conectado', tone: 'warn', help: 'Clique em “Conectar WhatsApp”: a instância é criada sozinha e o QR code aparece.' },
};

const PRESETS = [
  { id: 'safe', label: 'Conservador', min: 8, max: 20, hint: 'Números novos ou grupos grandes' },
  { id: 'balanced', label: 'Equilibrado', min: 4, max: 12, hint: 'Uso diário recomendado' },
  { id: 'fast', label: 'Rápido', min: 2, max: 6, hint: 'Só para número já aquecido' },
] as const;

type Managed = { base_url?: boolean; instance?: boolean; api_key?: boolean; webhook?: boolean };

export default function WhatsAppTab({ s, secrets, reload, isAdmin }: TabProps) {
  const cfg = cfgOf<EvolutionConfig>(s, 'evolution', DEF); const st = statusOf(s, 'evolution');
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  const toForm = (c: EvolutionConfig) => ({ ...c, nums: c.alert_numbers.join('\n') });
  const [f, setF] = useState(toForm(cfg)); const sig = stable(cfg);
  useEffect(() => { setF(toForm(cfg)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const nums = f.nums.split(/[\s,;]+/).map(digitsOnly).filter(Boolean);
  const out: EvolutionConfig = { base_url: f.base_url.trim(), instance: f.instance.trim(), webhook_url: f.webhook_url.trim(), send_delay_min_s: Number(f.send_delay_min_s), send_delay_max_s: Number(f.send_delay_max_s), alerts: f.alerts, alert_numbers: nums };
  const dirty = stable(out) !== stable(cfg);

  const m = ((st.managed as Managed | undefined) ?? {});
  const keyInfo = secretOf(secrets, 'evolution_api_key');
  const baseOk = !!(m.base_url || cfg.base_url); const instOk = !!(m.instance || cfg.instance); const keyOk = !!(m.api_key || keyInfo?.is_set);
  const known = !!st.checked_at; // antes da primeira checagem não sabemos o que o servidor tem: deixa tentar e o worker explica
  const ready = known ? baseOk && instOk && keyOk : true; const fullyManaged = !!(m.api_key && m.base_url && m.instance);

  const act = useIntAction(); const test = useIntAction();
  const [connecting, setConnecting] = useState(false);
  const [testTo, setTestTo] = useState(''); const [testText, setTestText] = useState('Teste da Central de Promoções: a integração com o WhatsApp está funcionando.');

  // confere o estado sozinho ao abrir a aba (no máximo uma vez a cada 2 minutos)
  useEffect(() => {
    const age = st.checked_at ? Date.now() - new Date(String(st.checked_at)).getTime() : Infinity;
    if (isAdmin && age > 120000) void act.start('evolution', 'status', undefined, 'Verificando');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [isAdmin]);
  useEffect(() => { if (act.job?.status === 'done') reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [act.job?.status]);

  const state = String(st.state ?? '');
  const reachable = st.reachable !== false;
  const sm = !reachable ? { label: 'Servidor sem resposta', tone: 'bad' as const, help: String(st.error ?? 'Confira se a Evolution está no ar no servidor.') } : STATES[state];
  const connected = state === 'open';
  const host = String(st.host ?? '') || (() => { try { return new URL(cfg.base_url).host; } catch { return cfg.base_url || '—'; } })();
  const instance = m.instance ? String(st.instance ?? cfg.instance ?? 'definida no servidor') : cfg.instance || '—';
  const wh = st.webhook as { matches?: boolean; url?: string } | null | undefined;
  const avg = (Number(f.send_delay_min_s) + Number(f.send_delay_max_s)) / 2; const perHour = avg > 0 ? Math.floor(3600 / avg) : 0;

  const save = async () => { if (await run('save-evo', () => api().saveIntegration('evolution', out as unknown as Record<string, unknown>), 'Configuração do WhatsApp salva')) reload(); };
  const logout = async () => {
    if (!(await confirm({ title: 'Desconectar o WhatsApp?', danger: true, confirmLabel: 'Desconectar', body: 'O número sai da Central e as publicações para o WhatsApp ficam em espera até você ler um novo QR code.' }))) return;
    void act.start('evolution', 'logout', undefined, 'Desconectando');
  };
  const copyCmd = 'bash deploy/servidor/configurar-conexoes.sh --importar';

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="heroico"><Smartphone size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h2>WhatsApp</h2>{sm ? <Badge tone={sm.tone === 'off' ? undefined : sm.tone}><StateDot tone={sm.tone} />{sm.label}</Badge> : <Badge><StateDot tone="off" />Não verificado</Badge>}</div>
              <div className="small muted">{!ready ? 'Faltam dados da conexão no servidor. Veja “Conexão guardada no servidor” abaixo.' : (sm?.help ?? 'Clique em “Verificar agora” para consultar o servidor.')}</div>
            </div>
          </div>
          <div className="row wrap right">
            {connected
              ? <><Button icon={<RefreshCw size={14} />} disabled={!isAdmin} onClick={() => act.start('evolution', 'status', undefined, 'Verificando')}>Verificar</Button>
                <Button icon={<RotateCw size={14} />} disabled={!isAdmin} onClick={() => act.start('evolution', 'restart', undefined, 'Reiniciando')}>Reiniciar</Button>
                <Button variant="danger" icon={<LogOut size={14} />} disabled={!isAdmin} onClick={logout}>Desconectar</Button></>
              : <><Button icon={<RefreshCw size={14} />} disabled={!isAdmin || !ready} onClick={() => act.start('evolution', 'status', undefined, 'Verificando')}>Verificar agora</Button>
                <Button variant="primary" icon={<QrCode size={15} />} disabled={!isAdmin || !ready} title={!ready ? 'Falta guardar a chave no servidor' : undefined} onClick={() => setConnecting(true)}>Conectar WhatsApp</Button></>}
          </div>
        </div>
        <div className="facts">
          <div><span>Número</span><b>{st.phone ? '+' + String(st.phone) : '—'}</b></div>
          <div><span>Perfil</span><b>{String(st.profile ?? '—')}</b></div>
          <div><span>Servidor</span><b>{host || '—'}</b></div>
          <div><span>Última checagem</span><b>{checkedAt(st).replace('verificado ', '')}</b></div>
        </div>
        <div style={{ padding: '0 18px 16px' }}><ActionBanner act={act} okText={(r) => r.restarted ? 'Reiniciado. Aguarde alguns segundos.' : r.logged_out ? 'WhatsApp desconectado.' : r.state === 'open' ? 'WhatsApp conectado.' : 'Verificado.'} /></div>
      </section>

      <Card title="Conexão guardada no servidor" actions={<Badge tone={ready ? 'ok' : 'warn'}><Lock size={11} /> {fullyManaged ? 'arquivo seguro' : ready ? 'cofre do banco' : 'pendente'}</Badge>}>
        <div className="col">
          <div className="small muted">O endereço da Evolution, o nome da instância e a chave de acesso <b>não são digitados aqui</b>: ficam no arquivo protegido do servidor (<code>deploy/worker/worker.env</code>) e nunca chegam ao navegador. Para conectar, basta o botão <b>Conectar WhatsApp</b>.</div>
          <div className="facts" style={{ padding: 0 }}>
            <div><span>Endereço da Evolution</span><b>{baseOk ? (m.base_url ? 'no servidor ✓' : host) : 'faltando'}</b></div>
            <div><span>Instância</span><b>{instOk ? (m.instance ? instance + ' ✓' : instance) : 'faltando'}</b></div>
            <div><span>Chave de acesso</span><b>{keyOk ? (m.api_key ? 'no servidor ✓' : '••••' + (keyInfo?.hint ?? '')) : 'faltando'}</b></div>
          </div>
          {!fullyManaged && (
            <div className="alert info"><ShieldCheck size={16} style={{ flex: 'none', marginTop: 2 }} /><div>
              <b>Recomendado:</b> mova esses dados para o arquivo seguro do servidor. Com o SSH aberto na pasta do projeto, rode:
              <div className="row wrap" style={{ marginTop: 6 }}><code>{copyCmd}</code><CopyBtn text={copyCmd} /></div>
              <div className="small" style={{ fontWeight: 400, marginTop: 4 }}>Ele copia o que já está salvo, grava no <code>worker.env</code> e reinicia o worker. Depois disso o painel não pede mais nada. Sem nada salvo, rode sem opções e responda às perguntas.</div>
            </div></div>)}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Avançado: informar manualmente{fullyManaged ? ' (desativado: já vem do servidor)' : ''}</summary>
            <fieldset disabled={!isAdmin || fullyManaged} className="bare" style={{ marginTop: 10 }}><div className="col">
              <div className="grid g2">
                <Field label="Endereço da Evolution API" hint="Só o domínio, sem /manager no fim."><input value={f.base_url} disabled={!!m.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://whatsapp.seudominio.com.br" inputMode="url" /></Field>
                <Field label="Nome da instância"><input value={f.instance} disabled={!!m.instance} onChange={(e) => setF({ ...f, instance: e.target.value })} placeholder="central-ofertas" /></Field>
              </div>
              {!m.api_key && <SecretField k="evolution_api_key" label="Chave de acesso (apikey)" info={keyInfo} disabled={!isAdmin} onChanged={reload} hint="Fica no cofre do banco (só de escrita). O arquivo do servidor é mais seguro." />}
              <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-evo'} onClick={save}>Salvar</Button></div>
            </div></fieldset>
          </details>
        </div>
      </Card>

      <Card title="Receber mensagens (webhook)" actions={wh ? <Badge tone={wh.matches ? 'ok' : 'warn'}>{wh.matches ? 'configurado' : 'diferente do esperado'}</Badge> : undefined}>
        <div className="col">
          <div className="small muted">É assim que as conversas dos grupos aparecem em <b>WhatsApp → Conversas</b> e que o <b>Radar</b> enxerga as promoções. {m.webhook ? 'O endereço é do próprio worker e é corrigido automaticamente a cada verificação.' : 'Defina o endereço em Avançado ou use o arquivo do servidor.'}</div>
          <div className="row wrap">
            <Button icon={<Webhook size={14} />} disabled={!isAdmin || !ready} onClick={() => act.start('evolution', 'set_webhook', undefined, 'Reconfigurando webhook')}>Reconfigurar webhook</Button>
            {wh?.url && <span className="small muted truncate" style={{ maxWidth: 360 }}>Ativo: {wh.url}</span>}
          </div>
        </div>
      </Card>

      <Card title="Envio e proteção do número" actions={<Badge>≈ {perHour} msgs/hora no máximo</Badge>}>
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="col" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>Ritmo de envio</span>
            <div className="grid g3">
              {PRESETS.map((p) => { const on = Number(f.send_delay_min_s) === p.min && Number(f.send_delay_max_s) === p.max; return (
                <button type="button" key={p.id} className={`optcard${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, send_delay_min_s: p.min, send_delay_max_s: p.max })}>
                  <b>{p.label}</b><span className="small muted">{p.min}–{p.max}s entre mensagens</span><span className="small muted">{p.hint}</span></button>); })}
            </div>
          </div>
          <div className="grid g2">
            <Field label="Espera mínima entre mensagens (s)" hint="Evita parecer robô. Recomendado: 4 ou mais."><input type="number" min={1} max={120} value={f.send_delay_min_s} onChange={(e) => setF({ ...f, send_delay_min_s: +e.target.value })} /></Field>
            <Field label="Espera máxima entre mensagens (s)" hint="O worker sorteia um tempo entre o mínimo e o máximo."><input type="number" min={1} max={120} value={f.send_delay_max_s} onChange={(e) => setF({ ...f, send_delay_max_s: +e.target.value })} /></Field>
          </div>
          {Number(f.send_delay_min_s) > Number(f.send_delay_max_s) && <div className="alert warning"><div>O mínimo está maior que o máximo. Ajuste antes de salvar.</div></div>}
          <div className="row"><Toggle label="Alertas de queda" checked={f.alerts} onChange={(v) => setF({ ...f, alerts: v })} /><span><b>Avisar quando o WhatsApp cair ou voltar</b><div className="small muted">O aviso vai para o chat do administrador no Telegram (aba Telegram).</div></span></div>
          <Field label="Números para alerta (um por linha, até 5)" hint="DDI+DDD+número. Reservado para avisos pelo WhatsApp."><textarea style={{ minHeight: 70 }} value={f.nums} onChange={(e) => setF({ ...f, nums: e.target.value })} placeholder={'5511999990001'} /></Field>
          <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty || Number(f.send_delay_min_s) > Number(f.send_delay_max_s)} busy={busy === 'save-evo'} onClick={save}>Salvar proteção</Button></div>
          <ul className="tips">
            <li><b>Aqueça o número</b>: nas primeiras semanas envie poucas mensagens por dia e aumente aos poucos (use o ritmo Conservador).</li>
            <li><b>Use grupos seus</b>: enviar para quem não pediu aumenta a chance de denúncia e bloqueio.</li>
            <li><b>Evite rajadas</b>: a espera entre mensagens fica aqui; não zere esses valores.</li>
            <li><b>Nunca reenviamos no escuro</b>: se a Evolution não confirmar o envio, a publicação vai para “Incerta” e você confere no aplicativo.</li>
          </ul>
        </div></fieldset>
      </Card>

      <GroupDefaultsCard channel="whatsapp" s={s} reload={reload} isAdmin={isAdmin} />

      <Card title="Teste de envio">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Número de destino" hint="DDI+DDD+número, só dígitos. Mande para você mesmo."><input value={testTo} onChange={(e) => setTestTo(digitsOnly(e.target.value))} placeholder="5511999990001" inputMode="numeric" /></Field>
            <Field label="Mensagem"><input value={testText} maxLength={500} onChange={(e) => setTestText(e.target.value)} /></Field>
          </div>
          <div><Button icon={<Send size={14} />} disabled={!ready || !connected || testTo.length < 10} busy={test.running} onClick={() => test.start('evolution', 'send_test', { to: testTo, text: testText }, 'Enviando teste')}>Enviar teste</Button>{!connected && <span className="small muted" style={{ marginLeft: 10 }}>Disponível quando o número estiver conectado.</span>}</div>
          <ActionBanner act={test} okText={() => 'Mensagem enviada. Confira no celular.'} />
        </div></fieldset>
      </Card>

      {connecting && <ConnectWhatsAppModal onClose={() => { setConnecting(false); reload(); }} onConnected={() => { reload(); }} />}
    </div>);
}
