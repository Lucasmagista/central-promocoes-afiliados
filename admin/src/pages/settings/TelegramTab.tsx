import { useEffect, useState } from 'react';
import { Bot, RefreshCw, Save, Send, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { TelegramConfig } from '../../lib/types';
import { Badge, Button, Card, Field, Seg, Toggle, useAction } from '../../ui/ui';
import { ActionBanner, CopyBtn, SecretField, StateDot, Step, checkedAt, cfgOf, statusOf, useIntAction } from '../../components/integrations';
import GroupDefaultsCard from '../../components/GroupDefaultsCard';
import type { TabProps } from './shared';
import { secretOf, stable } from './shared';

const DEF: TelegramConfig = { enabled: false, mode: 'polling', webhook_url: '', admin_chat_id: '', alerts: true };

export default function TelegramTab({ s, secrets, reload, isAdmin }: TabProps) {
  const cfg = cfgOf<TelegramConfig>(s, 'telegram', DEF); const st = statusOf(s, 'telegram');
  const { run, busy } = useAction();
  const [f, setF] = useState(cfg); const sig = stable(cfg);
  useEffect(() => { setF(cfg); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const out: TelegramConfig = { ...f, webhook_url: f.webhook_url.trim(), admin_chat_id: f.admin_chat_id.trim() };
  const dirty = stable(out) !== stable(cfg);
  const tok = secretOf(secrets, 'telegram_bot_token'); const hook = secretOf(secrets, 'telegram_webhook_secret');
  const act = useIntAction(); const test = useIntAction();
  const [to, setTo] = useState(''); const [text, setText] = useState('Teste da Central de Promoções: o bot está funcionando.');
  const save = async () => { if (await run('save-tg', () => api().saveIntegration('telegram', out as unknown as Record<string, unknown>), 'Configuração do Telegram salva')) reload(); };
  const live = String(st.mode_live ?? ''); const wh = st.webhook as { url?: string; pending?: number; last_error?: string | null } | null | undefined;
  const botOk = st.ok === true;
  const modeMismatch = botOk && live && cfg.enabled && live !== cfg.mode;

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="heroico tg"><Bot size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h2>Telegram (Bot API)</h2>
                {!cfg.enabled ? <Badge><StateDot tone="off" />Desligado</Badge> : botOk ? <Badge tone="ok"><StateDot tone="ok" />Bot ativo</Badge> : st.ok === false ? <Badge tone="bad"><StateDot tone="bad" />Com problema</Badge> : <Badge tone="warn"><StateDot tone="warn" />Não verificado</Badge>}</div>
              <div className="small muted">{st.ok === false ? String(st.error ?? 'Não foi possível falar com o bot.') : botOk ? 'O bot respondeu e está pronto para publicar nos canais e grupos em que for administrador.' : 'Siga os passos abaixo e depois clique em “Verificar bot”.'}</div>
            </div>
          </div>
          <div className="row wrap right"><Button icon={<RefreshCw size={14} />} disabled={!isAdmin || !tok?.is_set} busy={act.running && act.label === 'Verificando'} onClick={() => act.start('telegram', 'check', undefined, 'Verificando')}>Verificar bot</Button></div>
        </div>
        <div className="facts">
          <div><span>Bot</span><b>{st.bot_username ? '@' + String(st.bot_username) : '—'}</b></div>
          <div><span>Nome</span><b>{String(st.bot_name ?? '—')}</b></div>
          <div><span>Recebimento</span><b>{live === 'webhook' ? 'Webhook' : live === 'polling' ? 'Consulta (polling)' : '—'}</b></div>
          <div><span>Pendentes</span><b>{wh?.pending ?? '—'}</b></div>
          <div><span>Entra em grupos</span><b>{st.can_join_groups == null ? '—' : st.can_join_groups ? 'sim' : 'não'}</b></div>
          <div><span>Última checagem</span><b>{checkedAt(st).replace('verificado ', '')}</b></div>
        </div>
        {modeMismatch && <div className="alert warning" style={{ margin: '0 18px 16px' }}><div>O modo salvo é <b>{cfg.mode === 'webhook' ? 'webhook' : 'consulta'}</b>, mas o Telegram está em <b>{live === 'webhook' ? 'webhook' : 'consulta'}</b>. Use os botões do passo 3 para alinhar.</div></div>}
      </section>

      <Card title="Como configurar">
        <ol className="guide">
          <Step n={1} title="Crie o bot no @BotFather" done={!!tok?.is_set}>No Telegram, abra <b>@BotFather</b> → <code>/newbot</code> → escolha nome e usuário. Ele devolve o <b>token</b>.</Step>
          <Step n={2} title="Cole o token abaixo" done={botOk}>O token fica guardado no banco, sem voltar para a tela. Depois clique em “Verificar bot”.</Step>
          <Step n={3} title="Adicione o bot como administrador do canal ou grupo" done={false}>Canal: Administradores → Adicionar → permissão de <b>publicar mensagens</b>. Grupo: torne o bot admin para ele ler e enviar.</Step>
          <Step n={4} title="Traga os chats para a Central" done={false}>Em <Link to="/destinos">Destinos</Link> use “Buscar grupos” ou informe o @canal. O bot só enxerga chats onde alguém o adicionou.</Step>
        </ol>
      </Card>

      <Card title="Bot e recebimento">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <SecretField k="telegram_bot_token" label="Token do bot" info={tok} disabled={!isAdmin} onChanged={reload} placeholder="123456789:AAH…" hint="Formato 123456789:AA… (do @BotFather). Se vazar, gere outro com /revoke." />
          <div className="row"><Toggle label="Telegram ativo" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span><b>Usar o Telegram nas publicações</b><div className="small muted">Desligado, as publicações para o Telegram ficam aguardando e nada é enviado.</div></span></div>
          <div className="col" style={{ gap: 5 }}><span style={{ fontWeight: 600, fontSize: 12.5 }}>Como o sistema recebe as mensagens dos chats</span><Seg value={f.mode} onChange={(m) => setF({ ...f, mode: m })} options={[{ v: 'polling', label: 'Consulta (polling)' }, { v: 'webhook', label: 'Webhook' }]} /></div>
          <div className="small muted">{f.mode === 'polling' ? 'Mais simples: o n8n pergunta ao Telegram a cada minuto. Não precisa de endereço público. Atraso de até 1 min nas conversas.' : 'Instantâneo: o Telegram chama o n8n a cada mensagem. Exige o workflow “Entrada Telegram” ativo e um endereço https público.'}</div>
          {f.mode === 'webhook' && (<>
            <Field label="Endereço do webhook no n8n" hint="Production URL do nó “Webhook Telegram”."><input value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} placeholder="https://n8n.seudominio.com.br/webhook/central-telegram-…" inputMode="url" /></Field>
            <div className="row wrap secretrow"><span style={{ fontWeight: 600, fontSize: 12.5 }}>Segredo do webhook</span>
              {hook?.is_set ? <Badge tone="ok">gerado ••••{hook.hint}</Badge> : <Badge tone="warn">ainda não gerado</Badge>}
              <Button size="sm" disabled={!isAdmin} busy={busy === 'rot'} onClick={async () => { if (await run('rot', () => api().rotateTelegramWebhookSecret(), 'Novo segredo gerado. Registre o webhook de novo.')) reload(); }}>{hook?.is_set ? 'Gerar outro' : 'Gerar segredo'}</Button>
              <span className="small muted">O Telegram envia esse segredo em cada chamada; o n8n recusa quem não o tiver.</span></div>
          </>)}
          <div className="row wrap">
            <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-tg'} onClick={save}>Salvar</Button>
            {f.mode === 'webhook' && <Button icon={<Webhook size={14} />} disabled={dirty || !tok?.is_set || !hook?.is_set || !cfg.webhook_url} busy={act.running && act.label === 'Registrando webhook'} onClick={() => act.start('telegram', 'set_webhook', undefined, 'Registrando webhook')}>Registrar webhook no Telegram</Button>}
            {live === 'webhook' && <Button disabled={!tok?.is_set} busy={act.running && act.label === 'Removendo webhook'} onClick={() => act.start('telegram', 'delete_webhook', undefined, 'Removendo webhook')}>Voltar para consulta (remover webhook)</Button>}
            {wh?.url && <><span className="small muted truncate" style={{ maxWidth: 320 }}>Ativo: {wh.url}</span><CopyBtn text={wh.url} /></>}
          </div>
          {wh?.last_error && <div className="alert warning"><div>Último erro do Telegram ao chamar o webhook: {wh.last_error}</div></div>}
          <ActionBanner act={act} okText={(r) => r.bot_username ? `Bot @${r.bot_username} respondeu. Recebimento: ${r.mode_live === 'webhook' ? 'webhook' : 'consulta'}.` : r.webhook === null ? 'Webhook removido; o sistema voltou a consultar.' : r.webhook ? 'Webhook registrado no Telegram.' : 'Concluído.'} />
        </div></fieldset>
      </Card>

      <Card title="Alertas do administrador">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="row"><Toggle label="Alertas" checked={f.alerts} onChange={(v) => setF({ ...f, alerts: v })} /><span><b>Receber avisos no Telegram</b><div className="small muted">Queda e retorno do WhatsApp, e problemas do próprio bot.</div></span></div>
          <Field label="ID do seu chat com o bot" hint={<>Fale com <b>@userinfobot</b> para descobrir seu ID, depois mande <code>/start</code> para o seu bot. Só números.</>}><input value={f.admin_chat_id} onChange={(e) => setF({ ...f, admin_chat_id: e.target.value })} placeholder="123456789" inputMode="numeric" style={{ maxWidth: 260 }} /></Field>
          <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-tg'} onClick={save}>Salvar</Button></div>
        </div></fieldset>
      </Card>

      <Card title="Teste de envio">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Destino" hint="ID numérico do chat (ex.: -1001234567890) ou @canal."><input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={f.admin_chat_id || '@meu_canal'} /></Field>
            <Field label="Mensagem"><input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></Field>
          </div>
          <div className="row wrap"><Button icon={<Send size={14} />} disabled={!tok?.is_set || !to} busy={test.running} onClick={() => test.start('telegram', 'send_test', { to, text }, 'Enviando teste')}>Enviar teste</Button>
            {f.admin_chat_id && <Button size="sm" onClick={() => setTo(f.admin_chat_id)}>Usar meu chat</Button>}</div>
          <ActionBanner act={test} okText={() => 'Mensagem enviada. Confira no Telegram.'} />
        </div></fieldset>
      </Card>

      <GroupDefaultsCard channel="telegram" s={s} reload={reload} isAdmin={isAdmin} />
    </div>);
}
