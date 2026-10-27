import { api } from '../lib/api';
import { useSession } from '../session';
import { ago, roleLabel } from '../lib/format';
import type { Profile, Role } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Loading, PageHead, useAction, useDialogs, useLoad } from '../ui/ui';

export default function Users() {
  const { isAdmin, state } = useSession();
  const { confirm } = useDialogs();
  const { run, busy } = useAction();
  const q = useLoad(() => api().listUsers(), []);
  if (!isAdmin) return <><PageHead title="Usuários" /><div className="alert warning">Somente administradores gerenciam usuários.</div></>;
  const me = state?.status === 'ready' ? state.profile.user_id : '';
  const pending = (q.data ?? []).filter((u) => !u.active);
  const change = async (u: Profile, role: Role, active: boolean, okMsg: string) => { if (await run(u.user_id, () => api().setProfile(u.user_id, role, active), okMsg)) void q.reload(); };
  return (
    <>
      <PageHead title="Usuários" sub="Contas novas ficam inativas até você aprovar. O sistema impede remover o último administrador." />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : <>
        {pending.length > 0 && <Card title={<span className="row">Aguardando aprovação <Badge tone="warn">{pending.length}</Badge></span>} className="" flush>
          <div className="tablewrap"><table><tbody>{pending.map((u) => <tr key={u.user_id}><td><b>{u.name ?? u.email}</b><div className="small muted">{u.email} · criada {ago(u.created_at)}</div></td>
            <td className="right nowrap" style={{ textAlign: 'right' }}><Button size="sm" variant="primary" busy={busy === u.user_id} onClick={() => change(u, 'viewer', true, 'Conta aprovada como leitor')}>Aprovar como leitor</Button>{' '}
              <Button size="sm" busy={busy === u.user_id} onClick={() => change(u, 'operator', true, 'Conta aprovada como operador')}>Como operador</Button></td></tr>)}</tbody></table></div></Card>}
        <div style={{ marginTop: pending.length ? 14 : 0 }}><Card title="Equipe" flush><div className="tablewrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th /></tr></thead>
          <tbody>{(q.data ?? []).filter((u) => u.active).map((u) => <tr key={u.user_id}><td><b>{u.name ?? u.email}</b>{u.user_id === me && <> <Badge tone="accent">você</Badge></>}<div className="small muted">{u.email}</div></td>
            <td><select aria-label={`Perfil de ${u.email}`} style={{ width: 'auto' }} value={u.role} disabled={busy === u.user_id} onChange={(e) => change(u, e.target.value as Role, true, 'Perfil atualizado')}>{Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td><Badge tone="ok">Ativo</Badge></td>
            <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" disabled={u.user_id === me} onClick={async () => { if (await confirm({ title: `Desativar ${u.email}?`, body: 'A pessoa perde o acesso imediatamente.', danger: true, confirmLabel: 'Desativar' })) await change(u, u.role, false, 'Conta desativada'); }}>Desativar</Button></td></tr>)}</tbody></table></div></Card></div>
        <div className="card" style={{ marginTop: 14, padding: 16 }}><h3>Perfis</h3><ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.8, marginBottom: 0 }}>
          <li><b>Administrador</b>: tudo, incluindo destinos, templates, conectores, configurações, retomar publicações e usuários.</li>
          <li><b>Operador</b>: cadastra, aprova e rejeita ofertas, trata publicações, testa destinos e pode pausar tudo.</li>
          <li><b>Leitor</b>: somente consulta.</li></ul></div></>}
    </>);
}
