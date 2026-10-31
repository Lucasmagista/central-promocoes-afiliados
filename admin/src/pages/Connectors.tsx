import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, CalendarCheck, Check, CheckCircle2, Eye, KeyRound, Link2, LogOut, Pencil, Play, Plug, Plus, RefreshCw, Rss, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, connectorModeLabel, dateTime, money, platformName } from '../lib/format';
import type { CollectResult, Connector, ConnectorConfig, ConnectorMode, IntProvider, ProductCategory, Run, SecretInfo, SecretKey, SettingsMap, StoreAccount, StoreProduct, StoreStatus } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHead, Tabs, Toggle, useAction, useDialogs, useLoad } from '../ui/ui';
import { ConnectorMode as Mode } from '../ui/badges';
import { CategoryChips, CategoryPicker } from '../components/CategoryPicker';
import { DEFAULT_CATEGORIES } from '../lib/categories';
import { ActionBanner, CopyBtn, SecretField, StateDot, statusOf, useIntAction, type IntAct } from '../components/integrations';

const DAY = 86_400_000;
const isStore = (p: string): boolean => p === 'mercadolivre' || p === 'shopee' || p === 'aliexpress' || p === 'amazon';
const isDemo = () => !import.meta.env.VITE_SUPABASE_URL || new URLSearchParams(location.search).has('demo');

/** Como cada plataforma entrega dados por API oficial. Endereços e exigências mudam: confira sempre no painel do programa. */
interface PlatformDef {
  api: boolean; auth: 'oauth' | 'keys' | 'none'; secret?: SecretKey; secretLabel?: string; idKey?: 'app_id' | 'client_id'; idLabel?: string; idHint?: string;
  intro: string; steps: string[]; pulls: string[]; docs: { label: string; url: string }[]; linkTemplateEx?: string;
  accountLabel?: string; linkNote?: string; need?: string[]; extra?: { key: string; label: string; hint: string; ph: string; options?: string[] }[];
  aff: { label: string; key: 'affiliate_id' | 'affiliate_tag' | 'partner_tag' | 'tracking_id'; hint: string; ph: string };
}
const PLATFORMS: Record<string, PlatformDef> = {
  mercadolivre: {
    api: true, auth: 'oauth', secret: 'ml_client_secret', secretLabel: 'Secret Key do aplicativo', idKey: 'app_id', idLabel: 'App ID', idHint: 'Número do aplicativo em Mercado Livre Developers.',
    intro: 'Você autoriza a sua conta uma vez e o painel passa a ler os dados dela direto da API do Mercado Livre (sem copiar e colar).',
    steps: ['Em Mercado Livre Developers, crie um aplicativo com a mesma conta que usa no Programa de Afiliados.', 'No campo “URL de redirecionamento” do aplicativo, cadastre exatamente o endereço mostrado abaixo.', 'Copie o App ID e a Secret Key para cá e salve.', 'Clique em “Conectar conta” e autorize no Mercado Livre. Você volta para este painel já conectado.'],
    pulls: ['Dados da conta (apelido, reputação)', 'Busca de produtos com preço atual e preço original', 'Estoque, vendedor, frete grátis e imagem'],
    docs: [{ label: 'Mercado Livre Developers', url: 'https://developers.mercadolivre.com.br' }, { label: 'Programa de Afiliados', url: 'https://www.mercadolivre.com.br/afiliados' }],
    linkTemplateEx: '{url}?matt_tool=SEU_ID',
    aff: { label: 'ID de afiliado', key: 'affiliate_id', hint: 'O identificador do Programa de Afiliados do Mercado Livre.', ph: 'seu-id' },
  },
  shopee: {
    api: true, auth: 'keys', secret: 'shopee_secret', secretLabel: 'Secret (chave secreta)', idKey: 'app_id', idLabel: 'App ID', idHint: 'Fornecido em Open API, no painel de afiliados da Shopee.',
    intro: 'A Shopee não usa login: a conexão é o par App ID + Secret da sua conta de afiliado. Com ele o painel lê produtos já com o seu link rastreado e a comissão.',
    steps: ['No painel do Programa de Afiliados da Shopee, abra a área de Open API.', 'Copie o App ID e o Secret.', 'Cole aqui, clique em “Salvar e testar” e confira a amostra de produtos.'],
    pulls: ['Produtos com preço, desconto e % de comissão', 'Link de afiliado já rastreado (offerLink)', 'Comissão e conversões dos últimos 30 dias'],
    docs: [{ label: 'Afiliados Shopee', url: 'https://affiliate.shopee.com.br' }],
    linkTemplateEx: '{url}?utm_source=an_SEU_ID&mmp_pid=an_SEU_ID&utm_medium=affiliates',
    aff: { label: 'ID de afiliado', key: 'affiliate_id', hint: 'O ID do programa de afiliados da Shopee (só referência).', ph: 'seu-id' },
  },
  amazon: {
    api: true, auth: 'keys', secret: 'amazon_client_secret', secretLabel: 'Credential Secret', idKey: 'client_id', idLabel: 'Credential ID', idHint: 'Gerado em Associates Central → Ferramentas → Creators API. Só o dono da conta Associates cria credenciais.',
    accountLabel: 'de associado da Amazon', need: ['partner_tag'], linkNote: 'o link já vem com a sua tag de associado',
    extra: [{ key: 'marketplace', label: 'Loja (marketplace)', hint: 'Brasil: www.amazon.com.br', ph: 'www.amazon.com.br' }, { key: 'credential_version', label: 'Versão da credencial', hint: '3.1 = Américas (inclui o Brasil). Está na tela da credencial.', ph: '3.1', options: ['3.1', '3.2', '3.3'] }],
    intro: 'A Creators API substituiu a PA-API 5.0 (login OAuth 2.0 com Credential ID e Secret). O painel busca produtos pela API e usa o link oficial, que já leva a sua tag. A Amazon exige vendas qualificadas para liberar e pode pedir preços atualizados em até 24 h.',
    steps: ['No Amazon Associates, abra Ferramentas → Creators API e crie uma credencial (guarde o Secret: ele aparece uma vez).', 'Cole o Credential ID e o Secret aqui. Informe a versão (3.1 para o Brasil) e a sua tag de associado (nome-20).', 'Clique em “Salvar e testar” e confira a amostra.', 'Ligue a coleta. Mantenha o link curto desligado, a menos que o programa permita.'],
    pulls: ['Produtos por palavra-chave, com título, imagem e vendedor', 'Preço atual e preço de referência (savingBasis) vindos da própria Amazon', 'Link oficial (detailPageURL) com a sua tag'],
    docs: [{ label: 'Creators API', url: 'https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl' }, { label: 'Amazon Associates Brasil', url: 'https://associados.amazon.com.br' }],
    aff: { label: 'Tag de associado', key: 'partner_tag', hint: 'Sua tag do Amazon Associates, no formato nome-20.', ph: 'seunome-20' },
  },
  aliexpress: {
    api: true, auth: 'keys', secret: 'aliexpress_app_secret', secretLabel: 'App Secret', idKey: 'app_id', idLabel: 'App Key', idHint: 'No console AliExpress Open Platform, depois de criar o app e pedir a API de afiliados.',
    accountLabel: 'de afiliado da AliExpress', need: ['tracking_id'], linkNote: 'link rastreado pela própria AliExpress (promotion_link)',
    extra: [{ key: 'api_endpoint', label: 'Endereço da API (opcional)', hint: 'Deixe vazio para https://api-sg.aliexpress.com/sync.', ph: 'https://…' }],
    intro: 'A conta é o par App Key + App Secret do console de desenvolvedores, mais o Tracking ID do portal de afiliados. Com eles o painel busca produtos em reais, já com o seu link de afiliado e a comissão.',
    steps: ['Entre no portal de afiliados da AliExpress (portals.aliexpress.com) e copie o seu Tracking ID.', 'No AliExpress Open Platform, crie um app e peça acesso à API de afiliados (Affiliate API).', 'Cole App Key, App Secret e Tracking ID aqui e clique em “Salvar e testar”.', 'Veja a amostra, ajuste os filtros e ligue a coleta.'],
    pulls: ['Produtos mais vendidos por termo de busca (preço em BRL, entrega para o Brasil)', 'Preço original e preço promocional', '% de comissão e link de afiliado (promotion_link)'],
    docs: [{ label: 'Portal de afiliados', url: 'https://portals.aliexpress.com' }, { label: 'AliExpress Open Platform', url: 'https://openservice.aliexpress.com' }],
    aff: { label: 'Tracking ID', key: 'tracking_id', hint: 'O Tracking ID do portal de afiliados da AliExpress.', ph: 'meu_tracking' },
  },
  magalu: {
    api: false, auth: 'none', accountLabel: 'do Parceiro Magalu', linkTemplateEx: '{url}?seu-parametro=SEU_ID',
    intro: 'Não encontrei API pública de afiliados do Magalu, então aqui a entrada é manual: gere o link no painel do Parceiro Magalu e cadastre em “Nova oferta”. Se o seu link for sempre o endereço do produto mais um parâmetro, o modelo do link monta isso para você.',
    steps: [], pulls: [], docs: [{ label: 'Parceiro Magalu', url: 'https://www.parceiromagalu.com.br' }],
    aff: { label: 'ID de afiliado', key: 'affiliate_id', hint: 'O seu identificador no Parceiro Magalu.', ph: 'seu-id' },
  },
  network: { api: false, auth: 'none', intro: 'Redes de afiliados entram por cadastro manual de ofertas.', steps: [], pulls: [], docs: [], aff: { label: 'ID da rede', key: 'affiliate_id', hint: 'ID na rede de afiliados.', ph: 'id' } },
};
const SKIP_LABEL: Record<string, string> = { invalido: 'incompletos', repetido: 'repetidos', sem_estoque: 'sem estoque', usado: 'usados', sem_desconto: 'sem desconto comprovado', fora_da_faixa: 'fora da faixa de preço' };
const LEVEL: Record<string, string> = { '5_green': 'reputação verde', '4_light_green': 'reputação verde-clara', '3_yellow': 'reputação amarela', '2_orange': 'reputação laranja', '1_red': 'reputação vermelha' };
const POWER: Record<string, string> = { platinum: 'MercadoLíder Platinum', gold: 'MercadoLíder Gold', silver: 'MercadoLíder' };
const redirectDefault = () => `${location.origin}/oauth/mercadolivre`;

