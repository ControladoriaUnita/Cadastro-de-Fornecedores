/**
 * Painel dev → Usuários e Cargos e permissões.
 * Cargos são conjuntos de permissões; o usuário pode ter vários (as permissões se somam).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Search, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react'
import type { RoleDTO, TeamUserDTO } from '@shared/contracts'
import { ALL_PERMISSIONS, DEV_ROLE_KEY, PERMISSION_INFO, permissionsFor, type Permission } from '@shared/domain/roles'
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Skeleton } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/utils/format'

const GROUPS = [...new Set(ALL_PERMISSIONS.map((p) => PERMISSION_INFO[p].group))]

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api<RoleDTO[]>('/roles') })
}

// ----------------------------------------------------------------------------- cargos

function RoleEditor({ role, onClose }: { role: RoleDTO | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role?.permissions ?? []))
  const locked = !!role?.system
  const toggle = (p: Permission) =>
    setPerms((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const save = useMutation({
    mutationFn: () =>
      api<RoleDTO[]>(role ? `/roles/${role.key}` : '/roles', {
        method: role ? 'PUT' : 'POST',
        body: { name, description: description || null, permissions: [...perms] },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['roles'], data)
      void qc.invalidateQueries({ queryKey: ['me'] })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(94vw, 46rem)"
      title={role ? `Editar cargo: ${role.name}` : 'Novo cargo'}
      description={role ? `${role.users} usuário(s) com este cargo. A mudança vale no próximo clique deles.` : 'Escolha o que quem tiver este cargo pode fazer.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
            Salvar cargo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do cargo" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Gerente de obras" autoFocus />
          </Field>
          <Field label="Descrição">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {locked && (
          <Alert tone="info" title="Cargo de sistema">
            O cargo Dev sempre tem todas as permissões, para ninguém perder o acesso às configurações. Só o nome e a descrição mudam.
          </Alert>
        )}
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const items = ALL_PERMISSIONS.filter((p) => PERMISSION_INFO[p].group === g)
            const allOn = items.every((p) => perms.has(p))
            return (
              <fieldset key={g} disabled={locked} className="rounded-control border border-border-soft">
                <legend className="ml-3 px-1 text-sm font-semibold">{g}</legend>
                {!locked && (
                  <button
                    type="button"
                    className="float-right mt-[-6px] mr-3 text-xs font-medium text-primary hover:underline"
                    onClick={() => setPerms((s) => new Set(allOn ? [...s].filter((p) => !items.includes(p)) : [...s, ...items]))}
                  >
                    {allOn ? 'Desmarcar todas' : 'Marcar todas'}
                  </button>
                )}
                <ul className="divide-y divide-border-soft">
                  {items.map((p) => (
                    <li key={p}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-ink-50">
                        <input type="checkbox" className="mt-1 accent-primary" checked={locked || perms.has(p)} onChange={() => toggle(p)} />
                        <span>
                          <span className="block text-sm font-medium text-text">{PERMISSION_INFO[p].label}</span>
                          <span className="block text-xs text-text-muted">{PERMISSION_INFO[p].description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )
          })}
        </div>
        {!locked && perms.size === 0 && <Alert tone="warning">Sem nenhuma permissão, quem tiver só este cargo não consegue usar o app.</Alert>}
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      </div>
    </Dialog>
  )
}

export function RolesManager() {
  const qc = useQueryClient()
  const q = useRoles()
  const [edit, setEdit] = useState<RoleDTO | 'new' | null>(null)
  const [removing, setRemoving] = useState<RoleDTO | null>(null)
  const del = useMutation({
    mutationFn: (key: string) => api<RoleDTO[]>(`/roles/${key}`, { method: 'DELETE' }),
    onSuccess: (data) => {
      qc.setQueryData(['roles'], data)
      setRemoving(null)
    },
  })

  return (
    <Card>
      <CardHeader
        title="Cargos e permissões"
        description="Cada cargo libera um conjunto de telas e ações. Um usuário pode ter vários cargos; as permissões se somam."
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
            Novo cargo
          </Button>
        }
      />
      {q.isError && <Alert tone="error" className="m-4">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Skeleton className="m-4 h-40" />
      ) : (
        <ul className="divide-y divide-border-soft">
          {q.data?.map((r) => (
            <li key={r.key} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <ShieldCheck className={r.system ? 'mt-0.5 size-5 text-primary' : 'mt-0.5 size-5 text-ink-400'} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {r.name}
                  {r.system && (
                    <Badge tone="primary" icon={<Lock className="size-3" />}>
                      Sistema
                    </Badge>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-text-muted">
                    <UsersIcon className="size-3.5" /> {r.users}
                  </span>
                </p>
                {r.description && <p className="text-sm text-text-muted">{r.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <span key={p} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700">
                      {PERMISSION_INFO[p].label}
                    </span>
                  ))}
                  {!r.permissions.length && <span className="text-xs text-warning">Sem permissões</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Editar ${r.name}`} onClick={() => setEdit(r)}>
                  <Pencil className="size-4" />
                </Button>
                {!r.system && (
                  <Button size="sm" variant="ghost" aria-label={`Apagar ${r.name}`} onClick={() => (del.reset(), setRemoving(r))}>
                    <Trash2 className="size-4 text-error" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <RoleEditor role={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title={`Apagar o cargo "${removing?.name}"?`}
        description={removing?.users ? `${removing.users} usuário(s) ainda têm este cargo: troque o cargo deles antes.` : 'O cargo deixa de existir. Esta ação não pode ser desfeita.'}
        confirmLabel="Apagar"
        loading={del.isPending}
        onConfirm={() => removing && del.mutate(removing.key)}
        onCancel={() => setRemoving(null)}
      >
        {del.isError && <Alert tone="error">{errorMessage(del.error)}</Alert>}
      </ConfirmDialog>
    </Card>
  )
}

// ----------------------------------------------------------------------------- usuários

export function UsersManager() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<TeamUserDTO[]>('/users') })
  const roles = useRoles()
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<TeamUserDTO | 'new' | null>(null)
  const [form, setForm] = useState({ fullName: '', email: '', roles: [] as string[], active: true })
  const roleName = useMemo(() => new Map((roles.data ?? []).map((r) => [r.key, r.name])), [roles.data])
  const iAmDev = !!me?.roles.includes(DEV_ROLE_KEY)

  const open = (u: TeamUserDTO | 'new') => {
    setEdit(u)
    setForm(u === 'new' ? { fullName: '', email: '', roles: [], active: true } : { fullName: u.fullName, email: u.email, roles: u.roles, active: u.active })
  }
  const save = useMutation({
    mutationFn: () => api(edit === 'new' ? '/users' : `/users/${(edit as TeamUserDTO).id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      void qc.invalidateQueries({ queryKey: ['roles'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      setEdit(null)
    },
  })
  const effective = permissionsFor(form.roles, roles.data ?? [])
  const term = search.trim().toLowerCase()
  const rows = (q.data ?? []).filter((u) => !term || u.fullName.toLowerCase().includes(term) || u.email.includes(term))

  return (
    <Card>
      <CardHeader
        title="Usuários da equipe"
        description="Só entra quem estiver aqui. No login Microsoft, o e-mail precisa ser o mesmo da conta."
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => open('new')}>
            Novo usuário
          </Button>
        }
      />
      <div className="border-b border-border-soft px-5 py-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou e-mail" className="h-9 pl-9" aria-label="Buscar usuário" />
        </div>
      </div>
      {q.isError && <Alert tone="error" className="m-4">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Skeleton className="m-4 h-32" />
      ) : rows.length ? (
        <ul className="divide-y divide-border-soft">
          {rows.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {u.fullName} {!u.active && <Badge tone="error">Inativo</Badge>} {u.id === me?.id && <Badge tone="info">Você</Badge>}
                </p>
                <p className="text-xs text-text-muted">
                  {u.email} · último acesso {formatDateTime(u.lastLoginAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {u.roles.map((r) => (
                  <Badge key={r} tone={r === DEV_ROLE_KEY ? 'primary' : 'neutral'}>
                    {roleName.get(r) ?? `${r} (apagado)`}
                  </Badge>
                ))}
              </div>
              <Button size="sm" variant="ghost" aria-label={`Editar ${u.fullName}`} onClick={() => open(u)}>
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nenhum usuário encontrado" />
      )}
      {edit && (
        <Dialog
          open
          onClose={() => setEdit(null)}
          width="min(94vw, 40rem)"
          title={edit === 'new' ? 'Novo usuário' : 'Editar usuário'}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEdit(null)} className="mr-auto">
                Cancelar
              </Button>
              <Button variant="primary" loading={save.isPending} disabled={!form.roles.length || form.fullName.trim().length < 2 || !form.email.includes('@')} onClick={() => save.mutate()}>
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" required>
                <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </Field>
              <Field label="E-mail corporativo" required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-ink-700">Cargos</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {roles.data?.map((r) => {
                  const blocked = r.key === DEV_ROLE_KEY && !iAmDev
                  return (
                    <label key={r.key} className="flex items-start gap-2 rounded-control border border-border-soft px-3 py-2 text-sm" title={blocked ? 'Só quem é Dev pode dar este cargo' : undefined}>
                      <input
                        type="checkbox"
                        className="mt-1 accent-primary"
                        disabled={blocked}
                        checked={form.roles.includes(r.key)}
                        onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, r.key] : form.roles.filter((x) => x !== r.key) })}
                      />
                      <span>
                        <span className="block font-medium">{r.name}</span>
                        {r.description && <span className="block text-xs text-text-muted">{r.description}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="rounded-control bg-ink-50 px-3 py-2">
              <p className="text-xs font-semibold text-ink-700">Na prática, esta pessoa vai poder:</p>
              {effective.length ? (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {effective.map((p) => (
                    <li key={p} className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-700">
                      {PERMISSION_INFO[p].label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-text-muted">Nada ainda: escolha ao menos um cargo.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Ativo (pode entrar no app)
            </label>
            {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          </div>
        </Dialog>
      )}
    </Card>
  )
}

