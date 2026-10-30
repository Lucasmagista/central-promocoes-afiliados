import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Play, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { IntProvider, SelfTestResult, WebhookCheck } from '../../lib/types';
import { Badge, Button, Card, useDialogs, useLoad } from '../../ui/ui';
import { ActionBanner, CopyBtn, StateDot, Step, statusOf, useIntAction, type IntAct } from '../../components/integrations';
import type { TabProps } from './shared';
import { ago } from '../../lib/format';

const ENV = 'SUPABASE_URL=https://SEU-PROJETO.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=cole_a_service_role_aqui';

const secs = (a: IntAct) => (a.job?.finished_at && a.job.requested_at ? Math.max(0, (new Date(a.job.finished_at).getTime() - new Date(a.job.requested_at).getTime()) / 1000) : null);

/** Um teste: botão, andamento, erro explicado e o resultado. Mostra em quanto tempo o worker respondeu. */
function TestTile({ title, desc, provider, action, button, disabled, why, confirmText, render, okText }: {
  title: string; desc: string; provider: IntProvider; action: string; button: string; disabled?: boolean; why?: string; confirmText?: string;
  render?: (r: Record<string, any>) => ReactNode; okText?: (r: Record<string, any>) => ReactNode;
}) {
  const act = useIntAction(); const { confirm } = useDialogs();
  const t = secs(act); const r = act.result;
  const verdict = act.job?.status === 'done' && r ? (r.ok === false ? 'bad' : r.partial ? 'warn' : 'ok') : act.job?.status === 'failed' ? 'bad' : null;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}><b>{title}</b>{verdict && <Badge tone={verdict === 'ok' ? 'ok' : verdict === 'warn' ? 'warn' : 'bad'}>{verdict === 'ok' ? 'passou' : verdict === 'warn' ? 'atenção' : 'falhou'}</Badge>}{t != null && <span className="small muted">o worker respondeu em {t < 1 ? '<1' : t.toFixed(0)} s</span>}</div>
          <div className="small muted" style={{ marginTop: 2 }}>{desc}</div>
        </div>
        <Button icon={<Play size={14} />} disabled={disabled} title={disabled ? why : undefined} busy={act.running} onClick={async () => { if (confirmText && !(await confirm({ title: title + '?', body: confirmText, confirmLabel: button }))) return; act.start(provider, action, undefined, title); }}>{button}</Button>
      </div>
      {(act.running || act.job) && <div style={{ marginTop: 12 }}><ActionBanner act={act} okText={okText ?? (() => 'Concluído.')} /></div>}
      {act.job?.status === 'done' && r && render && <div style={{ marginTop: 10 }}>{render(r)}</div>}
    </div>);
}

function Checks({ items }: { items: { ok: boolean; label: string; detail: string; required?: boolean }[] }) {
  return <ul className="checks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map((c) => (
    <li key={c.label} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
      {c.ok ? <CheckCircle2 size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} /> : c.required === false ? <CircleAlert size={16} style={{ color: 'var(--warn, var(--muted))', flex: 'none', marginTop: 2 }} /> : <XCircle size={16} style={{ color: 'var(--bad)', flex: 'none', marginTop: 2 }} />}
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{c.label}</div><div className="small muted">{c.detail}</div></div></li>))}</ul>;
}

