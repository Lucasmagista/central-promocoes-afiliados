import { useEffect, useState } from 'react';
import { Chrome, FileSpreadsheet, KeyRound, Play, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Toggle, useAction, useDialogs, useLoad } from '../../ui/ui';
import { ActionBanner, CopyBtn, StateDot, useIntAction } from '../../components/integrations';
import type { TabProps } from './shared';
import { stable } from './shared';
import type { SettingsMap } from '../../lib/types';

interface Source { kind: 'url' | 'file'; value: string }
interface FeedConfig { enabled: boolean; sources: Source[]; min_discount: number; min_rating: number; min_price: number; max_price: number; per_run: number; every_hours: number; exclude_categories: string[] }
interface CollectorConfig { enabled: boolean; min_discount: number; min_price: number; max_price: number; per_run: number }
const EXCLUDE = ['Spare Parts and Accessories for Vehicles', 'Books & Magazines', 'Food & Beverages', 'Health'];
const FEED: FeedConfig = { enabled: false, sources: [], min_discount: 40, min_rating: 4.5, min_price: 0, max_price: 100000, per_run: 30, every_hours: 24, exclude_categories: EXCLUDE };
const COL: CollectorConfig = { enabled: true, min_discount: 25, min_price: 0, max_price: 100000, per_run: 20 };
const when = (v: unknown) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
const st = (s: SettingsMap, k: string) => (s[`int_status_${k}`] as Record<string, any> | undefined) ?? {};
const nm = (v: unknown) => (v === '' || v == null ? 0 : Number(v));

