import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, Check, CircleDashed, Clock, KeyRound, Link2, Pencil, Plus, Rss, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, connectorModeLabel, dateTime, platformName } from '../lib/format';
import type { Connector, ConnectorConfig, ConnectorMode, IntProvider, ProductCategory, Run, SecretInfo, SecretKey, SettingsMap } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHead, Tabs, Toggle, useAction, useLoad } from '../ui/ui';
import { ConnectorMode as Mode } from '../ui/badges';
import { CategoryChips, CategoryPicker } from '../components/CategoryPicker';
import { DEFAULT_CATEGORIES } from '../lib/categories';
import { ActionBanner, SecretField, statusOf, useIntAction } from '../components/integrations';

/** Como cada plataforma entrega ofertas por API oficial. Endereços e exigências mudam: sempre confira no painel do programa. */
const API: Record<string, { name: string; secret: SecretKey; secretLabel: string; fields: { key: string; label: string; hint: string; ph: string }[]; steps: string[]; verdict: string; docs: { label: string; url: string }[]; autoCheck: boolean }> = {
  mercadolivre: {
    name: 'Aplicativo do Mercado Livre', secret: 'ml_client_secret', secretLabel: 'Secret Key do aplicativo', autoCheck: true,
    fields: [{ key: 'app_id', label: 'App ID (Client ID)', hint: 'Número do aplicativo, na página do app em Mercado Livre Developers.', ph: '1234567890123456' }, { key: 'redirect_uri', label: 'URL de redirecionamento', hint: 'Exigida ao criar o app. Pode ser o endereço do seu painel (https).', ph: 'https://painel.seudominio.com.br' }],
    verdict: 'Vale a pena criar. A API oficial entrega preço, estoque, categoria e vendedor com estabilidade, sem depender de páginas que mudam. O app só fornece os dados; a comissão continua vindo do seu ID no Programa de Afiliados.',
    steps: ['Entre em Mercado Livre Developers com a conta do vendedor/afiliado e crie um aplicativo.', 'Marque o escopo de leitura e informe a URL de redirecionamento.', 'Copie o App ID e a Secret Key para cá.', 'Salve e clique em “Testar conexão”.'],
    docs: [{ label: 'Mercado Livre Developers', url: 'https://developers.mercadolivre.com.br' }, { label: 'Programa de Afiliados', url: 'https://www.mercadolivre.com.br/afiliados' }],
  },
  shopee: {
    name: 'Shopee Affiliate Open API', secret: 'shopee_secret', secretLabel: 'Secret (chave secreta)', autoCheck: true,
    fields: [{ key: 'app_id', label: 'App ID', hint: 'Fornecido no painel de afiliados da Shopee, em Open API.', ph: '1234567' }, { key: 'api_endpoint', label: 'Endereço da API (opcional)', hint: 'Deixe vazio para usar o padrão do Brasil. Preencha só se a Shopee informar outro.', ph: 'https://…' }],
    verdict: 'Vale a pena, é o caminho certo. A Open API de afiliados devolve produtos com link já rastreado para a sua conta e a taxa de comissão. Exige conta de afiliado aprovada.',
    steps: ['Entre no painel do Programa de Afiliados da Shopee e abra a área de Open API.', 'Crie as credenciais e copie o App ID e o Secret.', 'Cole aqui, salve e use “Testar conexão”.'],
    docs: [{ label: 'Afiliados Shopee', url: 'https://affiliate.shopee.com.br' }],
  },
  amazon: {
    name: 'Amazon Creators API', secret: 'amazon_client_secret', secretLabel: 'Client Secret', autoCheck: false,
    fields: [{ key: 'client_id', label: 'Client ID (credential ID)', hint: 'Gerado na área de API do Amazon Associates.', ph: 'amzn1.application-oa2-client…' }, { key: 'partner_tag', label: 'Tag de associado', hint: 'Sua tag, no formato nome-20.', ph: 'seunome-20' }, { key: 'marketplace', label: 'Loja (marketplace)', hint: 'Ex.: www.amazon.com.br', ph: 'www.amazon.com.br' }],
    verdict: 'Use quando a sua conta liberar. A antiga PA-API v5 foi encerrada e a Creators API a substituiu, com exigência de vendas qualificadas. Confirme no Associates se o Brasil está habilitado. Por enquanto o painel só confere o preenchimento.',
    steps: ['No Amazon Associates, abra Ferramentas → API de criadores e crie as credenciais.', 'Copie o Client ID e o Client Secret e informe a tag.', 'Salve. O teste automático ainda não existe: valide gerando um link no Associates.'],
    docs: [{ label: 'Amazon Associates Brasil', url: 'https://associados.amazon.com.br' }],
  },
};


