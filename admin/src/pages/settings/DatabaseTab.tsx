import { useEffect, useState } from 'react';
import { CheckCircle2, Database, RefreshCw, Save, ShieldAlert, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import type { DatabaseConfig, DatabaseOverview } from '../../lib/types';
import { Badge, Button, Card, Field, Loading, Seg, useAction, useDialogs, useLoad } from '../../ui/ui';
import { StateDot, statusOf } from '../../components/integrations';
import type { TabProps } from './shared';

const empty: DatabaseConfig = { provider: 'supabase', project_ref: '', api_url: '', migration_mode: 'manual' };

/** Endereço e identificador do projeto a que ESTE painel está ligado (vem do build; a chave pública nunca é exibida). */
function connectedProject(): { url: string; host: string; ref: string } | null {
  const url = String((import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!url) return null;
  try { const host = new URL(url).host; return { url, host, ref: host.split('.')[0] }; } catch { return { url, host: url, ref: '' }; }
}

export default function DatabaseTab({ isAdmin, s }: { isAdmin: boolean } & Partial<Pick<TabProps, 's'>>) {
  const q = useLoad(async () => { const t0 = performance.now(); const d = await api().getDatabaseOverview(); return { d, ms: Math.round(performance.now() - t0) }; }, [], 10000);
  const [cfg, setCfg] = useState<DatabaseConfig>(empty); const [token, setToken] = useState('');
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  useEffect(() => { if (q.data) setCfg({ ...empty, ...q.data.d.config }); }, [q.data]);
  if (q.loading && !q.data) return <Loading />;
  const data = q.data?.d as DatabaseOverview | undefined; const ms = q.data?.ms;
  const proj = connectedProject(); const demo = api().mode === 'demo';
  const online = !q.error && !!data;
  const worker = s ? statusOf(s, 'worker') : {};
  const changed = JSON.stringify(cfg) !== JSON.stringify(data?.config ?? empty);
  const canRun = cfg.provider === 'supabase' && cfg.migration_mode === 'worker' && !!cfg.project_ref && !!data?.management_token_configured;
  const save = async () => {
    if (cfg.provider !== data?.config.provider && !(await confirm({ title: 'Trocar provedor configurado?', danger: true, confirmLabel: 'Salvar alteração', body: 'Isso altera somente a configuração operacional. O painel atual continua conectado ao Supabase definido no build até que você publique uma nova versão com as variáveis corretas.' }))) return;
    if (await run('database_config', () => api().saveDatabaseConfig(cfg), 'Configuração do banco salva')) void q.reload();
  };
  const storeToken = async () => {
    if (!token.trim()) return;
    if (await run('database_token', () => api().setSupabaseManagementToken(token), 'Token guardado sem exibir o valor')) { setToken(''); void q.reload(); }
  };
  const migrate = async () => {
    if (!(await confirm({ title: 'Aplicar migrações pendentes?', danger: true, confirmLabel: 'Solicitar atualização', body: 'O worker executará somente arquivos SQL posteriores aos já registrados no banco. Revise a versão e mantenha backup antes de confirmar.' }))) return;
    if (await run('database_migrate', () => api().requestDatabaseMigration(), 'Atualização solicitada ao worker')) void q.reload();
  };
  return <div className="col" style={{ gap: 14 }}>
    <section className="card">
      <div className="statushero">
        <div className="row" style={{ gap: 14, minWidth: 0 }}>
          <span className="heroico"><Database size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}><h2>Supabase</h2>
              {online ? <Badge tone="ok"><StateDot tone="ok" /><CheckCircle2 size={12} /> Já conectado</Badge> : <Badge tone="bad"><StateDot tone="bad" />Sem resposta</Badge>}</div>
            <div className="small muted">{online ? 'Este painel já está ligado ao banco de dados e funcionando. Não precisa configurar nada aqui para usar a Central.' : 'Não consegui consultar o banco agora. Confira a internet e as variáveis do build do painel.'}</div>
          </div>
        </div>
        <div className="row wrap right"><Button icon={<Zap size={14} />} busy={q.loading} onClick={() => void q.reload()}>Testar conexão</Button></div>
      </div>
      <div className="facts">
        <div><span>Projeto</span><b>{demo ? 'demonstração' : proj?.ref || '—'}</b></div>
        <div><span>Endereço</span><b>{demo ? 'demo.supabase.co' : proj?.host || '—'}</b></div>
        <div><span>Resposta</span><b>{ms != null ? `${ms} ms` : '—'}</b></div>
        <div><span>Migrações aplicadas</span><b>{data?.migration_count ?? '—'}</b></div>
        <div><span>Última migração</span><b title={data?.latest ?? ''}>{data?.latest ?? 'bootstrap necessário'}</b></div>
        <div><span>Worker</span><b>{worker.ok === true ? 'conectado ✓' : worker.ok === false ? 'com problema' : '—'}</b></div>
      </div>
    </section>

    <Card title="Migrações do projeto" actions={<Badge tone={data?.latest ? 'ok' : 'warn'}>{data?.latest ?? 'bootstrap necessário'}</Badge>}>
      <div className="col">
        <div className="small muted">O banco registra {data?.migration_count ?? 0} arquivo(s) aplicado(s). O botão usa o worker para comparar a lista versionada do projeto (pasta <code>db/migrations</code>, lida do servidor) e executar apenas os SQL posteriores. A primeira ativação exige aplicar manualmente a migração <code>011_database_providers.sql</code>.</div>
        <Field label="Modo de atualização" hint="O modo manual mantém a aplicação pelo SQL Editor. O modo worker usa o token oculto e o worker."><Seg value={cfg.migration_mode} onChange={(migration_mode) => setCfg({ ...cfg, migration_mode: migration_mode as DatabaseConfig['migration_mode'] })} options={[{ v: 'manual', label: 'Manual' }, { v: 'worker', label: 'Pelo worker' }]} /></Field>
        {cfg.migration_mode === 'worker' && <div className="alert warning"><ShieldAlert size={16} /><div>Antes de atualizar, faça backup e revise novas migrações. A alteração é registrada na auditoria e não envia chaves ao navegador.</div></div>}
        <div className="row wrap">
          <Button icon={<Save size={14} />} disabled={!isAdmin || !changed} busy={busy === 'database_config'} onClick={save}>Salvar modo</Button>
          <Button variant="danger" icon={<RefreshCw size={14} />} disabled={!isAdmin || !canRun} title={!canRun ? 'Configure Supabase, project ref, token e modo Pelo worker' : undefined} busy={busy === 'database_migrate'} onClick={migrate}>Aplicar migrações pendentes</Button>
        </div>
      </div>
    </Card>

    <Card title="Trocar de banco ou opções avançadas" actions={<Badge tone={cfg.provider === 'supabase' ? 'ok' : 'warn'}><Database size={13} />{cfg.provider === 'supabase' ? 'Supabase' : 'planejado'}</Badge>}>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Mostrar opções (só use se for mudar de projeto ou provedor)</summary>
        <fieldset disabled={!isAdmin} className="bare" style={{ marginTop: 12 }}><div className="col">
          <div className="alert info"><div>Para apontar o painel para <b>outro projeto Supabase</b>, troque <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no build do painel e <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_ROLE_KEY</code> em <code>deploy/worker/worker.env</code>; depois rode o script de atualização. Os campos abaixo guardam apenas a configuração operacional.</div></div>
          <Field label="Provedor" hint="A troca não move dados automaticamente e não altera o painel publicado. Ela prepara a operação para uma migração futura.">
            <Seg value={cfg.provider} onChange={(provider) => setCfg({ ...cfg, provider: provider as DatabaseConfig['provider'], migration_mode: provider === 'supabase' ? cfg.migration_mode : 'manual' })} options={[{ v: 'supabase', label: 'Supabase' }, { v: 'postgresql', label: 'PostgreSQL' }, { v: 'future', label: 'Outro' }]} />
          </Field>
          <div className="grid g2">
            <Field label="Project ref do Supabase" hint="Identificador de 20 caracteres visível na URL do projeto. Não é segredo."><input value={cfg.project_ref} disabled={cfg.provider !== 'supabase'} placeholder={proj?.ref || 'abcdefghijklmnopqrst'} onChange={(e) => setCfg({ ...cfg, project_ref: e.target.value.trim().toLowerCase() })} /></Field>
            <Field label="URL pública da API" hint="Usada como referência operacional; a conexão real do painel vem do build."><input value={cfg.api_url} placeholder={proj?.url || 'https://seu-projeto.supabase.co'} onChange={(e) => setCfg({ ...cfg, api_url: e.target.value.trim() })} /></Field>
          </div>
          {proj && !cfg.project_ref && <div><Button size="sm" onClick={() => setCfg({ ...cfg, project_ref: proj.ref, api_url: proj.url })}>Usar o projeto conectado ({proj.ref})</Button></div>}
          <div><Button variant="primary" icon={<Save size={14} />} disabled={!changed} busy={busy === 'database_config'} onClick={save}>Salvar provedor</Button></div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
          <div className="row wrap" style={{ gap: 8 }}><b>Credencial de atualização</b><Badge tone={data?.management_token_configured ? 'ok' : 'warn'}>{data?.management_token_configured ? 'configurada' : 'não configurada'}</Badge></div>
          <div className="small muted">Para Supabase, use um token da Management API com acesso mínimo de banco. O valor é somente de escrita: depois de salvar, este campo fica vazio e o painel mostra apenas “configurada”. Trocar o valor substitui o token anterior.</div>
          <Field label="Token da Management API" hint="Cole somente para cadastrar ou trocar. Deixe vazio para manter o atual."><input type="password" autoComplete="new-password" value={token} placeholder={data?.management_token_configured ? 'Configurado — informe outro valor para substituir' : 'Cole o token'} onChange={(e) => setToken(e.target.value)} /></Field>
          <div><Button icon={<Save size={14} />} disabled={!token.trim()} busy={busy === 'database_token'} onClick={storeToken}>Salvar token</Button></div>
        </div></fieldset>
      </details>
    </Card>
  </div>;
}
