'use client'

import { Fragment, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { UserMenu } from '@/components/auth/user-menu'
import { createPortal } from 'react-dom'
import { BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, ChevronRight, Gauge, Grid3x3, Minus, RotateCcw, Search, Settings, SlidersHorizontal, UploadCloud, Users, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type ContractRow = [string, string, string, string, string]
type PresenceRow = [string, number, number, number]
type EmployeeRow = {
  edv: string
  name: string
  subgroup: string
  hrArea: string
  division: string
  organizationalUnit: string
  manager: string
  managerEmail: string
  contractType: 'Presencial' | 'HO Preponderante' | 'Home Office 100%'
  entries: number
  businessDays: number
  presencePercentage: number
  targetPercentage: number | null
  targetDays: number | null
  withinTarget: boolean | null
  // Um caractere por dia do mês: o = escritório, h = casa, a = ausência (IT2001), f = feriado, w = fim de semana
  calendar: string
}
type DashboardData = {
  hasData: boolean
  reference?: { year: number; month: number; monthName: string; businessDays: number; importedAt: string }
  employees: EmployeeRow[]
  targets: { subgroup: string; percentage: number }[]
  filters: null | {
    years: string[]
    months: string[]
    periods: { year: number; month: number }[]
    divisions: string[]
    organizationalUnits: string[]
    hrAreas: string[]
    subgroups: string[]
    contractTypes: string[]
  }
}

const boschLogoUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/Bosch_symbol_logo_black_red.png?version=1&modificationDate=1773863609000&api=v2'
const boschSupergraphicUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/supergraphic.jpg?version=1&modificationDate=1773863610000&api=v2'

function roundPercentage(value: number) {
  return Math.round(value * 10) / 10
}

const numberFormatter = new Intl.NumberFormat('pt-BR')
const naturalCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
const contractIndex: Record<EmployeeRow['contractType'], number> = { 'Presencial': 0, 'HO Preponderante': 1, 'Home Office 100%': 2 }

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function aggregate(employees: EmployeeRow[], selector: (employee: EmployeeRow) => string) {
  // Contagem em uma única passada: [presencial, HO preponderante, HO 100%] por grupo
  const counts = new Map<string, [number, number, number]>()
  const totals: [number, number, number] = [0, 0, 0]
  for (const employee of employees) {
    const key = selector(employee) || 'Não informado'
    const groupCounts = counts.get(key) ?? [0, 0, 0]
    groupCounts[contractIndex[employee.contractType]] += 1
    totals[contractIndex[employee.contractType]] += 1
    counts.set(key, groupCounts)
  }
  const rows = [...counts.entries()].sort(([first], [second]) => naturalCollator.compare(first, second))
  rows.push(['Total', totals])

  const share = (count: number, total: number) => total ? roundPercentage((count / total) * 100) : 0
  const contractRows: ContractRow[] = rows.map(([name, [presencial, homeOffice, homeOffice100]]) =>
    [name, formatNumber(presencial), formatNumber(homeOffice), formatNumber(homeOffice100), formatNumber(presencial + homeOffice + homeOffice100)])
  const presenceRows: PresenceRow[] = rows.map(([name, [presencial, homeOffice, homeOffice100]]) => {
    const total = presencial + homeOffice + homeOffice100
    return [name, share(presencial, total), share(homeOffice, total), share(homeOffice100, total)]
  })
  return { contracts: contractRows, presence: presenceRows }
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

type FilterKey = 'division' | 'unit' | 'area' | 'subgroup' | 'contract'
const filterKeys: FilterKey[] = ['division', 'unit', 'area', 'subgroup', 'contract']
const filterSelectors: Record<FilterKey, (employee: EmployeeRow) => string> = {
  division: employee => employee.division,
  unit: employee => employee.organizationalUnit,
  area: employee => employee.hrArea,
  subgroup: employee => employee.subgroup,
  contract: employee => employee.contractType,
}

// Marcador para "nenhuma opção selecionada" (lista vazia significa "Todos"); não corresponde a nenhum colaborador
const noneSelected = '\u0000nenhum'

// Opções que começam desmarcadas ao abrir o dashboard (podem ser marcadas depois)
const initiallyUnselected: Partial<Record<FilterKey, (value: string) => boolean>> = {
  division: value => value === 'BD',
  unit: value => {
    const normalizedValue = value.toUpperCase()
    return normalizedValue.startsWith('GS/TET') || normalizedValue.includes('BISB')
  },
  contract: value => value === 'Home Office 100%',
}

function initialFilters(employees: EmployeeRow[]) {
  const filters = { division: [] as string[], unit: [] as string[], area: [] as string[], subgroup: [] as string[], contract: [] as string[] }
  for (const key of filterKeys) {
    const isUnselected = initiallyUnselected[key]
    if (!isUnselected) continue
    const options = [...new Set(employees.map(filterSelectors[key]))]
    const selected = options.filter(option => !isUnselected(option))
    if (selected.length < options.length) filters[key] = selected.length ? selected : [noneSelected]
  }
  return filters
}

// Filtros e mês escolhidos ficam guardados na sessão (como o login): sobrevivem a recarregar a página e a ir ao Management;
// os filtros iniciais só valem ao entrar no sistema
// A versÃ£o 2 descarta uma Ãºnica vez seleÃ§Ãµes antigas que ainda incluÃ­am GS/TET e BISB.
// A partir dela, as novas escolhas continuam persistindo normalmente durante a sessÃ£o.
const dashboardStateKey = 'smart-check:dashboard:v2'
const initialExclusionsMigrationKey = 'smart-check:dashboard:initial-exclusions:bisb-v1'
type DashboardFilters = ReturnType<typeof initialFilters>
type SavedDashboardState = { filters: DashboardFilters; period?: { year: number; month: number } }
type DashboardStateRead = { saved: SavedDashboardState | null; applyInitialExclusions: boolean }

function employeeMatchesFilters(employee: EmployeeRow, filters: DashboardFilters) {
  return filterKeys.every(key => {
    const selectedValues = filters[key]
    return selectedValues.length === 0 || selectedValues.includes(filterSelectors[key](employee))
  })
}

function applyInitialExclusions(filters: DashboardFilters, employees: EmployeeRow[]) {
  const nextFilters: DashboardFilters = { ...filters }
  for (const key of filterKeys) {
    const isInitiallyUnselected = initiallyUnselected[key]
    if (!isInitiallyUnselected) continue

    const options = [...new Set(employees.map(filterSelectors[key]))]
    const currentSelection = filters[key].length === 0
      ? options
      : filters[key].filter(value => value !== noneSelected)
    const selected = currentSelection.filter(value => !isInitiallyUnselected(value))
    nextFilters[key] = selected.length === options.length ? [] : selected.length > 0 ? selected : [noneSelected]
  }
  return nextFilters
}

function readDashboardState(): DashboardStateRead {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(dashboardStateKey) ?? 'null') as SavedDashboardState | null
    const validSaved = saved && filterKeys.every(key => Array.isArray(saved.filters?.[key])) ? saved : null
    const applyInitialExclusions = window.sessionStorage.getItem(initialExclusionsMigrationKey) !== 'done'
    if (applyInitialExclusions) window.sessionStorage.setItem(initialExclusionsMigrationKey, 'done')
    return { saved: validSaved, applyInitialExclusions }
  } catch {
    return { saved: null, applyInitialExclusions: true }
  }
}

function Filter({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Enquanto há texto na busca, as opções encontradas ficam marcadas até o filtro ser aplicado,
  // exceto as que o usuário desmarcou (lembradas mesmo se o texto da busca mudar)
  const [searchExcluded, setSearchExcluded] = useState<string[]>([])
  // Como no Excel: os itens da busca podem substituir a seleção atual ou ser somados a ela
  const [addToSelection, setAddToSelection] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const sortedOptions = useMemo(() => [...new Set(options)].sort((first, second) => naturalCollator.compare(first, second)), [options])
  const matchingOptions = (text: string) => sortedOptions.filter(option => normalizeSearch(option).includes(normalizeSearch(text)))
  const visibleOptions = matchingOptions(search)
  const searching = search.trim().length > 0
  const searchSelection = searching ? visibleOptions.filter(option => !searchExcluded.includes(option)) : []

  function commitSearch(add: boolean) {
    if (!searching || searchSelection.length === 0) return
    if (add) {
      if (allSelected) return
      const merged = [...new Set([...hiddenValues, ...visibleValues, ...searchSelection])]
      onChange(merged.length === sortedOptions.length && hiddenValues.length === 0 ? [] : merged)
    } else onChange(searchSelection.length === sortedOptions.length ? [] : searchSelection)
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
      if (!containerRef.current?.contains(event.target as Node)) closeFilterRef.current(true)
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

  // Seleções fora das opções disponíveis (restritas pelos demais filtros) não aparecem nem entram na contagem,
  // mas continuam guardadas para voltar quando os outros filtros forem ampliados
  const optionSet = useMemo(() => new Set(sortedOptions), [sortedOptions])
  const visibleValues = values.filter(value => optionSet.has(value))
  const hiddenValues = values.filter(value => value !== noneSelected && !optionSet.has(value))
  const allSelected = values.length === 0
  const nothingSelected = !allSelected && visibleValues.length === 0
  const selectedCount = visibleValues.length

  function toggleAll() {
    onChange(allSelected ? [noneSelected] : [])
  }

  // Clicar nas opções não tira o foco da busca, para o Enter aplicar o filtro em vez de clicar de novo na opção
  const keepSearchFocus = (event: React.MouseEvent) => event.preventDefault()

  function updateSearch(text: string) {
    // Apagar a busca aplica os itens encontrados e volta a lista completa com essa seleção
    if (!text.trim()) {
      commitSearch(addToSelection)
      setSearchExcluded([])
    }
    setSearch(text)
  }

  function toggleOption(option: string) {
    if (searching) {
      setSearchExcluded(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option])
      return
    }
    const current = allSelected ? sortedOptions : visibleValues
    const next = current.includes(option) ? current.filter(value => value !== option) : [...current, option]
    if (next.length === sortedOptions.length && hiddenValues.length === 0) onChange([])
    else onChange(next.length + hiddenValues.length === 0 ? [noneSelected] : [...hiddenValues, ...next])
  }

  const summary = allSelected ? 'Todos' : nothingSelected ? 'Nenhum' : visibleValues.length === 1 ? visibleValues[0] : `${visibleValues.length} selecionados`

  return <div ref={containerRef} className="relative min-w-0">
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.09em] text-[#587386]">{label}</span>
    <div className="relative">
      <button type="button" onClick={() => open ? closeFilter(true) : setOpen(true)} aria-haspopup="listbox" aria-expanded={open} className={`flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white pl-3.5 text-left text-sm shadow-[0_2px_8px_rgba(31,75,103,0.04)] outline-none transition ${values.length > 0 ? 'pr-10' : 'pr-3.5'} ${open ? 'border-[#1475bd] ring-3 ring-[#1475bd]/10' : 'border-[#cfdee8] hover:border-[#9ebed2] hover:shadow-[0_4px_12px_rgba(31,75,103,0.08)]'}`}>
        <span className={`truncate ${values.length ? 'font-semibold text-[#174f74]' : 'text-[#526b7c]'}`}>{summary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {values.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[#1475bd] px-1.5 py-0.5 text-[10px] font-bold text-white">{selectedCount}</span>}
          <ChevronDown className={`size-4 text-[#6a8597] transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {values.length > 0 && <button type="button" onClick={() => onChange([])} aria-label={`Limpar filtro ${label}`} title="Limpar este filtro" className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#6a8597] transition hover:bg-[#fdecec] hover:text-[#c84d55]"><X className="size-3.5" strokeWidth={2.5} /></button>}
    </div>
    {open && <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-full min-w-[260px] overflow-hidden rounded-2xl border border-[#cfdee8] bg-white shadow-[0_18px_48px_rgba(22,61,86,0.20)]">
      <div className="border-b border-[#e3ebf0] p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7890a0]" />
          <input autoFocus value={search} onChange={event => updateSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); closeFilter(true, addToSelection || event.shiftKey) } }} placeholder="Buscar..." className="h-9 w-full rounded-lg border border-[#cfdee8] bg-[#f7fafc] pl-9 pr-3 text-sm text-[#294f68] outline-none transition placeholder:text-[#879aa7] focus:border-[#1475bd] focus:bg-white focus:ring-3 focus:ring-[#1475bd]/10" />
        </div>
      </div>
      <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
        {!search && <button type="button" onMouseDown={keepSearchFocus} onClick={toggleAll} aria-pressed={allSelected} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-[#294f68] transition hover:bg-[#eef6fb]">
          <span className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${allSelected || selectedCount > 0 ? 'border-[#1475bd] bg-[#1475bd] text-white' : 'border-[#b9cad5] bg-white'}`}>{allSelected ? <Check className="size-3" strokeWidth={3} /> : selectedCount > 0 && <Minus className="size-3" strokeWidth={3} />}</span>
          <span className="font-medium">Todos</span>
        </button>}
        {visibleOptions.map(option => {
          const selected = searching ? searchSelection.includes(option) : allSelected || visibleValues.includes(option)
          return <button key={option} type="button" role="option" aria-selected={selected} onMouseDown={keepSearchFocus} onClick={() => toggleOption(option)} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${selected ? 'bg-[#eaf4fb] text-[#125f93]' : 'text-[#3e5b6e] hover:bg-[#f3f7f9]'}`}>
            <span className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${selected ? 'border-[#1475bd] bg-[#1475bd] text-white' : 'border-[#b9cad5] bg-white'}`}>{selected && <Check className="size-3" strokeWidth={3} />}</span>
            <span className="truncate font-medium">{option}</span>
          </button>
        })}
        {visibleOptions.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">Nenhum resultado encontrado</p>}
      </div>
      {searching && visibleOptions.length > 0 && <div className="space-y-1.5 border-t border-[#e3ebf0] bg-[#f7fafc] px-3 py-2 text-[11px] text-[#587386]">
        {!allSelected && <button type="button" role="checkbox" aria-checked={addToSelection} onMouseDown={keepSearchFocus} onClick={() => setAddToSelection(current => !current)} className="flex items-center gap-2 font-medium text-[#3e5b6e]">
          <span className={`grid size-3.5 shrink-0 place-items-center rounded-[4px] border ${addToSelection ? 'border-[#1475bd] bg-[#1475bd] text-white' : 'border-[#b9cad5] bg-white'}`}>{addToSelection && <Check className="size-2.5" strokeWidth={3} />}</span>
          Adicionar à seleção atual ({selectedCount} {selectedCount === 1 ? 'item' : 'itens'})
        </button>}
        {searchSelection.length > 0 && <p>Pressione <strong>Enter</strong> para {addToSelection ? 'adicionar' : 'filtrar'} {searchSelection.length} {searchSelection.length === 1 ? 'item' : 'itens'}</p>}
      </div>}
    </div>}
  </div>
}

function KpiCard({ label, value, detail, tone, icon: Icon }: { label: string; value: string; detail: string; tone: string; icon: typeof Users }) {
  return <Card className={`relative min-w-[170px] overflow-hidden border-0 bg-white shadow-[0_10px_24px_rgba(32,91,130,0.10)] ${tone}`}><div className="absolute inset-y-0 left-0 w-1 bg-current" /><CardContent className="p-4 pl-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-700">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div><div className="grid size-9 place-items-center rounded-xl bg-slate-50 text-current"><Icon /></div></div></CardContent></Card>
}

// Cabeçalho (40px) + 10 linhas de conteúdo e a linha de total (44px cada)
const sectionHeight = 'max-h-[524px]'

const contractStyles = [
  { badge: 'bg-[#e8f6f0] text-[#21775f] ring-[#bce0d2]', bar: 'bg-[#269a7d]', text: 'text-[#17745d]' },
  { badge: 'bg-[#eaf4fb] text-[#1269a8] ring-[#c4dff0]', bar: 'bg-[#1475bd]', text: 'text-[#1269a8]' },
  { badge: 'bg-[#fdf4dc] text-[#946300] ring-[#f1dda3]', bar: 'bg-[#e0a526]', text: 'text-[#946300]' },
]

function ContractTable({ title, rows }: { title: string; rows: ContractRow[] }) {
  return <Card className="group overflow-hidden border-0 bg-white ring-1 ring-[#d8e5ee] shadow-[0_10px_30px_rgba(23,67,96,0.08)] transition duration-300 hover:ring-[#b8d4e6] hover:shadow-[0_16px_38px_rgba(23,67,96,0.13)]"><CardHeader className="relative border-b border-[#deebf3] bg-white px-5 py-4"><div className="absolute inset-y-0 left-0 w-1 bg-[#1475bd]" /><div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e7f2fa] text-[#1269a8]"><BriefcaseBusiness className="size-[18px]" /></div><div><CardTitle className="text-[15px] font-semibold tracking-tight text-[#183b56]">Tipo de contrato</CardTitle><p className="mt-0.5 text-[11px] font-medium text-slate-500">Distribuição por {title.toLowerCase()}</p></div></div></CardHeader><CardContent className={`${sectionHeight} overflow-y-auto p-0`}><table className="w-full table-fixed text-sm"><thead><tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#547086] [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:h-10 [&>th]:border-b [&>th]:border-[#dfe9f0] [&>th]:bg-[#f3f7fa]"><th className="w-[40%] px-5">{title}</th>
<th className="px-2 text-center">Presencial</th>
<th className="px-2 text-center">HO Preponderante</th>
<th className="px-2 text-center">Home Office 100%</th>
</tr></thead><tbody>{rows.map((row, index) => { const isTotal = index === rows.length - 1; return <tr key={row[0]} className={isTotal ? 'h-11 font-bold text-[#173d5a] [&>td]:sticky [&>td]:bottom-0 [&>td]:border-t-2 [&>td]:border-[#aacbe1] [&>td]:bg-[#eef5fa]' : `h-11 ${index % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfe]'} border-t border-[#e8eff4] text-[#435d70] transition-colors hover:bg-[#f0f7fc]`}><td className="truncate px-5"><span className="flex items-center gap-2.5">{!isTotal && <span className="size-1.5 shrink-0 rounded-full bg-[#45a3d2]" />}<span className="truncate">{row[0]}</span></span></td>{row.slice(1, 4).map((count, countIndex) => <td key={countIndex} className="px-2 text-center tabular-nums"><span className={isTotal ? '' : `inline-flex min-w-10 justify-center rounded-md px-2 py-1 font-semibold ring-1 ${contractStyles[countIndex].badge}`}>{count}</span></td>)}</tr> })}</tbody></table></CardContent></Card>
}

function PresenceTable({ title, rows }: { title: string; rows: PresenceRow[] }) {
  return <Card className="group overflow-hidden border-0 bg-white ring-1 ring-[#d6e7e1] shadow-[0_10px_30px_rgba(26,94,75,0.08)] transition duration-300 hover:ring-[#add6c8] hover:shadow-[0_16px_38px_rgba(26,94,75,0.13)]"><CardHeader className="relative border-b border-[#deece7] bg-white px-5 py-4"><div className="absolute inset-y-0 left-0 w-1 bg-[#269a7d]" /><div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e5f5ef] text-[#21856c]"><Gauge className="size-[18px]" /></div><div><CardTitle className="text-[15px] font-semibold tracking-tight text-[#183f37]">Tipo de contrato (%)</CardTitle><p className="mt-0.5 text-[11px] font-medium text-slate-500">Percentual de colaboradores por {title.toLowerCase()}</p></div></div></CardHeader><CardContent className={`${sectionHeight} overflow-y-auto p-0`}><table className="w-full table-fixed text-sm"><thead><tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#54746b] [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:h-10 [&>th]:border-b [&>th]:border-[#dfeae6] [&>th]:bg-[#f2f8f6]"><th className="w-[40%] px-5">{title}</th>
<th className="px-2 text-center">Presencial</th>
<th className="px-2 text-center">HO Preponderante</th>
<th className="px-2 text-center">Home Office 100%</th>
</tr></thead><tbody>{rows.map((row, index) => { const isTotal = index === rows.length - 1; return <tr key={row[0]} className={isTotal ? 'h-11 font-bold text-[#19493d] [&>td]:sticky [&>td]:bottom-0 [&>td]:border-t-2 [&>td]:border-[#a7d6c6] [&>td]:bg-[#edf7f3]' : `h-11 ${index % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'} border-t border-[#e8f0ed] text-[#435f57] transition-colors hover:bg-[#eef8f4]`}><td className="truncate px-5"><span className="flex items-center gap-2.5">{!isTotal && <span className="size-1.5 shrink-0 rounded-full bg-[#54b798]" />}<span className="truncate">{row[0]}</span></span></td>{row.slice(1).map((percentage, percentageIndex) => <td key={percentageIndex} className="px-2"><div className="flex items-center justify-center gap-2"><div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-[#e3ece9] sm:block"><div className={`h-full rounded-full ${contractStyles[percentageIndex].bar}`} style={{ width: `${Math.min(Number(percentage), 100)}%` }} /></div><span className={`min-w-11 text-right font-semibold tabular-nums ${contractStyles[percentageIndex].text}`}>{percentage}%</span></div></td>)}</tr> })}</tbody></table></CardContent></Card>
}

type PresenceGroup = { name: string; people: number; entries: number; businessDays: number; officePercentage: number }
type PresenceListMode = 'employees' | 'subgroup' | 'contract'

const presenceGroupByOptions: { key: FilterKey; label: string }[] = [
  { key: 'division', label: 'Divisão' },
  { key: 'unit', label: 'Unidade organizacional' },
  { key: 'area', label: 'Área de recursos humanos' },
  { key: 'subgroup', label: 'Subgrupo de empregados' },
  { key: 'contract', label: 'Tipo de contrato' },
]
const presenceListModes: { key: PresenceListMode; label: string }[] = [
  { key: 'employees', label: 'Pessoas' },
  { key: 'subgroup', label: 'Subgrupos' },
  { key: 'contract', label: 'Tipos de contrato' },
]
const officeColor = '#1475bd'
const homeOfficeColor = '#d3e1eb'

function officePercentage(entries: number, businessDays: number) {
  return businessDays ? Math.min(100, roundPercentage((entries / businessDays) * 100)) : 0
}

function groupPresence(employees: EmployeeRow[], selector: (employee: EmployeeRow) => string): PresenceGroup[] {
  const groups = new Map<string, PresenceGroup>()
  for (const employee of employees) {
    const name = selector(employee) || 'Não informado'
    const group = groups.get(name) ?? { name, people: 0, entries: 0, businessDays: 0, officePercentage: 0 }
    group.people += 1
    group.entries += employee.entries
    group.businessDays += employee.businessDays
    groups.set(name, group)
  }
  return [...groups.values()]
    .map(group => ({ ...group, officePercentage: officePercentage(group.entries, group.businessDays) }))
    .sort((first, second) => naturalCollator.compare(first.name, second.name))
}

function PresenceDonut({ percentage, size = 112 }: { percentage: number; size?: number }) {
  const stroke = size * 0.12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  // 2px de respiro entre os dois segmentos, quando ambos existem
  const gap = percentage > 0 && percentage < 100 ? 2 : 0
  const officeLength = Math.max(0, (percentage / 100) * circumference - gap)
  const homeLength = Math.max(0, circumference - officeLength - gap * 2)
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={homeOfficeColor} strokeWidth={stroke} strokeDasharray={`${homeLength} ${circumference}`} strokeDashoffset={-(officeLength + gap)} />
    {officeLength > 0 && <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={officeColor} strokeWidth={stroke} strokeDasharray={`${officeLength} ${circumference}`} />}
  </svg>
}

function PresenceBar({ percentage }: { percentage: number }) {
  return <div className="flex items-center gap-2">
    <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ backgroundColor: homeOfficeColor }}><div className="h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: officeColor }} /></div>
    <span className="min-w-11 text-right text-xs font-bold tabular-nums text-[#183b56]">{percentage}%</span>
  </div>
}

const calendarDayStyles: Record<string, { label: string; className: string }> = {
  o: { label: 'No escritório', className: 'bg-[#1475bd] text-white' },
  h: { label: 'Home office', className: 'bg-[#e3e9ee] text-[#4f6474]' },
  a: { label: 'Ausência (IT2001)', className: 'bg-[#fbdcde] text-[#b42330]' },
  f: { label: 'Feriado', className: 'bg-[#fbdcde] text-[#b42330]' },
  w: { label: 'Fim de semana', className: 'bg-[#fbdcde] text-[#b42330]' },
  // Viagem bTravel: em dia útil conta como presença; em fim de semana, feriado ou ausência só é sinalizada pela borda
  t: { label: 'Viagem bTravel', className: 'bg-[#7c5cc4] text-white' },
  // Serviço externo em dia útil: conta como presença
  e: { label: 'BIS - ITV', className: 'bg-[#0f8a9d] text-white' },
  E: { label: 'BIS - ITV (ausência IT2001)', className: 'bg-[#0f8a9d] text-[#ffd0d6] font-bold ring-[3px] ring-inset ring-[#f2606d]' },
  W: { label: 'Viagem bTravel (fim de semana)', className: 'bg-[#fbdcde] text-[#6a4fb3] ring-2 ring-inset ring-[#7c5cc4]' },
  F: { label: 'Viagem bTravel (feriado)', className: 'bg-[#fbdcde] text-[#6a4fb3] ring-2 ring-inset ring-[#7c5cc4]' },
  // Viagem em dia de ausência: roxo com borda e número rosa (como a ausência com entrada no escritório)
  A: { label: 'Viagem bTravel (ausência IT2001)', className: 'bg-[#7c5cc4] text-[#ffd0d6] font-bold ring-[3px] ring-inset ring-[#f2606d]' },
  // Ausência no IT2001 em dia com entrada no escritório: conta como presença
  B: { label: 'No escritório (ausência IT2001)', className: 'bg-[#1475bd] text-[#ffd0d6] font-bold ring-[3px] ring-inset ring-[#f2606d]' },
}

function EmployeeCalendar({ employee, period, onClose }: { employee: EmployeeRow; period: { year: number; month: number }; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const leadingDays = new Date(period.year, period.month - 1, 1).getDay()
  const days = [...employee.calendar]
  const count = (code: string) => days.filter(day => day === code).length
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(period.year, period.month - 1, 1))

  // Portal no body: o modal não pode ficar preso em containers com overflow ou transform
  return createPortal(<div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-50 grid place-items-center bg-[#17384f]/25 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="employee-calendar-title" className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#d8e5ee] bg-white shadow-[0_24px_70px_rgba(23,67,96,0.24)]">
      <div className="flex items-start justify-between gap-3 border-b border-[#e3ebf0] px-5 py-4">
        <div className="min-w-0"><h3 id="employee-calendar-title" className="truncate font-semibold text-[#183b56]">{employee.name}</h3><p className="mt-0.5 text-xs capitalize text-slate-500">EDV {employee.edv} · {monthLabel}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar calendário" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-[#eef6fb] hover:text-[#1475bd]"><X className="size-4" /></button>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-7 gap-1 text-center">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={index} className="py-1 text-[10px] font-bold text-slate-400">{day}</span>)}
          {Array.from({ length: leadingDays }, (_, index) => <span key={`empty-${index}`} />)}
          {days.map((code, index) => <span key={index} title={`${String(index + 1).padStart(2, '0')}/${String(period.month).padStart(2, '0')}: ${calendarDayStyles[code]?.label ?? ''}`} className={`grid aspect-square place-items-center rounded-lg text-sm font-semibold tabular-nums ${calendarDayStyles[code]?.className ?? ''}`}>{index + 1}</span>)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-[#425d70]">
          <span className="flex items-center gap-2"><span className="size-3 rounded bg-[#1475bd]" />No escritório: <strong className="tabular-nums">{count('o') + count('B')}</strong></span>
          <span className="flex items-center gap-2"><span className="size-3 rounded bg-[#e3e9ee]" />Home Office: <strong className="tabular-nums">{count('h')}</strong></span>
          <span className="flex items-center gap-2"><span className="size-3 rounded bg-[#fbdcde]" />Ausência: <strong className="tabular-nums">{count('a') + count('A') + count('B') + count('E')}</strong></span>
          <span className="flex items-center gap-2"><span className="size-3 rounded bg-[#fbdcde]" />Feriado: <strong className="tabular-nums">{count('f') + count('F')}</strong></span>
          <span className="flex items-center gap-2" title="Dias úteis em viagem, inclusive os que também têm entrada no escritório"><span className="size-3 rounded bg-[#7c5cc4]" />Viagem bTravel: <strong className="tabular-nums">{count('t')}</strong></span>
          <span className="flex items-center gap-2" title="Dias úteis com registro no BIS - ITV, sem entrada no escritório nem viagem, inclusive com ausência no IT2001"><span className="size-3 rounded bg-[#0f8a9d]" />BIS - ITV: <strong className="tabular-nums">{count('e') + count('E')}</strong></span>
          <span className="flex items-center gap-2" title="Viagem em fim de semana ou feriado: não conta como presença"><span className="size-3 rounded bg-[#fbdcde] ring-2 ring-inset ring-[#7c5cc4]" />Viagem em dia não útil: <strong className="tabular-nums">{count('W') + count('F')}</strong></span>
          <span className="flex items-center gap-2" title="Viagem em dia com ausência no IT2001: não conta como presença"><span className="size-3 rounded bg-[#7c5cc4] ring-2 ring-inset ring-[#f2606d]" />Viagem com ausência: <strong className="tabular-nums">{count('A')}</strong></span>
          <span className="flex items-center gap-2" title="Dia com ausência no IT2001 e entrada no escritório: sai dos dias úteis, mas a entrada conta presença"><span className="size-3 rounded bg-[#1475bd] ring-2 ring-inset ring-[#f2606d]" />Ausência com entrada: <strong className="tabular-nums">{count('B')}</strong></span>
          <span className="flex items-center gap-2" title="BIS - ITV em dia com ausência no IT2001: não conta como presença"><span className="size-3 rounded bg-[#0f8a9d] ring-2 ring-inset ring-[#f2606d]" />BIS com ausência: <strong className="tabular-nums">{count('E')}</strong></span>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Presença no escritório: <strong className="text-[#183b56]">{employee.presencePercentage}%</strong> ({employee.entries} de {employee.businessDays} dias úteis).</p>
      </div>
    </div>
  </div>, document.body)
}

// Escala sequencial de um só tom (azul claro → escuro) para a intensidade de presença
function heatColor(percentage: number) {
  const light = [232, 241, 248]
  const dark = [11, 79, 134]
  const ratio = Math.max(0, Math.min(1, percentage / 100))
  return `rgb(${light.map((channel, index) => Math.round(channel + (dark[index] - channel) * ratio)).join(', ')})`
}

function PresenceHeatmap({ title, subtitle, employees, period, onClose }: { title: string; subtitle: string; employees: EmployeeRow[]; period: { year: number; month: number }; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Por dia: quantos estavam no escritório entre os que estavam disponíveis (escritório ou home office)
  const daysInMonth = new Date(period.year, period.month, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    let office = 0
    let available = 0
    for (const employee of employees) {
      const code = employee.calendar[index]
      // Viagem e serviço externo em dia útil contam como presença
      if (code === 'o' || code === 't' || code === 'e' || code === 'B') office += 1
      if (code === 'o' || code === 't' || code === 'e' || code === 'B' || code === 'h') available += 1
    }
    return { day: index + 1, weekday: new Date(period.year, period.month - 1, index + 1).getDay(), office, available, percentage: available ? roundPercentage((office / available) * 100) : null }
  })
  const weekdays = [1, 2, 3, 4, 5].map(weekday => {
    const matching = days.filter(day => day.weekday === weekday && day.available > 0)
    const office = matching.reduce((sum, day) => sum + day.office, 0)
    const available = matching.reduce((sum, day) => sum + day.available, 0)
    return { weekday, percentage: available ? roundPercentage((office / available) * 100) : 0 }
  })
  const busiest = Math.max(...weekdays.map(weekday => weekday.percentage))
  const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const leadingDays = new Date(period.year, period.month - 1, 1).getDay()
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(period.year, period.month - 1, 1))

  return createPortal(<div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-50 grid place-items-center bg-[#17384f]/25 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="presence-heatmap-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d8e5ee] bg-white shadow-[0_24px_70px_rgba(23,67,96,0.24)]">
      <div className="flex items-start justify-between gap-3 border-b border-[#e3ebf0] px-5 py-4">
        <div className="min-w-0"><h3 id="presence-heatmap-title" className="truncate font-semibold text-[#183b56]">Mapa de calor · {title}</h3><p className="mt-0.5 text-xs capitalize text-slate-500">{subtitle} · {formatNumber(employees.length)} {employees.length === 1 ? 'pessoa' : 'pessoas'} · {monthLabel}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar mapa de calor" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-[#eef6fb] hover:text-[#1475bd]"><X className="size-4" /></button>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-7 gap-1 text-center">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={index} className="py-1 text-[10px] font-bold text-slate-400">{day}</span>)}
          {Array.from({ length: leadingDays }, (_, index) => <span key={`empty-${index}`} />)}
          {days.map(day => {
            const date = `${String(day.day).padStart(2, '0')}/${String(period.month).padStart(2, '0')}`
            if (day.percentage === null) return <span key={day.day} title={`${date}: sem expediente`} className="grid aspect-square place-items-center rounded-lg bg-[#f4f6f8] text-xs font-semibold text-slate-300">{day.day}</span>
            return <span key={day.day} title={`${date}: ${formatNumber(day.office)} de ${formatNumber(day.available)} pessoas no escritório (${day.percentage}%)`} className="flex aspect-square flex-col items-center justify-center rounded-lg leading-none" style={{ backgroundColor: heatColor(day.percentage), color: day.percentage >= 55 ? '#ffffff' : '#183b56' }}>
              <span className="text-xs font-semibold tabular-nums">{day.day}</span>
              <span className="mt-0.5 text-[9px] font-medium tabular-nums opacity-90">{Math.round(day.percentage)}%</span>
            </span>
          })}
        </div>
        <div className="mx-auto mt-3 flex w-4/5 items-center gap-2 text-[10px] text-slate-500">
          <span>0%</span>
          <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(100)})` }} />
          <span>100%</span>
        </div>
        <div className="mt-4 border-t border-[#eef3f6] pt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#587386]">Média por dia da semana</p>
          <div className="space-y-1.5">
            {weekdays.map(weekday => <div key={weekday.weekday} className="flex items-center gap-2 text-xs">
              <span className={`w-8 ${weekday.percentage === busiest && busiest > 0 ? 'font-bold text-[#183b56]' : 'text-slate-500'}`}>{weekdayNames[weekday.weekday]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef3f6]"><div className="h-full rounded-full bg-[#1475bd]" style={{ width: `${weekday.percentage}%` }} /></div>
              <span className="w-11 text-right font-semibold tabular-nums text-[#183b56]">{weekday.percentage}%</span>
            </div>)}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Percentual de pessoas de {title} no escritório em cada dia útil.</p>
      </div>
    </div>
  </div>, document.body)
}

function PresenceOverview({ employees, period, groupBy, onGroupByChange: setGroupBy }: { employees: EmployeeRow[]; period: { year: number; month: number }; groupBy: FilterKey; onGroupByChange: (groupBy: FilterKey) => void }) {
  const [heatmapOpen, setHeatmapOpen] = useState(false)
  const closeHeatmap = useCallback(() => setHeatmapOpen(false), [])
  const [calendarEmployee, setCalendarEmployee] = useState<EmployeeRow | null>(null)
  const closeCalendar = useCallback(() => setCalendarEmployee(null), [])
  const [listMode, setListMode] = useState<PresenceListMode>('employees')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const groups = useMemo(() => groupPresence(employees, filterSelectors[groupBy]), [employees, groupBy])
  // Sem grupo selecionado, o painel da direita mostra a visão geral (todos os colaboradores dos filtros do cabeçalho)
  const activeGroup = groups.find(group => group.name === selectedGroup) ?? null
  const groupLabel = presenceGroupByOptions.find(option => option.key === groupBy)!.label
  const groupEmployees = useMemo(() => (activeGroup
    ? employees.filter(employee => (filterSelectors[groupBy](employee) || 'Não informado') === activeGroup.name)
    : [...employees]).sort((first, second) => naturalCollator.compare(first.name, second.name)), [employees, groupBy, activeGroup])
  const panelTitle = activeGroup?.name ?? 'Visão geral'
  const panelPercentage = activeGroup?.officePercentage ?? officePercentage(
    employees.reduce((sum, employee) => sum + employee.entries, 0),
    employees.reduce((sum, employee) => sum + employee.businessDays, 0),
  )

  // Clicar fora dos gráficos, do painel da direita e dos modais tira a seleção do grupo
  const detailPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element
      if (target.closest('[data-presence-group]') || detailPanelRef.current?.contains(target) || target.closest('[role="dialog"], [role="presentation"]')) return
      setSelectedGroup(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])
  const listGroups = useMemo(() => listMode === 'employees' ? [] : groupPresence(groupEmployees, filterSelectors[listMode]), [groupEmployees, listMode])

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
    <Card className="overflow-hidden border-0 bg-white ring-1 ring-[#d8e5ee] shadow-[0_10px_30px_rgba(23,67,96,0.08)]">
      <CardHeader className="relative border-b border-[#deebf3] bg-white px-5 py-4">
        <div className="absolute inset-y-0 left-0 w-1 bg-[#1475bd]" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e7f2fa] text-[#1269a8]"><Building2 className="size-[18px]" /></div>
            <div><CardTitle className="text-[15px] font-semibold tracking-tight text-[#183b56]">Presença no escritório por {groupLabel.toLowerCase()}</CardTitle><p className="mt-0.5 text-[11px] font-medium text-slate-500">Dias no escritório sobre os dias úteis disponíveis · clique em um gráfico para ver o detalhe</p></div>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#587386]">Ver por
            <select value={groupBy} onChange={event => { setGroupBy(event.target.value as FilterKey); setSelectedGroup(null) }} className="h-9 rounded-lg border border-[#cfdee8] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#183b56] outline-none focus:border-[#1475bd]">
              {presenceGroupByOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-[#425d70]">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ backgroundColor: officeColor }} />No escritório</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ backgroundColor: homeOfficeColor }} />Home office</span>
        </div>
      </CardHeader>
      <CardContent className="max-h-[640px] overflow-y-auto p-4">
        {groups.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">Nenhum colaborador para os filtros selecionados.</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map(group => {
            const selected = group.name === activeGroup?.name
            return <button key={group.name} type="button" data-presence-group onClick={() => setSelectedGroup(current => current === group.name ? null : group.name)} title={`${group.name}: ${group.officePercentage}% no escritório · ${roundPercentage(100 - group.officePercentage)}% home office · ${formatNumber(group.people)} ${group.people === 1 ? 'pessoa' : 'pessoas'}`} className={`flex flex-col items-center rounded-xl border p-3 text-center transition ${selected ? 'border-[#1475bd] bg-[#f0f7fc] ring-2 ring-[#1475bd]/15' : 'border-[#e3ecf2] bg-white hover:border-[#b9d3e4] hover:bg-[#f8fbfd]'}`}>
              <span className="relative grid place-items-center">
                <PresenceDonut percentage={group.officePercentage} />
                <span className="absolute flex flex-col items-center"><span className="text-lg font-bold tabular-nums text-[#183b56]">{group.officePercentage}%</span><span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">escritório</span></span>
              </span>
              <span className="mt-2 w-full truncate text-sm font-semibold text-[#183b56]">{group.name}</span>
              <span className="text-[11px] text-slate-500">{formatNumber(group.people)} {group.people === 1 ? 'pessoa' : 'pessoas'}</span>
            </button>
          })}
        </div>}
      </CardContent>
    </Card>

    <div ref={detailPanelRef} className="min-w-0"><Card className="overflow-hidden border-0 bg-white ring-1 ring-[#d8e5ee] shadow-[0_10px_30px_rgba(23,67,96,0.08)]">
      <CardHeader className="relative border-b border-[#deebf3] bg-white px-5 py-4">
        <div className="absolute inset-y-0 left-0 w-1 bg-[#269a7d]" />
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#587386]">{activeGroup ? groupLabel : "Todos os colaboradores filtrados"}</p>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <CardTitle className="truncate text-[15px] font-semibold tracking-tight text-[#183b56]">{panelTitle}</CardTitle>
          {groupEmployees.length > 0 && <span className="shrink-0 text-xs text-slate-500"><strong className="text-[#1475bd]">{panelPercentage}%</strong> escritório · {roundPercentage(100 - panelPercentage)}% home office</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex w-fit gap-1 rounded-lg border border-[#d6e5ef] bg-[#f6f9fb] p-1">
            {presenceListModes.map(mode => <button key={mode.key} type="button" onClick={() => setListMode(mode.key)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${listMode === mode.key ? 'bg-white text-[#1475bd] shadow-sm' : 'text-slate-500 hover:text-[#183b56]'}`}>{mode.label}</button>)}
          </div>
          <button type="button" onClick={() => setHeatmapOpen(true)} disabled={groupEmployees.length === 0} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[#d6e5ef] bg-white px-3 text-xs font-semibold text-[#1475bd] transition hover:bg-[#eaf4fb] disabled:opacity-40"><Grid3x3 className="size-3.5" /> Mapa de calor</button>
        </div>
      </CardHeader>
      <CardContent className="max-h-[588px] overflow-y-auto p-0">
        {listMode === 'employees'
          ? groupEmployees.map(employee => <div key={employee.edv} className="flex items-center justify-between gap-3 border-b border-[#eef3f6] px-5 py-2.5 last:border-b-0">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#183b56]">{employee.name}</p><p className="text-[11px] text-slate-500">EDV {employee.edv} · {employee.entries} de {employee.businessDays} dias úteis</p></div>
            <div className="flex shrink-0 items-center gap-1.5">
              <PresenceBar percentage={employee.presencePercentage} />
              <button type="button" onClick={() => setCalendarEmployee(employee)} aria-label={`Ver calendário de ${employee.name}`} title="Ver dias do mês" className="grid size-7 place-items-center rounded-md text-[#6a8597] transition hover:bg-[#eaf4fb] hover:text-[#1475bd]"><CalendarDays className="size-4" /></button>
            </div>
          </div>)
          : listGroups.map(group => <div key={group.name} className="flex items-center justify-between gap-3 border-b border-[#eef3f6] px-5 py-2.5 last:border-b-0">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#183b56]">{group.name}</p><p className="text-[11px] text-slate-500">{formatNumber(group.people)} {group.people === 1 ? 'pessoa' : 'pessoas'}</p></div>
            <PresenceBar percentage={group.officePercentage} />
          </div>)}
        {groupEmployees.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Nenhum colaborador para os filtros selecionados.</p>}
      </CardContent>
    </Card></div>
    {calendarEmployee && <EmployeeCalendar employee={calendarEmployee} period={period} onClose={closeCalendar} />}
    {heatmapOpen && <PresenceHeatmap title={panelTitle} subtitle={activeGroup ? groupLabel : "Todos os colaboradores filtrados"} employees={groupEmployees} period={period} onClose={closeHeatmap} />}
  </div>
}

// Ocupa a largura da janela (menos as margens laterais da página), centralizado, mesmo dentro do conteúdo limitado
function FullWidth({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    function update() {
      const viewport = document.documentElement.clientWidth
      setWidth(viewport - (viewport >= 1024 ? 64 : 40))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return <div className="relative left-1/2 -translate-x-1/2" style={{ width: width ?? '100%' }}>{children}</div>
}

const employeeRowHeight = 52
const employeeViewportRows = 10
const employeeOverscanRows = 8

type TargetFilter = 'all' | 'below' | 'met'

function EmployeeTable({ employees: visibleEmployees, search, onSearchChange, period, targetFilter, onTargetFilterChange, targetCounts }: { employees: EmployeeRow[]; search: string; onSearchChange: (search: string) => void; period: { year: number; month: number }; targetFilter: TargetFilter; onTargetFilterChange: (filter: TargetFilter) => void; targetCounts: { below: number; met: number } }) {
  // "Não conforme ao contrato" deixa a tabela em tons de vermelho para evidenciar quem não cumpriu
  const belowMode = targetFilter === 'below'
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [calendarEmployee, setCalendarEmployee] = useState<EmployeeRow | null>(null)
  const closeCalendar = useCallback(() => setCalendarEmployee(null), [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [visibleEmployees])

  // Renderiza apenas as linhas visíveis (mais uma margem); o restante é representado por espaçadores
  const firstRow = Math.max(0, Math.floor(scrollTop / employeeRowHeight) - employeeOverscanRows)
  const lastRow = Math.min(visibleEmployees.length, firstRow + employeeViewportRows + employeeOverscanRows * 2)
  const renderedEmployees = visibleEmployees.slice(firstRow, lastRow)

  return <Card className={`overflow-hidden border-0 bg-white shadow-[0_14px_38px_rgba(23,67,96,0.10)] ring-1 transition ${belowMode ? 'ring-[#e9a3a9] shadow-[0_14px_38px_rgba(180,35,48,0.14)]' : 'ring-[#d8e5ee]'}`}><CardHeader className={`relative border-b px-6 py-5 ${belowMode ? 'border-[#f3cfd2] bg-[#fff6f6]' : 'border-[#dce8f0] bg-white'}`}><div className={`absolute inset-y-0 left-0 w-1 ${belowMode ? 'bg-[#c4303c]' : 'bg-[#1475bd]'}`} /><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#e7f2fa] text-[#1269a8]"><Users className="size-5" /></div><div><div className="flex items-center gap-2"><CardTitle className="text-[15px] font-semibold tracking-tight text-[#183b56]">Detalhamento dos colaboradores</CardTitle>
<span className="rounded-full bg-[#edf4f8] px-2 py-0.5 text-[11px] font-bold text-[#4d6b80]">{formatNumber(visibleEmployees.length)} registros</span>
</div><p className="mt-0.5 text-[11px] font-medium text-slate-500">Dados consolidados dos arquivos importados</p></div></div><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><button type="button" onClick={() => onTargetFilterChange(targetFilter === 'below' ? 'all' : 'below')} aria-pressed={targetFilter === 'below'} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-xs font-semibold transition ${targetFilter === 'below' ? 'border-[#c4303c] bg-[#c4303c] text-white shadow-sm' : 'border-[#efc3c7] bg-[#fff5f5] text-[#b42330] hover:bg-[#fdeaec]'}`}><X className="size-3.5" strokeWidth={2.5} />Não conforme ao contrato<span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${targetFilter === 'below' ? 'bg-white/20 text-white' : 'bg-[#fbdcde] text-[#b42330]'}`}>{formatNumber(targetCounts.below)}</span></button><button type="button" onClick={() => onTargetFilterChange(targetFilter === 'met' ? 'all' : 'met')} aria-pressed={targetFilter === 'met'} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-xs font-semibold transition ${targetFilter === 'met' ? 'border-[#1475bd] bg-[#1475bd] text-white shadow-sm' : 'border-[#c4dff0] bg-[#f2f8fc] text-[#1269a8] hover:bg-[#e6f2fa]'}`}><Check className="size-3.5" strokeWidth={2.5} />Conforme ao contrato<span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${targetFilter === 'met' ? 'bg-white/20 text-white' : 'bg-[#dbeef9] text-[#1269a8]'}`}>{formatNumber(targetCounts.met)}</span></button><div className="relative w-full sm:w-80"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#638096]" /><Input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Pesquisar por EDV ou nome" className="h-10 rounded-lg border-[#c8dae7] bg-[#f8fbfd] pl-10 pr-9 text-sm text-black shadow-none placeholder:text-slate-500" />{search && <button type="button" onClick={() => onSearchChange('')} aria-label="Limpar pesquisa" title="Limpar pesquisa" className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#6a8597] transition hover:bg-[#fdecec] hover:text-[#c84d55]"><X className="size-3.5" strokeWidth={2.5} /></button>}</div></div></div></CardHeader><CardContent className="p-0"><div ref={scrollRef} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} className="max-h-[564px] overflow-auto"><table className="w-full text-xs"><thead><tr className={`text-left text-[10px] font-bold uppercase tracking-[0.07em] [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:h-11 [&>th]:border-b ${belowMode ? 'text-[#9b3a43] [&>th]:border-[#f3cfd2] [&>th]:bg-[#fdf0f1]' : 'text-[#506f84] [&>th]:border-[#d9e6ee] [&>th]:bg-[#f1f6f9]'}`}>{['EDV', 'Colaborador', 'Subgrupo', 'Área de rec. humanos', 'Unid. org.', 'Gestor disciplinar', 'Email do gestor', 'Tipo de contrato', 'Entradas', 'Dias úteis', 'Presença', 'Status', ''].map(header => <th key={header} className="whitespace-nowrap px-4">{header}</th>)}</tr></thead><tbody>{firstRow > 0 && <tr aria-hidden="true" style={{ height: firstRow * employeeRowHeight }} />}{renderedEmployees.map((employee, renderedIndex) => { const rowIndex = firstRow + renderedIndex; const initials = employee.name.split(' ').map(part => part[0]).slice(0, 2).join(''); return <tr key={employee.edv} style={{ height: employeeRowHeight }} className={`${belowMode ? (rowIndex % 2 === 0 ? 'bg-[#fffafa]' : 'bg-[#fff3f4]') + ' border-[#f6dfe1] hover:bg-[#fde8ea]' : (rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfe]') + ' border-[#e7eef3] hover:bg-[#eef6fb]'} border-t text-[#425d70] transition-colors [&>td]:py-0`}><td className="whitespace-nowrap px-4"><span className="rounded-md bg-[#edf3f7] px-2 py-1 font-mono text-[11px] font-semibold text-[#35566d]">{employee.edv}</span></td><td className="whitespace-nowrap px-4 py-3"><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-full bg-[#dfeef7] text-[10px] font-bold text-[#1269a8]">{initials}</span><span className="font-semibold text-[#183b56]">{employee.name}</span></div></td><td className="whitespace-nowrap px-4 py-3"><span className="inline-flex min-w-8 justify-center rounded-md bg-[#eaf4fb] px-2 py-1 font-bold text-[#1269a8]">{employee.subgroup}</span></td><td className="whitespace-nowrap px-4 py-3">{employee.hrArea}</td><td className="whitespace-nowrap px-4 py-3 font-semibold text-[#294f68]">{employee.organizationalUnit}</td><td className="whitespace-nowrap px-4 py-3">{employee.manager}</td><td className="whitespace-nowrap px-4 py-3 text-[#426f8d]">{employee.managerEmail || '—'}</td><td className="whitespace-nowrap px-4 py-3"><span className={
employee.contractType === 'Presencial'
 ? 'rounded-md bg-[#e8f6f0] px-2.5 py-1 font-semibold text-[#21775f]' : 'rounded-md bg-[#f0f3f5] px-2.5 py-1 font-semibold text-[#587080]'}>{employee.contractType}</span></td><td className="px-4 py-3 text-center font-bold tabular-nums text-[#183b56]">{employee.entries}</td><td className="px-4 py-3 text-center tabular-nums">{employee.businessDays}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#dce7ec]"><div className={employee.withinTarget === false ? 'h-full rounded-full bg-[#d88442]' : 'h-full rounded-full bg-[#269a7d]'} style={{ width: `${Math.min(employee.presencePercentage, 100)}%` }} /></div><span className={employee.withinTarget === false ? 'min-w-10 font-bold tabular-nums text-[#b66326]' : 'min-w-10 font-bold tabular-nums text-[#21775f]'}>{employee.presencePercentage}%</span></div></td><td className="whitespace-nowrap px-4 py-3">{employee.withinTarget === null ? <Badge className="border border-[#d7e1e7] bg-[#f3f6f8] text-[#607582]">Conformidade não definida</Badge> : <Badge className={employee.withinTarget ? 'border border-[#bce0d2] bg-[#e8f6f0] px-2.5 py-1 text-[#21775f]' : 'border border-[#efd2ba] bg-[#fff4e9] px-2.5 py-1 text-[#b66326]'}>{employee.withinTarget ? <Check data-icon="inline-start" /> : <X data-icon="inline-start" />}{employee.withinTarget ? 'Conforme ao contrato' : 'Não conforme ao contrato'}</Badge>}</td><td className="px-2"><button type="button" onClick={() => setCalendarEmployee(employee)} aria-label={`Ver calendário de ${employee.name}`} title="Ver dias do mês" className="grid size-7 place-items-center rounded-md text-[#6a8597] transition hover:bg-[#eaf4fb] hover:text-[#1475bd]"><CalendarDays className="size-4" /></button></td></tr> })}{lastRow < visibleEmployees.length && <tr aria-hidden="true" style={{ height: (visibleEmployees.length - lastRow) * employeeRowHeight }} />}</tbody></table></div></CardContent>{calendarEmployee && <EmployeeCalendar employee={calendarEmployee} period={period} onClose={closeCalendar} />}</Card>
}

type StatusData = {
  year: number | null
  months: { month: number; rows: number[][] }[]
  dictionaries: Record<'division' | 'organizationalUnit' | 'hrArea' | 'subgroup' | 'contractType', string[]> | null
}
type StatusSeries = { name: string; values: Map<number, number>; average: number; monthsOnTarget: number; people: number }

// Meta de presença: M-Group tem meta própria, mais alta
const statusTarget = 60
const mGroupStatusTarget = 80
const statusMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
// Barras por área de RH: a cor indica a meta (o nome da área já identifica cada gráfico)
const statusBarOnTarget = '#007bc0'
const statusBarBelowTarget = '#b7cad8'
// Coluna de cada filtro nas linhas do histórico: [divisão, unidade, área, subgrupo, contrato, entradas, dias úteis]
const statusFilterColumns: Record<FilterKey, number> = { division: 0, unit: 1, area: 2, subgroup: 3, contract: 4 }

// Cores de referência Bosch: azul #007bc0, azul-escuro #004975, verde #00884a, vermelho #c4303c
const boschBlue = '#007bc0'
const boschDarkBlue = '#004975'
const boschGreen = '#00884a'
const boschRed = '#c4303c'

function statusCellStyle(value: number, target: number) {
  if (value >= target) return 'bg-[#00884a] text-white'
  if (value >= target - 2) return 'bg-[#cdebd8] text-[#0f5132]'
  return 'bg-[#eef1f4] text-[#4a5966]'
}

function buildStatusSeries(months: { month: number; rows: number[][] }[], column: number, names: string[], target: number): StatusSeries[] {
  // people: quantidade de pessoas no mês mais recente em que o grupo tem dados
  const groups = new Map<number, { totals: Map<number, [number, number]>; people: number; peopleMonth: number }>()
  for (const { month, rows } of months) {
    for (const row of rows) {
      const group = groups.get(row[column]) ?? { totals: new Map(), people: 0, peopleMonth: month }
      const totals = group.totals.get(month) ?? [0, 0]
      totals[0] += row[5]
      totals[1] += row[6]
      group.totals.set(month, totals)
      if (month > group.peopleMonth) {
        group.peopleMonth = month
        group.people = 0
      }
      if (month === group.peopleMonth) group.people += 1
      groups.set(row[column], group)
    }
  }
  return [...groups.entries()].map(([index, group]) => {
    const values = new Map([...group.totals].filter(([, [, businessDays]]) => businessDays > 0).map(([month, [entries, businessDays]]) => [month, officePercentage(entries, businessDays)]))
    const percentages = [...values.values()]
    return {
      name: names[index],
      values,
      average: percentages.length ? roundPercentage(percentages.reduce((sum, value) => sum + value, 0) / percentages.length) : 0,
      monthsOnTarget: percentages.filter(value => value >= target).length,
      people: group.people,
    }
  }).sort((first, second) => second.average - first.average || naturalCollator.compare(first.name, second.name))
}

function StatusCard({ title, subtitle, actions, children, className = '' }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <Card className={`overflow-hidden border-0 bg-white ring-1 ring-[#dfe6ec] shadow-[0_1px_2px_rgba(16,40,60,0.04),0_8px_24px_rgba(16,40,60,0.06)] ${className}`}>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-[#edf1f4] px-6 py-4">
      <div>
        <CardTitle className="text-[15px] font-semibold tracking-tight text-[#1a2b3a]">{title}</CardTitle>
        {subtitle && <p className="mt-0.5 text-[11px] font-medium text-[#6b7a87]">{subtitle}</p>}
      </div>
      {actions}
    </CardHeader>
    <CardContent className="px-6 py-5">{children}</CardContent>
  </Card>
}

function StatusLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-[#4a5966]">
    {items.map(item => <span key={item.label} className="flex items-center gap-1.5">
      {item.dashed
        ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: item.color }} />
        : <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: item.color }} />}
      {item.label}
    </span>)}
  </div>
}

function StatusLineChart({ points, target }: { points: { month: number; value: number }[]; target: number }) {
  const width = 720
  const height = 250
  const padding = { top: 28, right: 24, bottom: 32, left: 40 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const values = points.map(point => point.value)
  const minimum = Math.max(0, Math.floor((Math.min(target, ...values) - 10) / 10) * 10)
  const maximum = Math.min(100, Math.ceil((Math.max(target, ...values) + 5) / 10) * 10)
  // Pontos centralizados em faixas iguais: com poucos meses o gráfico não fica espalhado
  const slot = plotWidth / Math.max(points.length, 1)
  const x = (index: number) => padding.left + slot * index + slot / 2
  const y = (value: number) => padding.top + ((maximum - value) / (maximum - minimum || 1)) * plotHeight
  const gridValues = Array.from({ length: Math.floor((maximum - minimum) / 10) + 1 }, (_, index) => minimum + index * 10)
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ')
  const areaPath = points.length > 1 ? `${linePath} L${x(points.length - 1)},${padding.top + plotHeight} L${x(0)},${padding.top + plotHeight} Z` : ''
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Média mensal de presença no escritório">
    <defs>
      <linearGradient id="status-area" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor={boschBlue} stopOpacity={0.16} />
        <stop offset="100%" stopColor={boschBlue} stopOpacity={0} />
      </linearGradient>
    </defs>
    {gridValues.map(value => <g key={value}>
      <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} stroke="#edf1f4" strokeWidth={1} />
      <text x={padding.left - 10} y={y(value) + 4} textAnchor="end" className="fill-[#8a97a3] text-[11px]">{value}%</text>
    </g>)}
    <line x1={padding.left} x2={width - padding.right} y1={y(target)} y2={y(target)} stroke={boschGreen} strokeWidth={1.5} strokeDasharray="6 5" />
    {areaPath && <path d={areaPath} fill="url(#status-area)" />}
    {points.length > 1 && <path d={linePath} fill="none" stroke={boschDarkBlue} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
    {points.map((point, index) => <g key={point.month}>
      <title>{`${statusMonthNames[point.month - 1]}: ${point.value}%`}</title>
      <rect x={x(index) - slot / 2} y={padding.top} width={slot} height={plotHeight} fill="transparent" />
      <circle cx={x(index)} cy={y(point.value)} r={5} fill={point.value >= target ? boschDarkBlue : boschRed} stroke="#ffffff" strokeWidth={2.5} />
      <text x={x(index)} y={y(point.value) - 12} textAnchor="middle" stroke="#ffffff" strokeWidth={4} paintOrder="stroke" className="fill-[#1a2b3a] text-[12px] font-semibold">{Math.round(point.value)}%</text>
      <text x={x(index)} y={height - 8} textAnchor="middle" className="fill-[#6b7a87] text-[11.5px] font-medium">{statusMonthNames[point.month - 1]}</text>
    </g>)}
  </svg>
}

// Nome da unidade com o prefixo da divisão apagado (ex.: GS/HRS1 → GS/ em cinza + HRS1)
function UnitName({ name, parent }: { name: string; parent: string }) {
  const prefix = `${parent}/`
  if (!name.toUpperCase().startsWith(prefix.toUpperCase()) || name.length === prefix.length) return <>{name}</>
  return <><span className="text-[#9aa7b2]">{name.slice(0, prefix.length)}</span>{name.slice(prefix.length)}</>
}

function StatusHeatTable({ title, label, series, months, target, childSeries, childLabel = 'itens' }: { title: string; label: string; series: StatusSeries[]; months: number[]; target: number; childSeries?: Map<string, StatusSeries[]>; childLabel?: string }) {
  const firstBelow = series.findIndex(item => item.average < target)
  // Linhas abertas pela setinha (todas começam fechadas)
  const [expanded, setExpanded] = useState<string[]>([])
  const expandable = childSeries ? series.filter(item => (childSeries.get(item.name)?.length ?? 0) > 0).map(item => item.name) : []
  const allExpanded = expandable.length > 0 && expandable.every(name => expanded.includes(name))
  const toggle = (name: string) => setExpanded(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])

  function renderRow(item: StatusSeries, options: { separator: boolean; child?: { parent: string; last: boolean }; open?: boolean; childCount?: number }) {
    const { separator, child } = options
    const separatorClass = separator ? 'border-t border-[#c3ced8] pt-2' : ''
    // Unidades: células menores e mais claras, para ficar visível que estão dentro da divisão
    const cellSize = child ? 'h-7 w-14 rounded-[5px] text-[12px]' : 'h-8 w-14 rounded-[6px] text-[13px]'
    return <tr key={child ? `${child.parent}|${item.name}` : item.name} className={child ? 'group/unit' : ''}>
      <td className={`sticky left-0 z-10 whitespace-nowrap bg-white pr-4 ${separatorClass}`} title={`${formatNumber(item.people)} pessoas no último mês`}>
        {child
          ? <div className="relative flex h-7 items-center pl-9 text-[12.5px] font-medium text-[#3d4f5e]">
            {/* Linha da árvore: liga cada unidade à divisão acima */}
            <span aria-hidden="true" className={`absolute left-[13px] top-[-4px] w-px bg-[#cbd6df] ${child.last ? 'h-[calc(50%+4px)]' : 'bottom-[-4px]'}`} />
            <span aria-hidden="true" className="absolute left-[13px] top-1/2 h-px w-4 bg-[#cbd6df]" />
            <span className="truncate"><UnitName name={item.name} parent={child.parent} /></span>
          </div>
          : options.childCount
            ? <button type="button" onClick={() => toggle(item.name)} aria-expanded={options.open} aria-label={`${options.open ? 'Fechar' : 'Abrir'} ${childLabel} de ${item.name}`} className="group flex items-center gap-1.5 rounded-md py-1 pr-2 text-left font-semibold text-[#1a2b3a] transition hover:text-[#005691]">
              <span className={`grid size-[22px] place-items-center rounded-md transition ${options.open ? 'bg-[#e8f1f8] text-[#005691]' : 'text-[#8a97a3] group-hover:bg-[#f1f5f8]'}`}><ChevronRight className={`size-3.5 transition-transform duration-200 ${options.open ? 'rotate-90' : ''}`} strokeWidth={2.5} /></span>
              {item.name}
              <span className={`ml-1 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums transition ${options.open ? 'bg-[#e8f1f8] text-[#005691]' : 'bg-[#f1f3f5] text-[#8a97a3]'}`}>{options.childCount}</span>
            </button>
            : <span className="flex items-center gap-1.5 py-1 font-semibold text-[#1a2b3a]">{childSeries && <span className="size-[22px]" />}{item.name}</span>}
      </td>
      {months.map(month => {
        const value = item.values.get(month)
        return <td key={month} className={separatorClass}>{value === undefined
          ? <span className={`grid ${cellSize} place-items-center text-[#c3ced8]`}>—</span>
          : <span title={`${item.name} · ${statusMonthNames[month - 1]}: ${value}%`} className={`grid ${cellSize} place-items-center font-semibold tabular-nums ${statusCellStyle(value, target)} ${child ? 'opacity-90' : ''}`}>{Math.round(value)}</span>}</td>
      })}
      <td className={`pl-16 ${separatorClass}`}>
        <div className="flex flex-col items-center gap-1">
          <span className={`font-semibold tabular-nums ${child ? 'text-[11px] text-[#6b7a87]' : 'text-xs text-[#4a5966]'}`}>{item.monthsOnTarget}/{item.values.size}</span>
          <span className="flex gap-1.5">{months.map(month => {
            const value = item.values.get(month)
            return <span key={month} className={`${child ? 'h-1' : 'h-1.5'} w-5 rounded-full`} style={{ backgroundColor: value === undefined ? '#edf1f4' : value >= target ? boschGreen : '#cfd8df' }} />
          })}</span>
        </div>
      </td>
      <td className={`pl-10 text-right ${separatorClass}`}><span className={`inline-flex justify-center rounded-full px-2 font-bold tabular-nums ${child ? 'min-w-14 py-px text-[11px]' : 'min-w-16 py-0.5 text-xs'} ${item.average >= target ? 'bg-[#e6f4ec] text-[#00884a]' : 'bg-[#f1f3f5] text-[#4a5966]'}`}>{item.average.toLocaleString('pt-BR')}%</span></td>
    </tr>
  }

  return <StatusCard
    title={title}
    subtitle="Percentual mensal de presença no escritório · ordenado pela média do ano"
    actions={<StatusLegend items={[{ color: boschGreen, label: `≥ ${target}%` }, { color: '#cdebd8', label: 'até 2 p.p. abaixo' }, { color: '#dfe5ea', label: 'abaixo da meta' }]} />}
  >
    {series.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Sem dados para os filtros selecionados.</p> : <div className="overflow-x-auto">
      <table className="border-separate border-spacing-x-1 border-spacing-y-1 text-sm">
        <thead><tr className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#6b7a87]">
          <th className="sticky left-0 z-10 min-w-44 bg-white pr-4 text-left">
            <span className="flex items-center gap-2">{label}
              {expandable.length > 0 && <button type="button" onClick={() => setExpanded(allExpanded ? [] : expandable)} className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-[#1475bd] transition hover:bg-[#eef6fb]">{allExpanded ? 'Fechar todas' : 'Abrir todas'}</button>}
            </span>
          </th>
          {months.map(month => <th key={month} className="w-14 pb-1 text-center">{statusMonthNames[month - 1]}</th>)}
          <th className="w-60 whitespace-nowrap pb-1 pl-16 text-center">Meses ≥ {target}%</th>
          <th className="w-32 pb-1 pl-10 text-right">Média</th>
        </tr></thead>
        <tbody>{series.map((item, index) => {
          const children = childSeries?.get(item.name) ?? []
          const open = expanded.includes(item.name)
          return <Fragment key={item.name}>
            {renderRow(item, { separator: index === firstBelow && index > 0, open, childCount: children.length })}
            {open && children.map((unit, unitIndex) => renderRow(unit, { separator: false, child: { parent: item.name, last: unitIndex === children.length - 1 } }))}
            {/* Respiro depois do grupo aberto */}
            {open && children.length > 0 && <tr aria-hidden="true"><td colSpan={months.length + 3} className="h-1.5" /></tr>}
          </Fragment>
        })}</tbody>
      </table>
    </div>}
  </StatusCard>
}

function StatusAreaBars({ series, months, target }: { series: StatusSeries[]; months: number[]; target: number }) {
  // Desenho com proporção fixa; as barras ficam centralizadas em faixas iguais por mês
  const width = 320
  const chartHeight = 120
  const top = 18
  const slot = width / Math.max(months.length, 1)
  const barWidth = Math.min(26, slot * 0.56)
  const y = (value: number) => top + chartHeight - (value / 100) * chartHeight
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {series.map(item => {
      return <div key={item.name} className="rounded-xl border border-[#e6ecf1] bg-[#fbfcfd] p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#1a2b3a]" title={item.name}>{item.name}</p>
            <p className="mt-0.5 text-[11px] text-[#6b7a87]">{formatNumber(item.people)} pessoas</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${item.average >= target ? 'bg-[#e6f4ec] text-[#00884a]' : 'bg-[#f1f3f5] text-[#4a5966]'}`}>média {item.average.toLocaleString('pt-BR')}%</span>
        </div>
        <svg viewBox={`0 0 ${width} ${top + chartHeight + 22}`} className="h-auto w-full" role="img" aria-label={`Presença mensal de ${item.name}`}>
          <line x1={0} x2={width} y1={top + chartHeight} y2={top + chartHeight} stroke="#dfe6ec" strokeWidth={1} />
          {months.map((month, index) => {
            const value = item.values.get(month)
            const center = index * slot + slot / 2
            return <g key={month}>
              {value !== undefined && <>
                <title>{`${item.name} · ${statusMonthNames[month - 1]}: ${value}%`}</title>
                <rect x={center - barWidth / 2} y={y(value)} width={barWidth} height={Math.max(0, top + chartHeight - y(value))} rx={4} fill={value >= target ? statusBarOnTarget : statusBarBelowTarget} />
                <text x={center} y={y(value) - 5} textAnchor="middle" stroke="#fbfcfd" strokeWidth={3} paintOrder="stroke" className="fill-[#1a2b3a] text-[10.5px] font-semibold">{Math.round(value)}</text>
              </>}
              <text x={center} y={top + chartHeight + 16} textAnchor="middle" className="fill-[#6b7a87] text-[10.5px] font-medium">{statusMonthNames[month - 1]}</text>
            </g>
          })}
          <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke={boschGreen} strokeWidth={1.25} strokeDasharray="5 4" />
        </svg>
      </div>
    })}
  </div>
}

// M-Group: subgrupos de liderança; A-Group: todos os demais
const mGroupSubgroups = ['G1', 'V1', 'G2', 'V2', 'G3', 'V3', 'G4', 'V4', 'G5', 'V5']

function StatusOverview({ data, filters, onSubgroupsChange }: { data: StatusData | null; filters: Record<FilterKey, string[]>; onSubgroupsChange: (subgroups: string[]) => void }) {
  // Group preenche o filtro "Subgrupo de empregados" do cabeçalho com os subgrupos do grupo (todos os do ano)
  const mGroup = new Set(mGroupSubgroups)
  const yearSubgroups = data?.dictionaries?.subgroup ?? []
  const groupSubgroups = {
    M: yearSubgroups.filter(subgroup => mGroup.has(subgroup.trim().toUpperCase())),
    A: yearSubgroups.filter(subgroup => !mGroup.has(subgroup.trim().toUpperCase())),
  }
  const sameSubgroups = (values: string[]) => values.length === filters.subgroup.length && values.every(value => filters.subgroup.includes(value))
  const selectedGroup = filters.subgroup.length === 0 ? 'all' : sameSubgroups(groupSubgroups.M) ? 'M' : sameSubgroups(groupSubgroups.A) ? 'A' : null
  const target = selectedGroup === 'M' ? mGroupStatusTarget : statusTarget
  const view = useMemo(() => {
    if (!data?.dictionaries) return null
    const dictionaries = data.dictionaries
    const dictionaryByFilter: Record<FilterKey, string[]> = { division: dictionaries.division, unit: dictionaries.organizationalUnit, area: dictionaries.hrArea, subgroup: dictionaries.subgroup, contract: dictionaries.contractType }
    // Os mesmos filtros do cabeçalho, aplicados a todos os meses do ano
    const allowed = filterKeys.map(key => {
      if (filters[key].length === 0) return null
      const selected = new Set(filters[key])
      return new Set(dictionaryByFilter[key].flatMap((value, index) => selected.has(value) ? [index] : []))
    })
    const months = data.months.map(({ month, rows }) => ({
      month,
      rows: rows.filter(row => filterKeys.every((key, keyIndex) => !allowed[keyIndex] || allowed[keyIndex]!.has(row[statusFilterColumns[key]]))),
    }))
    const overall = months.flatMap(({ month, rows }) => {
      const entries = rows.reduce((sum, row) => sum + row[5], 0)
      const businessDays = rows.reduce((sum, row) => sum + row[6], 0)
      return businessDays ? [{ month, value: officePercentage(entries, businessDays) }] : []
    })
    const ytd = overall.length ? roundPercentage(overall.reduce((sum, point) => sum + point.value, 0) / overall.length) : 0
    const areaSeries = buildStatusSeries(months, 2, dictionaries.hrArea, target)
    // Unidades organizacionais de cada divisão, abertas pela setinha no histórico por divisão
    const monthsByDivision = new Map<number, { month: number; rows: number[][] }[]>()
    for (const { month, rows } of months) {
      const rowsByDivision = new Map<number, number[][]>()
      for (const row of rows) rowsByDivision.set(row[0], [...(rowsByDivision.get(row[0]) ?? []), row])
      for (const [division, divisionRows] of rowsByDivision) monthsByDivision.set(division, [...(monthsByDivision.get(division) ?? []), { month, rows: divisionRows }])
    }
    const divisionUnits = new Map([...monthsByDivision].map(([division, divisionMonths]) => [dictionaries.division[division], buildStatusSeries(divisionMonths, 1, dictionaries.organizationalUnit, target)]))
    return {
      monthNumbers: months.filter(({ rows }) => rows.length > 0).map(({ month }) => month),
      overall,
      ytd,
      divisions: buildStatusSeries(months, 0, dictionaries.division, target),
      divisionUnits,
      // Todas as áreas com dados no ano, exceto BISB, em ordem alfabética
      areas: areaSeries
        .filter(area => area.name.trim().toUpperCase() !== 'BISB')
        .sort((first, second) => naturalCollator.compare(first.name, second.name)),
    }
  }, [data, filters, target])

  if (!data) return <div className="grid min-h-60 place-items-center text-sm text-slate-500">Carregando histórico do ano...</div>
  if (!view || view.overall.length === 0) return <div className="grid min-h-60 place-items-center text-sm text-slate-500">Sem dados no ano para os filtros selecionados.</div>
  const gap = roundPercentage(view.ytd - target)
  const onTarget = view.ytd >= target
  const monthsOnTarget = view.overall.filter(point => point.value >= target).length
  const latest = view.overall.at(-1)!
  const previous = view.overall.at(-2)
  const change = previous ? roundPercentage(latest.value - previous.value) : null

  return <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex flex-col overflow-hidden border-0 bg-white ring-1 ring-[#dfe6ec] shadow-[0_1px_2px_rgba(16,40,60,0.04),0_8px_24px_rgba(16,40,60,0.06)]">
        <div className="bg-[#004975] px-6 py-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Presença no escritório</p>
          <p className="text-sm font-semibold text-white">Média do ano · {data.year}</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-6">
          <span className={`text-[64px] font-bold leading-none tabular-nums tracking-tight ${onTarget ? 'text-[#00884a]' : 'text-[#c4303c]'}`}>{view.ytd.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
          <span className="mt-2 text-xs font-medium text-[#6b7a87]">{view.overall.length} {view.overall.length === 1 ? 'mês' : 'meses'} · {monthsOnTarget} {monthsOnTarget === 1 ? 'mês' : 'meses'} na meta</span>
          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${onTarget ? 'bg-[#e6f4ec] text-[#00884a]' : 'bg-[#fbe9ea] text-[#c4303c]'}`}>
            {onTarget ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}{onTarget ? 'Dentro da meta' : 'Abaixo da meta'}
          </span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[#edf1f4] border-t border-[#edf1f4] text-center">
          <div className="px-2 py-3.5"><p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8a97a3]">Meta</p><p className="mt-0.5 text-base font-bold text-[#004975]">≥ {target}%</p></div>
          <div className="px-2 py-3.5"><p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8a97a3]">Gap p/ meta</p><p className={`mt-0.5 text-base font-bold tabular-nums ${onTarget ? 'text-[#00884a]' : 'text-[#c4303c]'}`}>{gap >= 0 ? '+' : ''}{gap.toLocaleString('pt-BR')} p.p.</p></div>
          <div className="px-2 py-3.5"><p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8a97a3]">{statusMonthNames[latest.month - 1]}</p><p className="mt-0.5 text-base font-bold tabular-nums text-[#1a2b3a]">{latest.value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%{change !== null && <span className={`ml-1 text-[11px] font-semibold ${change >= 0 ? 'text-[#00884a]' : 'text-[#c4303c]'}`}>{change >= 0 ? '▲' : '▼'}{Math.abs(change).toLocaleString('pt-BR')}</span>}</p></div>
        </div>
      </Card>
      <StatusCard
        title="Histórico geral"
        subtitle={`Média mensal de presença no escritório em ${data.year}, para os filtros selecionados`}
        actions={<div className="flex flex-wrap items-center gap-4">
          <div role="group" aria-label="Group" className="flex items-center rounded-lg bg-[#f1f4f7] p-0.5 text-[11px] font-semibold">
            {([['all', 'Todos'], ['A', 'A-Group'], ['M', 'M-Group']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={selectedGroup === key} onClick={() => onSubgroupsChange(key === 'all' || selectedGroup === key ? [] : groupSubgroups[key])} title={key === 'M' ? mGroupSubgroups.join(', ') : key === 'A' ? 'Todos os subgrupos, exceto os do M-Group' : 'Sem filtro de subgrupo'} className={`rounded-md px-2.5 py-1 transition ${selectedGroup === key ? 'bg-white text-[#004975] shadow-[0_1px_2px_rgba(16,40,60,0.12)]' : 'text-[#6b7a87] hover:text-[#1a2b3a]'}`}>{label}</button>)}
          </div>
          <StatusLegend items={[{ color: boschDarkBlue, label: 'Presença no escritório' }, { color: boschGreen, label: `Meta ${target}%`, dashed: true }]} />
        </div>}
      >
        <StatusLineChart points={view.overall} target={target} />
      </StatusCard>
    </div>
    <StatusHeatTable title="Histórico por divisão" label="Divisão" series={view.divisions} months={view.monthNumbers} target={target} childSeries={view.divisionUnits} childLabel="unidades" />
    <StatusCard
      title="Histórico por área de recursos humanos"
      subtitle={`Presença mensal no escritório · ${view.areas.length} ${view.areas.length === 1 ? 'área' : 'áreas'}, em ordem alfabética`}
      actions={<StatusLegend items={[{ color: statusBarOnTarget, label: `≥ ${target}%` }, { color: statusBarBelowTarget, label: 'abaixo da meta' }, { color: boschGreen, label: `Meta ${target}%`, dashed: true }]} />}
    >
      <StatusAreaBars series={view.areas} months={view.monthNumbers} target={target} />
    </StatusCard>
  </div>
}

export default function Page() {
  const [tab, setTab] = useState<'organization' | 'presence' | 'employees' | 'status'>('status')
  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ division: [] as string[], unit: [] as string[], area: [] as string[], subgroup: [] as string[], contract: [] as string[] })
  const [employeeSearch, setEmployeeSearch] = useState('')
  const statusYear = data?.reference?.year
  useEffect(() => {
    if (tab !== 'status' || !statusYear || statusData?.year === statusYear) return
    fetch(`/api/dashboard/status?year=${statusYear}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Falha ao carregar o histórico.')))
      .then(setStatusData)
      .catch(fetchError => setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar o histórico.'))
  }, [tab, statusYear, statusData?.year])
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all')
  // "Ver por" da aba Presença no escritório: sempre começa em Unidade organizacional ao abrir a aba
  const [presenceGroupBy, changePresenceGroupBy] = useState<FilterKey>('unit')
  const deferredEmployeeSearch = useDeferredValue(employeeSearch)

  // Na primeira carga usa os filtros guardados na sessão (ou os iniciais); ao trocar de mês os filtros atuais são mantidos
  function loadDashboard(year?: number, month?: number, savedFilters?: DashboardFilters | null, applySavedInitialExclusions = false) {
    const query = year && month ? `?year=${year}&month=${month}` : ''
    fetch(`/api/dashboard${query}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Falha ao carregar o dashboard.')))
      .then((result: DashboardData) => {
        setData(result)
        if (savedFilters !== undefined) {
          const nextFilters = savedFilters ?? initialFilters(result.employees ?? [])
          setFilters(applySavedInitialExclusions ? applyInitialExclusions(nextFilters, result.employees ?? []) : nextFilters)
        }
      })
      .catch(fetchError => setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar o dashboard.'))
  }

  useEffect(() => {
    const { saved, applyInitialExclusions: migrateInitialExclusions } = readDashboardState()
    loadDashboard(saved?.period?.year, saved?.period?.month, saved?.filters ?? null, migrateInitialExclusions)
  }, [])

  const referenceYear = data?.reference?.year
  const referenceMonth = data?.reference?.month
  useEffect(() => {
    if (!referenceYear || !referenceMonth) return
    try {
      window.sessionStorage.setItem(dashboardStateKey, JSON.stringify({ filters, period: { year: referenceYear, month: referenceMonth } } satisfies SavedDashboardState))
    } catch {}
  }, [filters, referenceYear, referenceMonth])

  function changeYear(year: number) {
    if (!data?.filters) return
    const newestMonth = data.filters.periods.find(period => period.year === year)?.month
    if (newestMonth) loadDashboard(year, newestMonth)
  }

  function changeMonth(month: number) {
    if (data?.reference?.year) loadDashboard(data.reference.year, month)
  }

  const { filteredEmployees, filterOptions } = useMemo(() => {
    const employees = data?.employees ?? []
    const matchers = filterKeys.map(key => {
      const values = new Set(filters[key])
      return (employee: EmployeeRow) => values.size === 0 || values.has(filterSelectors[key](employee))
    })
    const filtered = employees.filter(employee => employeeMatchesFilters(employee, filters))

    // Filtros encadeados: cada filtro lista só as opções compatíveis com os demais filtros (ligados pelo EDV)
    const options = {} as Record<FilterKey, string[]>
    filterKeys.forEach((key, keyIndex) => {
      const values = new Set<string>()
      for (const employee of employees) {
        if (matchers.every((matches, matcherIndex) => matcherIndex === keyIndex || matches(employee))) values.add(filterSelectors[key](employee))
      }
      options[key] = [...values]
    })
    return { filteredEmployees: filtered, filterOptions: options }
  }, [data, filters])

  const activeFilterCount = Object.values(filters).reduce((total, values) => total + values.length, 0)
  const clearFilters = () => startTransition(() => setFilters({ division: [], unit: [], area: [], subgroup: [], contract: [] }))
  const restoreInitialFilters = () => startTransition(() => {
    const employees = data?.employees ?? []
    const nextFilters = initialFilters(employees)
    const units = [...new Set(employees.map(filterSelectors.unit))]
    const selectedUnits = units.filter(unit => !/TET|BISB/i.test(unit))
    nextFilters.unit = selectedUnits.length === units.length ? [] : selectedUnits.length ? selectedUnits : [noneSelected]
    setFilters(nextFilters)
  })

  const views = useMemo(() => [
    ['Subgrupo de empregados', aggregate(filteredEmployees, employee => employee.subgroup)],
    ['Área de recursos humanos', aggregate(filteredEmployees, employee => employee.hrArea)],
    ['Divisão', aggregate(filteredEmployees, employee => employee.division)],
    ['Unidade organizacional', aggregate(filteredEmployees, employee => employee.organizationalUnit)],
  ] as const, [filteredEmployees])

  const sortedEmployees = useMemo(() => filteredEmployees
    .map(employee => ({ employee, searchKey: normalizeSearch(`${employee.edv} ${employee.name}`) }))
    .sort((first, second) => naturalCollator.compare(first.employee.name, second.employee.name)), [filteredEmployees])
  const textSearchedEmployees = useMemo(() => {
    const term = normalizeSearch(deferredEmployeeSearch.trim())
    return (term ? sortedEmployees.filter(item => item.searchKey.includes(term)) : sortedEmployees).map(item => item.employee)
  }, [sortedEmployees, deferredEmployeeSearch])
  const targetCounts = useMemo(() => ({
    below: textSearchedEmployees.filter(employee => employee.withinTarget === false).length,
    met: textSearchedEmployees.filter(employee => employee.withinTarget === true).length,
  }), [textSearchedEmployees])
  const searchedEmployees = useMemo(() => targetFilter === 'all'
    ? textSearchedEmployees
    : textSearchedEmployees.filter(employee => employee.withinTarget === (targetFilter === 'met')), [textSearchedEmployees, targetFilter])

  // Na aba Colaboradores, os KPIs também consideram a busca por EDV ou nome
  const kpiEmployees = tab === 'employees' ? searchedEmployees : filteredEmployees
  const filteredBusinessDays = kpiEmployees.reduce((sum, employee) => sum + employee.businessDays, 0)
  const overallPresence = filteredBusinessDays ? Math.min(100, roundPercentage((kpiEmployees.reduce((sum, employee) => sum + employee.entries, 0) / filteredBusinessDays) * 100)) : 0
  const presencialCount = kpiEmployees.filter(employee => employee.contractType === 'Presencial').length

  return <div className="light min-h-screen bg-[linear-gradient(135deg,#f4f9fc_0%,#f7fbfa_52%,#eef8ff_100%)] text-slate-700"><div className="h-[4px] w-full bg-[#e20015]" style={{ backgroundImage: `url(${boschSupergraphicUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" /><header className="border-b border-[#d9e5ee] bg-white/95 shadow-sm"><div className="flex h-16 items-center justify-between px-5 lg:px-10"><div className="flex items-center gap-4"><div className="flex h-10 w-32 items-center justify-center"><img src={boschLogoUrl} alt="Bosch" className="h-12 w-auto max-w-none object-contain" /></div><div className="h-8 w-px bg-[#d9e5ee]" /><div><p className="text-sm font-bold text-slate-700">Smart Check | On-Site Work</p><p className="text-[10px] uppercase tracking-[.18em] text-[#1475bd]">People Analytics</p></div></div><div className="flex items-center gap-3"><UserMenu /><Link href="/management" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#c9ddea] bg-[#f4f9fc] px-3.5 text-xs font-semibold text-[#1269a8] transition hover:border-[#9fc4dc] hover:bg-[#e9f4fb]"><Settings className="size-4" />Management</Link></div></div>{data?.hasData && data.filters && <div className="border-t border-[#e0eaf0] bg-[#f4f8fa] px-5 py-4 lg:px-10"><div className="mx-auto max-w-[1450px]"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#e2f0f9] text-[#1475bd]"><SlidersHorizontal className="size-[18px]" /></span><div><div className="flex items-center gap-2"><p className="text-sm font-bold text-[#244a63]">Filtros</p>{activeFilterCount > 0 && <span className="rounded-full bg-[#dbeef9] px-2 py-0.5 text-[10px] font-bold text-[#1269a8]">{activeFilterCount} ativos</span>}</div>
<div className="mt-1 flex items-center gap-2.5 text-[13px] text-[#6d8493]">
  <label className="flex items-center gap-1.5">
    <span>Ano</span>
    {/* Anos e meses em ordem crescente */}
    <select value={data.reference?.year ?? ''} onChange={event => changeYear(Number(event.target.value))} className="h-7 cursor-pointer rounded-md border border-[#d3e1ea] bg-white px-1.5 text-[13px] font-semibold text-[#315c77] outline-none transition hover:border-[#9ebed2] focus:border-[#1475bd]">
      {[...data.filters.years].sort().map(year => <option key={year} value={year}>{year}</option>)}
    </select>
  </label>
  <label className="flex items-center gap-1.5">
    <span>Mês</span>
    <select value={String(data.reference?.month ?? '').padStart(2, '0')} onChange={event => changeMonth(Number(event.target.value))} className="h-7 cursor-pointer rounded-md border border-[#d3e1ea] bg-white px-1.5 text-[13px] font-semibold text-[#315c77] outline-none transition hover:border-[#9ebed2] focus:border-[#1475bd]">
      {[...data.filters.months].sort().map(month => <option key={month} value={month}>{month}</option>)}
    </select>
  </label>
</div>
</div></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={restoreInitialFilters} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cfdee8] bg-white px-3 text-xs font-semibold text-[#46677d] shadow-sm transition hover:border-[#a8c4d5] hover:bg-[#f8fbfd]"><Check className="size-3.5" />Filtros iniciais</button><button type="button" onClick={clearFilters} disabled={activeFilterCount === 0} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cfdee8] bg-white px-3 text-xs font-semibold text-[#46677d] shadow-sm transition hover:border-[#a8c4d5] hover:bg-[#f8fbfd] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="size-3.5" />Limpar filtros</button></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"><Filter label="Divisão" values={filters.division} options={filterOptions.division} onChange={division => startTransition(() => setFilters(current => ({ ...current, division })))} /><Filter label="Unidade organizacional" values={filters.unit} options={filterOptions.unit} onChange={unit => startTransition(() => setFilters(current => ({ ...current, unit })))} /><Filter label="Área de recursos humanos" values={filters.area} options={filterOptions.area} onChange={area => startTransition(() => setFilters(current => ({ ...current, area })))} /><Filter label="Subgrupo de empregados" values={filters.subgroup} options={filterOptions.subgroup} onChange={subgroup => startTransition(() => setFilters(current => ({ ...current, subgroup })))} /><Filter label="Tipo de contrato" values={filters.contract} options={filterOptions.contract} onChange={contract => startTransition(() => setFilters(current => ({ ...current, contract })))} /></div></div></div>}</header><main className="mx-auto max-w-[1450px] p-5 lg:px-8 lg:pb-8 lg:pt-5">{error ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div> : !data ? <div className="grid min-h-80 place-items-center text-sm text-slate-500">Carregando dados...</div> : !data.hasData ? <div className="grid min-h-[460px] place-items-center"><div className="max-w-lg rounded-2xl border border-[#d7e5ee] bg-white p-10 text-center shadow-[0_14px_38px_rgba(23,67,96,0.08)]"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e7f2fa] text-[#1475bd]"><UploadCloud className="size-7" /></div><h1 className="mt-5 text-2xl font-semibold text-[#183b56]">Nenhum dado importado</h1><p className="mt-2 text-sm leading-6 text-slate-500">Acesse o Management para enviar os arquivos Lenel, IT007 e IT2001. O dashboard será preenchido somente com os dados importados.</p><Link href="/management" className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-[#116da9] px-5 text-sm font-semibold text-white hover:bg-[#0c5d92]"><UploadCloud className="size-4" />Importar arquivos</Link></div></div> : <><div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#1475bd]">Smart Check · {data.reference?.monthName} {data.reference?.year}</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-700">{tab === 'organization' ? 'Tipo de Contrato' : tab === 'presence' ? 'Presença no Escritório' : tab === 'status' ? 'Status' : 'Colaboradores'}</h1><p className="mt-0.5 text-[13px] text-slate-500">{tab === 'organization' ? 'Distribuição dos tipos de contrato a partir dos arquivos importados.' : tab === 'presence' ? 'Quanto dos dias úteis foi cumprido no escritório e quanto em home office.' : tab === 'status' ? 'Evolução da presença no escritório ao longo do ano.' : 'Indicadores individuais consolidados por EDV.'}</p></div><div className="flex flex-wrap justify-end gap-3"><KpiCard label="Presença geral" value={`${overallPresence}%`} detail={`de presença no escritório`} tone="text-[#1475bd]" icon={Building2} />
<KpiCard label="Contrato presencial" value={`${kpiEmployees.length ? roundPercentage((presencialCount / kpiEmployees.length) * 100) : 0}%`} detail={`${formatNumber(presencialCount)} ${presencialCount === 1 ? 'contrato' : 'contratos'}`} tone="text-[#269a7d]" icon={Check} />
<KpiCard label="Total" value={formatNumber(kpiEmployees.length)} detail="colaboradores filtrados" tone="text-[#d58a24]" icon={Users} /></div></div><div className="mb-6 flex w-fit gap-1 rounded-xl border border-[#d6e5ef] bg-white p-1 shadow-sm"><button type="button" onClick={() => setTab('status')} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${tab === 'status' ? 'bg-[#e9f4ff] text-[#1475bd] shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Status</button>
<button type="button" onClick={() => { setTab('presence'); changePresenceGroupBy('unit') }} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${tab === 'presence' ? 'bg-[#e9f4ff] text-[#1475bd] shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Presença no escritório</button><button type="button" onClick={() => setTab('organization')} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${tab === 'organization' ? 'bg-[#e9f4ff] text-[#1475bd] shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Tipo de contrato</button>
<button type="button" onClick={() => setTab('employees')} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${tab === 'employees' ? 'bg-[#e9f4ff] text-[#1475bd] shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Colaboradores</button></div>{tab === 'organization' ? <div className="grid gap-5 lg:grid-cols-2">{views.map(([title, view]) => <div key={title} className="contents"><ContractTable title={title} rows={view.contracts} /><PresenceTable title={title} rows={view.presence} /></div>)}</div> : tab === 'status' ? <StatusOverview data={statusData?.year === statusYear ? statusData : null} filters={filters} onSubgroupsChange={subgroup => startTransition(() => setFilters(current => ({ ...current, subgroup })))} /> : tab === 'presence' ? <PresenceOverview employees={filteredEmployees} groupBy={presenceGroupBy} onGroupByChange={changePresenceGroupBy} period={{ year: data.reference?.year ?? new Date().getFullYear(), month: data.reference?.month ?? new Date().getMonth() + 1 }} /> : <FullWidth><EmployeeTable employees={searchedEmployees} search={employeeSearch} onSearchChange={setEmployeeSearch} targetFilter={targetFilter} onTargetFilterChange={setTargetFilter} targetCounts={targetCounts} period={{ year: data.reference?.year ?? new Date().getFullYear(), month: data.reference?.month ?? new Date().getMonth() + 1 }} /></FullWidth>}</>}</main></div>
}
