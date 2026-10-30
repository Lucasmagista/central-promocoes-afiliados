import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { platformName } from '../lib/format';
import type { Destination, ProductCategory, RoutingRule, RoutingRuleInput, SettingsMap } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Toggle, useAction, useDialogs, useLoad } from '../ui/ui';
import { ChannelTag } from '../ui/badges';
import { CategoryChips, CategoryPicker } from '../components/CategoryPicker';
import { DEFAULT_CATEGORIES } from '../lib/categories';

const PLATFORMS = ['mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu'] as const;
const num = (v: unknown, d: number) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const flag = (v: unknown, d: boolean) => (v == null ? d : v === true || v === 'true');

function AutoSettings({ s, reload, isAdmin }: { s: SettingsMap; reload: () => void; isAdmin: boolean }) {
  const [f, setF] = useState({ enabled: flag(s.auto_approve_enabled, false), thr: num(s.auto_approve_threshold, 90), cap: num(s.auto_approve_max_per_day, 20), radar: num(s.radar_auto_min_score, 70), reval: flag(s.revalidate_before_send, true), drift: num(s.max_price_drift_pct, 3) });
  const { run, busy } = useAction(); const mode = String(s.mode ?? 'simulation');
  const save = async () => { if (await run('s', async () => {
    const api0 = api(); await api0.setSetting('auto_approve_enabled', f.enabled); await api0.setSetting('auto_approve_threshold', f.thr); await api0.setSetting('auto_approve_max_per_day', f.cap);
    await api0.setSetting('radar_auto_min_score', f.radar); await api0.setSetting('revalidate_before_send', f.reval); await api0.setSetting('max_price_drift_pct', f.drift);
  }, 'Ajustes salvos')) reload(); };
  return (
    <Card title="Aprovação automática e revalidação" actions={<Badge tone={mode === 'simulation' ? 'warn' : 'ok'}>modo: {mode === 'simulation' ? 'simulação' : mode === 'review' ? 'revisão' : 'automático'}</Badge>}>
      <fieldset disabled={!isAdmin} className="bare"><div className="col">
        {mode === 'simulation' && <div className="alert warning small"><div>No modo <b>simulação</b> nada é aprovado nem enviado de verdade. Mude para “revisão” em Configurações → Operação quando o grupo de teste estiver validado.</div></div>}
        <div className="row"><Toggle label="Aprovar sozinho" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span><b>Aprovar ofertas sozinho</b><div className="small muted">Ofertas com nota igual ou acima do corte vão direto para os destinos (respeitando as regras abaixo, a categoria de cada destino e os limites de envio). O resto continua para revisão.</div></span></div>
        <div className="grid g3">
          <Field label="Nota de corte (0–100)" hint="Sugestão: 85 ou mais."><input type="number" min={0} max={100} value={f.thr} onChange={(e) => setF({ ...f, thr: Number(e.target.value) })} /></Field>
          <Field label="Máx. aprovações automáticas por dia" hint="Freio de segurança."><input type="number" min={1} max={500} value={f.cap} onChange={(e) => setF({ ...f, cap: Number(e.target.value) })} /></Field>
          <Field label="Nota mínima para fontes do Radar em modo automático"><input type="number" min={0} max={100} value={f.radar} onChange={(e) => setF({ ...f, radar: Number(e.target.value) })} /></Field>
        </div>
        <div className="row"><Toggle label="Revalidar antes de enviar" checked={f.reval} onChange={(v) => setF({ ...f, reval: v })} /><span><b>Conferir o preço na loja antes de enviar</b><div className="small muted">Se o preço mudou mais que o limite (ou acabou o estoque), o envio é cancelado e a oferta volta para revisão com o preço novo.</div></span></div>
        <Field label="Oscilação de preço tolerada (%)" hint="Acima disso a oferta volta para revisão."><input type="number" min={0} max={50} step={0.5} value={f.drift} style={{ maxWidth: 140 }} onChange={(e) => setF({ ...f, drift: Number(e.target.value) })} /></Field>
        <div><Button variant="primary" busy={busy === 's'} onClick={save}>Salvar</Button></div>
      </div></fieldset>
    </Card>);
}

