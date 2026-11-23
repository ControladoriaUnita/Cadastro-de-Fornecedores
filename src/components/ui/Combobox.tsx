import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { controlClass } from './Input'

export interface ComboboxOption {
  value: string
  label: string
  /** Texto menor ao lado (ex.: "UAU 70 · Metrocasa"); também entra na busca */
  hint?: string
}

/** Sem acento e minúsculo, para a busca achar "Cupecê" digitando "cupece". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Lista suspensa com busca: digitar filtra as opções; ↑ ↓ navegam, Enter escolhe, Esc fecha.
 * Só aceita valores da lista (o que for digitado e não escolhido é descartado ao sair).
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Digite para buscar…',
  emptyText = 'Nada encontrado',
  id,
  disabled,
  'aria-invalid': invalid,
}: {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  id?: string
  disabled?: boolean
  'aria-invalid'?: boolean
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = options.find((o) => o.value === value) ?? null

  const filtered = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (!words.length) return options
    return options.filter((o) => {
      const text = fold(`${o.label} ${o.hint ?? ''}`)
      return words.every((w) => text.includes(w))
    })
  }, [options, query])

  useEffect(() => setActive(0), [query, open])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (o: ComboboxOption) => {
    onChange(o.value)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        disabled={disabled}
        autoComplete="off"
        className={cn(controlClass, 'h-10 pr-16')}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onBlur={() => {
          // dá tempo do clique na opção chegar antes de fechar
          setTimeout(() => {
            setOpen(false)
            setQuery('')
          }, 120)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            if (open && filtered[active]) {
              e.preventDefault()
              choose(filtered[active]!)
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
          }
        }}
      />
      <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-ink-400">
        {selected && !disabled && (
          <button
            type="button"
            aria-label="Limpar"
            className="rounded p-1 hover:text-text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
          >
            <X className="size-4" />
          </button>
        )}
        <ChevronDown className="pointer-events-none size-4" aria-hidden />
      </div>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-control border border-border bg-surface py-1 shadow-overlay"
        >
          {filtered.length ? (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active && 'bg-primary-soft')}
              >
                <Check className={cn('size-4 shrink-0 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                {/* nome inteiro em cima, detalhe embaixo: cabe mesmo em campo estreito */}
                <span className="min-w-0 flex-1">
                  <span className="block">{o.label}</span>
                  {o.hint && <span className="block text-xs text-text-muted">{o.hint}</span>}
                </span>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-text-muted">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  )
}