export default function WorkerTab({ s, isAdmin }: TabProps) {
  const hb = useLoad(() => api().dashboard(), [], 15000);
  const wa = useLoad(() => api().channelOverview('whatsapp'), [], 20000);
  const tgo = useLoad(() => api().channelOverview('telegram'), [], 20000);
  const worker = hb.data?.heartbeats.find((h) => h.service === 'worker');
  const last = statusOf(s, 'worker') as { ok?: boolean; at?: string; checked_at?: string };
  const evoCfg = (s.int_evolution ?? {}) as { webhook_url?: string; instance?: string }; const tgCfg = (s.int_telegram ?? {}) as { webhook_url?: string };
  const alive = !!worker && worker.age_seconds < 150;
  const paused = s.paused === true || s.paused === 'true';
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card">
        <div className="statushero">
          <div style={{ minWidth: 0 }}><div className="row wrap" style={{ gap: 8 }}><h2>Worker</h2>
            {!worker ? <Badge tone="warn"><StateDot tone="warn" />sem sinal</Badge> : alive ? <Badge tone="ok"><StateDot tone="ok" />ativo</Badge> : <Badge tone="bad"><StateDot tone="bad" />parado</Badge>}
            {last.at && <Badge tone={last.ok ? 'ok' : 'bad'}>{last.ok ? 'autoteste passou' : 'autoteste com falhas'} · {ago(last.at)}</Badge>}</div>
            <div className="small muted">{worker ? `Último sinal ${ago(worker.last_seen)}.` : 'Nenhum sinal recebido ainda. Siga o passo a passo abaixo.'} O worker é quem fala com a Evolution, o Telegram e as lojas; o painel só dá as ordens.</div></div>
          <div className="row wrap right"><Link className="btn" to="/saude">Ver saúde do sistema</Link></div>
        </div>
      </section>

      <Card title="Do zero ao funcionando">
        <ol className="guide">
          <Step n={1} title="Variáveis no servidor" done={alive}>Crie <code>deploy/worker/worker.env</code> com as duas variáveis da seção “Variáveis de ambiente” (a <i>service_role</i> fica só aí).</Step>
          <Step n={2} title="Migrações do banco até a 017" done={!!last.at}>No SQL Editor do Supabase, rode em ordem as migrações que ainda não rodou.</Step>
          <Step n={3} title="Subir o worker" done={alive}>No servidor: <code>./deploy/servidor/atualizar.sh --force</code> (ou o script <code>subir.ps1</code>, no seu computador). O sinal de vida acima fica verde em até 1 minuto.</Step>
          <Step n={4} title="Rodar o autoteste" done={!!last.ok}>Use o primeiro teste logo abaixo.</Step>
          <Step n={5} title="Webhooks de entrada" done={!!evoCfg.webhook_url}>Os endereços aparecem em <code>docker logs promo-worker</code>. Cole nas abas WhatsApp (pode ser o interno <code>http://promo-worker:8787/hook/whatsapp-…</code>) e Telegram (precisa ser https público). Depois rode “Webhooks de entrada”.</Step>
        </ol>
      </Card>

      <Card title="Testes — cada parte do worker">
        <div className="col">
          <div className="small muted">Cada botão manda uma ordem ao worker e mostra o resultado. Se ficar “aguardando o worker” por mais de 20 s, ele não está no ar ou as variáveis estão erradas (veja os passos 1 e 3).</div>
          <TestTile title="Autoteste completo" desc="Variáveis do worker, conexão com o Supabase, assinaturas (SHA-256/HMAC) e o que já está configurado. Não mostra segredos."
            provider="worker" action="selftest" button="Rodar autoteste" disabled={!isAdmin} why="Só administradores"
            okText={(r) => ((r as SelfTestResult).ok ? 'Tudo que é obrigatório está certo.' : 'Há itens obrigatórios com problema.')}
            render={(r) => <Checks items={(r as SelfTestResult).checks} />} />
          <TestTile title="Webhooks de entrada" desc="O worker chama os endereços salvos nas abas WhatsApp e Telegram, como a Evolution e o Telegram fariam. Prova que a URL chega ao worker."
            provider="worker" action="webhook_check" button="Testar webhooks" disabled={!isAdmin} why="Só administradores"
            okText={(r) => (r.ok ? 'Os webhooks salvos estão respondendo.' : 'Algum webhook não respondeu como esperado.')}
            render={(r) => <Checks items={((r.webhooks ?? []) as WebhookCheck[]).map((w) => ({ ok: w.ok, required: w.configured, label: `${w.name}${w.target ? ' · ' + w.target : ''}`, detail: `${w.detail}${w.ms ? ` (${w.ms} ms)` : ''}` }))} />} />
          <TestTile title="WhatsApp (Evolution)" desc="O worker consulta o servidor, a instância e o número conectado."
            provider="evolution" action="status" button="Verificar WhatsApp" disabled={!isAdmin} why="Só administradores"
            okText={(r) => `Servidor ${r.reachable ? 'respondeu' : 'sem resposta'}${r.state ? ` · instância ${r.state}` : ''}${r.phone ? ` · +${r.phone}` : ''}.`} />
          <TestTile title="Telegram (bot)" desc="O worker confere o token, o nome do bot e o modo de recebimento."
            provider="telegram" action="check" button="Verificar Telegram" disabled={!isAdmin} why="Só administradores"
            okText={(r) => `Bot @${r.bot_username ?? '?'} ativo · modo ${r.mode_live ?? '?'}.`} />
          <TestTile title="Monitor agora" desc="Roda uma vez o vigia do minuto: confere WhatsApp e Telegram, busca mensagens (modo polling) e avisa se algo caiu."
            provider="worker" action="run_monitor" button="Rodar monitor" disabled={!isAdmin} why="Só administradores"
            okText={(r) => `Monitor executado: ${Object.entries((r.monitor ?? {}) as Record<string, string>).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nada para conferir (configure WhatsApp ou Telegram)'}.`} />
          <TestTile title="Ciclo de envio agora" desc="Roda uma vez o publicador: envia as ofertas aprovadas que já estão na fila, respeitando pausa, janelas e limites."
            provider="worker" action="run_sender" button="Rodar envio" disabled={!isAdmin || paused} why={paused ? 'A pausa geral está ligada' : 'Só administradores'}
            confirmText="Isso publica de verdade as ofertas aprovadas que estiverem prontas na fila (no modo Simulação, nada sai). Continuar?"
            okText={(r) => { const x = (r.sender ?? {}) as Record<string, number>; return `Envio executado: ${x.sent ?? 0} enviada(s), ${x.failed ?? 0} com falha, ${x.unknown ?? 0} incerta(s).`; }} />
          <div className="small muted">Lojas (Mercado Livre, Shopee, Amazon, AliExpress): teste em <Link to="/conectores">Conectores → Testar conexão</Link>. Grupos e QR code: abas WhatsApp e Telegram.</div>
        </div>
      </Card>

      <Card title="Entrada de mensagens (últimas 24 h)">
        <div className="col">
          <div className="grid g2">
            <div className="card stat"><div className="small muted" style={{ fontWeight: 600 }}>Recebidas do WhatsApp</div><div className="v">{wa.data ? wa.data.messages_in_24h : '—'}</div></div>
            <div className="card stat"><div className="small muted" style={{ fontWeight: 600 }}>Recebidas do Telegram</div><div className="v">{tgo.data ? tgo.data.messages_in_24h : '—'}</div></div>
          </div>
          <div className="small muted">Para provar a entrada de ponta a ponta: mande uma mensagem em um grupo em que o número/bot esteja e veja se este número sobe (ou abra Conversas). Zero com grupos ativos indica webhook errado ou worker parado.</div>
          <div className="small muted">Endereços salvos — WhatsApp: <code>{evoCfg.webhook_url || 'não definido'}</code> · Telegram: <code>{tgCfg.webhook_url || 'não definido (modo polling não precisa)'}</code></div>
        </div>
      </Card>

      <Card title="Variáveis de ambiente do worker">
        <div className="col">
          <div className="small muted">Arquivo <code>deploy/worker/worker.env</code> no servidor (fora do Git). Depois de editar, reinicie o worker com o <code>atualizar.sh --force</code>.</div>
          <pre className="envbox">{ENV}</pre>
          <div className="row"><CopyBtn text={ENV} label="Copiar modelo" /></div>
          <div className="alert warning"><div>A <b>service_role</b> dá acesso total ao banco. Ela fica só no worker; nunca coloque no painel, no navegador ou em arquivos do site.</div></div>
        </div>
      </Card>
    </div>);
}
