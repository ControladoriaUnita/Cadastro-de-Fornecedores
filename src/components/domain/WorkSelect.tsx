import { useQuery } from '@tanstack/react-query'
import type { WorkDTO } from '@shared/contracts'
import { Combobox } from '@/components/ui/Combobox'
import { api } from '@/lib/api'

/** Campo "Obra": lista suspensa com busca nas obras ativas (cadastro no Painel dev). Guarda o nome. */
export function WorkSelect({ value, onChange, id }: { value: string; onChange: (name: string) => void; id?: string }) {
  const q = useQuery({ queryKey: ['works'], queryFn: () => api<WorkDTO[]>('/works'), staleTime: 5 * 60_000 })
  const options = (q.data ?? [])
    .filter((w) => w.active || w.name === value)
    .map((w) => ({ value: w.name, label: w.name, hint: [w.uauCode && `UAU ${w.uauCode}`, w.client].filter(Boolean).join(' · ') || undefined }))
  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={q.isLoading ? 'Carregando obras…' : 'Digite o nome, código UAU ou cliente…'}
      emptyText={q.isError ? 'Não foi possível carregar as obras.' : 'Nenhuma obra encontrada. Peça o cadastro no Painel dev.'}
    />
  )
}
