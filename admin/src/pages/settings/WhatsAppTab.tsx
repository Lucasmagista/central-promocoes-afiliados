import { useEffect, useState } from 'react';
import { PlugZap, QrCode, RefreshCw, Save, Send, Smartphone, Webhook } from 'lucide-react';
import { api } from '../../lib/api';
import type { EvolutionConfig } from '../../lib/types';
import { Badge, Button, Card, Field, Seg, Toggle, useAction } from '../../ui/ui';
import DirectConnect from '../../components/DirectConnect';
import GroupDefaultsCard from '../../components/GroupDefaultsCard';
import { ActionBanner, CopyBtn, SecretField, StateDot, checkedAt, cfgOf, statusOf, useIntAction } from '../../components/integrations';
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
  const { run, busy } = useAction();
  const toForm = (c: EvolutionConfig) => ({ ...c, nums: c.alert_numbers.join('\n') });
  const [f, setF] = useState(toForm(cfg));
  const sig = stable(cfg);
  useEffect(() => { setF(toForm(cfg)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const nums = f.nums.split(/[\s,;]+/).map(digitsOnly).filter(Boolean);
  const out: EvolutionConfig = { base_url: f.base_url.trim(), instance: f.instance.trim(), webhook_url: f.webhook_url.trim(), send_delay_min_s: Number(f.send_delay_min_s), send_delay_max_s: Number(f.send_delay_max_s), alerts: f.alerts, alert_numbers: nums };
  const dirty = stable(out) !== stable(cfg);
  const keyInfo = secretOf(secrets, 'evolution_api_key');

  const act = useIntAction();     // status, QR, reiniciar…
  const inst = useIntAction();    // listar instâncias
  const test = useIntAction();    // teste de envio
  const [how, setHow] = useState<'direct' | 'n8n'>('direct');
  const [pair, setPair] = useState(''); const [testTo, setTestTo] = useState(''); const [testText, setTestText] = useState('Teste da Central de Promoções: a integração com o WhatsApp está funcionando.');
  const state = String(st.state ?? ''); const sm = !st.reachable && st.reachable !== undefined ? { label: 'Servidor sem resposta', tone: 'bad' as const, help: String(st.error ?? 'Confira o endereço e se o servidor está no ar.') } : STATES[state];
  const qr = act.result?.qr as string | undefined; const code = act.result?.pairing_code as string | undefined;
  const showQr = !!(qr || code) && state !== 'open';

  // Enquanto o QR está na tela, confere sozinho se o celular já leu (a cada ~10 s, por até 3 min).
  useEffect(() => {
    if (!showQr) return; let n = 0;
    const t = setInterval(() => { if (++n > 18) return clearInterval(t); void api().requestIntegrationAction('evolution', 'status').catch(() => {}); setTimeout(reload, 7000); }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr]);

  const save = async () => { if (await run('save-evo', () => api().saveIntegration('evolution', out as unknown as Record<string, unknown>), 'Configuração do WhatsApp salva')) reload(); };
  const ready = !!(cfg.base_url && keyInfo?.is_set);

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="heroico"><Smartphone size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h2>WhatsApp (Evolution API)</h2>{sm ? <Badge tone={sm.tone === 'off' ? undefined : sm.tone}><StateDot tone={sm.tone} />{sm.label}</Badge> : <Badge><StateDot tone="off" />Não verificado</Badge>}</div>
              <div className="small muted">{sm?.help ?? (ready ? 'Clique em “Verificar agora” para consultar o servidor.' : 'Informe a chave de acesso da Evolution para começar.')}</div>
            </div>
          </div>
          <div className="row wrap right">
            <Button icon={<RefreshCw size={14} />} disabled={!isAdmin || !ready} busy={act.running && act.label === 'Verificando'} onClick={() => act.start('evolution', 'status', undefined, 'Verificando')}>Verificar agora</Button>
          </div>
        </div>
        <div className="facts">
          <div><span>Número</span><b>{st.phone ? '+' + String(st.phone) : '—'}</b></div>
          <div><span>Perfil</span><b>{String(st.profile ?? '—')}</b></div>
          <div><span>Instância</span><b>{String(st.instance ?? (cfg.instance || '—'))}</b></div>
          <div><span>Versão</span><b>{String(st.version ?? '—')}</b></div>
          <div><span>Resposta</span><b>{st.ms != null ? `${st.ms} ms` : '—'}</b></div>
          <div><span>Última checagem</span><b>{checkedAt(st).replace('verificado ', '')}</b></div>
        </div>
      </section>

      <Card title="1. Conexão com o servidor" actions={<Badge tone={ready ? 'ok' : 'warn'}>{ready ? 'credenciais informadas' : 'incompleto'}</Badge>}>
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Endereço da Evolution API" hint="Só o domínio, sem /manager no fim."><input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://whatsapp.hubly.software" inputMode="url" /></Field>
            <Field label="Nome da instância" hint="Identifica o número dentro da Evolution. Ex.: central-ofertas"><input value={f.instance} onChange={(e) => setF({ ...f, instance: e.target.value })} placeholder="central-ofertas" /></Field>
          </div>
          <SecretField k="evolution_api_key" label="Chave de acesso (apikey)" info={keyInfo} disabled={!isAdmin} onChanged={reload}
            hint="Copie em Manager → Instâncias → sua instância → API Key, ou use a chave global do servidor. Fica guardada no banco e não volta para esta tela." />
          <div className="row wrap">
            <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-evo'} onClick={save}>Salvar conexão</Button>
            <Button icon={<PlugZap size={14} />} disabled={!ready || dirty} busy={inst.running} onClick={() => inst.start('evolution', 'list_instances', undefined, 'Listando instâncias')}>Ver instâncias do servidor</Button>
            <Button disabled={!ready || dirty || !cfg.instance} busy={act.running && act.label === 'Criando'} onClick={() => act.start('evolution', 'create_instance', undefined, 'Criando')}>Criar instância</Button>
            <a className="btn" href={`${cfg.base_url.replace(/\/+$/, '')}/manager`} target="_blank" rel="noreferrer noopener">Abrir o Manager ↗</a>
          </div>
          <ActionBanner act={inst} okText={(r) => (Array.isArray(r.instances) && r.instances.length ? `${r.instances.length} instância(s) no servidor.` : 'Nenhuma instância criada ainda neste servidor.')} />
          {Array.isArray(inst.result?.instances) && inst.result!.instances.length > 0 && <div className="row wrap">{(inst.result!.instances as { name: string; state: string; phone: string }[]).map((i) => <button key={i.name} type="button" className="pillbtn" onClick={() => setF({ ...f, instance: i.name })}><StateDot tone={i.state === 'open' ? 'ok' : 'warn'} />{i.name}{i.phone && <span className="muted"> +{i.phone}</span>}</button>)}<span className="small muted">Clique para usar o nome no campo acima e salve.</span></div>}
        </div></fieldset>
      </Card>

      <Card title="2. Conectar o número" actions={<div className="row" style={{ gap: 8 }}>{state === 'open' && <Badge tone="ok">conectado</Badge>}<Seg value={how} onChange={setHow} options={[{ v: 'direct', label: 'Direto (QR na hora)' }, { v: 'n8n', label: 'Via n8n' }]} /></div>}>
        {how === 'direct' ? <DirectConnect baseUrl={cfg.base_url} instance={cfg.instance} webhookUrl={cfg.webhook_url} isAdmin={isAdmin} /> : (
        <div className="col">
          <div className="small muted">O QR code é gerado pelo servidor (via n8n) e aparece aqui. Ele vale cerca de 1 minuto; a tela confere sozinha quando o celular lê.</div>
          <div className="row wrap">
            <Button variant="primary" icon={<QrCode size={14} />} disabled={!isAdmin || !ready || !cfg.instance} busy={act.running && act.label === 'Gerando QR code'} onClick={() => act.start('evolution', 'connect', undefined, 'Gerando QR code')}>{showQr ? 'Gerar novo QR code' : 'Conectar com QR code'}</Button>
            <Button disabled={!isAdmin || !ready || !cfg.instance} busy={act.running && act.label === 'Reiniciando'} onClick={() => act.start('evolution', 'restart', undefined, 'Reiniciando')}>Reiniciar instância</Button>
            <Button variant="danger" disabled={!isAdmin || state !== 'open'} onClick={() => act.start('evolution', 'logout', undefined, 'Desconectando')}>Desconectar número</Button>
          </div>
          {!cfg.instance && <div className="small muted">Defina e salve o nome da instância antes de conectar.</div>}
          <ActionBanner act={act} okText={(r) => r.already ? 'O número já está conectado.' : r.qr ? 'QR code gerado. Leia com o WhatsApp do celular.' : r.pairing_code ? 'Código de pareamento gerado.' : r.created ? 'Instância criada. Gere o QR code para conectar.' : r.existed ? 'A instância já existia.' : r.restarted ? 'Instância reiniciada.' : r.logged_out ? 'Número desconectado.' : r.webhook ? 'Webhook configurado na Evolution.' : 'Status atualizado.'} />
          {showQr && (
            <div className="qrwrap">
              {qr && <div className="qrbox"><img src={qr} alt="QR code para conectar o WhatsApp" width={232} height={232} /></div>}
              <ol className="howto">
                <li>No celular, abra o <b>WhatsApp</b>.</li>
                <li>Toque em <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>.</li>
                <li>Aponte a câmera para o QR code{code ? ' ou digite o código abaixo' : ''}.</li>
              </ol>
              {code && <div className="paircode" aria-label="Código de pareamento">{code}</div>}
            </div>)}
          <div className="row wrap" style={{ alignItems: 'end' }}>
            <Field label="Sem câmera? Conectar por código" hint="Número do WhatsApp com DDI+DDD (só dígitos)."><input value={pair} onChange={(e) => setPair(digitsOnly(e.target.value))} placeholder="5511999990001" inputMode="numeric" style={{ maxWidth: 220 }} /></Field>
            <Button disabled={!isAdmin || !ready || !cfg.instance || pair.length < 10} onClick={() => act.start('evolution', 'connect', { pairing_number: pair }, 'Gerando código')}>Gerar código</Button>
          </div>
        </div>
        )}
      </Card>

      <Card title="3. Receber mensagens (webhook)" actions={st.webhook ? <Badge tone={(st.webhook as { matches?: boolean }).matches ? 'ok' : 'warn'}>{(st.webhook as { matches?: boolean }).matches ? 'configurado' : 'diferente do salvo'}</Badge> : undefined}>
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="small muted">É assim que as conversas dos grupos aparecem em <b>WhatsApp → Conversas</b>. Importe o workflow “Central — Entrada WhatsApp” no n8n, copie o endereço do <i>Production URL</i> do nó Webhook e cole abaixo.</div>
          <Field label="Endereço do webhook no n8n" hint="https://… Production URL do nó “Webhook Evolution”."><input value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} placeholder="https://n8n.seudominio.com.br/webhook/central-whatsapp-…" inputMode="url" /></Field>
          <div className="row wrap">
            <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-evo'} onClick={save}>Salvar</Button>
            <Button icon={<Webhook size={14} />} disabled={!ready || dirty || !cfg.webhook_url || !cfg.instance} busy={act.running && act.label === 'Configurando webhook'} onClick={() => act.start('evolution', 'set_webhook', undefined, 'Configurando webhook')}>Configurar na Evolution</Button>
            {st.webhook && (st.webhook as { url?: string }).url ? <><span className="small muted truncate" style={{ maxWidth: 340 }}>Hoje na Evolution: {(st.webhook as { url: string }).url}</span><CopyBtn text={(st.webhook as { url: string }).url} /></> : null}
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