function RuleModal({ rule, dests, cats, onClose, onSaved }: { rule: RoutingRule | null; dests: Destination[]; cats: ProductCategory[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<RoutingRuleInput>(rule ? { ...rule } : { name: '', enabled: true, priority: 100, platforms: [], categories: [], min_score: 0, min_discount_pct: 0, destinations: [], auto_approve: false });
  const { run, busy } = useAction(); const tog = <K extends 'platforms' | 'destinations'>(k: K, v: string) => setF({ ...f, [k]: (f[k] as string[]).includes(v) ? (f[k] as string[]).filter((x) => x !== v) : [...(f[k] as string[]), v] });
  const save = async () => { if (await run('s', () => api().saveRoutingRule(rule?.id ?? null, f), 'Regra salva')) { onSaved(); onClose(); } };
  return (
    <Modal wide title={rule ? 'Editar regra' : 'Nova regra de roteamento'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={busy === 's'} disabled={f.name.trim().length < 2} onClick={save}>Salvar</Button></>}>
      <div className="col">
        <div className="grid g2"><Field label="Nome da regra"><input value={f.name} maxLength={80} placeholder="ex.: Eletrônicos da Shopee → Grupo Tech" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Prioridade" hint="Menor número roda primeiro."><input type="number" min={1} max={999} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></Field></div>
        <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Lojas</div><div className="row wrap" style={{ gap: 6 }}>{PLATFORMS.map((p) => <button key={p} type="button" className="chip" aria-pressed={f.platforms.includes(p)} onClick={() => tog('platforms', p)}>{platformName[p]}</button>)}</div><div className="small muted" style={{ marginTop: 4 }}>Nenhuma marcada = todas.</div></div>
        <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Tipos de produto</div><CategoryPicker cats={cats} value={f.categories} onChange={(v) => setF({ ...f, categories: v })} /></div>
        <div className="grid g2"><Field label="Nota mínima da oferta"><input type="number" min={0} max={100} value={f.min_score} onChange={(e) => setF({ ...f, min_score: Number(e.target.value) })} /></Field>
          <Field label="Desconto mínimo (%)"><input type="number" min={0} max={95} value={f.min_discount_pct} onChange={(e) => setF({ ...f, min_discount_pct: Number(e.target.value) })} /></Field></div>
        <div><div style={{ fontWeight: 650, marginBottom: 6 }}>Mandar para estes destinos</div>
          {dests.length === 0 ? <div className="small muted">Cadastre destinos primeiro.</div> : <div className="col" style={{ gap: 6 }}>{dests.map((d) => <label key={d.id} className="row"><input type="checkbox" checked={f.destinations.includes(d.id)} onChange={() => tog('destinations', d.id)} /><ChannelTag c={d.channel} /><span>{d.name}</span>{!d.enabled && <Badge>desativado</Badge>}</label>)}</div>}
          <div className="small muted" style={{ marginTop: 4 }}>Sem destino marcado, vale todos os destinos ativos que aceitam o tipo do produto.</div></div>
        <div className="row"><Toggle label="Aprovar automaticamente" checked={f.auto_approve} onChange={(v) => setF({ ...f, auto_approve: v })} /><span>Aprovar sozinho o que casar com esta regra (respeita o modo e o limite diário)</span></div>
        <div className="row"><Toggle label="Regra ativa" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /><span>Regra ativa</span></div>
      </div>
    </Modal>);
}

function Rules({ dests, cats, isAdmin }: { dests: Destination[]; cats: ProductCategory[]; isAdmin: boolean }) {
  const q = useLoad(() => api().listRoutingRules(), []); const [edit, setEdit] = useState<RoutingRule | null | undefined>(undefined); const { run } = useAction(); const { confirm } = useDialogs();
  const name = (id: string) => dests.find((d) => d.id === id)?.name ?? '—';
  return (
    <Card title="Regras de roteamento" actions={isAdmin && <Button size="sm" icon={<Plus size={14} />} onClick={() => setEdit(null)}>Nova regra</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : (q.data ?? []).length === 0 ? <Empty>Sem regras: ofertas aprovadas vão para os destinos que você escolher a cada aprovação. Crie regras para mandar cada tipo de oferta ao grupo certo.</Empty> :
        <div className="col" style={{ gap: 8 }}>{(q.data ?? []).map((r) => <div key={r.id} className="row card" style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}><div className="row wrap" style={{ gap: 8 }}><b>{r.name}</b>{!r.enabled && <Badge>desativada</Badge>}{r.auto_approve && <Badge tone="warn">aprova sozinha</Badge>}<span className="small muted">prioridade {r.priority}</span></div>
            <div className="small muted" style={{ marginTop: 3 }}>{r.platforms.length ? r.platforms.map((p) => platformName[p] ?? p).join(', ') : 'todas as lojas'} · nota ≥ {r.min_score} · desconto ≥ {r.min_discount_pct}% → {r.destinations.length ? r.destinations.map(name).join(', ') : 'todos os destinos aceitos'}</div>
            <div className="row wrap" style={{ gap: 5, marginTop: 5 }}><CategoryChips cats={cats} value={r.categories} max={4} /></div></div>
          {isAdmin && <span className="row" style={{ gap: 4 }}><Button size="sm" icon={<Pencil size={13} />} onClick={() => setEdit(r)}>Editar</Button>
            <Button size="sm" variant="ghost" aria-label={`Apagar ${r.name}`} icon={<Trash2 size={14} />} onClick={async () => { if (await confirm({ title: 'Apagar regra?', danger: true, confirmLabel: 'Apagar', body: r.name })) if (await run('d', () => api().deleteRoutingRule(r.id), 'Regra apagada')) void q.reload(); }} /></span>}
        </div>)}</div>}
      {edit !== undefined && <RuleModal rule={edit} dests={dests} cats={cats} onClose={() => setEdit(undefined)} onSaved={() => void q.reload()} />}
    </Card>);
}

function SearchTerms({ s, reload, cats, isAdmin }: { s: SettingsMap; reload: () => void; cats: ProductCategory[]; isAdmin: boolean }) {
  const cur = (s.search_terms ?? {}) as Record<string, string[]>; const [f, setF] = useState<Record<string, string>>({}); const { run, busy } = useAction();
  useEffect(() => { setF(Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, (v ?? []).join('\n')]))); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cur)]);
  const save = async () => { const out: Record<string, string[]> = {}; for (const [k, v] of Object.entries(f)) { const t = v.split('\n').map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 60 && !/[<>{}\\]/.test(x)).slice(0, 8); if (t.length) out[k] = t; }
    if (await run('s', () => api().setSetting('search_terms', out), 'Termos salvos')) reload(); };
  return (
    <Card title="Termos de busca por tipo de produto" actions={isAdmin && <Button size="sm" variant="primary" busy={busy === 's'} onClick={save}>Salvar</Button>}>
      <div className="col"><div className="small muted">Quando um conector não tem termos próprios, a coleta busca estes termos para cada tipo de produto (um por linha, até 8). Campo vazio = termos padrão do sistema. Para o Mercado Livre, as 3 buscas mais em alta do dia também entram.</div>
        <div className="grid g2">{cats.filter((c) => c.slug !== 'outros').map((c) => <Field key={c.slug} label={c.label}><textarea rows={3} disabled={!isAdmin} placeholder="padrão do sistema" value={f[c.slug] ?? ''} onChange={(e) => setF({ ...f, [c.slug]: e.target.value })} /></Field>)}</div></div>
    </Card>);
}

export default function Automation() {
  const { isAdmin } = useSession();
  const settings = useLoad(() => api().getSettings(), []); const dests = useLoad(() => api().listDestinations(), []); const catsQ = useLoad(() => api().listCategories(), []);
  const cats = catsQ.data ?? DEFAULT_CATEGORIES;
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error || !settings.data) return <ErrorBox error={settings.error ?? 'Sem dados'} retry={settings.reloadLoud} />;
  return (
    <>
      <PageHead title="Automação" sub="Regras para mandar cada oferta ao grupo certo, aprovação automática com freio e revalidação do preço antes de enviar." />
      <div className="col" style={{ gap: 14 }}>
        <AutoSettings key={JSON.stringify([settings.data.auto_approve_enabled, settings.data.auto_approve_threshold, settings.data.mode])} s={settings.data} reload={() => void settings.reload()} isAdmin={isAdmin} />
        <Rules dests={dests.data ?? []} cats={cats} isAdmin={isAdmin} />
        <SearchTerms s={settings.data} reload={() => void settings.reload()} cats={cats} isAdmin={isAdmin} />
      </div>
    </>);
}