/** Onde o conector está no caminho “conectar → testar → coletar”. */
function progress(c: Connector, cfg: ConnectorConfig, st: StoreStatus, secrets: SecretInfo[]) {
  const def = PLATFORMS[c.platform] ?? PLATFORMS.network;
  const hasSecret = !!def.secret && !!secrets.find((x) => x.key === def.secret)?.is_set;
  const creds = !!def.idKey && !!cfg[def.idKey] && hasSecret && (def.need ?? []).every((k) => !!cfg[k] || (k === 'partner_tag' && !!cfg.affiliate_tag));
  const account = def.auth === 'oauth' ? st.connected === true : creds;
  const tested = account && st.ok === true && !st.partial && st.connected !== false;
  const active = c.mode === 'api_ready';
  const failed = st.ok === false && !!st.checked_at && creds;
  return { creds, account, tested, active, failed, steps: [{ k: 'creds', label: 'Credenciais', ok: creds }, ...(def.auth === 'oauth' ? [{ k: 'account', label: 'Conta autorizada', ok: account }] : []), { k: 'test', label: 'Testada', ok: tested }, { k: 'active', label: 'Coleta ligada', ok: active }] };
}
function stateBadge(c: Connector, p: ReturnType<typeof progress>) {
  const def = PLATFORMS[c.platform] ?? PLATFORMS.network;
  if (!def.api || !isStore(c.platform)) return <Mode s={c.mode} />;
  if (p.active && p.tested) return <Badge tone="ok"><StateDot tone="ok" />Coletando</Badge>;
  if (p.failed) return <Badge tone="bad"><StateDot tone="bad" />Falha na conexão</Badge>;
  if (p.tested) return <Badge tone="ok"><StateDot tone="ok" />Conectada</Badge>;
  if (p.creds && def.auth === 'oauth' && !p.account) return <Badge tone="warn"><StateDot tone="warn" />Falta autorizar a conta</Badge>;
  if (p.creds) return <Badge tone="warn"><StateDot tone="warn" />Não testada</Badge>;
  return <Badge><StateDot tone="off" />Não conectada</Badge>;
}