const DAY = 86_400_000;
const AFF: Record<string, { label: string; key: 'affiliate_id' | 'affiliate_tag'; hint: string; ph: string }> = {
  mercadolivre: { label: 'ID de afiliado', key: 'affiliate_id', hint: 'O identificador que o programa de afiliados do Mercado Livre usa nos seus links.', ph: 'seu-id' },
  amazon: { label: 'Tag de associado', key: 'affiliate_tag', hint: 'A tag do Amazon Associates, no formato nome-20.', ph: 'seunome-20' },
  shopee: { label: 'ID de afiliado', key: 'affiliate_id', hint: 'O ID do programa de afiliados da Shopee.', ph: 'seu-id' },
  network: { label: 'ID da rede', key: 'affiliate_id', hint: 'ID na rede de afiliados.', ph: 'id' },
};

function checklist(c: Connector, cfg: ConnectorConfig, reviewed: string | null) {
  const aff = AFF[c.platform] ?? AFF.network;
  return [
    { ok: !!reviewed, label: 'Documentação e termos do programa revisados', fix: 'Informe a data da revisão' },
    { ok: !!cfg[aff.key], label: `${aff.label} informado`, fix: `Preencha “${aff.label}” na aba Afiliado` },
    { ok: !!cfg.credential_ref, label: 'Credencial referenciada (guardada no n8n)', fix: 'Informe o nome da credencial no n8n' },
    { ok: (cfg.categories?.length ?? 0) > 0, label: 'Tipos de produto monitorados definidos', fix: 'Escolha ao menos um tipo na aba Coleta' },
    { ok: (cfg.poll_minutes ?? 0) >= 5, label: 'Frequência de coleta definida', fix: 'Defina de quantos em quantos minutos' },
  ];
}


