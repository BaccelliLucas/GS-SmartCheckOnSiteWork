'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { UserMenu } from '@/components/auth/user-menu'
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  GripVertical,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  UploadCloud,
  UsersRound,
} from 'lucide-react'
import { AccessSection } from './access-section'
import { ExclusionsSection } from './exclusions-section'
import { ExternalSection } from './external-section'

type UploadKey = 'lenel' | 'it007' | 'it2001' | 'btravel' | 'external' | 'exceptions'
type PresenceTarget = { id: number; subgroup: string; percentage: number }
type TargetGroup = { percentage: number; targets: PresenceTarget[] }
type ContractType = 'Presencial' | 'HO Preponderante' | 'Home Office 100%'
type ContractPresenceTarget = { contractType: ContractType; minimumDays: number }
type AreaHoliday = { hrArea: string; date: string }
type HolidayGroup = { key: string; areas: string[]; months: [string, string[]][] }
type SourceImport = { source: UploadKey; period: string; fileName: string; rowCount: number; importedAt: string }

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function formatPeriodLabel(period: string) {
  return `${monthNames[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`
}

function formatImportDate(value: string) {
  // imported_at é gravado em UTC pelo SQLite (CURRENT_TIMESTAMP)
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

// Identifica o mês no nome do arquivo, ex.: IT007_202609.XLSX, IT2001_2026.09.XLSX ou Exclusão_Base_08_26.xlsx (MM_AA)
function periodFromFileName(fileName: string) {
  const match = fileName.match(/(20\d{2})[._-]?(0[1-9]|1[0-2])(?!\d)/)
  if (match) return { year: Number(match[1]), month: Number(match[2]) }
  const shortMatch = fileName.match(/(?<!\d)(0[1-9]|1[0-2])[._-](\d{2})(?!\d)/)
  return shortMatch ? { year: 2000 + Number(shortMatch[2]), month: Number(shortMatch[1]) } : null
}

function previousMonth() {
  const today = new Date()
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

const boschLogoUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/Bosch_symbol_logo_black_red.png?version=1&modificationDate=1773863609000&api=v2'
const boschSupergraphicUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/supergraphic.jpg?version=1&modificationDate=1773863610000&api=v2'

const uploadDefinitions: { key: UploadKey; name: string; description: string; accent: string }[] = [
  { key: 'lenel', name: 'Lenel', description: 'Registros de acesso e entradas de catraca', accent: '#1475bd' },
  { key: 'it007', name: 'IT007', description: 'Base organizacional e dados dos colaboradores', accent: '#269a7d' },
  { key: 'it2001', name: 'IT2001', description: 'Informações de ausências', accent: '#b16d19' },
  { key: 'btravel', name: 'bTravel', description: 'Colaboradores que viajaram no mês', accent: '#6a4fb3' },  { key: 'external', name: 'BIS - ITV', description: 'Registro de acesso e entradas em Itupeva', accent: '#0f8a9d' },
  { key: 'exceptions', name: 'Exceções', description: 'EDVs que não devem aparecer no dashboard', accent: '#c64550' },
]

const noFiles = Object.fromEntries(uploadDefinitions.map(upload => [upload.key, null])) as Record<UploadKey, File | null>

const initialTargets: PresenceTarget[] = ['CH', 'G1', 'V1', 'G2', 'V2', 'G3', 'V3', 'G4', 'V4']
  .map((subgroup, index) => ({ id: index + 1, subgroup, percentage: 80 }))
const contractTypeOptions: ContractType[] = ['Presencial', 'HO Preponderante', 'Home Office 100%']

// Áreas que não aparecem na lista de feriados
const hiddenHolidayAreas = new Set(['campinas 2'])
const isHiddenHolidayArea = (area: string) => hiddenHolidayAreas.has(area.trim().toLowerCase())

function formatAreaList(areas: string[]) {
  return areas.length <= 1 ? areas.join('') : `${areas.slice(0, -1).join(', ')} e ${areas[areas.length - 1]}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ManagementPage() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>(noFiles)
  const [fileInputsKey, setFileInputsKey] = useState(0)
  const [referencePeriod, setReferencePeriod] = useState(previousMonth)
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([])
  const [savedMessage, setSavedMessage] = useState('')
  const [targets, setTargets] = useState<PresenceTarget[]>(initialTargets)
  const [contractTargets, setContractTargets] = useState<ContractPresenceTarget[]>([])
  const [newContractType, setNewContractType] = useState<ContractType | ''>('')
  const [newContractMinimumDays, setNewContractMinimumDays] = useState(1)
  const [newSubgroups, setNewSubgroups] = useState<Record<number, string>>({})
  // Metas criadas pelo "+" que ainda não têm subgrupos (passam a ser salvas quando recebem o primeiro subgrupo)
  const [extraPercentages, setExtraPercentages] = useState<number[]>([])
  const [newPercentage, setNewPercentage] = useState<string | null>(null)
  const [holidays, setHolidays] = useState<AreaHoliday[]>([])
  const [hrAreas, setHrAreas] = useState<string[]>([])
  const [holidayModalAreas, setHolidayModalAreas] = useState<string[] | null>(null)
  const [areaSearch, setAreaSearch] = useState('')
  const [expandedHolidayGroups, setExpandedHolidayGroups] = useState<string[]>([])
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [draggedTargetId, setDraggedTargetId] = useState<number | null>(null)
  const [dragOverPercentage, setDragOverPercentage] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedFiles = Object.values(files).filter(Boolean).length

  function loadSourceImports() {
    fetch('/api/management/import', { cache: 'no-store' })
      .then(response => response.json())
      .then((result: { imports?: SourceImport[]; hrAreas?: string[] }) => {
        setSourceImports(result.imports ?? [])
        setHrAreas(result.hrAreas ?? [])
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetch('/api/management/import', { cache: 'no-store' })
      .then(response => response.json())
      .then((result: { targets?: { subgroup: string; percentage: number }[]; contractTargets?: ContractPresenceTarget[]; holidays?: AreaHoliday[]; hrAreas?: string[]; imports?: SourceImport[] }) => {
        setSourceImports(result.imports ?? [])
        // Somente os subgrupos cadastrados nas metas são considerados no sistema; os demais são ignorados
        const savedTargets = result.targets ?? []
        setTargets(savedTargets.length === 0 ? initialTargets : savedTargets
          .map(target => ({ subgroup: target.subgroup.trim().toUpperCase(), percentage: target.percentage }))
          .filter(target => target.subgroup)
          .sort((first, second) => first.subgroup.localeCompare(second.subgroup, 'pt-BR', { numeric: true }))
          .map((target, index) => ({ id: index + 1, ...target })))
        setContractTargets(result.contractTargets ?? [])
        setHolidays(result.holidays ?? [])
        setHrAreas(result.hrAreas ?? [])
      })
      .catch(() => {})
  }, [])

  function updateFile(key: UploadKey, file: File | null) {
    setFiles(current => ({ ...current, [key]: file }))
    const detectedPeriod = file ? periodFromFileName(file.name) : null
    if (detectedPeriod) setReferencePeriod(detectedPeriod)
    setSaved(false)
    setError('')
  }

  const referencePeriodKey = `${referencePeriod.year}-${String(referencePeriod.month).padStart(2, '0')}`
  const existingImports = useMemo(() => new Map(sourceImports.filter(item => item.period === referencePeriodKey).map(item => [item.source, item])), [sourceImports, referencePeriodKey])
  const importHistory = useMemo(() => {
    const periods = new Map<string, Partial<Record<UploadKey, SourceImport>>>()
    for (const item of sourceImports) periods.set(item.period, { ...periods.get(item.period), [item.source]: item })
    return [...periods.entries()].sort(([first], [second]) => second.localeCompare(first))
  }, [sourceImports])
  const historyYears = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return [...new Set([currentYear + 1, currentYear, currentYear - 1, currentYear - 2, referencePeriod.year, ...sourceImports.map(item => Number(item.period.slice(0, 4)))])].sort((first, second) => second - first)
  }, [sourceImports, referencePeriod.year])

  const targetGroups = useMemo(() => {
    const groups = new Map<number, PresenceTarget[]>()
    for (const target of targets) groups.set(target.percentage, [...(groups.get(target.percentage) ?? []), target])
    for (const percentage of [80, 60, ...extraPercentages]) if (!groups.has(percentage)) groups.set(percentage, [])
    return [...groups.entries()].sort(([first], [second]) => second - first).map(([percentage, groupedTargets]) => ({ percentage, targets: groupedTargets })) as TargetGroup[]
  }, [targets, extraPercentages])
  const availableContractTypes = contractTypeOptions.filter(contractType => !contractTargets.some(target => target.contractType === contractType))

  function addPercentage() {
    const percentage = Math.round(Number((newPercentage ?? '').replace(',', '.')))
    if (!(newPercentage ?? '').trim() || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return
    if (!targetGroups.some(group => group.percentage === percentage)) setExtraPercentages(current => [...current, percentage])
    setNewPercentage(null)
  }

  const holidayGroups = useMemo(() => {
    const datesByArea = new Map<string, string[]>()
    for (const holiday of holidays) if (!isHiddenHolidayArea(holiday.hrArea)) datesByArea.set(holiday.hrArea, [...(datesByArea.get(holiday.hrArea) ?? []), holiday.date])
    const areasByDates = new Map<string, string[]>()
    for (const [area, dates] of datesByArea) {
      const key = [...new Set(dates)].sort().join('|')
      areasByDates.set(key, [...(areasByDates.get(key) ?? []), area])
    }
    const groupsWithHolidays = [...areasByDates.entries()].map(([dateKey, areas]) => {
      const months = new Map<string, string[]>()
      for (const date of dateKey.split('|')) months.set(date.slice(0, 7), [...(months.get(date.slice(0, 7)) ?? []), date])
      const sortedAreas = areas.sort((first, second) => first.localeCompare(second, 'pt-BR'))
      return { key: sortedAreas.join('|'), areas: sortedAreas, months: [...months.entries()] }
    })
    const areasWithoutHolidays = hrAreas.filter(area => !datesByArea.has(area) && !isHiddenHolidayArea(area)).map(area => ({ key: area, areas: [area], months: [] }))
    return [...groupsWithHolidays, ...areasWithoutHolidays].sort((first, second) => first.areas[0].localeCompare(second.areas[0], 'pt-BR')) as HolidayGroup[]
  }, [holidays, hrAreas])

  function toggleHolidayGroup(key: string) {
    setExpandedHolidayGroups(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  }

  const areaOptions = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return [...new Set([...hrAreas, ...holidays.map(holiday => holiday.hrArea)])]
      .filter(area => !isHiddenHolidayArea(area))
      .sort((first, second) => first.localeCompare(second, 'pt-BR'))
      .filter(area => normalize(area).includes(normalize(areaSearch)))
  }, [hrAreas, holidays, areaSearch])

  async function persistConfiguration(nextTargets: PresenceTarget[], nextContractTargets: ContractPresenceTarget[], nextHolidays: AreaHoliday[]) {
    try {
      const response = await fetch('/api/management/import', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: nextTargets, contractTargets: nextContractTargets, holidays: nextHolidays }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar as configurações.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as configurações.')
    }
  }

  function addSubgroup(percentage: number) {
    const subgroup = (newSubgroups[percentage] ?? '').trim().toUpperCase()
    if (!subgroup) return
    const existing = targets.find(target => target.subgroup === subgroup)
    const nextTargets = existing
      ? targets.map(target => target.subgroup === subgroup ? { ...target, percentage } : target)
      : [...targets, { id: Date.now(), subgroup, percentage }]
    setTargets(nextTargets)
    void persistConfiguration(nextTargets, contractTargets, holidays)
    setNewSubgroups(current => ({ ...current, [percentage]: '' }))
    setSaved(false)
  }

  function removeTarget(id: number) {
    const nextTargets = targets.filter(target => target.id !== id)
    setTargets(nextTargets)
    void persistConfiguration(nextTargets, contractTargets, holidays)
    setSaved(false)
  }

  function moveTarget(id: number, percentage: number) {
    const nextTargets = targets.map(target => target.id === id ? { ...target, percentage } : target)
    setTargets(nextTargets)
    void persistConfiguration(nextTargets, contractTargets, holidays)
    setDraggedTargetId(null)
    setDragOverPercentage(null)
    setSaved(false)
  }

  function addContractTarget() {
    const contractType = newContractType || availableContractTypes[0]
    if (!contractType) return
    const nextContractTargets = [...contractTargets, { contractType, minimumDays: newContractMinimumDays }]
    setContractTargets(nextContractTargets)
    void persistConfiguration(targets, nextContractTargets, holidays)
    setNewContractType('')
    setNewContractMinimumDays(1)
    setSaved(false)
  }

  function updateContractTarget(contractType: ContractType, minimumDays: number) {
    const nextContractTargets = contractTargets.map(target => target.contractType === contractType ? { ...target, minimumDays } : target)
    setContractTargets(nextContractTargets)
    void persistConfiguration(targets, nextContractTargets, holidays)
    setSaved(false)
  }

  function removeContractTarget(contractType: ContractType) {
    const nextContractTargets = contractTargets.filter(target => target.contractType !== contractType)
    setContractTargets(nextContractTargets)
    void persistConfiguration(targets, nextContractTargets, holidays)
    setSaved(false)
  }

  function openHolidayModal(areas: string[]) {
    setHolidayModalAreas(areas)
    setAreaSearch('')
  }

  function toggleModalArea(area: string) {
    setHolidayModalAreas(current => current?.includes(area) ? current.filter(item => item !== area) : [...(current ?? []), area])
  }

  function isHolidayForAll(areas: string[], date: string) {
    return areas.length > 0 && areas.every(area => holidays.some(holiday => holiday.hrArea === area && holiday.date === date))
  }

  function toggleHoliday(day: number) {
    const areas = holidayModalAreas ?? []
    if (areas.length === 0) return
    const date = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const nextHolidays = isHolidayForAll(areas, date)
      ? holidays.filter(holiday => !(holiday.date === date && areas.includes(holiday.hrArea)))
      : [...holidays, ...areas.filter(area => !holidays.some(holiday => holiday.hrArea === area && holiday.date === date)).map(hrArea => ({ hrArea, date }))]
    setHolidays(nextHolidays)
    void persistConfiguration(targets, contractTargets, nextHolidays)
    setSaved(false)
  }

  function removeHoliday(areas: string[], date: string) {
    const nextHolidays = holidays.filter(holiday => !(holiday.date === date && areas.includes(holiday.hrArea)))
    setHolidays(nextHolidays)
    void persistConfiguration(targets, contractTargets, nextHolidays)
    setSaved(false)
  }

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear()
    const month = calendarMonth.getMonth()
    const leadingDays = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return [...Array(leadingDays).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)] as (number | null)[]
  }, [calendarMonth])

  async function handleRemoveImport(source: UploadKey, period: string, fileName: string) {
    const sourceName = uploadDefinitions.find(upload => upload.key === source)?.name ?? source
    if (!window.confirm(`Remover ${fileName} (${sourceName}) de ${formatPeriodLabel(period)}? Os dados desse arquivo serão apagados do banco e os números do dashboard serão recalculados.`)) return
    setError('')
    setSaved(false)
    try {
      const response = await fetch('/api/management/import', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, period }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Não foi possível remover o arquivo.')
      setSavedMessage(`${fileName} removido de ${formatPeriodLabel(period)}.`)
      setSaved(true)
      loadSourceImports()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível remover o arquivo.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const selectedUploads = uploadDefinitions.filter(upload => files[upload.key])
    if (selectedUploads.length === 0) {
      setError('Selecione ao menos um arquivo.')
      return
    }
    const replaced = selectedUploads.filter(upload => existingImports.has(upload.key))
    if (replaced.length > 0 && !window.confirm(`Já existe ${replaced.map(upload => upload.name).join(', ')} importado para ${formatPeriodLabel(referencePeriodKey)}. Deseja substituir?`)) return

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('year', String(referencePeriod.year))
      formData.append('month', String(referencePeriod.month))
      for (const upload of selectedUploads) formData.append(upload.key, files[upload.key]!)

      const response = await fetch('/api/management/import', { method: 'POST', body: formData })
      const result = await response.json() as { error?: string; results?: Partial<Record<UploadKey, { rows: number; ignoredRows: number }>> }
      if (!response.ok) throw new Error(result.error || 'Não foi possível importar os arquivos.')
      const ignoredLenelRows = result.results?.lenel?.ignoredRows ?? 0
      setSavedMessage(`${selectedUploads.map(upload => upload.name).join(', ')} ${selectedUploads.length === 1 ? 'importado' : 'importados'} para ${formatPeriodLabel(referencePeriodKey)}.${ignoredLenelRows ? ` ${ignoredLenelRows.toLocaleString('pt-BR')} linhas do Lenel de outros meses foram ignoradas.` : ''}`)
      setSaved(true)
      setFiles(noFiles)
      setFileInputsKey(current => current + 1)
      loadSourceImports()
    } catch (importError) {
      setSaved(false)
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar os arquivos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="light min-h-screen bg-[linear-gradient(135deg,#f4f9fc_0%,#f8fbfa_52%,#eef7fb_100%)] text-slate-700">
      <div className="h-[4px] w-full bg-[#e20015]" style={{ backgroundImage: `url(${boschSupergraphicUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
      <header className="border-b border-[#d9e5ee] bg-white shadow-sm">
        <div className="flex h-16 items-center justify-between px-5 lg:px-10">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-32 items-center justify-center">
              <img src={boschLogoUrl} alt="Bosch" className="h-12 w-auto max-w-none object-contain" />
            </div>
            <div className="h-8 w-px bg-[#d9e5ee]" />
            <div>
              <p className="text-sm font-bold text-slate-700">Smart Check | On-Site Work</p>
              <p className="text-[10px] uppercase tracking-[.18em] text-[#1475bd]">People Analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
          <UserMenu />
          <Link href="/" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#c9ddea] bg-white px-3.5 text-xs font-semibold text-[#1269a8] transition hover:bg-[#f1f7fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1475bd]/30">
            <ArrowLeft className="size-4" /> Voltar ao dashboard
          </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-5 py-8 lg:px-8 lg:py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#1475bd]"><Settings2 className="size-4" /> Administração de dados</div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#183b56]">Management</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Atualize as fontes utilizadas pelo Smart Check e configure metas específicas quando necessário.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[#d4e3ec] bg-white px-4 py-3 shadow-[0_6px_20px_rgba(23,67,96,0.06)]">
            <div className="grid size-9 place-items-center rounded-lg bg-[#e9f4fb] text-[#1475bd]"><FileSpreadsheet className="size-[18px]" /></div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Arquivos selecionados</p><p className="text-sm font-semibold text-[#183b56]">{selectedFiles} de {uploadDefinitions.length}</p></div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-[#d8e5ee] bg-white shadow-[0_12px_34px_rgba(23,67,96,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#dce8f0] px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-[#e7f2fa] text-[#1269a8]"><UploadCloud className="size-5" /></div>
                <div><h2 className="text-[17px] font-semibold text-[#183b56]">Fontes de dados</h2><p className="mt-0.5 text-xs text-slate-500">Envie um ou mais arquivos do mês de referência. Reenviar um arquivo do mesmo mês substitui só aquele arquivo.</p></div>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#587386]">Mês de referência</span>
                  <select value={referencePeriod.month} onChange={event => setReferencePeriod(current => ({ ...current, month: Number(event.target.value) }))} className="h-10 rounded-lg border border-[#c8dae7] bg-white px-3 text-sm font-semibold text-[#183b56] outline-none focus:border-[#1475bd]">
                    {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                  </select>
                </label>
                <select aria-label="Ano de referência" value={referencePeriod.year} onChange={event => setReferencePeriod(current => ({ ...current, year: Number(event.target.value) }))} className="h-10 rounded-lg border border-[#c8dae7] bg-white px-3 text-sm font-semibold text-[#183b56] outline-none focus:border-[#1475bd]">
                  {historyYears.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
            </div>
            <div key={fileInputsKey} className="grid gap-4 p-6 md:grid-cols-3">
              {uploadDefinitions.map(upload => {
                const file = files[upload.key]
                const existing = existingImports.get(upload.key)
                return <label key={upload.key} className="group relative flex min-h-52 cursor-pointer flex-col overflow-hidden rounded-xl border border-[#d9e5ed] bg-[#fbfdfe] transition hover:-translate-y-0.5 hover:border-[#aecddd] hover:bg-white hover:shadow-[0_10px_24px_rgba(23,67,96,0.09)]">
                  <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: upload.accent }} />
                  <input type="file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain" className="sr-only" onChange={event => updateFile(upload.key, event.target.files?.[0] ?? null)} />
                  <span className="flex flex-1 flex-col items-center justify-center px-5 py-6 text-center">
                    <span className="mb-4 grid size-12 place-items-center rounded-xl bg-white text-[#527086] shadow-sm ring-1 ring-[#dbe7ee] transition group-hover:text-[#1475bd]"><FileSpreadsheet className="size-6" /></span>
                    <strong className="text-base font-semibold text-[#183b56]">{upload.name}</strong>
                    <span className="mt-1.5 min-h-9 text-xs leading-[18px] text-slate-500">{upload.description}</span>
                    {file ? <span className="mt-4 flex max-w-full items-center gap-2 rounded-lg bg-[#eaf6f1] px-3 py-2 text-left text-[11px] font-semibold text-[#21775f]"><CheckCircle2 className="size-4 shrink-0" /><span className="truncate">{file.name}</span><span className="shrink-0 font-normal text-[#5d8577]">{formatFileSize(file.size)}</span></span> : <span className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#cbdde8] bg-white px-3 py-2 text-xs font-semibold text-[#1269a8]"><UploadCloud className="size-4" /> Selecionar arquivo</span>}
                    {file && existing && <span className="mt-2 text-[11px] font-semibold text-[#b66326]">Este arquivo substitui o {upload.name} de {formatPeriodLabel(referencePeriodKey)}</span>}
                  </span>
                </label>
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e2ebf1] bg-[#f8fbfd] px-6 py-4">
              <div>{error ? <p className="text-sm font-semibold text-[#c84d55]">{error}</p> : saved ? <p className="flex items-center gap-2 text-sm font-semibold text-[#21775f]"><CheckCircle2 className="size-5" /> {savedMessage}</p> : <p className="text-xs text-slate-500">Formatos aceitos: XLSX, XLS, CSV e TXT. O mês é identificado pelo nome do arquivo quando possível.</p>}</div>
              <button type="submit" disabled={saving || selectedFiles === 0} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#116da9] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c5d92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1475bd]/30 disabled:cursor-not-allowed disabled:opacity-60"><Save className="size-4" /> {saving ? 'Importando...' : `Importar para ${formatPeriodLabel(referencePeriodKey)}`}</button>
            </div>
            <div className="border-t border-[#e2ebf1] px-6 py-5">
              <h3 className="mb-3 text-sm font-semibold text-[#183b56]">Histórico de importações</h3>
              {importHistory.length === 0 ? <p className="rounded-xl border border-dashed border-[#d9e5ed] px-4 py-5 text-center text-sm text-slate-400">Nenhum arquivo importado.</p> : <div className="max-h-[320px] overflow-auto rounded-xl border border-[#e2ebf1]">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#547086] [&>th]:sticky [&>th]:top-0 [&>th]:bg-[#f3f7fa] [&>th]:px-4 [&>th]:py-2.5"><th>Mês</th>{uploadDefinitions.map(upload => <th key={upload.key}>{upload.name}</th>)}</tr></thead>
                  <tbody>{importHistory.map(([period, sources]) => <tr key={period} onClick={() => setReferencePeriod({ year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) })} className={`cursor-pointer border-t border-[#edf2f6] transition hover:bg-[#f0f7fc] ${period === referencePeriodKey ? 'bg-[#eaf4fb]' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#183b56]">{formatPeriodLabel(period)}</td>
                    {uploadDefinitions.map(upload => {
                      const item = sources[upload.key]
                      return <td key={upload.key} className="group/import px-4 py-2.5">{item ? <span className="flex items-start gap-1.5"><span className="flex min-w-0 flex-col"><span className="flex items-center gap-1.5 font-semibold text-[#21775f]"><CheckCircle2 className="size-3.5 shrink-0" /><span className="max-w-40 truncate" title={item.fileName}>{item.fileName}</span></span><span className="pl-5 text-[10px] text-slate-400">{formatImportDate(item.importedAt)} · {item.rowCount.toLocaleString('pt-BR')} linhas</span></span><span className="flex shrink-0 flex-col"><button type="button" onClick={event => { event.stopPropagation(); handleRemoveImport(upload.key, period, item.fileName) }} aria-label={`Remover ${item.fileName}`} title="Remover do histórico" className="grid size-5 shrink-0 place-items-center rounded text-slate-400 opacity-0 transition hover:bg-[#fdecec] hover:text-[#c84d55] focus-visible:opacity-100 group-hover/import:opacity-100"><Trash2 className="size-3.5" /></button><a href={`/api/management/import/download?source=${upload.key}&period=${period}`} download onClick={event => event.stopPropagation()} aria-label={`Baixar ${item.fileName}`} title="Baixar dados" className="grid size-5 shrink-0 place-items-center rounded text-slate-400 opacity-0 transition hover:bg-[#e8f2fa] hover:text-[#1269a8] focus-visible:opacity-100 group-hover/import:opacity-100"><Download className="size-3.5" /></a></span></span> : <span className="text-slate-300">—</span>}</td>
                    })}
                  </tr>)}</tbody>
                </table>
              </div>}
            </div>
          </section>

          <AccessSection />

          <section className="overflow-hidden rounded-2xl border border-[#d6e7e1] bg-white shadow-[0_12px_34px_rgba(26,94,75,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce9e4] px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-[#e5f5ef] text-[#21856c]"><UsersRound className="size-5" /></div>
                <div><h2 className="text-[17px] font-semibold text-[#183f37]">Metas de presença</h2><p className="mt-0.5 text-xs text-slate-500">Regras por subgrupo e por tipo de contrato, aplicadas ao status individual no dashboard.</p></div>
              </div>
              {newPercentage === null
                ? <button type="button" onClick={() => setNewPercentage('')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#bcd9cf] bg-[#f3faf7] px-3 text-xs font-semibold text-[#21775f] transition hover:bg-[#e8f5f0]"><Plus className="size-4" /> Nova meta</button>
                : <div className="flex items-center gap-2">
                  <div className="relative">
                    <input autoFocus value={newPercentage} onChange={event => setNewPercentage(event.target.value.replace(/[^\d.,]/g, ''))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addPercentage() } if (event.key === 'Escape') setNewPercentage(null) }} placeholder="Ex.: 40" inputMode="numeric" maxLength={5} aria-label="Percentual da nova meta" className="h-9 w-24 rounded-lg border border-[#ccddd7] bg-white pl-3 pr-7 text-sm font-semibold text-[#264d42] outline-none transition focus:border-[#67ad96] focus:ring-2 focus:ring-[#269a7d]/15" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#7a9a90]">%</span>
                  </div>
                  <button type="button" onClick={addPercentage} className="inline-flex h-9 items-center rounded-lg bg-[#21856c] px-3 text-xs font-semibold text-white transition hover:bg-[#1b6f5a]">Criar</button>
                  <button type="button" onClick={() => setNewPercentage(null)} className="inline-flex h-9 items-center rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100">Cancelar</button>
                </div>}
            </div>
            <div className="px-6 py-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-[#183f37]">Metas por subgrupo</h3>
                <p className="mt-0.5 text-xs text-slate-500">Percentual mínimo dos dias úteis. Subgrupos fora desta lista são ignorados no dashboard.</p>
              </div>
              <div className="space-y-3">
                {targetGroups.map(group => <div key={group.percentage} onDragOver={event => { event.preventDefault(); setDragOverPercentage(group.percentage) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverPercentage(null) }} onDrop={event => { event.preventDefault(); if (draggedTargetId !== null) moveTarget(draggedTargetId, group.percentage) }} className={`flex flex-col gap-3 rounded-xl border p-3 transition sm:flex-row sm:items-center ${dragOverPercentage === group.percentage ? 'border-[#269a7d] bg-[#eaf7f2] ring-2 ring-[#269a7d]/15' : 'border-[#dce9e4] bg-[#fbfdfc]'}`}>
                  <div className="relative flex w-24 shrink-0 items-center justify-center rounded-lg bg-[#e7f5f0] px-3 py-2 text-sm font-bold text-[#21775f]">{group.percentage}%
                    {group.targets.length === 0 && group.percentage !== 80 && group.percentage !== 60 && <button type="button" onClick={() => setExtraPercentages(current => current.filter(percentage => percentage !== group.percentage))} aria-label={`Remover meta de ${group.percentage}%`} title="Remover meta" className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full border border-[#d6e5df] bg-white text-[11px] text-[#87a49b] shadow-sm transition hover:text-[#c84d55]">×</button>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {group.targets.map(target => <span key={target.id} draggable onDragStart={event => { setDraggedTargetId(target.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', target.subgroup) }} onDragEnd={() => { setDraggedTargetId(null); setDragOverPercentage(null) }} className={`group/badge inline-flex h-8 cursor-grab items-center gap-1 rounded-full border border-[#bdd8ce] bg-white pl-2 pr-1.5 text-xs font-bold text-[#264d42] shadow-sm active:cursor-grabbing ${draggedTargetId === target.id ? 'opacity-40' : ''}`}>
                      <GripVertical className="size-3.5 text-[#91aaa2]" />{target.subgroup}
                      <button type="button" onClick={() => removeTarget(target.id)} aria-label={`Remover ${target.subgroup} da meta de ${group.percentage}%`} className="grid size-5 place-items-center rounded-full text-[#87a49b] opacity-50 transition hover:bg-[#fdecec] hover:text-[#c84d55] group-hover/badge:opacity-100"><span aria-hidden="true">×</span></button>
                    </span>)}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input value={newSubgroups[group.percentage] ?? ''} onChange={event => setNewSubgroups(current => ({ ...current, [group.percentage]: event.target.value.toUpperCase() }))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSubgroup(group.percentage) } }} placeholder="Adicionar sigla" maxLength={8} className="h-9 w-36 rounded-lg border border-[#ccddd7] bg-white px-3 text-xs font-semibold uppercase text-[#264d42] outline-none transition focus:border-[#67ad96] focus:ring-2 focus:ring-[#269a7d]/15" />
                    <button type="button" onClick={() => addSubgroup(group.percentage)} aria-label={`Adicionar subgrupo à meta de ${group.percentage}%`} className="grid size-9 place-items-center rounded-lg border border-[#bcd9cf] bg-white text-[#21775f] transition hover:bg-[#e8f5f0]"><Plus className="size-4" /></button>
                  </div>
                </div>)}
              </div>
              <div className="mt-6 border-t border-[#dce9e4] pt-5">
                <div className="mb-3 flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eef5fa] text-[#1269a8]"><BriefcaseBusiness className="size-[18px]" /></div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#183f37]">Metas por tipo de contrato</h3>
                    <p className="mt-0.5 text-xs text-slate-500">A quantidade mínima de dias só substitui a meta do subgrupo quando ela for de 60%; metas de 80% continuam percentuais. Além disso, HO Preponderante acima de 50% presencial não está conforme.</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {contractTargets.map(target => <div key={target.contractType} className="flex flex-col gap-3 rounded-xl border border-[#dce6ee] bg-[#fbfdfe] p-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="inline-flex h-8 items-center rounded-full border border-[#c8dce9] bg-white px-3 text-xs font-bold text-[#294f68]">{target.contractType}</span>
                      <span className="text-xs text-slate-500">{target.contractType === 'HO Preponderante' ? 'substitui os 60% e permite no máximo 50% presencial' : 'substitui os 60% do subgrupo'}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <select value={target.minimumDays} onChange={event => updateContractTarget(target.contractType, Number(event.target.value))} aria-label={`Dias presenciais para ${target.contractType}`} className="h-9 rounded-lg border border-[#c8dce9] bg-white px-3 text-sm font-bold text-[#1269a8] outline-none focus:border-[#1475bd]">
                        {Array.from({ length: 32 }, (_, days) => <option key={days} value={days}>{days}</option>)}
                      </select>
                      <span className="min-w-32 text-xs font-medium text-[#526b7c]">{target.minimumDays === 1 ? 'dia útil presencial' : 'dias úteis presenciais'}</span>
                      <button type="button" onClick={() => removeContractTarget(target.contractType)} aria-label={`Remover meta de ${target.contractType}`} title="Remover meta" className="grid size-8 place-items-center rounded-lg text-[#87a0b0] transition hover:bg-[#fdecec] hover:text-[#c84d55]">×</button>
                    </div>
                  </div>)}
                </div>
                {availableContractTypes.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#cbdde8] bg-[#f8fbfd] p-3">
                  <select value={newContractType || availableContractTypes[0]} onChange={event => setNewContractType(event.target.value as ContractType)} aria-label="Tipo de contrato da nova meta" className="h-9 min-w-52 rounded-lg border border-[#c8dce9] bg-white px-3 text-sm font-semibold text-[#294f68] outline-none focus:border-[#1475bd]">
                    {availableContractTypes.map(contractType => <option key={contractType} value={contractType}>{contractType}</option>)}
                  </select>
                  <select value={newContractMinimumDays} onChange={event => setNewContractMinimumDays(Number(event.target.value))} aria-label="Dias presenciais da nova meta" className="h-9 rounded-lg border border-[#c8dce9] bg-white px-3 text-sm font-bold text-[#1269a8] outline-none focus:border-[#1475bd]">
                    {Array.from({ length: 32 }, (_, days) => <option key={days} value={days}>{days}</option>)}
                  </select>
                  <span className="text-xs font-medium text-[#526b7c]">{newContractMinimumDays === 1 ? 'dia útil presencial' : 'dias úteis presenciais'}</span>
                  <button type="button" onClick={addContractTarget} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#bcd9cf] bg-white px-3 text-xs font-semibold text-[#21775f] transition hover:bg-[#e8f5f0]"><Plus className="size-4" /> Adicionar contrato</button>
                </div>}
              </div>
            </div>
          </section>

          <ExternalSection period={referencePeriodKey} refreshKey={fileInputsKey} />

          <ExclusionsSection period={referencePeriodKey} refreshKey={fileInputsKey} />

          <section className="overflow-hidden rounded-2xl border border-[#efd4d6] bg-white shadow-[0_12px_34px_rgba(145,45,54,0.07)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0dfe0] px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-[#fceced] text-[#c64550]"><CalendarDays className="size-5" /></div>
                <div><h2 className="text-[17px] font-semibold text-[#65343a]">Feriados</h2><p className="mt-0.5 text-xs font-medium text-[#c64550]">As datas cadastradas serão descontadas dos dias úteis do respectivo mês.</p></div>
              </div>
              <button type="button" onClick={() => openHolidayModal([])} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e2c1c4] bg-[#fff6f6] px-3 text-xs font-semibold text-[#b53d47] transition hover:bg-[#fceced]"><Plus className="size-4" /> Adicionar</button>
            </div>
            <div className="space-y-2 px-6 py-5">
              {holidayGroups.length === 0 ? <p className="rounded-xl border border-dashed border-[#ead7d8] px-4 py-5 text-center text-sm text-slate-400">Nenhuma área de recursos humanos encontrada.</p> : holidayGroups.map(group => {
                const expanded = expandedHolidayGroups.includes(group.key)
                return <div key={group.key} className="overflow-hidden rounded-xl border border-[#eee0e1] bg-[#fffafa]">
                <div onDoubleClick={() => toggleHolidayGroup(group.key)} className={`flex cursor-pointer select-none items-center justify-between gap-3 bg-[#fdf3f4] px-4 py-2.5 ${expanded && group.months.length > 0 ? 'border-b border-[#f1e3e4]' : ''}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm text-[#65343a]">{formatAreaList(group.areas)}</strong>
                    {group.months.length > 0 && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#b53d47] ring-1 ring-[#efd4d6]">{group.months.reduce((sum, [, dates]) => sum + dates.length, 0)}</span>}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button type="button" onDoubleClick={event => event.stopPropagation()} onClick={() => toggleHolidayGroup(group.key)} aria-expanded={expanded} aria-label={`${expanded ? 'Recolher' : 'Expandir'} feriados de ${formatAreaList(group.areas)}`} className="grid size-8 place-items-center rounded-lg text-[#8d555a] transition hover:bg-white"><ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
                  </div>
                </div>
                {expanded && <div className="divide-y divide-[#f3e7e8]">
                  {group.months.map(([month, dates]) => <div key={month} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                    <span className="w-36 shrink-0 text-sm font-semibold capitalize text-[#85454b]">{new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))} <span className="text-xs font-normal text-[#b88d91]">{month.slice(0, 4)}</span></span>
                    <div className="flex flex-wrap gap-2">{dates.map(date => <span key={date} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e5cacc] bg-white pl-3 pr-1.5 text-xs font-semibold tabular-nums text-[#85454b]">{date.slice(8, 10)}<button type="button" onClick={() => removeHoliday(group.areas, date)} aria-label={`Remover feriado de ${date} para ${formatAreaList(group.areas)}`} className="grid size-5 place-items-center rounded-full text-[#b8787e] transition hover:bg-[#fde7e8] hover:text-[#b52f3b]">×</button></span>)}</div>
                  </div>)}
                </div>}
              </div>
              })}
            </div>
          </section>
        </form>
      </main>
      {holidayModalAreas && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHolidayModalAreas(null) }} className="fixed inset-0 z-50 grid place-items-center bg-[#17384f]/25 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="holiday-calendar-title" className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#ead4d6] bg-white shadow-[0_24px_70px_rgba(70,25,30,0.24)]">
          <div className="flex items-center justify-between border-b border-[#f0dfe0] px-5 py-4">
            <div><h3 id="holiday-calendar-title" className="font-semibold text-[#65343a]">Adicionar feriado</h3><p className="mt-0.5 text-xs text-[#b15a62]">Selecione as áreas de recursos humanos e clique nas datas</p></div>
            <button type="button" onClick={() => setHolidayModalAreas(null)} aria-label="Fechar calendário" className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-[#fceced] hover:text-[#b53d47]">×</button>
          </div>
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 sm:grid-cols-[1fr_1.2fr]">
            <div className="flex min-h-0 flex-col">
              <span className="mb-2 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8d555a]">Área de recursos humanos</span>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#b88d91]" />
                <input value={areaSearch} onChange={event => setAreaSearch(event.target.value)} placeholder="Buscar área..." className="h-9 w-full rounded-lg border border-[#ead9da] bg-[#fffafa] pl-9 pr-3 text-sm text-black outline-none transition placeholder:text-slate-400 focus:border-[#c64550] focus:bg-white" />
              </div>
              <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-[#f0e2e3] p-1">
                {areaOptions.map(area => {
                  const selected = holidayModalAreas.includes(area)
                  return <button key={area} type="button" onClick={() => toggleModalArea(area)} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition ${selected ? 'bg-[#fdeeef] text-[#9e3540]' : 'text-[#5b4a4c] hover:bg-[#fff5f5]'}`}>
                    <span className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${selected ? 'border-[#c64550] bg-[#c64550] text-white' : 'border-[#d9c3c5] bg-white'}`}>{selected && '✓'}</span>
                    <span className="truncate">{area}</span>
                  </button>
                })}
                {areaOptions.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">Nenhuma área encontrada</p>}
              </div>
            </div>
            <div>
            <div className="mb-4 flex items-center justify-between">
              <button type="button" onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-lg border border-[#ead9da] text-[#8d555a] transition hover:bg-[#fff5f5]"><ChevronLeft className="size-4" /></button>
              <strong className="text-sm capitalize text-[#65343a]">{new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(calendarMonth)}</strong>
              <button type="button" onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-lg border border-[#ead9da] text-[#8d555a] transition hover:bg-[#fff5f5]"><ChevronRight className="size-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <span key={day} className="py-1 text-[10px] font-bold uppercase text-slate-400">{day}</span>)}
              {calendarDays.map((day, index) => {
                if (day === null) return <span key={`empty-${index}`} />
                const date = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const selected = isHolidayForAll(holidayModalAreas, date)
                const weekday = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day).getDay()
                return <button key={date} type="button" disabled={holidayModalAreas.length === 0} onClick={() => toggleHoliday(day)} className={`grid aspect-square place-items-center rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'bg-[#c64550] text-white hover:bg-[#ad3843]' : weekday === 0 || weekday === 6 ? 'text-[#bd7c82] hover:bg-[#fff0f1]' : 'text-[#4e5f69] hover:bg-[#fceced] hover:text-[#a93640]'}`}>{day}</button>
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">{holidayModalAreas.length === 0 ? 'Selecione ao menos uma área para escolher as datas.' : `Clique em uma data para incluir ou remover o feriado de ${formatAreaList(holidayModalAreas)}.`}</p>
            </div>
          </div>
          <div className="flex justify-end border-t border-[#f0dfe0] bg-[#fffafa] px-5 py-3">
            <button type="button" onClick={() => setHolidayModalAreas(null)} className="inline-flex h-9 items-center rounded-lg bg-[#c64550] px-4 text-sm font-semibold text-white transition hover:bg-[#ad3843]">Concluir</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