/** Autorização do Mercado Livre: guarda um “state” anti-fraude e leva o usuário ao login oficial. */
async function startMlAuth(appId: string, redirect: string, act: IntAct) {
  if (isDemo()) { act.start('mercadolivre', 'exchange_code', { code: 'DEMO-CODE-1234567890', redirect_uri: redirect }, 'Conectando a conta (demonstração)'); return; }
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem('ml_oauth_state', state); sessionStorage.setItem('ml_oauth_redirect', redirect); } catch { /* segue sem guardar: o retorno será recusado */ }
  location.assign(`https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`);
}

function Account({ platform, acc }: { platform: string; acc: StoreAccount }) {
  if (platform === 'mercadolivre') {
    return <div className="acct"><div className="avatar-ml" aria-hidden>{(acc.nickname ?? '?').slice(0, 1)}</div><div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 650 }}>{acc.nickname ?? `Conta ${acc.id}`}</div>
      <div className="small muted">{[acc.power_seller ? POWER[acc.power_seller] ?? acc.power_seller : null, acc.level ? LEVEL[acc.level] ?? acc.level : null, `ID ${acc.id}`].filter(Boolean).join(' · ')}</div></div>
      <a className="right small" href="https://www.mercadolivre.com.br/afiliados/hub" target="_blank" rel="noreferrer noopener" title="Painel de afiliados do Mercado Livre: cliques, pedidos e ganhos">Painel de afiliados <ArrowUpRight size={12} style={{ verticalAlign: -1 }} /></a></div>;
  }
  return <div className="acct"><div className="avatar-ml" aria-hidden><KeyRound size={16} /></div><div style={{ minWidth: 0 }}>
    <div style={{ fontWeight: 650 }}>App {acc.id}</div>
    <div className="small muted">{acc.report ? `Últimos 30 dias: ${acc.report.conversions}${acc.report.more ? '+' : ''} conversão(ões) · comissão ${money(acc.report.commission)}` : acc.report_error ? `Relatório de comissões indisponível: ${acc.report_error}` : 'Credenciais da conta de afiliado'}</div></div></div>;
}