function ApiTab({ c, cfg, set, secrets, settings, onChanged, isDirty }: { c: Connector; cfg: ConnectorConfig; set: <K extends keyof ConnectorConfig>(k: K, v: ConnectorConfig[K]) => void; secrets: SecretInfo[]; settings: SettingsMap; onChanged: () => void; isDirty: boolean }) {
  const def = API[c.platform]; const act = useIntAction();
  const fin = act.job?.status === 'done' || act.job?.status === 'failed';
  useEffect(() => { if (fin) onChanged(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fin, act.job?.id]);
  if (!def) return <div className="alert info">Esta rede não tem integração por API oficial neste painel.</div>;
  const st = statusOf(settings, c.platform as IntProvider); const info = secrets.find((x) => x.key === def.secret);
  return (
    <div className="col">
      <div className="alert info" style={{ alignItems: 'flex-start' }}><div><b>{def.name}: vale criar?</b><div style={{ fontWeight: 400, marginTop: 3 }}>{def.verdict}</div></div></div>
      <ol className="guide">{def.steps.map((s, i) => <li key={s} className="step"><span className="stepn">{i + 1}</span><div>{s}</div></li>)}</ol>
      <div className="row wrap small">{def.docs.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer noopener">{d.label} ↗</a>)}<span className="muted">Confira sempre os termos e requisitos atuais no site do programa.</span></div>
      <div className="grid g2">{def.fields.map((f) => <Field key={f.key} label={f.label} hint={f.hint}><input value={String(cfg[f.key] ?? '')} placeholder={f.ph} onChange={(e) => set(f.key, e.target.value.trim() || undefined)} /></Field>)}</div>
      <SecretField k={def.secret} label={def.secretLabel} info={info} onChanged={onChanged} hint="Guardada no banco, sem voltar para a tela. Para trocar, use “Trocar”." />
      <div className="row wrap">
        <Button variant="primary" disabled={isDirty || !info?.is_set} busy={act.running} onClick={() => act.start(c.platform as IntProvider, 'check', undefined, 'Testando conexão')}>Testar conexão</Button>
        {isDirty && <span className="small muted">Salve o conector antes de testar: o teste usa os dados salvos.</span>}
        {!def.autoCheck && <span className="small muted">Para a Amazon o teste só confere o preenchimento.</span>}
        <span className="small right muted">Executado pelo n8n · <Link to="/configuracoes?aba=n8n">ver workflows</Link></span>
      </div>
      <ActionBanner act={act} />
      {!act.job && st.checked_at ? <div className={`alert ${st.ok ? 'info' : 'critical'}`} style={st.ok ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : undefined}><div><b>Último teste {ago(String(st.checked_at))}:</b> {st.ok ? String(st.detail ?? 'credenciais aceitas') : String(st.error ?? 'falhou')}</div></div> : null}
    </div>);
}

function Editor({ c, cats, allowed, secrets, settings, reloadInt, onClose, onSaved }: { c: Connector; cats: ProductCategory[]; allowed: string[]; secrets: SecretInfo[]; settings: SettingsMap; reloadInt: () => void; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState('geral');
  const [mode, setMode] = useState<ConnectorMode>(c.mode);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [short, setShort] = useState(c.use_short_link);
  const [reviewed, setReviewed] = useState(c.docs_reviewed_at ? c.docs_reviewed_at.slice(0, 10) : '');
  const [cfg, setCfg] = useState<ConnectorConfig>({ ...c.config });
  const [src, setSrc] = useState({ name: '', url: '' });
  const { run, busy } = useAction();
  const set = <K extends keyof ConnectorConfig>(k: K, v: ConnectorConfig[K]) => setCfg((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const aff = AFF[c.platform] ?? AFF.network;
  const items = checklist(c, cfg, reviewed || null);
  const readyBlockers = items.filter((i) => !i.ok);
  const srcOk = (() => { try { const u = new URL(src.url); return u.protocol === 'https:' && (!allowed.length || allowed.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))); } catch { return false; } })();
  const apiKeys = (API[c.platform]?.fields ?? []).map((f) => f.key);
  const apiDirty = apiKeys.some((k) => (cfg[k] ?? '') !== (c.config[k] ?? ''));
  const errs: string[] = [];
  if (cfg.poll_minutes != null && (cfg.poll_minutes < 5 || cfg.poll_minutes > 1440)) errs.push('Frequência de coleta: entre 5 e 1440 minutos.');
  if (cfg.min_discount_pct != null && (cfg.min_discount_pct < 0 || cfg.min_discount_pct > 95)) errs.push('Desconto mínimo: entre 0 e 95%.');
  if (cfg.min_score != null && (cfg.min_score < 0 || cfg.min_score > 100)) errs.push('Score mínimo: entre 0 e 100.');
  if (cfg.max_items_per_run != null && (cfg.max_items_per_run < 1 || cfg.max_items_per_run > 500)) errs.push('Itens por execução: entre 1 e 500.');
  if (cfg.min_price != null && cfg.max_price != null && cfg.min_price > cfg.max_price) errs.push('Preço mínimo maior que o máximo.');
  if (mode === 'api_ready' && readyBlockers.length) errs.push('Para marcar “API pronta” complete o checklist (aba Geral).');
  const save = async () => {
    const rd = reviewed ? new Date(reviewed + 'T12:00:00').toISOString() : null;
    const clean = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0 && false)));
    if (await run('s', () => api().saveConnector(c.id, { mode, notes: notes || null, use_short_link: short, docs_reviewed_at: rd, review_due_at: rd ? new Date(new Date(rd).getTime() + 30 * DAY).toISOString() : null, config: clean as ConnectorConfig }), 'Conector atualizado')) { onSaved(); onClose(); }
  };
  return (
    <Modal wide title={`Configurar — ${c.display_name}`} onClose={onClose} footer={<>
      {errs.length > 0 && <span className="small" style={{ color: 'var(--bad)', marginRight: 'auto' }}>{errs[0]}</span>}
      <Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={busy === 's'} disabled={errs.length > 0} onClick={save}>Salvar</Button></>}>
      <div className="col">
        <Tabs value={tab} onChange={setTab} tabs={[{ v: 'geral', label: 'Geral' }, { v: 'afiliado', label: 'Afiliado' }, ...(API[c.platform] ? [{ v: 'api', label: 'API oficial' }] : []), { v: 'coleta', label: 'Coleta' }, { v: 'fontes', label: `Fontes (${cfg.sources?.length ?? 0})` }]} />

        {tab === 'geral' && <div className="col">
          <Field label="Modo de operação" hint="“API pronta” só é permitido com o checklist completo e a data de revisão dos termos."><select value={mode} onChange={(e) => setMode(e.target.value as ConnectorMode)}>{Object.entries(connectorModeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Documentação/termos revisados em" hint="A próxima revisão é marcada para 30 dias depois."><input type="date" value={reviewed} onChange={(e) => setReviewed(e.target.value)} /></Field>
          <label className="row"><Toggle label="Link curto" checked={short} onChange={setShort} />Usar redirecionador próprio (link curto). Desligue se o programa proibir links encurtados.</label>
          <Field label="Observações"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>Checklist para “API pronta”</div>
            <div className="col" style={{ gap: 6 }}>{items.map((i) => <div key={i.label} className="row small" style={{ color: i.ok ? 'var(--ok)' : 'var(--text)' }}>{i.ok ? <Check size={15} /> : <CircleDashed size={15} color="var(--muted)" />}<span>{i.label}</span>{!i.ok && <span className="muted">— {i.fix}</span>}</div>)}</div>
          </div>
        </div>}

        {tab === 'afiliado' && <div className="col">
          <Field label={aff.label} hint={aff.hint}><input value={String(cfg[aff.key] ?? '')} placeholder={aff.ph} onChange={(e) => set(aff.key, e.target.value.trim() || undefined)} /></Field>
          <Field label="Nome da credencial no n8n" hint="Só o NOME (ex.: ml-afiliados). Chaves, tokens e senhas ficam no n8n, nunca aqui."><input value={cfg.credential_ref ?? ''} placeholder="nome-da-credencial" onChange={(e) => set('credential_ref', e.target.value.trim() || undefined)} /></Field>
          <div className="alert info"><KeyRound size={16} style={{ flex: 'none', marginTop: 2 }} />O banco recusa campos com nome de segredo (token, senha, api_key…) e valores que parecem chaves. Isso protege você caso alguém cole uma chave por engano.</div>
        </div>}

        {tab === 'api' && <ApiTab c={c} cfg={cfg} set={set} secrets={secrets} settings={settings} onChanged={reloadInt} isDirty={apiDirty} />}

        {tab === 'coleta' && <div className="col">
          <div className="grid g3">
            <Field label="Coletar a cada (min)" hint="5 a 1440."><input type="number" min={5} max={1440} value={cfg.poll_minutes ?? ''} onChange={(e) => set('poll_minutes', num(e.target.value))} /></Field>
            <Field label="Itens por execução" hint="1 a 500."><input type="number" min={1} max={500} value={cfg.max_items_per_run ?? ''} onChange={(e) => set('max_items_per_run', num(e.target.value))} /></Field>
            <Field label="Score mínimo" hint="0 a 100."><input type="number" min={0} max={100} value={cfg.min_score ?? ''} onChange={(e) => set('min_score', num(e.target.value))} /></Field>
          </div>
          <div className="grid g3">
            <Field label="Desconto mínimo (%)" hint="0 a 95."><input type="number" min={0} max={95} value={cfg.min_discount_pct ?? ''} onChange={(e) => set('min_discount_pct', num(e.target.value))} /></Field>
            <Field label="Preço mínimo (R$)"><input type="number" min={0} value={cfg.min_price ?? ''} onChange={(e) => set('min_price', num(e.target.value))} /></Field>
            <Field label="Preço máximo (R$)"><input type="number" min={0} value={cfg.max_price ?? ''} onChange={(e) => set('max_price', num(e.target.value))} /></Field>
          </div>
          <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Tipos de produto monitorados</div><CategoryPicker cats={cats} value={cfg.categories ?? []} onChange={(v) => set('categories', v)} /></div>
          {errs.filter((e) => !e.startsWith('Para marcar')).map((e) => <div key={e} className="alert critical">{e}</div>)}
        </div>}

        {tab === 'fontes' && <div className="col">
          <div className="small muted">Páginas de ofertas que o coletor deve visitar. Apenas https e somente domínios permitidos {allowed.length ? `(${allowed.join(', ')})` : ''}.</div>
          {(cfg.sources ?? []).map((s, i) => <div key={s.url} className="row card" style={{ padding: '8px 12px' }}><Rss size={15} color="var(--muted)" /><div style={{ minWidth: 0, flex: 1 }}><b>{s.name}</b><div className="small muted truncate">{s.url}</div></div>
            <Button size="sm" variant="ghost" aria-label={`Remover ${s.name}`} icon={<Trash2 size={14} />} onClick={() => set('sources', (cfg.sources ?? []).filter((_, k) => k !== i))} /></div>)}
          <div className="row wrap"><input aria-label="Nome da fonte" style={{ width: 180 }} placeholder="Nome" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} />
            <input aria-label="Endereço da fonte" style={{ flex: 1, minWidth: 220 }} placeholder="https://…" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
            <Button icon={<Plus size={15} />} disabled={!src.name.trim() || !srcOk} onClick={() => { set('sources', [...(cfg.sources ?? []), { name: src.name.trim(), url: src.url.trim() }]); setSrc({ name: '', url: '' }); }}>Adicionar</Button></div>
          {src.url && !srcOk && <div className="small" style={{ color: 'var(--bad)' }}>Endereço inválido ou fora dos domínios permitidos (Configurações → domínios permitidos).</div>}
        </div>}
      </div>
    </Modal>);
}

const num = (n: number | undefined, suf = '') => (n == null ? '—' : `${n}${suf}`);

export default function Connectors() {
  const { isAdmin } = useSession();
  const { run } = useAction();
  const q = useLoad(() => api().listConnectors(), []);
  const runs = useLoad(() => api().listRuns(), [], 20000);
  const catsQ = useLoad(() => api().listCategories(), []);
  const settings = useLoad(() => api().getSettings(), [], 15000);
  const secs = useLoad(() => api().listIntegrationSecrets().catch(() => [] as SecretInfo[]), []);
  const [edit, setEdit] = useState<Connector | null>(null);
  const [plat, setPlat] = useState('all');
  const cats = catsQ.data ?? DEFAULT_CATEGORIES;
  const allowedFor = (p: string) => ((settings.data?.allowed_domains as Record<string, string[]> | undefined)?.[p] ?? []);
  const rs: Run[] = (runs.data ?? []).filter((r) => plat === 'all' || r.platform === plat);

  return (
    <>
      <PageHead title="Conectores" sub="Uma entrada por plataforma. Nada coleta ou publica sem um modo explícito e uma revisão de termos registrada." />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> :
        <div className="grid g2">{q.data!.map((c) => {
          const overdue = c.review_due_at && new Date(c.review_due_at).getTime() < Date.now();
          const days = c.review_due_at ? Math.ceil((new Date(c.review_due_at).getTime() - Date.now()) / DAY) : null;
          const cfg = c.config ?? {}; const aff = AFF[c.platform] ?? AFF.network;
          const items = checklist(c, cfg, c.docs_reviewed_at); const done = items.filter((i) => i.ok).length;
          const lastRun = (runs.data ?? []).find((r) => r.platform === c.platform);
          return <Card key={c.id} title={<span className="row wrap">{c.display_name}<Mode s={c.mode} /></span>} actions={isAdmin && <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEdit(c)}>Configurar</Button>}>
            <div className="col" style={{ gap: 12 }}>
              {c.last_error && <div className="alert critical small"><AlertTriangle size={15} style={{ flex: 'none', marginTop: 2 }} /><span><b>Último erro {ago(c.last_error_at)}:</b> {c.last_error}</span></div>}
              <div>
                <div className="row small" style={{ marginBottom: 4 }}><span style={{ fontWeight: 600 }}>Preparo para API</span><span className="right muted">{done} de {items.length}</span></div>
                <div className="bar"><i style={{ width: `${(done / items.length) * 100}%` }} /></div>
              </div>
              <dl className="kv wide">
                <dt><SlidersHorizontal size={13} style={{ verticalAlign: -2 }} /> Coleta</dt><dd>a cada {num(cfg.poll_minutes, ' min')} · até {num(cfg.max_items_per_run)} itens · desconto ≥ {num(cfg.min_discount_pct, '%')} · score ≥ {num(cfg.min_score)}</dd>
                <dt>Tipos monitorados</dt><dd><span className="row wrap" style={{ gap: 5 }}><CategoryChips cats={cats} value={cfg.categories ?? []} max={3} /></span></dd>
                <dt>{aff.label}</dt><dd>{cfg[aff.key] ? <code>{String(cfg[aff.key])}</code> : <Badge tone="warn">não informado</Badge>}</dd>
                {API[c.platform] && <><dt><KeyRound size={13} style={{ verticalAlign: -2 }} /> API oficial</dt><dd>{(() => { const def = API[c.platform]; const has = (secs.data ?? []).find((x) => x.key === def.secret)?.is_set; const stt = statusOf(settings.data ?? {}, c.platform as IntProvider);
                  return !has || !cfg[def.fields[0].key] ? <Badge tone="warn">não configurada</Badge> : stt.checked_at ? (stt.ok ? <Badge tone="ok">{stt.partial ? 'campos ok' : 'conectada'} · {ago(String(stt.checked_at))}</Badge> : <Badge tone="bad">teste falhou</Badge>) : <Badge>configurada, não testada</Badge>; })()}</dd></>}
                <dt><Rss size={13} style={{ verticalAlign: -2 }} /> Fontes</dt><dd>{cfg.sources?.length ? `${cfg.sources.length} cadastrada(s)` : '—'}</dd>
                <dt><CalendarCheck size={13} style={{ verticalAlign: -2 }} /> Termos revisados</dt><dd>{c.docs_reviewed_at ? <>{new Date(c.docs_reviewed_at).toLocaleDateString('pt-BR')} · {overdue ? <Badge tone="bad">revisão vencida</Badge> : <span className={days != null && days <= 7 ? 'down' : 'muted'}>próxima em {days} dia(s)</span>}</> : <Badge tone="warn">nunca</Badge>}</dd>
                <dt><Clock size={13} style={{ verticalAlign: -2 }} /> Último sucesso</dt><dd>{ago(c.last_success_at)}{lastRun ? <span className="muted"> · última execução: {lastRun.status}</span> : null}</dd>
                <dt><Link2 size={13} style={{ verticalAlign: -2 }} /> Link curto</dt><dd><span className="row"><Toggle label={`Link curto ${c.display_name}`} checked={c.use_short_link} disabled={!isAdmin} onChange={async (v) => { if (await run('l', () => api().saveConnector(c.id, { use_short_link: v }), 'Atualizado')) void q.reload(); }} />
                  <span className="small muted">{c.use_short_link ? 'redirecionador próprio' : 'link de afiliado direto'}</span></span></dd></dl>
              {c.notes && <div className="small muted">{c.notes}</div>}
              {isAdmin && <Button size="sm" icon={<CalendarCheck size={14} />} onClick={async () => { const now = new Date().toISOString(); if (await run('r', () => api().saveConnector(c.id, { docs_reviewed_at: now, review_due_at: new Date(Date.now() + 30 * DAY).toISOString() }), 'Revisão registrada para hoje')) void q.reload(); }}>Registrar revisão de hoje</Button>}
            </div></Card>; })}</div>}
      <div style={{ marginTop: 14 }}><Card title="Execuções recentes" actions={<select aria-label="Filtrar execuções" value={plat} onChange={(e) => setPlat(e.target.value)}><option value="all">Todas as plataformas</option>{(q.data ?? []).map((c) => <option key={c.id} value={c.platform}>{platformName[c.platform as keyof typeof platformName] ?? c.display_name}</option>)}</select>} flush>
        {rs.length ? <div className="tablewrap"><table><thead><tr><th>Plataforma</th><th>Início</th><th>Duração</th><th>Status</th><th>Vistos</th><th>Aceitos</th><th>Rejeitados</th><th>Resumo</th></tr></thead>
          <tbody>{rs.map((r) => <tr key={r.id}><td>{r.platform}</td><td className="nowrap">{dateTime(r.started_at)}</td><td className="small">{r.finished_at ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))} s` : 'em andamento'}</td><td><Badge tone={r.status === 'success' ? 'ok' : r.status === 'error' ? 'bad' : 'warn'}>{r.status}</Badge></td>
            <td>{r.items_seen}</td><td>{r.items_accepted}</td><td>{r.items_rejected}</td><td className="small muted">{r.error_summary ?? '—'}</td></tr>)}</tbody></table></div> : <div className="empty">Nenhuma execução ainda. Elas aparecem quando os coletores automáticos entrarem em operação (Fase 6).</div>}
      </Card></div>
      {edit && <Editor c={edit} cats={cats} allowed={allowedFor(edit.platform)} secrets={secs.data ?? []} settings={settings.data ?? {}} reloadInt={() => { void secs.reload(); void settings.reload(); }} onClose={() => setEdit(null)} onSaved={q.reload} />}
    </>);
}
