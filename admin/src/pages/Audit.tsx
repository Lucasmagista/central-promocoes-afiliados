import { useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { dateFull, download, toCsv } from '../lib/format';
import type { AuditEvent } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHead, useLoad } from '../ui/ui';

export default function Audit() {
  const [q, setQ] = useState(''); const [entity, setEntity] = useState('all'); const [sel, setSel] = useState<AuditEvent | null>(null);
  const r = useLoad(() => api().listAudit({ q, entity, limit: 300 }), [q, entity], 15000);
  const rows = r.data ?? [];
  const entities = ['offer', 'publication', 'destinations', 'destination', 'templates', 'connectors', 'settings', 'profiles'];
  return (
    <>
      <PageHead title="Auditoria" sub="Quem fez o quê e quando. Segredos são removidos antes de gravar. Somente leitura.">
        <Button icon={<Download size={15} />} disabled={!rows.length} onClick={() => download(`auditoria-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows.map((e) => ({ id: e.id, quando: e.created_at, ator: e.actor_email ?? e.actor_type, acao: e.action, entidade: e.entity_type, entidade_id: e.entity_id, detalhes: e.metadata }))))}>Exportar CSV</Button></PageHead>
      <Card flush>
        <div className="tools"><input aria-label="Filtrar por ação" placeholder="Filtrar por ação (ex.: approved)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Entidade" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="all">Todas as entidades</option>{entities.map((x) => <option key={x}>{x}</option>)}</select>
          <span className="right small muted">{rows.length} evento(s)</span></div>
        {r.loading && !r.data ? <Loading /> : r.error ? <div style={{ padding: 16 }}><ErrorBox error={r.error} retry={r.reloadLoud} /></div> : !rows.length ? <Empty icon={<ScrollText size={30} />}>Nenhum evento.</Empty> :
          <div className="tablewrap"><table><thead><tr><th>Quando</th><th>Ator</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
            <tbody>{rows.map((e) => <tr key={e.id} className="click" tabIndex={0} onClick={() => setSel(e)} onKeyDown={(k) => k.key === 'Enter' && setSel(e)}>
              <td className="small nowrap">{dateFull(e.created_at)}</td><td>{e.actor_type === 'system' ? <Badge>sistema</Badge> : <span className="small">{e.actor_email}</span>}</td>
              <td><code>{e.action}</code></td><td className="small">{e.entity_type ?? '—'}</td><td className="small muted truncate" style={{ maxWidth: 280 }}>{JSON.stringify(e.metadata)}</td></tr>)}</tbody></table></div>}
      </Card>
      {sel && <Modal title={`Evento #${sel.id}`} onClose={() => setSel(null)}><dl className="kv"><dt>Quando</dt><dd>{dateFull(sel.created_at)}</dd><dt>Ator</dt><dd>{sel.actor_email ?? sel.actor_type}</dd><dt>Ação</dt><dd><code>{sel.action}</code></dd><dt>Entidade</dt><dd>{sel.entity_type} <code>{sel.entity_id}</code></dd></dl>
        <pre className="mono" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10, overflow: 'auto', marginTop: 12 }}>{JSON.stringify(sel.metadata, null, 2)}</pre></Modal>}
    </>);
}