function Products({ items }: { items: StoreProduct[] }) {
  return <div className="col" style={{ gap: 8 }}>{items.map((p) => (
    <div key={p.url + p.title} className="prod">
      {p.image ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="ph" aria-hidden />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <a href={p.url} target="_blank" rel="noreferrer noopener" className="truncate" style={{ display: 'block', fontWeight: 600 }}>{p.title}</a>
        <div className="row wrap small" style={{ gap: 8, marginTop: 2 }}>
          <b>{money(p.price)}</b>{p.previous && <s className="muted">{money(p.previous)}</s>}{p.discount_pct ? <Badge tone="ok">−{Math.round(p.discount_pct)}%</Badge> : null}
          {p.commission_pct != null && <Badge tone="info">comissão {p.commission_pct}%</Badge>}{p.free_shipping && <Badge>frete grátis</Badge>}{p.seller && <span className="muted truncate">{p.seller}</span>}
        </div></div></div>))}</div>;
}

function ResultModal({ title, res, onClose }: { title: string; res: CollectResult; onClose: () => void }) {
  const skipped = Object.entries(res.skipped ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${SKIP_LABEL[k] ?? k}`);
  return <Modal wide title={title} onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}><div className="col">
    {res.dry
      ? <div className="alert info"><div>A API devolveu <b>{res.seen}</b> produto(s); <b>{res.eligible}</b> passam nos seus filtros. {res.items?.length ? 'Abaixo, as melhores. Nada foi gravado.' : 'Nenhum passou: afrouxe os filtros na aba Coleta.'}</div></div>
      : <div className="alert info" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><CheckCircle2 size={16} style={{ flex: 'none', marginTop: 2 }} /><div><b>{res.created ?? 0}</b> oferta(s) nova(s) na fila de aprovação{res.duplicates ? ` · ${res.duplicates} já existiam` : ''}{res.rejected ? ` · ${res.rejected} recusada(s) pelas regras` : ''}{res.low_score ? ` · ${res.low_score} abaixo do score mínimo` : ''}. <Link to="/revisao">Abrir fila de aprovação</Link></div></div>}
    {res.items && res.items.length > 0 && <Products items={res.items} />}
    {skipped.length > 0 && <div className="small muted">Descartados pelos filtros: {skipped.join(' · ')}.</div>}
    {res.reasons && Object.keys(res.reasons).length > 0 && <div className="small muted">Motivos de recusa: {Object.entries(res.reasons).map(([k, n]) => `${k} (${n})`).join(', ')}.</div>}
    {res.errors?.length > 0 && <div className="alert warning small"><div>Algumas buscas falharam: {res.errors.slice(0, 2).join(' · ')}</div></div>}
  </div></Modal>;
}

/** Botões de teste/amostra/coleta e o resultado, reaproveitados no cartão e no editor. */
function useStoreActions(c: Connector, onDone: () => void) {
  const check = useIntAction(); const prev = useIntAction(); const col = useIntAction();
  const [modal, setModal] = useState<{ title: string; res: CollectResult } | null>(null);
  const fin = (a: IntAct) => a.job?.status === 'done' || a.job?.status === 'failed';
  useEffect(() => { if (fin(check)) onDone(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.job?.id, check.job?.status]);
  useEffect(() => { if (prev.job?.status === 'done' && prev.result) setModal({ title: `Amostra — ${c.display_name}`, res: prev.result as unknown as CollectResult }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev.job?.id, prev.job?.status]);
  useEffect(() => { if (col.job?.status === 'done' && col.result) { setModal({ title: `Coleta — ${c.display_name}`, res: col.result as unknown as CollectResult }); onDone(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col.job?.id, col.job?.status]);
  const plat = c.platform as IntProvider;
  return { check, prev, col, modal, closeModal: () => setModal(null),
    test: () => check.start(plat, 'check', undefined, 'Testando a conexão'), sample: () => prev.start(plat, 'preview', undefined, 'Buscando uma amostra'), collect: () => col.start(plat, 'collect', undefined, 'Coletando ofertas') };
}

function Editor({ c, cats, allowed, secrets, settings, reloadInt, onClose, onSaved }: { c: Connector; cats: ProductCategory[]; allowed: string[]; secrets: SecretInfo[]; settings: SettingsMap; reloadInt: () => void; onClose: () => void; onSaved: () => void }) {
  const def = PLATFORMS[c.platform] ?? PLATFORMS.network;
  const [tab, setTab] = useState(def.api ? 'conta' : 'coleta');
  const [mode, setMode] = useState<ConnectorMode>(c.mode);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [short, setShort] = useState(c.use_short_link);
  const [reviewed, setReviewed] = useState(c.docs_reviewed_at ? c.docs_reviewed_at.slice(0, 10) : '');
  const [cfg, setCfg] = useState<ConnectorConfig>({ ...c.config, ...(c.platform === 'mercadolivre' && !c.config.redirect_uri ? { redirect_uri: redirectDefault() } : {}) });
  const [src, setSrc] = useState({ name: '', url: '' }); const [kw, setKw] = useState('');
  const { run, busy } = useAction(); const { toast } = useDialogs();
  const A = useStoreActions(c, reloadInt); const oauth = useIntAction();
  const set = <K extends keyof ConnectorConfig>(k: K, v: ConnectorConfig[K]) => setCfg((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const st = statusOf(settings, c.platform as IntProvider) as StoreStatus; const pr = progress(c, c.config, st, secrets);
  const srcOk = (() => { try { const u = new URL(src.url); return u.protocol === 'https:' && (!allowed.length || allowed.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))); } catch { return false; } })();
  const dirty = JSON.stringify(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== '').sort()) !== JSON.stringify(Object.entries(c.config).filter(([, v]) => v !== undefined && v !== '').sort());
  const errs: string[] = [];
  if (cfg.poll_minutes != null && (cfg.poll_minutes < 5 || cfg.poll_minutes > 1440)) errs.push('Frequência de coleta: entre 5 e 1440 minutos.');
  if (cfg.min_discount_pct != null && (cfg.min_discount_pct < 0 || cfg.min_discount_pct > 95)) errs.push('Desconto mínimo: entre 0 e 95%.');
  if (cfg.min_score != null && (cfg.min_score < 0 || cfg.min_score > 100)) errs.push('Score mínimo: entre 0 e 100.');
  if (cfg.max_items_per_run != null && (cfg.max_items_per_run < 1 || cfg.max_items_per_run > 500)) errs.push('Itens por execução: entre 1 e 500.');
  if (cfg.min_price != null && cfg.max_price != null && cfg.min_price > cfg.max_price) errs.push('Preço mínimo maior que o máximo.');
  if (cfg.link_template && (!cfg.link_template.includes('{url}') || !/^(\{url\}|https:\/\/)/.test(cfg.link_template) || /\s/.test(cfg.link_template))) errs.push('Modelo do link: precisa conter {url}, começar com {url} ou https:// e não ter espaços.');
  if (mode === 'api_ready' && !reviewed) errs.push('Para “API pronta” informe a data da revisão dos termos (aba Avançado).');
  const clean = () => Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== ''));
  const persist = async () => {
    const rd = reviewed ? new Date(reviewed + 'T12:00:00').toISOString() : null;
    return run('s', () => api().saveConnector(c.id, { mode, notes: notes || null, use_short_link: short, docs_reviewed_at: rd, review_due_at: rd ? new Date(new Date(rd).getTime() + 30 * DAY).toISOString() : null, config: clean() as ConnectorConfig }), 'Conector atualizado');
  };
  const save = async () => { if (await persist()) { onSaved(); onClose(); } };
  const saveAndTest = async () => { if (await persist()) { onSaved(); A.test(); } };
  const connect = async () => {
    if (!cfg.app_id) { toast('Informe o App ID antes.', 'err'); return; }
    if (dirty && !(await persist())) return;
    onSaved(); await startMlAuth(String(cfg.app_id), String(cfg.redirect_uri || redirectDefault()), oauth);
  };
  useEffect(() => { if (oauth.job?.status === 'done' || oauth.job?.status === 'failed') { A.check.clear(); reloadInt(); onSaved(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauth.job?.id, oauth.job?.status]);
  const secret = def.secret ? secrets.find((x) => x.key === def.secret) : undefined;
  const addKw = () => { const v = kw.trim(); if (v.length < 2 || v.length > 60 || /[<>{}\\]/.test(v) || (cfg.keywords ?? []).includes(v) || (cfg.keywords ?? []).length >= 12) return; set('keywords', [...(cfg.keywords ?? []), v]); setKw(''); };
  const tplPreview = cfg.link_template ? cfg.link_template.split('{url}').join(/^\{url\}/.test(cfg.link_template) ? 'https://www.exemplo.com.br/produto-123' : encodeURIComponent('https://www.exemplo.com.br/produto-123')) : null;
  const tabs = [...(def.api ? [{ v: 'conta', label: 'Conta e API' }] : []), { v: 'coleta', label: 'Coleta' }, { v: 'links', label: 'Afiliado e links' }, { v: 'avancado', label: 'Avançado' }];
  return (
    <Modal wide title={`Configurar — ${c.display_name}`} onClose={onClose} footer={<>
      {errs.length > 0 && <span className="small" style={{ color: 'var(--bad)', marginRight: 'auto' }}>{errs[0]}</span>}
      <Button onClick={onClose}>Fechar</Button><Button variant="primary" busy={busy === 's'} disabled={errs.length > 0 || !dirty && mode === c.mode && short === c.use_short_link && notes === (c.notes ?? '') && reviewed === (c.docs_reviewed_at?.slice(0, 10) ?? '')} onClick={save}>Salvar alterações</Button></>}>
      <div className="col">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />

        {tab === 'conta' && def.api && <div className="col">
          <div className="alert info"><div>{def.intro}</div></div>
          {pr.steps.length > 0 && <ol className="steps" aria-label="Progresso">{pr.steps.map((s) => <li key={s.k} className={s.ok ? 'done' : ''}><b>{s.ok ? <Check size={12} /> : pr.steps.indexOf(s) + 1}</b>{s.label}</li>)}</ol>}
          {c.platform === 'mercadolivre' && <Field label="URL de redirecionamento" hint="Cadastre exatamente este endereço no aplicativo do Mercado Livre. Ele só recebe o retorno do login."><div className="row"><input value={String(cfg.redirect_uri ?? '')} onChange={(e) => set('redirect_uri', e.target.value.trim() || undefined)} style={{ flex: 1, minWidth: 0 }} /><CopyBtn text={String(cfg.redirect_uri || redirectDefault())} /></div></Field>}
          <div className="grid g2">
            <Field label={def.idLabel ?? 'ID'} hint={def.idHint}><input value={String(cfg[def.idKey ?? 'app_id'] ?? '')} placeholder="Cole aqui" onChange={(e) => set(def.idKey ?? 'app_id', e.target.value.trim() || undefined)} /></Field>
            {c.platform === 'shopee' && <Field label="Endereço da API (opcional)" hint="Deixe vazio para o padrão do Brasil."><input value={String(cfg.api_endpoint ?? '')} placeholder="https://…" onChange={(e) => set('api_endpoint', e.target.value.trim() || undefined)} /></Field>}
            {(def.extra ?? []).map((x) => <Field key={x.key} label={x.label} hint={x.hint}>{x.options
              ? <select value={String(cfg[x.key] ?? x.options[0])} onChange={(e) => set(x.key, e.target.value)}>{x.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : <input value={String(cfg[x.key] ?? '')} placeholder={x.ph} onChange={(e) => set(x.key, e.target.value.trim() || undefined)} />}</Field>)}
            {def.need?.includes('partner_tag') && <Field label="Tag de associado" hint="Obrigatória: a API só devolve ofertas com a sua tag."><input value={String(cfg.partner_tag ?? cfg.affiliate_tag ?? '')} placeholder="seunome-20" onChange={(e) => set('partner_tag', e.target.value.trim() || undefined)} /></Field>}
            {def.need?.includes('tracking_id') && <Field label="Tracking ID" hint="Sem ele a AliExpress devolve lista vazia, sem avisar."><input value={String(cfg.tracking_id ?? '')} placeholder="meu_tracking" onChange={(e) => set('tracking_id', e.target.value.trim() || undefined)} /></Field>}
          </div>
          {def.secret && <SecretField k={def.secret} label={def.secretLabel ?? 'Chave secreta'} info={secret} onChanged={reloadInt} hint="Guardada no banco, só de escrita: nunca volta para a tela. Para trocar, use “Trocar”." />}
          <div className="row wrap">
            {c.platform === 'mercadolivre' && <Button variant="primary" icon={<Plug size={14} />} busy={oauth.running} disabled={!pr.creds && !(cfg.app_id && secret?.is_set)} onClick={connect}>{pr.account ? 'Reconectar conta' : 'Conectar conta'}</Button>}
            <Button variant={c.platform === 'mercadolivre' ? 'default' : 'primary'} icon={<Play size={14} />} busy={A.check.running || busy === 's'} disabled={!(cfg[def.idKey ?? 'app_id'] && secret?.is_set) || errs.length > 0} onClick={saveAndTest}>{dirty ? 'Salvar e testar' : 'Testar conexão'}</Button>
            {isStore(c.platform) && <Button icon={<Eye size={14} />} busy={A.prev.running} disabled={!pr.tested} title={pr.tested ? undefined : 'Teste a conexão antes'} onClick={A.sample}>Ver amostra</Button>}
            {c.platform === 'mercadolivre' && pr.account && <Button variant="danger" size="sm" icon={<LogOut size={13} />} onClick={async () => { if (await run('d', async () => { await api().requestIntegrationAction('mercadolivre', 'disconnect'); }, 'Pedido enviado: desconectando')) setTimeout(reloadInt, 4000); }}>Desconectar</Button>}
          </div>
          <ActionBanner act={oauth} okText={(r) => r.detail ?? 'Conta conectada.'} /><ActionBanner act={A.check} okText={(r) => r.detail ?? 'Conexão confirmada.'} /><ActionBanner act={A.prev} okText={() => 'Amostra pronta.'} />
          {A.check.result?.sample?.length ? <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Amostra direto da {platformName[c.platform]}</div><Products items={A.check.result.sample as StoreProduct[]} /></div> : null}
          {st.account && !A.check.job && <Account platform={c.platform} acc={st.account} />}
          {!A.check.job && st.checked_at && <div className="small muted">Último teste {ago(st.checked_at)}: {st.ok ? st.detail ?? 'ok' : st.error ?? 'falhou'}</div>}
          <details><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Passo a passo e o que o painel lê</summary>
            <ol className="guide" style={{ marginTop: 10 }}>{def.steps.map((s, i) => <li key={s} className="step"><span className="stepn">{i + 1}</span><div>{s}</div></li>)}</ol>
            {def.pulls.length > 0 && <div className="small" style={{ marginTop: 10 }}><b>O que o painel lê:</b> {def.pulls.join(' · ')}.</div>}
            <div className="row wrap small" style={{ marginTop: 8 }}>{def.docs.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer noopener">{d.label} ↗</a>)}<span className="muted">Confira sempre os termos atuais do programa.</span></div></details>
        </div>}

        {tab === 'coleta' && <div className="col">
          {isStore(c.platform) && <div className="alert info"><div>A coleta busca produtos reais pela API, descarta o que não passa nos filtros abaixo e manda o resto para a <b>Fila de aprovação</b>. Nada é publicado sem a sua aprovação.</div></div>}
          <div className="grid g3">
            <Field label="Coletar a cada (min)" hint="5 a 1440."><input type="number" min={5} max={1440} value={cfg.poll_minutes ?? ''} onChange={(e) => set('poll_minutes', num(e.target.value))} /></Field>
            <Field label="Itens por execução" hint="1 a 500 (a API entrega no máx. 100)."><input type="number" min={1} max={500} value={cfg.max_items_per_run ?? ''} onChange={(e) => set('max_items_per_run', num(e.target.value))} /></Field>
            <Field label="Score mínimo" hint="Abaixo disso a oferta é recusada na entrada."><input type="number" min={0} max={100} value={cfg.min_score ?? ''} onChange={(e) => set('min_score', num(e.target.value))} /></Field>
          </div>
          <div className="grid g3">
            <Field label="Desconto mínimo (%)" hint="Só conta com preço anterior vindo da API."><input type="number" min={0} max={95} value={cfg.min_discount_pct ?? ''} onChange={(e) => set('min_discount_pct', num(e.target.value))} /></Field>
            <Field label="Preço mínimo (R$)"><input type="number" min={0} value={cfg.min_price ?? ''} onChange={(e) => set('min_price', num(e.target.value))} /></Field>
            <Field label="Preço máximo (R$)"><input type="number" min={0} value={cfg.max_price ?? ''} onChange={(e) => set('max_price', num(e.target.value))} /></Field>
          </div>
          <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Tipos de produto monitorados</div><CategoryPicker cats={cats} value={cfg.categories ?? []} onChange={(v) => set('categories', v)} /></div>
          {isStore(c.platform) && <Field label="Termos de busca (opcional)" hint="Se preencher, a busca usa estes termos em vez dos padrões de cada tipo de produto. Até 12.">
            <div className="col" style={{ gap: 8 }}>
              <div className="row wrap" style={{ gap: 6 }}>{(cfg.keywords ?? []).map((k) => <Badge key={k} tone="accent">{k}<button type="button" aria-label={`Remover ${k}`} className="xbtn" onClick={() => set('keywords', (cfg.keywords ?? []).filter((x) => x !== k))}><X size={11} /></button></Badge>)}</div>
              <div className="row"><input aria-label="Novo termo de busca" placeholder="ex.: fone bluetooth" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }} style={{ flex: 1, minWidth: 0 }} /><Button icon={<Plus size={14} />} disabled={kw.trim().length < 2} onClick={addKw}>Adicionar</Button></div></div></Field>}
          {errs.filter((e) => !e.startsWith('Para “API')).map((e) => <div key={e} className="alert critical">{e}</div>)}
        </div>}

        {tab === 'links' && <div className="col">
          <Field label={def.aff.label} hint={def.aff.hint}><input value={String(cfg[def.aff.key] ?? (def.aff.key === 'partner_tag' ? cfg.affiliate_tag ?? '' : ''))} placeholder={def.aff.ph} onChange={(e) => set(def.aff.key, e.target.value.trim() || undefined)} /></Field>
          {(isStore(c.platform) || c.platform === 'magalu') && <Field label="Modelo do link de afiliado" hint={def.linkNote ? 'Opcional. A API já devolve o link de afiliado de cada produto; o modelo só vale quando ela não devolver.' : <>Gere um link no painel do programa, copie o formato e troque o endereço do produto por <code>{'{url}'}</code>. Ex.: <code>{def.linkTemplateEx}</code>. <code>{'{id}'}</code> vira o seu ID de afiliado.</>}>
            <input value={cfg.link_template ?? ''} placeholder={def.linkTemplateEx ?? '{url}?…'} onChange={(e) => set('link_template', e.target.value.trim() || undefined)} /></Field>}
          {tplPreview && <div className="small"><b>Prévia:</b> <code>{tplPreview}</code></div>}
          {c.platform === 'mercadolivre' && <div className="alert warning"><div>A API do Mercado Livre entrega conta e produtos, mas <b>não gera links de afiliado nem informa comissão</b>. Sem o modelo acima, a oferta chega sem link e você cola o link gerado no programa antes de aprovar. Confirme o formato no painel de afiliados e confira se a primeira oferta rastreia certo.</div></div>}
          <label className="row"><Toggle label="Link curto" checked={short} onChange={setShort} />Usar redirecionador próprio (link curto). Desligue se o programa proibir links encurtados.</label>
        </div>}

        {tab === 'avancado' && <div className="col">
          <Field label="Modo de operação" hint="Na maioria dos casos use o botão “Coleta automática” do cartão. “API pronta” exige a data de revisão dos termos."><select value={mode} onChange={(e) => setMode(e.target.value as ConnectorMode)}>{Object.entries(connectorModeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Documentação/termos revisados em" hint="A próxima revisão é marcada para 30 dias depois."><input type="date" value={reviewed} onChange={(e) => setReviewed(e.target.value)} /></Field>
          <Field label="Observações"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="small muted">Páginas de referência (só anotação; a coleta usa a API). Apenas https e domínios permitidos {allowed.length ? `(${allowed.join(', ')})` : ''}.</div>
          {(cfg.sources ?? []).map((s, i) => <div key={s.url} className="row card" style={{ padding: '8px 12px' }}><Rss size={15} color="var(--muted)" /><div style={{ minWidth: 0, flex: 1 }}><b>{s.name}</b><div className="small muted truncate">{s.url}</div></div>
            <Button size="sm" variant="ghost" aria-label={`Remover ${s.name}`} icon={<Trash2 size={14} />} onClick={() => set('sources', (cfg.sources ?? []).filter((_, k) => k !== i))} /></div>)}
          <div className="row wrap"><input aria-label="Nome da fonte" style={{ width: 180 }} placeholder="Nome" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} />
            <input aria-label="Endereço da fonte" style={{ flex: 1, minWidth: 220 }} placeholder="https://…" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
            <Button icon={<Plus size={14} />} disabled={!src.name.trim() || !srcOk} onClick={() => { set('sources', [...(cfg.sources ?? []), { name: src.name.trim(), url: src.url.trim() }]); setSrc({ name: '', url: '' }); }}>Adicionar</Button></div>
          {src.url && !srcOk && <div className="small" style={{ color: 'var(--bad)' }}>Endereço inválido ou fora dos domínios permitidos (Configurações → domínios permitidos).</div>}
        </div>}
      </div>
      {A.modal && <ResultModal title={A.modal.title} res={A.modal.res} onClose={A.closeModal} />}
    </Modal>);
}

const num = (n: number | undefined, suf = '') => (n == null ? '—' : `${n}${suf}`);

function ConnectorCard({ c, cats, runs, st, secrets, isAdmin, workerOk, onEdit, reload, oauth }: { c: Connector; cats: ProductCategory[]; runs: Run[]; st: StoreStatus; secrets: SecretInfo[]; isAdmin: boolean; workerOk: boolean; onEdit: () => void; reload: () => void; oauth: IntAct }) {
  const def = PLATFORMS[c.platform] ?? PLATFORMS.network; const cfg = c.config ?? {}; const p = progress(c, cfg, st, secrets);
  const { run } = useAction(); const { confirm, toast } = useDialogs();
  const A = useStoreActions(c, reload);
  const store = isStore(c.platform); const last = runs.find((r) => r.platform === c.platform);
  const overdue = c.review_due_at && new Date(c.review_due_at).getTime() < Date.now(); const days = c.review_due_at ? Math.ceil((new Date(c.review_due_at).getTime() - Date.now()) / DAY) : null;
  const toggle = async (on: boolean) => {
    if (on) {
      if (!p.tested) { toast('Conecte e teste a conta antes de ligar a coleta.', 'err'); return; }
      if (!(await confirm({ title: `Ligar a coleta do ${c.display_name}?`, confirmLabel: 'Ligar coleta', body: `Ao confirmar, você declara que revisou os termos do programa hoje. A cada ${cfg.poll_minutes ?? 60} min o painel busca ofertas e as coloca na Fila de aprovação. Nada é publicado sem a sua aprovação.` }))) return;
      const now = new Date().toISOString();
      if (await run('t', () => api().saveConnector(c.id, { mode: 'api_ready', docs_reviewed_at: now, review_due_at: new Date(Date.now() + 30 * DAY).toISOString() }), 'Coleta automática ligada')) reload();
    } else if (await run('t', () => api().saveConnector(c.id, { mode: 'manual_only' }), 'Coleta automática desligada')) reload();
  };
  return (
    <Card title={<span className="row wrap">{c.display_name}{stateBadge(c, p)}</span>} actions={isAdmin && <Button size="sm" icon={<Pencil size={14} />} onClick={onEdit}>Configurar</Button>}>
      <div className="col" style={{ gap: 12 }}>
        {c.last_error && <div className="alert critical small"><AlertTriangle size={15} style={{ flex: 'none', marginTop: 2 }} /><span><b>Último erro {ago(c.last_error_at)}:</b> {c.last_error}</span></div>}
        {st.ok === false && st.error && <div className="alert critical small"><AlertTriangle size={15} style={{ flex: 'none', marginTop: 2 }} /><span>{st.error}</span></div>}

        {store ? <>
          {st.account && p.account ? <Account platform={c.platform} acc={st.account} /> : <div className="cta">
            <div><b>{p.creds ? (def.auth === 'oauth' ? 'Autorize a sua conta' : 'Teste as credenciais') : `Conecte a sua conta ${def.accountLabel ?? ''}`}</b>
              <div className="small muted">{p.creds ? (def.auth === 'oauth' ? 'O aplicativo está configurado. Falta você autorizar o acesso no Mercado Livre.' : 'Credenciais salvas. Falta confirmar que a loja as aceita.') : def.intro}</div></div>
            {isAdmin && (p.creds && def.auth === 'oauth'
              ? <Button variant="primary" icon={<Plug size={14} />} busy={oauth.running} onClick={() => void startMlAuth(String(cfg.app_id), String(cfg.redirect_uri || redirectDefault()), oauth)}>Conectar conta</Button>
              : p.creds ? <Button variant="primary" icon={<Play size={14} />} busy={A.check.running} onClick={A.test}>Testar conexão</Button>
              : <Button variant="primary" icon={<Plug size={14} />} onClick={onEdit}>Conectar</Button>)}
          </div>}
          <ActionBanner act={A.check} okText={(r) => r.detail ?? 'Conexão confirmada.'} />
          {(A.col.running || A.col.job?.status === 'failed') && <ActionBanner act={A.col} />}{(A.prev.running || A.prev.job?.status === 'failed') && <ActionBanner act={A.prev} />}
          {isAdmin && p.account && <div className="row wrap" style={{ gap: 8 }}>
            <Button size="sm" icon={<Eye size={14} />} busy={A.prev.running} onClick={A.sample} disabled={!workerOk}>Ver amostra</Button>
            <Button size="sm" icon={<RefreshCw size={14} />} busy={A.col.running} onClick={A.collect} disabled={!workerOk || c.mode === 'disabled' || c.mode === 'paused_policy' || c.mode === 'error'} title={c.mode === 'disabled' ? 'Ligue a coleta primeiro' : undefined}>Coletar agora</Button>
            <Button size="sm" icon={<Play size={14} />} busy={A.check.running} onClick={A.test} disabled={!workerOk}>Testar</Button>
            <span className="right row"><Toggle label={`Coleta automática ${c.display_name}`} checked={p.active} disabled={!isAdmin} onChange={(v) => void toggle(v)} /><span className="small">{p.active ? 'Coleta automática ligada' : 'Coleta automática desligada'}</span></span>
          </div>}
        </> : <div className="small muted">{def.intro}</div>}

        <dl className="kv wide">
          {store && <><dt>Coleta</dt><dd>a cada {num(cfg.poll_minutes, ' min')} · até {num(cfg.max_items_per_run)} itens · desconto ≥ {num(cfg.min_discount_pct, '%')} · score ≥ {num(cfg.min_score)}</dd></>}
          {store && <><dt>Tipos monitorados</dt><dd><span className="row wrap" style={{ gap: 5 }}>{cfg.keywords?.length ? cfg.keywords.map((k) => <Badge key={k}>{k}</Badge>) : <CategoryChips cats={cats} value={cfg.categories ?? []} max={3} />}</span></dd></>}
          <dt>{def.aff.label}</dt><dd>{cfg[def.aff.key] ? <code>{String(cfg[def.aff.key])}</code> : <Badge tone="warn">não informado</Badge>}</dd>
          {store && <><dt><Link2 size={13} style={{ verticalAlign: -2 }} /> Link de afiliado</dt><dd>{def.linkNote ? def.linkNote : cfg.link_template ? <code>{cfg.link_template}</code> : <Badge tone="warn">sem modelo (cole o link ao aprovar)</Badge>}</dd></>}
          {store && <><dt><CalendarCheck size={13} style={{ verticalAlign: -2 }} /> Termos revisados</dt><dd>{c.docs_reviewed_at ? <>{new Date(c.docs_reviewed_at).toLocaleDateString('pt-BR')} · {overdue ? <Badge tone="bad">revisão vencida</Badge> : <span className={days != null && days <= 7 ? 'down' : 'muted'}>próxima em {days} dia(s)</span>}</> : <span className="muted">registrada ao ligar a coleta</span>}</dd></>}
          {store && <><dt>Última coleta</dt><dd>{last ? <>{ago(last.started_at)} · <Badge tone={last.status === 'success' ? 'ok' : last.status === 'error' ? 'bad' : 'warn'}>{last.status === 'success' ? 'ok' : last.status}</Badge> · {last.items_accepted} nova(s) de {last.items_seen}</> : c.last_success_at ? ago(c.last_success_at) : '—'}</dd></>}
        </dl>
        {!store && c.notes && <div className="small muted">{c.notes}</div>}
        {!store && c.platform === 'magalu' && isAdmin && <div><Link className="btn" to="/ofertas/nova">Cadastrar oferta manual</Link></div>}
        {isAdmin && store && !workerOk && <div className="alert warning small"><div>O worker não está ativo, então testes e coleta ficam “aguardando”. Veja <Link to="/configuracoes?aba=worker">Configurações → Worker</Link>.</div></div>}
        {A.modal && <ResultModal title={A.modal.title} res={A.modal.res} onClose={A.closeModal} />}
      </div></Card>);
}

export default function Connectors() {
  const { isAdmin } = useSession();
  const q = useLoad(() => api().listConnectors(), []);
  const runs = useLoad(() => api().listRuns(), [], 20000);
  const catsQ = useLoad(() => api().listCategories(), []);
  const settings = useLoad(() => api().getSettings(), [], 15000);
  const secs = useLoad(() => api().listIntegrationSecrets().catch(() => [] as SecretInfo[]), []);
  const dash = useLoad(() => api().dashboard().catch(() => null), [], 30000);
  const [edit, setEdit] = useState<Connector | null>(null);
  const [plat, setPlat] = useState('all');
  const oauth = useIntAction(); const { toast } = useDialogs(); const handled = useRef(false);
  const cats = catsQ.data ?? DEFAULT_CATEGORIES;
  const allowedFor = (p: string) => ((settings.data?.allowed_domains as Record<string, string[]> | undefined)?.[p] ?? []);
  const rs: Run[] = (runs.data ?? []).filter((r) => plat === 'all' || r.platform === plat);
  const reloadAll = () => { void q.reload(); void runs.reload(); void settings.reload(); void secs.reload(); };

  // Volta do login do Mercado Livre: troca o código pelos tokens (o segredo fica no worker, nunca neste navegador).
  useEffect(() => {
    if (handled.current) return; handled.current = true;
    let raw: string | null = null; try { raw = sessionStorage.getItem('ml_oauth_return'); sessionStorage.removeItem('ml_oauth_return'); } catch { /* sem sessionStorage */ }
    if (!raw) return;
    try {
      const r = JSON.parse(raw) as { code?: string; state?: string; error?: string; at?: number };
      if (r.error) { toast(`Mercado Livre: ${r.error}`, 'err'); return; }
      const want = sessionStorage.getItem('ml_oauth_state'); const redirect = sessionStorage.getItem('ml_oauth_redirect') || redirectDefault();
      sessionStorage.removeItem('ml_oauth_state'); sessionStorage.removeItem('ml_oauth_redirect');
      if (!r.code || !want || r.state !== want || Date.now() - (r.at ?? 0) > 10 * 60_000) { toast('A autorização do Mercado Livre expirou ou não confere. Clique em “Conectar conta” de novo.', 'err'); return; }
      oauth.start('mercadolivre', 'exchange_code', { code: r.code, redirect_uri: redirect }, 'Conectando a conta do Mercado Livre');
    } catch { /* retorno ilegível: ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (oauth.job?.status === 'done' || oauth.job?.status === 'failed') reloadAll(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauth.job?.id, oauth.job?.status]);

  const list = q.data ?? []; const secretList = secs.data ?? []; const sMap = settings.data ?? {};
  const progs = list.filter((c) => isStore(c.platform)).map((c) => progress(c, c.config ?? {}, statusOf(sMap, c.platform as IntProvider) as StoreStatus, secretList));
  const hb = dash.data?.heartbeats.find((h) => h.service === 'worker'); const workerOk = !!hb && hb.age_seconds < 150;
  const lastRun = (runs.data ?? []).find((r) => r.status !== 'running');

  return (
    <>
      <PageHead title="Conectores" sub="Conecte suas contas de afiliado: o painel lê produtos e preços direto das lojas e entrega as ofertas para você aprovar." />
      {(oauth.running || oauth.job) && <div style={{ marginBottom: 14 }}><ActionBanner act={oauth} okText={(r) => r.detail ?? 'Conta conectada.'} /></div>}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : <>
        <div className="grid g3" style={{ marginBottom: 14 }}>
          <div className="card stat"><div className="k">Contas conectadas</div><div className="v">{progs.filter((x) => x.tested).length}<span className="muted" style={{ fontSize: 16 }}> de {progs.length}</span></div></div>
          <div className="card stat"><div className="k">Coleta automática</div><div className="v">{progs.filter((x) => x.active).length}<span className="muted" style={{ fontSize: 16 }}> ligada(s)</span></div></div>
          <div className="card stat"><div className="k">Última coleta</div><div className="v" style={{ fontSize: 22 }}>{lastRun ? ago(lastRun.started_at) : '—'}</div>{lastRun && <div className="d muted">{platformName[lastRun.platform as keyof typeof platformName] ?? lastRun.platform}: {lastRun.items_accepted} nova(s)</div>}</div>
        </div>
        <div className="grid g2">{list.map((c) => <ConnectorCard key={c.id} c={c} cats={cats} runs={runs.data ?? []} st={statusOf(sMap, c.platform as IntProvider) as StoreStatus} secrets={secretList} isAdmin={isAdmin} workerOk={workerOk || !dash.data} onEdit={() => setEdit(c)} reload={reloadAll} oauth={oauth} />)}</div></>}
      <div style={{ marginTop: 14 }}><Card title="Execuções recentes" actions={<select aria-label="Filtrar execuções" value={plat} onChange={(e) => setPlat(e.target.value)}><option value="all">Todas as plataformas</option>{list.map((c) => <option key={c.id} value={c.platform}>{platformName[c.platform as keyof typeof platformName] ?? c.display_name}</option>)}</select>} flush>
        {rs.length ? <div className="tablewrap"><table><thead><tr><th>Plataforma</th><th>Início</th><th>Duração</th><th>Status</th><th>Vistos</th><th>Aceitos</th><th>Rejeitados</th><th>Resumo</th></tr></thead>
          <tbody>{rs.map((r) => <tr key={r.id}><td>{platformName[r.platform as keyof typeof platformName] ?? r.platform}</td><td className="nowrap">{dateTime(r.started_at)}</td><td className="small">{r.finished_at ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))} s` : 'em andamento'}</td><td><Badge tone={r.status === 'success' ? 'ok' : r.status === 'error' ? 'bad' : 'warn'}>{r.status}</Badge></td>
            <td>{r.items_seen}</td><td>{r.items_accepted}</td><td>{r.items_rejected}</td><td className="small muted">{r.error_summary ?? '—'}</td></tr>)}</tbody></table></div> : <div className="empty">Nenhuma execução ainda. Conecte uma conta, ligue a coleta automática ou use “Coletar agora”.</div>}
      </Card></div>
      {edit && <Editor c={list.find((x) => x.id === edit.id) ?? edit} cats={cats} allowed={allowedFor(edit.platform)} secrets={secretList} settings={sMap} reloadInt={() => { void secs.reload(); void settings.reload(); }} onClose={() => setEdit(null)} onSaved={() => { void q.reload(); }} />}
    </>);
}

