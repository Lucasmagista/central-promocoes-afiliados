import { useEffect, useState } from 'react';
import { Database, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import type { DatabaseConfig, DatabaseOverview } from '../../lib/types';
import { Badge, Button, Card, Field, Loading, Seg, useAction, useDialogs, useLoad } from '../../ui/ui';

const empty: DatabaseConfig = { provider: 'supabase', project_ref: '', api_url: '', migration_mode: 'manual' };

export default function DatabaseTab({ isAdmin }: { isAdmin: boolean }) {
  const q = useLoad(() => api().getDatabaseOverview(), [], 10000);
  const [cfg, setCfg] = useState<DatabaseConfig>(empty); const [token, setToken] = useState('');
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  useEffect(() => { if (q.data) setCfg({ ...empty, ...q.data.config }); }, [q.data]);
  if (q.loading && !q.data) return <Loading />;
  const data = q.data as DatabaseOverview | undefined;
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
    <Card title="Provedor de banco" actions={<Badge tone={cfg.provider === 'supabase' ? 'ok' : 'warn'}><Database size={13} />{cfg.provider === 'supabase' ? 'Supabase' : 'planejado'}</Badge>}>
      <fieldset disabled={!isAdmin} className="bare"><div className="col">
        <Field label="Provedor" hint="A troca não move dados automaticamente e não altera o painel publicado. Ela prepara a operação para uma migração futura.">
          <Seg value={cfg.provider} onChange={(provider) => setCfg({ ...cfg, provider: provider as DatabaseConfig['provider'], migration_mode: provider === 'supabase' ? cfg.migration_mode : 'manual' })} options={[{ v: 'supabase', label: 'Supabase' }, { v: 'postgresql', label: 'PostgreSQL' }, { v: 'future', label: 'Outro' }]} />
        </Field>
        <div className="grid g2">
          <Field label="Project ref do Supabase" hint="Identificador de 20 caracteres visível na URL do projeto. Não é segredo."><input value={cfg.project_ref} disabled={cfg.provider !== 'supabase'} placeholder="abcdefghijklmnopqrst" onChange={(e) => setCfg({ ...cfg, project_ref: e.target.value.trim().toLowerCase() })} /></Field>
          <Field label="URL pública da API" hint="Usada como referência operacional; a conexão real do painel vem do build."><input value={cfg.api_url} placeholder="https://seu-projeto.supabase.co" onChange={(e) => setCfg({ ...cfg, api_url: e.target.value.trim() })} /></Field>
        </div>
        <div><Button variant="primary" icon={<Save size={14} />} disabled={!changed} busy={busy === 'database_config'} onClick={save}>Salvar provedor</Button></div>
      </div></fieldset>
    </Card>

    <Card title="Credencial de atualização" actions={<Badge tone={data?.management_token_configured ? 'ok' : 'warn'}>{data?.management_token_configured ? 'configurada' : 'não configurada'}</Badge>}>
      <fieldset disabled={!isAdmin} className="bare"><div className="col">
        <div className="small muted">Para Supabase, use um token da Management API com acesso mínimo de banco. O valor é somente de escrita: depois de salvar, este campo fica vazio e o painel mostra apenas “configurada”. Trocar o valor substitui o token anterior.</div>
        <Field label="Token da Management API" hint="Cole somente para cadastrar ou trocar. Deixe vazio para manter o atual."><input type="password" autoComplete="new-password" value={token} placeholder={data?.management_token_configured ? 'Configurado — informe outro valor para substituir' : 'Cole o token'} onChange={(e) => setToken(e.target.value)} /></Field>
        <div><Button icon={<Save size={14} />} disabled={!token.trim()} busy={busy === 'database_token'} onClick={storeToken}>Salvar token</Button></div>
      </div></fieldset>
    </Card>

    <Card title="Migrações do projeto" actions={<Badge tone={data?.latest ? 'ok' : 'warn'}>{data?.latest ?? 'bootstrap necessário'}</Badge>}>
      <div className="col">
        <div className="small muted">O banco registra {data?.migration_count ?? 0} arquivo(s) aplicado(s). O botão usa o worker para comparar a lista versionada do projeto e executar apenas os SQL posteriores. A primeira ativação exige aplicar manualmente a migração <code>011_database_providers.sql</code>.</div>
        <Field label="Modo de atualização" hint="O modo manual mantém a aplicação pelo SQL Editor. O modo worker usa o token oculto e o worker."><Seg value={cfg.migration_mode} onChange={(migration_mode) => setCfg({ ...cfg, migration_mode: migration_mode as DatabaseConfig['migration_mode'] })} options={[{ v: 'manual', label: 'Manual' }, { v: 'worker', label: 'Pelo worker' }]} /></Field>
        {cfg.migration_mode === 'worker' && <div className="alert warning"><ShieldAlert size={16} /><div>Antes de atualizar, faça backup e revise novas migrações. A alteração é registrada na auditoria e não envia chaves ao navegador.</div></div>}
        <div><Button variant="danger" icon={<RefreshCw size={14} />} disabled={!isAdmin || !canRun} title={!canRun ? 'Configure Supabase, project ref, token e modo Pelo worker' : undefined} busy={busy === 'database_migrate'} onClick={migrate}>Aplicar migrações pendentes</Button></div>
      </div>
    </Card>
  </div>;
}
