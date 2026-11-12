'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, EyeOff, Minus, Search } from 'lucide-react'

type ExclusionCategory = 'edv' | 'division' | 'organizationalUnit' | 'hrArea' | 'subgroup' | 'position' | 'flexibleSchedule'
type ExclusionRule = { category: ExclusionCategory; value: string }
type ExclusionState = { rules: ExclusionRule[]; categories: ExclusionCategory[]; names: Record<string, string> }

const categoryDefinitions: { key: ExclusionCategory; label: string; placeholder: string }[] = [
  { key: 'edv', label: 'EDV', placeholder: 'Buscar por EDV ou nome' },
  { key: 'division', label: 'Divisão', placeholder: 'Buscar divisão' },
  { key: 'organizationalUnit', label: 'Unidade organizacional', placeholder: 'Buscar unidade organizacional' },
  { key: 'hrArea', label: 'Área de recursos humanos', placeholder: 'Buscar área' },
  { key: 'subgroup', label: 'Subgrupo de empregados', placeholder: 'Buscar subgrupo' },
  { key: 'position', label: 'Posição', placeholder: 'Buscar posição' },
  { key: 'flexibleSchedule', label: 'Tipo de Contrato', placeholder: 'Buscar tipo de contrato' },
]

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function CheckBox({ state }: { state: 'all' | 'some' | 'none' }) {
  return <span className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${state === 'none' ? 'border-[#c9c0e3] bg-white' : 'border-[#6a4fb3] bg-[#6a4fb3] text-white'}`}>
    {state === 'all' ? <Check className="size-3" strokeWidth={3} /> : state === 'some' && <Minus className="size-3" strokeWidth={3} />}
  </span>
}

function CategoryCard({ category, values, names, options, onChange }: {
  category: (typeof categoryDefinitions)[number]
  values: string[]
  names: Record<string, string>
  options: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [searchExcluded, setSearchExcluded] = useState<string[]>([])
  const [addToSelection, setAddToSelection] = useState(false)
  const [employeeMatches, setEmployeeMatches] = useState<{ edv: string; name: string }[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const isEdv = category.key === 'edv'
  const employeeNames = useMemo(() => new Map(employeeMatches.map(employee => [employee.edv, employee.name])), [employeeMatches])
  const sortedOptions = useMemo(() => [...new Set(isEdv ? employeeMatches.map(employee => employee.edv) : options)].sort(collator.compare), [isEdv, employeeMatches, options])
  const visibleOptions = useMemo(() => sortedOptions.filter(option => normalize(isEdv && employeeNames.has(option) ? `${option} ${employeeNames.get(option)}` : option).includes(normalize(search))).slice(0, 300), [sortedOptions, search, isEdv, employeeNames])
  const searching = search.trim().length > 0
  const searchSelection = searching ? visibleOptions.filter(option => !searchExcluded.includes(option)) : []
  const selectedSet = useMemo(() => new Set(values), [values])
  const selectedOptions = sortedOptions.filter(option => selectedSet.has(option))
  const allOptionsSelected = sortedOptions.length > 0 && selectedOptions.length === sortedOptions.length
  const labelOf = (value: string) => isEdv && (names[value] || employeeNames.get(value)) ? `${value} - ${names[value] || employeeNames.get(value)}` : value

  useEffect(() => {
    if (!isEdv) return
    const term = search.trim()
    if (term.length < 2) {
      setEmployeeMatches([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/management/exclusions?employee=${encodeURIComponent(term)}`, { cache: 'no-store', signal: controller.signal })
        .then(response => response.json())
        .then((result: { employees?: { edv: string; name: string }[] }) => setEmployeeMatches(result.employees ?? []))
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, isEdv])

  function commitSearch(add: boolean) {
    if (!searching || searchSelection.length === 0) return
    onChange(add ? [...new Set([...values, ...searchSelection])] : searchSelection)
  }

  function closeFilter(apply: boolean, add = addToSelection) {
    if (apply) commitSearch(add)
    setOpen(false)
    setSearch('')
    setSearchExcluded([])
    setAddToSelection(false)
  }
  const closeFilterRef = useRef(closeFilter)
  closeFilterRef.current = closeFilter

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closeFilterRef.current(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeFilterRef.current(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function updateSearch(text: string) {
    if (!text.trim()) setSearchExcluded([])
    setSearch(text)
  }

  function toggleOption(option: string) {
    if (searching) {
      setSearchExcluded(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option])
      return
    }
    onChange(selectedSet.has(option) ? values.filter(value => value !== option) : [...values, option])
  }

  function toggleAll() {
    onChange(allOptionsSelected ? values.filter(value => !sortedOptions.includes(value)) : [...new Set([...values, ...sortedOptions])])
  }

  const keepSearchFocus = (event: React.MouseEvent) => event.preventDefault()
  const noOptionsMessage = category.key === 'position' && options.length === 0
    ? 'Nenhuma posição encontrada no banco de dados.'
    : isEdv && !searching ? 'Digite ao menos 2 caracteres para buscar por EDV ou nome.' : 'Nenhum resultado encontrado.'

  return <div className="flex flex-col rounded-xl border border-[#e2dcf2] bg-[#fcfbff]">
    <div className="flex items-center justify-between gap-2 border-b border-[#ebe6f6] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <strong className="truncate text-sm text-[#3f3566]">{category.label}</strong>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#6a4fb3] ring-1 ring-[#e2dcf2]">{values.length}</span>
      </div>
    </div>
    <div className="space-y-3 p-4">
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b91b8]" />
          <input value={search} onChange={event => updateSearch(event.target.value)} onFocus={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); closeFilter(true, addToSelection || event.shiftKey) } }} placeholder={category.placeholder} className="h-9 w-full rounded-lg border border-[#d9d1ee] bg-white pl-9 pr-3 text-sm text-[#3f3566] outline-none transition placeholder:text-slate-400 focus:border-[#6a4fb3] focus:ring-2 focus:ring-[#6a4fb3]/15" />
        </div>
        {open && <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-[#d9d1ee] bg-white shadow-[0_12px_32px_rgba(63,53,102,0.18)]">
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
            {!searching && sortedOptions.length > 0 && <button type="button" onMouseDown={keepSearchFocus} onClick={toggleAll} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#3f3566] transition hover:bg-[#f2eefb]">
              <CheckBox state={allOptionsSelected ? 'all' : selectedOptions.length ? 'some' : 'none'} />
              Selecionar todos ({sortedOptions.length})
            </button>}
            {visibleOptions.map(option => {
              const selected = searching ? searchSelection.includes(option) : selectedSet.has(option)
              return <button key={option} type="button" role="option" aria-selected={selected} onMouseDown={keepSearchFocus} onClick={() => toggleOption(option)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${selected ? 'bg-[#f2eefb] text-[#4b3f7a]' : 'text-[#3f3566] hover:bg-[#f7f5fc]'}`}>
                <CheckBox state={selected ? 'all' : 'none'} />
                <span className="truncate font-medium">{labelOf(option)}</span>
              </button>
            })}
            {visibleOptions.length === 0 && <p className="px-3 py-6 text-center text-xs leading-5 text-slate-400">{noOptionsMessage}</p>}
          </div>
          {searching && visibleOptions.length > 0 && <div className="space-y-1.5 border-t border-[#ebe6f6] bg-[#fcfbff] px-3 py-2 text-[11px] text-[#6b6390]">
            {values.length > 0 && <button type="button" role="checkbox" aria-checked={addToSelection} onMouseDown={keepSearchFocus} onClick={() => setAddToSelection(current => !current)} className="flex items-center gap-2 font-medium text-[#4b3f7a]">
              <CheckBox state={addToSelection ? 'all' : 'none'} />
              Adicionar à seleção atual ({values.length} {values.length === 1 ? 'item' : 'itens'})
            </button>}
            {searchSelection.length > 0 && <p>Pressione <strong>Enter</strong> para {addToSelection ? 'adicionar' : 'selecionar'} {searchSelection.length} {searchSelection.length === 1 ? 'item' : 'itens'}</p>}
          </div>}
        </div>}
      </div>
      {values.length === 0 ? <p className="text-xs text-slate-400">{isEdv ? 'Busque por EDV ou nome, marque os resultados e pressione Enter.' : 'Busque, marque um ou mais valores e pressione Enter.'}</p>
        : <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {values.map(value => <span key={value} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-[#d9d1ee] bg-white pl-2.5 pr-1 text-xs font-semibold text-[#4b3f7a]">
              <span className="truncate" title={isEdv && !names[value] ? `${value} (EDV não encontrado no IT007)` : labelOf(value)}>{labelOf(value)}</span>
              <button type="button" onClick={() => onChange(values.filter(item => item !== value))} aria-label={`Remover ${value}`} className="grid size-5 shrink-0 place-items-center rounded-full text-[#9b91b8] transition hover:bg-[#fdecec] hover:text-[#c84d55]">×</button>
            </span>)}
          </div>}
    </div>
  </div>
}

type MonthlyExclusion = { edv: string; name: string; hrbp: string; justification: string }

// Lista do arquivo Exclusão_Base_MM_AA do mês de referência: essas pessoas saem do dashboard só naquele mês
const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function MonthlyExclusionsTable({ period: referencePeriod, refreshKey, search }: { period: string; refreshKey: number; search: string }) {
  // Começa no mês de referência da página e acompanha quando ele muda, mas pode ser trocado só aqui na tabela
  const [period, setPeriod] = useState(referencePeriod)
  const [employees, setEmployees] = useState<MonthlyExclusion[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [tableSearch, setTableSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const periodLabel = `${monthNames[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return [...new Set([currentYear, currentYear - 1, Number(period.slice(0, 4)), ...periods.map(item => Number(item.slice(0, 4)))])].sort((first, second) => second - first)
  }, [periods, period])

  useEffect(() => setPeriod(referencePeriod), [referencePeriod])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/management/exclusions?period=${period}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.json())
      .then((result: { employees?: MonthlyExclusion[]; periods?: string[] }) => {
        setEmployees(result.employees ?? [])
        setPeriods(result.periods ?? [])
        setLoading(false)
      })
      .catch(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, refreshKey])

  const selectClass = 'h-8 rounded-lg border border-[#d9d1ee] bg-white px-2 text-xs font-semibold text-[#3f3566] outline-none transition focus:border-[#6a4fb3] focus:ring-2 focus:ring-[#6a4fb3]/15'

  async function remove(edv: string) {
    const previous = employees
    setEmployees(current => current.filter(employee => employee.edv !== edv))
    setError('')
    try {
      const response = await fetch('/api/management/exclusions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period, edv }) })
      const result = await response.json() as { employees?: MonthlyExclusion[]; error?: string }
      if (!response.ok) throw new Error(result.error || 'Não foi possível remover a exceção.')
      setEmployees(result.employees ?? [])
    } catch (removeError) {
      setEmployees(previous)
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível remover a exceção.')
    }
  }

  // Busca em todas as colunas; vale junto com a busca geral da seção
  const terms = [normalize(search), normalize(tableSearch)].filter(Boolean)
  const visibleEmployees = terms.length ? employees.filter(employee => terms.every(term => normalize(`${employee.edv} ${employee.name} ${employee.hrbp} ${employee.justification}`).includes(term))) : employees
  // Nome esperado do arquivo do mês, ex.: 2026-08 → Exclusão_Base_08_26.xlsx
  const month = period.slice(5, 7)
  const year = period.slice(2, 4)

  return <div className="mt-4 flex flex-col rounded-xl border border-[#e2dcf2] bg-[#fcfbff]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebe6f6] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <strong className="truncate text-sm text-[#3f3566]">Base de exclusão · {periodLabel}</strong>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#6a4fb3] ring-1 ring-[#e2dcf2]">{employees.length}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {error && <span className="text-xs font-semibold text-[#c84d55]">{error}</span>}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9b91b8]" />
          <input value={tableSearch} onChange={event => setTableSearch(event.target.value)} placeholder="Buscar..." aria-label="Buscar por EDV, nome, HRBP solicitante ou cargo" title="Busca por EDV, nome, HRBP solicitante ou cargo/justificativa" className="h-8 w-56 rounded-lg border border-[#d9d1ee] bg-white pl-8 pr-3 text-xs text-[#3f3566] outline-none transition placeholder:text-slate-400 focus:border-[#6a4fb3] focus:ring-2 focus:ring-[#6a4fb3]/15" />
        </div>
        <div className="flex items-center gap-1.5">
          <select aria-label="Mês da lista de exceções" value={Number(period.slice(5, 7))} onChange={event => setPeriod(`${period.slice(0, 4)}-${event.target.value.padStart(2, '0')}`)} className={selectClass}>
            {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}{periods.includes(`${period.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`) ? ' •' : ''}</option>)}
          </select>
          <select aria-label="Ano da lista de exceções" value={Number(period.slice(0, 4))} onChange={event => setPeriod(`${event.target.value}-${period.slice(5, 7)}`)} className={selectClass}>
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
      </div>
    </div>
    <div className="p-4">
      {loading ? <p className="text-xs text-slate-400">Carregando...</p>
        : employees.length === 0 ? <p className="rounded-lg border border-dashed border-[#e2dcf2] px-4 py-4 text-center text-xs text-slate-400">Nenhuma exceção para {periodLabel}. Envie o arquivo <strong className="text-[#6a4fb3]">Exclusão_Base_{month}_{year}.xlsx</strong> em Fontes de dados.</p>
          : visibleEmployees.length === 0 ? <p className="text-xs text-slate-400">Nenhuma pessoa corresponde à busca.</p>
            // Cabeçalho (36px) + 10 linhas (40px): a partir da 11ª linha aparece a rolagem
            : <div className="max-h-[436px] overflow-y-auto rounded-lg border border-[#e2dcf2] bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[#f5f2fc] text-[10px] font-bold uppercase tracking-[0.06em] text-[#6b6390]">
                  <tr className="h-9">
                    <th className="px-3 font-bold">EDV</th>
                    <th className="px-3 font-bold">Nome</th>
                    <th className="px-3 font-bold">HRBP solicitante</th>
                    <th className="px-3 font-bold">Cargo / Justificativa</th>
                    <th className="w-10 px-2"><span className="sr-only">Remover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map(employee => <tr key={employee.edv} className="h-10 border-t border-[#f0ecf8] text-[#3f3566] transition hover:bg-[#faf8fe]">
                    <td className="whitespace-nowrap px-3 font-semibold tabular-nums">{employee.edv}</td>
                    <td className="max-w-[260px] truncate px-3" title={employee.name}>{employee.name || '—'}</td>
                    <td className="max-w-[200px] truncate px-3" title={employee.hrbp}>{employee.hrbp || '—'}</td>
                    <td className="max-w-[320px] truncate px-3" title={employee.justification}>{employee.justification || '—'}</td>
                    <td className="px-2 text-right">
                      <button type="button" onClick={() => void remove(employee.edv)} aria-label={`Remover ${employee.edv} das exceções de ${periodLabel}`} title="Remover" className="grid size-6 place-items-center rounded-full text-[#9b91b8] transition hover:bg-[#fdecec] hover:text-[#c84d55]">×</button>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
    </div>
  </div>
}

export function ExclusionsSection({ period, refreshKey }: { period: string; refreshKey: number }) {
  const [error, setError] = useState('')
  const [rules, setRules] = useState<ExclusionRule[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [options, setOptions] = useState<Partial<Record<ExclusionCategory, string[]>>>({})
  // Categorias salvas no banco (inclusive as que ainda não têm itens)
  const [categories, setCategories] = useState<ExclusionCategory[]>([])

  useEffect(() => {
    fetch('/api/management/exclusions', { cache: 'no-store' })
      .then(response => response.json())
      .then((result: ExclusionState & { options?: Partial<Record<ExclusionCategory, string[]>> }) => {
        applyState(result)
        setOptions(result.options ?? {})
      })
      .catch(() => {})
  }, [])

  function applyState(state: Partial<ExclusionState>) {
    setRules(state.rules ?? [])
    setCategories(state.categories ?? [])
    setNames(state.names ?? {})
  }

  // Cada alteração envia só o que mudou (adicionar ou remover); a tela mostra a mudança na hora e volta atrás se falhar
  async function save(method: 'POST' | 'PUT' | 'DELETE', body: { category: ExclusionCategory; values?: string[]; value?: string }, optimistic: ExclusionState) {
    const previous = { rules, categories, names }
    applyState(optimistic)
    setError('')
    try {
      const response = await fetch('/api/management/exclusions', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as ExclusionState & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar as exceções.')
      applyState(result)
    } catch (saveError) {
      applyState(previous)
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as exceções.')
    }
  }

  const valuesByCategory = useMemo(() => {
    const grouped = new Map<ExclusionCategory, string[]>()
    for (const rule of rules) grouped.set(rule.category, [...(grouped.get(rule.category) ?? []), rule.value])
    for (const values of grouped.values()) values.sort(collator.compare)
    return grouped
  }, [rules])

  return <section className="rounded-2xl border border-[#e2dcf2] bg-white shadow-[0_12px_34px_rgba(63,53,102,0.07)]">
    <div className="border-b border-[#ebe6f6] px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-[#f2eefb] text-[#6a4fb3]"><EyeOff className="size-5" /></div>
        <div><h2 className="text-[17px] font-semibold text-[#3f3566]">Exceções</h2>{error ? <p className="mt-0.5 text-xs font-semibold text-[#c84d55]">{error}</p> : <p className="mt-0.5 text-xs text-slate-500">As categorias valem para todos os meses; a lista do mês vale só para o mês de referência.</p>}</div>
      </div>
    </div>
    <div className="px-6 py-5">
      <div className="grid gap-4 md:grid-cols-2">
            {categoryDefinitions.map(category => <CategoryCard
              key={category.key}
              category={category}
              values={valuesByCategory.get(category.key) ?? []}
              names={names}
              options={options[category.key] ?? []}
              onChange={values => void save('PUT', { category: category.key, values }, {
                rules: [...rules.filter(rule => rule.category !== category.key), ...values.map(value => ({ category: category.key, value }))],
                categories: [...new Set([...categories, category.key])],
                names,
              })}
            />)}
          </div>
      <MonthlyExclusionsTable period={period} refreshKey={refreshKey} search="" />
    </div>
  </section>
}
