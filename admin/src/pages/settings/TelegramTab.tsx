import { useEffect, useState } from 'react';
import { Bot, Lock, RefreshCw, Save, Send, ShieldCheck, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { TelegramConfig } from '../../lib/types';
import { Badge, Button, Card, Field, Seg, Toggle, useAction, useLoad } from '../../ui/ui';
import { ActionBanner, CopyBtn, SecretField, StateDot, Step, checkedAt, cfgOf, statusOf, useIntAction } from '../../components/integrations';
import GroupDefaultsCard from '../../components/GroupDefaultsCard';
import type { TabProps } from './shared';
import { secretOf, stable } from './shared';

const DEF: TelegramConfig = { enabled: false, mode: 'polling', webhook_url: '', admin_chat_id: '', alerts: true };
type Managed = { token?: boolean; webhook?: boolean };

export default function TelegramTab({ s, secrets, reload, isAdmin }: TabProps) {
  const cfg = cfgOf<TelegramConfig>(s, 'telegram', DEF); const st = statusOf(s, 'telegram');
  const { run, busy } = useAction();
  const [f, setF] = useState(cfg); const sig = stable(cfg);
  useEffect(() => { setF(cfg); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const out: TelegramConfig = { ...f, webhook_url: f.webhook_url.trim(), admin_chat_id: f.admin_chat_id.trim() };
  const dirty = stable(out) !== stable(cfg);
  const m = ((st.managed as Managed | undefined) ?? {});
  const tok = secretOf(secrets, 'telegram_bot_token'); const hook = secretOf(secrets, 'telegram_webhook_secret');
  const tokenOk = !!(m.token || tok?.is_set) || !st.checked_at; // antes da primeira checagem deixa tentar: o worker explica se faltar
  const act = useIntAction(); const test = useIntAction();
  const [to, setTo] = useState(''); const [text, setText] = useState('Teste da Central de Promoções: o bot está funcionando.');
  const privates = useLoad(() => api().listChats({ channel: 'telegram', kind: 'private' }), [], 0);
  const save = async () => { if (await run('save-tg', () => api().saveIntegration('telegram', out as unknown as Record<string, unknown>), 'Configuração do Telegram salva')) reload(); };
  const live = String(st.mode_live ?? ''); const wh = st.webhook as { url?: string; pending?: number; last_error?: string | null } | null | undefined;
  const botOk = st.ok === true; const active = cfg.enabled && botOk;
  const modeMismatch = botOk && live && cfg.enabled && live !== cfg.mode;
  useEffect(() => {
    const age = st.checked_at ? Date.now() - new Date(String(st.checked_at)).getTime() : Infinity;
    if (isAdmin && age > 300000) void act.start('telegram', 'check', undefined, 'Verificando');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [isAdmin]);
  useEffect(() => { if (act.job?.status === 'done') reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [act.job?.status]);
  const cmd = 'bash deploy/servidor/configurar-conexoes.sh --importar';

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="heroico tg"><Bot size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h2>Telegram</h2>
                {!tokenOk ? <Badge tone="warn"><StateDot tone="warn" />Sem token do bot</Badge> : active ? <Badge tone="ok"><StateDot tone="ok" />Conectado</Badge> : st.ok === false ? <Badge tone="bad"><StateDot tone="bad" />Com problema</Badge> : !cfg.enabled ? <Badge><StateDot tone="off" />Desligado</Badge> : <Badge tone="warn"><StateDot tone="warn" />Não verificado</Badge>}</div>
              <div className="small muted">{!tokenOk ? 'Falta o token do bot no arquivo seguro do servidor. Veja “Token guardado no servidor”.' : st.ok === false ? String(st.error ?? 'Não foi possível falar com o bot.') : active ? 'O bot respondeu e está pronto para publicar nos canais e grupos em que for administrador.' : 'Clique em “Conectar Telegram”: o bot é conferido, o recebimento é configurado e tudo é ativado.'}</div>
            </div>
          </div>
          <div className="row wrap right">
            {active && <Button icon={<RefreshCw size={14} />} disabled={!isAdmin} onClick={() => act.start('telegram', 'check', undefined, 'Verificando')}>Verificar</Button>}
            <Button variant="primary" icon={<Bot size={15} />} disabled={!isAdmin || !tokenOk} busy={act.running && act.label === 'Conectando'} onClick={() => act.start('telegram', 'connect', undefined, 'Conectando')}>{active ? 'Reconectar' : 'Conectar Telegram'}</Button>
          </div>
        </div>
        <div className="facts">
          <div><span>Bot</span><b>{st.bot_username ? '@' + String(st.bot_username) : '—'}</b></div>
          <div><span>Nome</span><b>{String(st.bot_name ?? '—')}</b></div>
          <div><span>Recebimento</span><b>{live === 'webhook' ? 'Webhook' : live === 'polling' ? 'Consulta (polling)' : '—'}</b></div>
          <div><span>Pendentes</span><b>{wh?.pending ?? '—'}</b></div>
          <div><span>Entra em grupos</span><b>{st.can_join_groups == null ? '—' : st.can_join_groups ? 'sim' : 'não'}</b></div>
          <div><span>Última checagem</span><b>{checkedAt(st).replace('verificado ', '')}</b></div>
        </div>
        <div style={{ padding: '0 18px 16px' }}>
          <ActionBanner act={act} okText={(r) => r.connected ? `Telegram conectado: bot @${r.bot_username}. Recebimento por ${r.mode_live === 'webhook' ? 'webhook' : 'consulta'}.` : r.bot_username ? `Bot @${r.bot_username} respondeu.` : r.webhook === null ? 'Webhook removido; o sistema voltou a consultar.' : 'Concluído.'} />
          {modeMismatch && <div className="alert warning" style={{ marginTop: 8 }}><div>O modo salvo é <b>{cfg.mode === 'webhook' ? 'webhook' : 'consulta'}</b>, mas o Telegram está em <b>{live === 'webhook' ? 'webhook' : 'consulta'}</b>. Clique em “Reconectar” para alinhar.</div></div>}
        </div>
      </section>

      <Card title="Token guardado no servidor" actions={<Badge tone={tokenOk ? 'ok' : 'warn'}><Lock size={11} /> {m.token ? 'arquivo seguro' : tok?.is_set ? 'cofre do banco' : 'pendente'}</Badge>}>
        <div className="col">
          <ol className="guide">
            <Step n={1} title="Crie o bot no @BotFather" done={tokenOk}>No Telegram, abra <b>@BotFather</b> → <code>/newbot</code> → escolha nome e usuário. Ele devolve o <b>token</b>.</Step>
            <Step n={2} title="Guarde o token no servidor" done={tokenOk}>No arquivo <code>deploy/worker/worker.env</code> a linha <code>TELEGRAM_BOT_TOKEN=…</code> (a tela nunca mostra nem pede o token). Ou rode no servidor o comando abaixo.</Step>
            <Step n={3} title="Clique em “Conectar Telegram”" done={active}>O sistema confere o bot e registra o recebimento sozinho.</Step>
            <Step n={4} title="Adicione o bot como administrador do canal ou grupo" done={false}>Canal: Administradores → Adicionar → permissão de <b>publicar mensagens</b>. Para o Radar ler promoções de um grupo, o bot precisa ser admin (ou ter o modo de privacidade desligado no @BotFather: <code>/setprivacy → Disable</code>).</Step>
            <Step n={5} title="Traga os chats para a Central" done={false}>Em <Link to="/destinos">Destinos</Link> use “Buscar grupos” ou informe o @canal. O bot só enxerga chats onde alguém o adicionou.</Step>
          </ol>
          {!m.token && <div className="row wrap"><code>{cmd}</code><CopyBtn text={cmd} /></div>}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Avançado: informar o token e o recebimento manualmente</summary>
            <fieldset disabled={!isAdmin} className="bare" style={{ marginTop: 10 }}><div className="col">
              {!m.token && <SecretField k="telegram_bot_token" label="Token do bot" info={tok} disabled={!isAdmin} onChanged={reload} placeholder="123456789:AAH…" hint="Fica no cofre do banco (só de escrita). O arquivo do servidor é mais seguro. Se vazar, gere outro com /revoke." />}
              <div className="row"><Toggle label="Telegram ativo" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span><b>Usar o Telegram nas publicações</b><div className="small muted">Desligado, as publicações para o Telegram ficam aguardando e nada é enviado.</div></span></div>
              <div className="col" style={{ gap: 5 }}><span style={{ fontWeight: 600, fontSize: 12.5 }}>Como o sistema recebe as mensagens dos chats</span><Seg value={f.mode} onChange={(mo) => setF({ ...f, mode: mo })} options={[{ v: 'polling', label: 'Consulta (polling)' }, { v: 'webhook', label: 'Webhook' }]} /></div>
              {f.mode === 'webhook' && !m.webhook && (<>
                <Field label="Endereço do webhook" hint="https público do worker."><input value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} placeholder="https://worker.seudominio.com.br/hook/telegram-…" inputMode="url" /></Field>
                <div className="row wrap secretrow"><span style={{ fontWeight: 600, fontSize: 12.5 }}>Segredo do webhook</span>
                  {hook?.is_set ? <Badge tone="ok">gerado ••••{hook.hint}</Badge> : <Badge tone="warn">ainda não gerado</Badge>}
                  <Button size="sm" disabled={!isAdmin} busy={busy === 'rot'} onClick={async () => { if (await run('rot', () => api().rotateTelegramWebhookSecret(), 'Novo segredo gerado. Registre o webhook de novo.')) reload(); }}>{hook?.is_set ? 'Gerar outro' : 'Gerar segredo'}</Button></div>
              </>)}
              {m.webhook && <div className="small muted">O endereço do webhook e o segredo vêm do servidor (<code>PUBLIC_URL</code>).</div>}
              <div className="row wrap">
                <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-tg'} onClick={save}>Salvar</Button>
                {f.mode === 'webhook' && <Button icon={<Webhook size={14} />} disabled={dirty || !tokenOk || (!m.webhook && (!hook?.is_set || !cfg.webhook_url))} busy={act.running && act.label === 'Registrando webhook'} onClick={() => act.start('telegram', 'set_webhook', undefined, 'Registrando webhook')}>Registrar webhook</Button>}
                {live === 'webhook' && <Button disabled={!tokenOk} busy={act.running && act.label === 'Removendo webhook'} onClick={() => act.start('telegram', 'delete_webhook', undefined, 'Removendo webhook')}>Voltar para consulta</Button>}
                {wh?.url && <><span className="small muted truncate" style={{ maxWidth: 320 }}>Ativo: {wh.url}</span><CopyBtn text={wh.url} /></>}
              </div>
              {wh?.last_error && <div className="alert warning"><div>Último erro do Telegram ao chamar o webhook: {wh.last_error}</div></div>}
            </div></fieldset>
          </details>
        </div>
      </Card>

      <Card title="Alertas do administrador">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="row"><Toggle label="Alertas" checked={f.alerts} onChange={(v) => setF({ ...f, alerts: v })} /><span><b>Receber avisos no Telegram</b><div className="small muted">Queda e retorno do WhatsApp, e problemas do próprio bot.</div></span></div>
          <Field label="Seu chat com o bot" hint={<>Mande <code>/start</code> para o seu bot no Telegram: a conversa aparece na lista. {privates.data?.length ? '' : <>Também dá para digitar o ID (fale com <b>@userinfobot</b>).</>}</>}>
            <div className="row wrap">
              {privates.data && privates.data.length > 0 && (
                <select value={privates.data.some((c) => c.external_id === f.admin_chat_id) ? f.admin_chat_id : ''} onChange={(e) => e.target.value && setF({ ...f, admin_chat_id: e.target.value })} style={{ maxWidth: 280 }} aria-label="Escolher conversa privada">
                  <option value="">Escolher na lista…</option>
                  {privates.data.map((c) => <option key={c.id} value={c.external_id}>{c.title}{c.username ? ` (@${c.username})` : ''}</option>)}
                </select>)}
              <input value={f.admin_chat_id} onChange={(e) => setF({ ...f, admin_chat_id: e.target.value })} placeholder="123456789" inputMode="numeric" style={{ maxWidth: 200 }} aria-label="ID do chat do administrador" />
            </div>
          </Field>
          <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'save-tg'} onClick={save}>Salvar</Button></div>
        </div></fieldset>
      </Card>

      <Card title="Teste de envio">
        <fieldset disabled={!isAdmin} className="bare"><div className="col">
          <div className="grid g2">
            <Field label="Destino" hint="ID numérico do chat (ex.: -1001234567890) ou @canal."><input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={f.admin_chat_id || '@meu_canal'} /></Field>
            <Field label="Mensagem"><input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></Field>
          </div>
          <div className="row wrap"><Button icon={<Send size={14} />} disabled={!tokenOk || !to} busy={test.running} onClick={() => test.start('telegram', 'send_test', { to, text }, 'Enviando teste')}>Enviar teste</Button>
            {f.admin_chat_id && <Button size="sm" onClick={() => setTo(f.admin_chat_id)}>Usar meu chat</Button>}</div>
          <ActionBanner act={test} okText={() => 'Mensagem enviada. Confira no Telegram.'} />
        </div></fieldset>
      </Card>

      <GroupDefaultsCard channel="telegram" s={s} reload={reload} isAdmin={isAdmin} />
      {!tokenOk && <div className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ShieldCheck size={14} /> O token nunca é exibido nem enviado ao navegador.</div>}
    </div>);
}