function FeedCard({ s, reload, isAdmin }: Pick<TabProps, 's' | 'reload' | 'isAdmin'>) {
  const cfg: FeedConfig = { ...FEED, ...((s.feed_config as Partial<FeedConfig> | undefined) ?? {}) }; const fs = st(s, 'feed');
  const { run, busy } = useAction(); const act = useIntAction();
  const [f, setF] = useState(cfg); const sig = stable(cfg);
  useEffect(() => { setF(cfg); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const out: FeedConfig = { ...f, sources: f.sources.map((x) => ({ ...x, value: x.value.trim() })).filter((x) => x.value), exclude_categories: f.exclude_categories.map((x) => x.trim()).filter(Boolean),
    min_discount: nm(f.min_discount), min_rating: nm(f.min_rating), min_price: nm(f.min_price), max_price: nm(f.max_price) || 100000, per_run: Math.max(1, Math.min(nm(f.per_run) || 30, 100)), every_hours: Math.max(1, nm(f.every_hours) || 24) };
  const dirty = stable(out) !== stable(cfg); const can = isAdmin && !dirty && cfg.sources.length > 0;
  const save = async () => { if (await run('save-feed', () => api().setSetting('feed_config', out), 'Configuração do feed salva')) reload(); };
  const setSrc = (i: number, p: Partial<Source>) => setF({ ...f, sources: f.sources.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return <Card title="Feed de produtos da Shopee" actions={<><Badge tone={cfg.enabled ? 'ok' : undefined}><StateDot tone={cfg.enabled ? 'ok' : 'off'} />{cfg.enabled ? 'automático ligado' : 'desligado'}</Badge>
    <Button variant="primary" size="sm" icon={<Save size={14} />} disabled={!isAdmin || !dirty} busy={busy === 'save-feed'} onClick={save}>Salvar</Button></>}>
    <fieldset disabled={!isAdmin} className="bare"><div className="col">
      <div className="small muted">O portal de afiliados da Shopee publica todo dia um arquivo com milhares de produtos, já com preço, desconto, imagem e o <b>seu link de afiliado</b>. A Central lê o arquivo, escolhe os melhores (desconto e nota altos) e os coloca na fila de aprovação. Em <b>Criativo → Feed de produto</b> do portal, copie o endereço de “Ver Link”; se ele pedir login, baixe o CSV e copie para a pasta <code>feeds</code> do servidor (<code>scp arquivo.csv ubuntu@servidor:/mnt/data/apps/central-promocoes/deploy/feeds/</code>) e informe só o nome do arquivo.</div>
      <div className="col" style={{ gap: 8 }}>
        {f.sources.map((x, i) => <div key={i} className="row" style={{ gap: 8 }}>
          <select aria-label="Tipo da fonte" value={x.kind} onChange={(e) => setSrc(i, { kind: e.target.value as Source['kind'] })} style={{ width: 'auto' }}><option value="url">Endereço (https)</option><option value="file">Arquivo no servidor</option></select>
          <input aria-label="Fonte do feed" style={{ flex: 1, minWidth: 0 }} value={x.value} placeholder={x.kind === 'url' ? 'https://…/arquivo.csv' : 'Shopee Brasil - 2022_….csv'} onChange={(e) => setSrc(i, { value: e.target.value })} />
          <Button size="sm" aria-label="Remover fonte" icon={<Trash2 size={14} />} onClick={() => setF({ ...f, sources: f.sources.filter((_, j) => j !== i) })} /></div>)}
        {f.sources.length < 3 && <div><Button size="sm" icon={<Plus size={14} />} onClick={() => setF({ ...f, sources: [...f.sources, { kind: 'url', value: '' }] })}>Adicionar fonte</Button></div>}
      </div>
      <div className="grid g3">
        <Field label="Desconto mínimo (%)"><input type="number" min={0} max={95} value={f.min_discount} onChange={(e) => setF({ ...f, min_discount: Number(e.target.value) })} /></Field>
        <Field label="Nota mínima"><input type="number" min={0} max={5} step={0.1} value={f.min_rating} onChange={(e) => setF({ ...f, min_rating: Number(e.target.value) })} /></Field>
        <Field label="Ofertas por importação" hint="Quantas novas entram na fila de uma vez."><input type="number" min={1} max={100} value={f.per_run} onChange={(e) => setF({ ...f, per_run: Number(e.target.value) })} /></Field>
        <Field label="Preço mínimo (R$)"><input type="number" min={0} value={f.min_price} onChange={(e) => setF({ ...f, min_price: Number(e.target.value) })} /></Field>
        <Field label="Preço máximo (R$)"><input type="number" min={0} value={f.max_price} onChange={(e) => setF({ ...f, max_price: Number(e.target.value) })} /></Field>
        <Field label="Importar a cada (horas)"><input type="number" min={1} value={f.every_hours} onChange={(e) => setF({ ...f, every_hours: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Categorias que ficam de fora" hint="Uma por linha, no nome que a Shopee usa (coluna global_category1). Por padrão: peças de veículos, livros, alimentos e saúde.">
        <textarea rows={3} value={f.exclude_categories.join('\n')} onChange={(e) => setF({ ...f, exclude_categories: e.target.value.split('\n') })} /></Field>
      <div className="row wrap" style={{ gap: 10 }}><Toggle label="Importar sozinho" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span className="small">Importar sozinho a cada {out.every_hours} h</span>
        <span className="right row wrap" style={{ gap: 8 }}>
          <Button icon={<FileSpreadsheet size={14} />} disabled={!can || act.running} onClick={() => act.start('shopee', 'import_feed', { dry: true }, 'Lendo o feed (simulação)')}>Simular</Button>
          <Button variant="primary" icon={<Play size={14} />} disabled={!can || act.running} onClick={() => act.start('shopee', 'import_feed', { dry: false }, 'Importando o feed')}>Importar agora</Button></span></div>
      {dirty && cfg.sources.length > 0 && <div className="small muted">Salve as alterações antes de simular ou importar.</div>}
      <ActionBanner act={act} okText={(r) => r.dry ? `Simulação: ${r.seen} produtos lidos, ${r.kept} passam nos filtros.` : `${r.created} oferta(s) nova(s) na fila (${r.duplicates} já existiam, ${r.rejected} recusadas).`} />
      {act.result?.warning && <div className="alert warning"><div>{String(act.result.warning)}</div></div>}
      {act.result?.dry && Array.isArray(act.result.items) && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{act.result.items.map((x: any, i: number) => <li key={i}>{String(x.title)} — R$ {Number(x.price).toFixed(2)} <span className="muted">(antes R$ {Number(x.previous).toFixed(2)}, -{Math.round(Number(x.off))}%, nota {x.rating})</span></li>)}</ul>}
      {!!fs.last_import_at && <div className="small muted">Última importação: {when(fs.last_import_at)} · {fs.ok === false ? <span style={{ color: 'var(--bad)' }}>erro: {String(fs.error)}</span> : `${Number(fs.created ?? 0)} nova(s) de ${Number(fs.kept ?? 0)} candidatas`}</div>}
    </div></fieldset>
  </Card>;
}

function CollectorCard({ s, reload, isAdmin }: Pick<TabProps, 's' | 'reload' | 'isAdmin'>) {
  const cfg: CollectorConfig = { ...COL, ...((s.collector_config as Partial<CollectorConfig> | undefined) ?? {}) }; const cs = st(s, 'collector');
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  const tok = useLoad(() => api().getIngestTokenStatus(), [], 0);
  const [f, setF] = useState(cfg); const sig = stable(cfg); const [fresh, setFresh] = useState('');
  useEffect(() => { setF(cfg); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const out: CollectorConfig = { ...f, min_discount: nm(f.min_discount), min_price: nm(f.min_price), max_price: nm(f.max_price) || 100000, per_run: Math.max(1, Math.min(nm(f.per_run) || 20, 60)) };
  const dirty = stable(out) !== stable(cfg);
  const base = (() => { const b = String(s.shortlink_base ?? ''); try { return b ? new URL(b).origin : ''; } catch { return ''; } })();
  const rotate = async () => {
    if (tok.data?.is_set && !(await confirm({ title: 'Gerar um novo token?', danger: true, confirmLabel: 'Gerar novo', body: 'O token atual deixa de funcionar. Você precisará colar o novo na extensão.' }))) return;
    try { const v = await api().rotateIngestToken(); setFresh(v); void tok.reload(); } catch (e) { await run('tok', async () => { throw e; }); }
  };
  return <Card title="Coletor do navegador (Mercado Livre e Shopee)" actions={<><Badge tone={tok.data?.is_set ? 'ok' : 'warn'}><KeyRound size={12} />{tok.data?.is_set ? `token •••• ${tok.data.hint ?? ''}` : 'sem token'}</Badge>
    <Button variant="primary" size="sm" icon={<Save size={14} />} disabled={!isAdmin || !dirty} busy={busy === 'save-col'} onClick={async () => { if (await run('save-col', () => api().setSetting('collector_config', out), 'Regras do coletor salvas')) reload(); }}>Salvar</Button></>}>
    <fieldset disabled={!isAdmin} className="bare"><div className="col">
      <div className="small muted">Uma extensão do Chrome, instalada no seu computador, entra sozinha nas páginas do programa de afiliados já logadas por você (hub do Mercado Livre e “Oferta de produto” da Shopee), lê produtos, preços, descontos, comissão e <b>gera o link de afiliado de cada um</b>, e envia tudo para a fila de aprovação. A senha e a sessão ficam só no seu navegador; a Central recebe apenas os produtos, com o token abaixo.</div>
      <div className="grid g2">
        <Field label="Desconto mínimo (%)"><input type="number" min={0} max={95} value={f.min_discount} onChange={(e) => setF({ ...f, min_discount: Number(e.target.value) })} /></Field>
        <Field label="Máximo de ofertas por coleta"><input type="number" min={1} max={60} value={f.per_run} onChange={(e) => setF({ ...f, per_run: Number(e.target.value) })} /></Field>
        <Field label="Preço mínimo (R$)"><input type="number" min={0} value={f.min_price} onChange={(e) => setF({ ...f, min_price: Number(e.target.value) })} /></Field>
        <Field label="Preço máximo (R$)"><input type="number" min={0} value={f.max_price} onChange={(e) => setF({ ...f, max_price: Number(e.target.value) })} /></Field>
      </div>
      <div className="row wrap" style={{ gap: 10 }}><Toggle label="Receber do coletor" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span className="small">Receber ofertas enviadas pela extensão</span></div>
      <div className="alert info"><div className="col" style={{ gap: 8 }}>
        <b>Instalar a extensão (uma vez)</b>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>No Chrome, abra <code>chrome://extensions</code>, ative o <b>Modo do desenvolvedor</b> e clique em <b>Carregar sem compactação</b>.</li>
          <li>Escolha a pasta <code>extension</code> do projeto.</li>
          <li>Clique no ícone da extensão, cole o <b>endereço do worker</b> e o <b>token</b> abaixo, e salve.</li>
          <li>Deixe o Chrome aberto e logado no Mercado Livre e no portal de afiliados da Shopee. A extensão coleta sozinha no intervalo escolhido; “Coletar agora” faz na hora.</li>
        </ol>
        <div className="row wrap" style={{ gap: 8 }}><span className="small">Endereço do worker:</span><code>{base || 'https://seu-worker'}</code>{base && <CopyBtn text={base} />}</div>
        <div className="row wrap" style={{ gap: 8 }}><Button size="sm" icon={<Chrome size={14} />} disabled={!isAdmin} busy={busy === 'tok'} onClick={rotate}>{tok.data?.is_set ? 'Gerar novo token' : 'Gerar token'}</Button>
          {tok.data?.updated_at && <span className="small muted">token gerado em {when(tok.data.updated_at)}</span>}</div>
        {fresh && <div className="alert warning"><div className="col" style={{ gap: 6 }}><b>Copie agora: este token aparece uma única vez.</b><div className="row wrap" style={{ gap: 8 }}><code style={{ wordBreak: 'break-all' }}>{fresh}</code><CopyBtn text={fresh} /></div></div></div>}
      </div></div>
      {!!cs.last_at && <div className="small muted">Última coleta recebida: {when(cs.last_at)} ({String(cs.platform)}): {Number(cs.received ?? 0)} lidas, {Number(cs.created ?? 0)} novas, {Number(cs.duplicates ?? 0)} repetidas{cs.warning ? ` · ${String(cs.warning)}` : ''}</div>}
    </div></fieldset>
  </Card>;
}

export default function CollectTab(props: TabProps) {
  return <div className="col" style={{ gap: 14 }}>
    <FeedCard s={props.s} reload={props.reload} isAdmin={props.isAdmin} />
    <CollectorCard s={props.s} reload={props.reload} isAdmin={props.isAdmin} />
  </div>;
}
