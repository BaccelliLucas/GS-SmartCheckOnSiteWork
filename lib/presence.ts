import { database, dataVersion } from '@/lib/database'

type EmployeeRecord = {
  edv: string
  full_name: string
  subgroup: string | null
  hr_area_name: string | null
  division: string | null
  position_name: string | null
  flexible_schedule: string | null
  organizational_unit: string | null
  predominant_home_office: string | null
  disciplinary_manager: string | null
  manager_name: string | null
  manager_email: string | null
}

type AccessRecord = { edv: string; access_date: string }
type AbsenceRecord = { edv: string; absence_type: string | null; start_date: string | null; end_date: string | null; days: string | null }
export type PresenceTarget = { subgroup: string; percentage: number }
export type ContractPresenceTarget = { contractType: EmployeeDashboardRow['contractType']; minimumDays: number }
export type SourceImport = { source: string; period: string; imported_at: string }
export type EmployeeDashboardRow = {
  edv: string
  name: string
  subgroup: string
  hrArea: string
  division: string
  position: string
  flexibleSchedule: string
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
  // Um caractere por dia do mês: o = escritório, t = viagem bTravel em dia útil (conta como presença, com ou sem entrada no escritório),
  // e = serviço externo em dia útil sem entrada nem viagem (conta como presença), h = casa, a = ausência (IT2001),
  // f = feriado, w = fim de semana; A/F/W = ausência/feriado/fim de semana em que a pessoa estava viajando (não conta presença);
  // B = ausência (IT2001) em dia com entrada no escritório (sai dos dias úteis, mas a entrada conta presença)
  calendar: string
}

// Áreas de recursos humanos ignoradas em todo o sistema, mesmo que venham nas planilhas
const excludedHrAreas = new Set(['sales office sp', 'chile', 'panama colon', 'peru'])

function normalizeAreaName(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function isExcludedHrArea(value: string | null | undefined) {
  return excludedHrAreas.has(normalizeAreaName(value ?? ''))
}

function contractType(value: string | null): EmployeeDashboardRow['contractType'] {
  if (!value?.trim()) return 'Presencial'
  const normalized = value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  if (['0', 'nao', 'no', 'false', 'n'].includes(normalized)) return 'Presencial'
  return normalized.includes('100%') ? 'Home Office 100%' : 'HO Preponderante'
}

function businessDaysInMonth(year: number, month: number, holidays: Set<string>) {
  let total = 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date)) total += 1
  }
  return total
}

function isWeekday(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

function normalizeDate(value: string | null) {
  const trimmed = value?.trim() ?? ''
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  const longYearMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (longYearMatch) {
    const first = Number(longYearMatch[1])
    const second = Number(longYearMatch[2])
    const month = second > 12 ? first : second
    const day = second > 12 ? second : first
    return `${longYearMatch[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const shortYearUsMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})/)
  if (shortYearUsMatch) return `20${shortYearUsMatch[3]}-${shortYearUsMatch[1].padStart(2, '0')}-${shortYearUsMatch[2].padStart(2, '0')}`
  return ''
}

function numericValue(value: string | null) {
  let normalized = (value ?? '').replace(/\s/g, '')
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '')
  } else {
    normalized = normalized.replace(',', '.')
  }
  return Number(normalized)
}

export function roundPercentage(value: number) {
  return Math.round(value * 10) / 10
}

const nameSuffixes = new Set(['JUNIOR', 'JÚNIOR', 'JR', 'JR.', 'FILHO', 'NETO', 'NETTO', 'SOBRINHO'])

// Primeiro nome + último sobrenome (ex.: "Maria Aparecida da Silva Souza" → "Maria Souza"); "Júnior", "Filho" etc. acompanham o sobrenome
function shortName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return parts.join(' ')
  const lastIndex = parts.length - 1
  const surnameStart = nameSuffixes.has(parts[lastIndex].toUpperCase()) && lastIndex > 1 ? lastIndex - 1 : lastIndex
  return [parts[0], ...parts.slice(surnameStart)].join(' ')
}

function managerDetails(value: string | null) {
  const manager = value?.trim() ?? ''
  const email = manager.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? ''
  const name = email ? manager.replace(email, '').replace(/[|;,()<>-]+$/g, '').trim() : manager
  return { name, email }
}

// Escolhe o mês do IT007/IT2001 a usar: o próprio mês ou, na falta dele, o mais próximo na direção preferida
function pickSourcePeriod(periods: string[], target: string, prefer: 'earlier' | 'later') {
  if (periods.includes(target)) return target
  const earlier = periods.filter(period => period < target).sort().at(-1)
  const later = periods.filter(period => period > target).sort()[0]
  return prefer === 'earlier' ? earlier ?? later ?? null : later ?? earlier ?? null
}

export function listSourceImports() {
  return database.prepare('SELECT source, period, imported_at FROM source_imports ORDER BY period DESC').all() as unknown as SourceImport[]
}

function numericEdv(value: string) {
  return value.trim().replace(/^0+(?=\d)/, '')
}

// Dias em viagem por EDV, a partir de todos os arquivos do bTravel importados (uma viagem pode atravessar meses).
// Cada reserva (PNR) vai da primeira à última "Arrive Date"; reservas de um trecho só (só ida ou só volta) são
// pareadas em ordem de data com a próxima do mesmo EDV.
function travelDaysByEdv(firstDay: string, lastDay: string) {
  const files = database.prepare("SELECT headers, rows FROM raw_source_files WHERE source = 'btravel'").all() as unknown as { headers: string; rows: string }[]
  const ranges = new Map<string, [string, string][]>()
  // Bases antigas do bTravel (TXT): viagens já montadas, do embarque ao retorno
  for (const trip of database.prepare('SELECT edv, start_date, end_date FROM btravel_trips WHERE start_date <= ? AND end_date >= ?').all(lastDay, firstDay) as unknown as { edv: string; start_date: string; end_date: string }[]) {
    ranges.set(trip.edv, [...(ranges.get(trip.edv) ?? []), [trip.start_date, trip.end_date]])
  }
  for (const file of files) {
    const headers = (JSON.parse(file.headers) as string[]).map(header => header.trim().toLowerCase())
    const edvIndex = headers.indexOf('reporting 6')
    const dateIndex = headers.indexOf('arrive date')
    const pnrIndex = headers.indexOf('pnr')
    if (edvIndex < 0 || dateIndex < 0) continue
    const datesByReservation = new Map<string, string[]>()
    for (const row of JSON.parse(file.rows) as string[][]) {
      const edv = numericEdv(row[edvIndex] ?? '')
      const date = normalizeDate(row[dateIndex] ?? '')
      if (!/^\d+$/.test(edv) || !date) continue
      const key = `${edv}|${pnrIndex >= 0 ? row[pnrIndex] ?? '' : ''}`
      datesByReservation.set(key, [...(datesByReservation.get(key) ?? []), date])
    }
    const singleLegs = new Map<string, string[]>()
    for (const [key, dates] of datesByReservation) {
      const edv = key.split('|')[0]
      if (dates.length === 1) {
        singleLegs.set(edv, [...(singleLegs.get(edv) ?? []), dates[0]])
        continue
      }
      const sorted = [...dates].sort()
      ranges.set(edv, [...(ranges.get(edv) ?? []), [sorted[0], sorted.at(-1)!]])
    }
    for (const [edv, dates] of singleLegs) {
      const sorted = [...dates].sort()
      for (let index = 0; index < sorted.length; index += 2) ranges.set(edv, [...(ranges.get(edv) ?? []), [sorted[index], sorted[index + 1] ?? sorted[index]]])
    }
  }
  const days = new Map<string, Set<string>>()
  for (const [edv, edvRanges] of ranges) {
    for (const [start, end] of edvRanges) {
      const consideredStart = start > firstDay ? start : firstDay
      const consideredEnd = end < lastDay ? end : lastDay
      for (let timestamp = Date.parse(`${consideredStart}T00:00:00Z`); timestamp <= Date.parse(`${consideredEnd}T00:00:00Z`); timestamp += 86_400_000) {
        if (!days.has(edv)) days.set(edv, new Set())
        days.get(edv)!.add(new Date(timestamp).toISOString().slice(0, 10))
      }
    }
  }
  return days
}

// Dias de serviço externo por EDV no mês (de qualquer arquivo importado, pela data do serviço)
function externalDaysByEdv(firstDay: string, lastDay: string) {
  const days = new Map<string, Set<string>>()
  for (const service of database.prepare('SELECT DISTINCT edv, service_date FROM external_services WHERE service_date BETWEEN ? AND ?').all(firstDay, lastDay) as unknown as { edv: string; service_date: string }[]) {
    if (!days.has(service.edv)) days.set(service.edv, new Set())
    days.get(service.edv)!.add(service.service_date)
  }
  return days
}

export const exclusionCategories = ['edv', 'division', 'organizationalUnit', 'hrArea', 'subgroup', 'position', 'flexibleSchedule'] as const
export type ExclusionCategory = (typeof exclusionCategories)[number]
export type ExclusionRule = { category: ExclusionCategory; value: string }

export function normalizeExclusionValue(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
}

export function listExclusionRules() {
  return database.prepare('SELECT category, value FROM exclusion_rules ORDER BY category, value').all() as unknown as ExclusionRule[]
}

export function listPresenceTargets() {
  return database.prepare('SELECT subgroup, percentage FROM presence_targets ORDER BY subgroup').all() as unknown as PresenceTarget[]
}

export function listContractPresenceTargets() {
  return database.prepare('SELECT contract_type AS contractType, minimum_days AS minimumDays FROM contract_presence_targets ORDER BY contract_type').all() as unknown as ContractPresenceTarget[]
}

export type MonthPresence = {
  employees: EmployeeDashboardRow[]
  businessDays: number
  sources: { lenel: string; it007: string | null; it2001: string | null }
}

// Cálculo de um mês, reaproveitado até a próxima importação ou alteração de configuração
const monthCache = new Map<string, MonthPresence>()
let monthCacheVersion = -1

export function computeMonthPresence(year: number, month: number, sourceImports: SourceImport[] = listSourceImports()): MonthPresence {
  if (monthCacheVersion !== dataVersion()) {
    monthCache.clear()
    monthCacheVersion = dataVersion()
  }
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const cached = monthCache.get(monthPrefix)
  if (cached) return cached

  // IT007 de um mês posterior não descreve a estrutura passada; IT2001 posterior inclui ausências lançadas depois
  const it007Period = pickSourcePeriod(sourceImports.filter(item => item.source === 'it007').map(item => item.period), monthPrefix, 'earlier')
  const it2001Period = pickSourcePeriod(sourceImports.filter(item => item.source === 'it2001').map(item => item.period), monthPrefix, 'later')
  const firstDayOfMonth = `${monthPrefix}-01`
  const lastDayOfMonth = `${monthPrefix}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  const holidaysByArea = new Map<string, Set<string>>()
  for (const holiday of database.prepare('SELECT hr_area, holiday_date FROM area_holidays WHERE holiday_date BETWEEN ? AND ?').all(firstDayOfMonth, lastDayOfMonth) as unknown as { hr_area: string; holiday_date: string }[]) {
    if (!holidaysByArea.has(holiday.hr_area)) holidaysByArea.set(holiday.hr_area, new Set())
    holidaysByArea.get(holiday.hr_area)!.add(holiday.holiday_date)
  }
  const noHolidays = new Set<string>()
  const businessDays = businessDaysInMonth(year, month, noHolidays)
  const businessDaysByArea = new Map([...holidaysByArea].map(([area, areaHolidays]) => [area, businessDaysInMonth(year, month, areaHolidays)]))
  const employees = (database.prepare(`
    SELECT employee.edv, employee.full_name, employee.subgroup, employee.hr_area_name, employee.division,
      coalesce(nullif(trim(employee.position_name), ''), (
        SELECT nullif(trim(previous.position_name), '') FROM employee_snapshots previous
        WHERE previous.edv = employee.edv AND previous.period <= employee.period AND length(trim(previous.position_name)) > 0
        ORDER BY previous.period DESC LIMIT 1
      )) AS position_name,
      coalesce(nullif(trim(employee.flexible_schedule), ''), (
        SELECT nullif(trim(previous.flexible_schedule), '') FROM employee_snapshots previous
        WHERE previous.edv = employee.edv AND previous.period <= employee.period AND length(trim(previous.flexible_schedule)) > 0
        ORDER BY previous.period DESC LIMIT 1
      )) AS flexible_schedule,
      unit.organizational_unit,
      employee.predominant_home_office, employee.disciplinary_manager, employee.manager_name, employee.manager_email
    FROM employee_snapshots employee
    LEFT JOIN employee_units unit ON unit.period = ? AND unit.edv = employee.edv
    WHERE employee.period = ?
      -- Entra no mês quem tem entrada no Lenel ou serviço externo (o serviço externo aponta presença como o Lenel)
      AND (employee.edv IN (SELECT edv FROM access_days WHERE access_date BETWEEN ? AND ?)
        OR employee.edv IN (SELECT edv FROM external_services WHERE service_date BETWEEN ? AND ?))
      AND upper(trim(employee.subgroup)) IN (SELECT upper(trim(subgroup)) FROM presence_targets)
      -- Base de exclusão do mês, exceto quem tem serviço externo no mês (o serviço externo vence)
      AND (employee.edv NOT IN (SELECT edv FROM excluded_employees WHERE period = ?)
        OR employee.edv IN (SELECT edv FROM external_services WHERE service_date BETWEEN ? AND ?))
    ORDER BY employee.full_name
  `).all(it2001Period, it007Period, firstDayOfMonth, lastDayOfMonth, firstDayOfMonth, lastDayOfMonth, monthPrefix, firstDayOfMonth, lastDayOfMonth) as unknown as EmployeeRecord[])
    .filter(employee => !isExcludedHrArea(employee.hr_area_name))
  const accessRecords = database.prepare('SELECT edv, access_date FROM access_days WHERE access_date BETWEEN ? AND ?').all(firstDayOfMonth, lastDayOfMonth) as unknown as AccessRecord[]
  const absenceRecords = database.prepare('SELECT edv, absence_type, start_date, end_date, days FROM absence_records WHERE period = ?').all(it2001Period) as unknown as AbsenceRecord[]
  const targets = listPresenceTargets()
  const contractTargets = listContractPresenceTargets()

  const holidaysByEmployee = new Map(employees.map(employee => [employee.edv, holidaysByArea.get(employee.hr_area_name?.trim() ?? '') ?? noHolidays]))
  const accessDaysByEmployee = new Map<string, Set<string>>()
  for (const access of accessRecords) {
    if (!isWeekday(access.access_date) || holidaysByEmployee.get(access.edv)?.has(access.access_date)) continue
    if (!accessDaysByEmployee.has(access.edv)) accessDaysByEmployee.set(access.edv, new Set())
    accessDaysByEmployee.get(access.edv)!.add(access.access_date)
  }

  const absenceDaysByEmployee = new Map<string, Set<string>>()
  for (const absence of absenceRecords) {
    const startDate = normalizeDate(absence.start_date)
    const endDate = normalizeDate(absence.end_date)
    // Ausências com menos de 1 dia na coluna Dias do IT2001 (ex.: 0,5) são desconsideradas
    if (!absence.edv || !absence.absence_type?.trim() || !startDate || !endDate || numericValue(absence.days) < 1) continue
    const consideredStart = startDate > firstDayOfMonth ? startDate : firstDayOfMonth
    const consideredEnd = endDate < lastDayOfMonth ? endDate : lastDayOfMonth
    if (consideredStart > consideredEnd) continue
    const employeeAbsences = absenceDaysByEmployee.get(absence.edv) ?? new Set<string>()
    const employeeHolidays = holidaysByEmployee.get(absence.edv) ?? noHolidays
    for (let timestamp = Date.parse(`${consideredStart}T00:00:00Z`); timestamp <= Date.parse(`${consideredEnd}T00:00:00Z`); timestamp += 86_400_000) {
      const date = new Date(timestamp).toISOString().slice(0, 10)
      if (isWeekday(date) && !employeeHolidays.has(date)) employeeAbsences.add(date)
    }
    absenceDaysByEmployee.set(absence.edv, employeeAbsences)
  }

  const travelDays = travelDaysByEdv(firstDayOfMonth, lastDayOfMonth)
  const externalDays = externalDaysByEdv(firstDayOfMonth, lastDayOfMonth)
  const targetBySubgroup = new Map(targets.map(target => [target.subgroup.toUpperCase(), target.percentage]))
  const targetDaysByContract = new Map(contractTargets.map(target => [target.contractType, target.minimumDays]))
  const monthDates = Array.from({ length: Number(lastDayOfMonth.slice(8, 10)) }, (_, index) => `${monthPrefix}-${String(index + 1).padStart(2, '0')}`)
  const dashboardEmployees: EmployeeDashboardRow[] = employees.map(employee => {
    const employeeTravel = travelDays.get(employee.edv)
    const employeeHolidays = holidaysByEmployee.get(employee.edv) ?? noHolidays
    const employeeAbsences = absenceDaysByEmployee.get(employee.edv)
    const employeeAccess = accessDaysByEmployee.get(employee.edv)
    // Viagem conta como presença só em dia útil (sem feriado nem ausência) em que a pessoa não entrou no escritório
    const isTravelPresence = (date: string) => Boolean(employeeTravel?.has(date)) && isWeekday(date) && !employeeHolidays.has(date) && !employeeAbsences?.has(date) && !employeeAccess?.has(date)
    const travelPresenceDays = employeeTravel ? monthDates.filter(isTravelPresence).length : 0
    // Serviço externo também conta em dia útil sem entrada no escritório; se já houver viagem no dia, conta uma presença só
    const employeeExternal = externalDays.get(employee.edv)
    const isExternalPresence = (date: string) => Boolean(employeeExternal?.has(date)) && isWeekday(date) && !employeeHolidays.has(date) && !employeeAbsences?.has(date) && !employeeAccess?.has(date) && !employeeTravel?.has(date)
    const externalPresenceDays = employeeExternal ? monthDates.filter(isExternalPresence).length : 0
    const entries = (employeeAccess?.size ?? 0) + travelPresenceDays + externalPresenceDays
    const areaBusinessDays = businessDaysByArea.get(employee.hr_area_name?.trim() ?? '') ?? businessDays
    // Toda ausência do IT2001 sai dos dias úteis; se a pessoa entrou no escritório no mesmo dia, a entrada continua contando presença
    const employeeBusinessDays = Math.max(0, areaBusinessDays - (employeeAbsences?.size ?? 0))
    const presencePercentage = employeeBusinessDays ? Math.min(100, roundPercentage((entries / employeeBusinessDays) * 100)) : 0
    const normalizedSubgroup = employee.subgroup?.toUpperCase() ?? ''
    const employeeContractType = contractType(employee.predominant_home_office)
    const subgroupTarget = targetBySubgroup.get(normalizedSubgroup) ?? 0
    // Metas de 80% sempre prevalecem; regras por contrato só substituem a meta quando o subgrupo está em 60%
    const targetDays = subgroupTarget === 60 ? targetDaysByContract.get(employeeContractType) ?? null : null
    const targetPercentage = targetDays === null ? subgroupTarget : null
    const meetsPresenceRule = targetDays === null ? presencePercentage >= (targetPercentage ?? 0) : entries >= targetDays
    // HO Preponderante deve permanecer majoritariamente em home office: acima de 50% presencial não está conforme
    const withinContractPresenceLimit = employeeContractType !== 'HO Preponderante' || presencePercentage <= 50
    const manager = managerDetails(employee.disciplinary_manager)
    return {
      edv: employee.edv,
      name: employee.full_name,
      subgroup: employee.subgroup || 'Não informado',
      hrArea: employee.hr_area_name || 'Não informado',
      division: employee.division || 'Não informado',
      position: employee.position_name || 'Não informado',
      flexibleSchedule: employee.flexible_schedule?.trim() || 'Não informado',
      organizationalUnit: employee.organizational_unit || employee.division || 'Não informado',
      // "Disc. Mng. LastName" e "Disc. Manager Email" do IT007; meses importados antes usam "Gestor Disciplinar"
      manager: shortName(employee.manager_name?.trim() || manager.name) || 'Não informado',
      managerEmail: employee.manager_email?.trim() || manager.email,
      contractType: employeeContractType,
      entries,
      businessDays: employeeBusinessDays,
      presencePercentage,
      targetPercentage,
      targetDays,
      withinTarget: meetsPresenceRule && withinContractPresenceLimit,
      calendar: monthDates.map(date => {
        const traveling = Boolean(employeeTravel?.has(date))
        if (!isWeekday(date)) return traveling ? 'W' : 'w'
        if (employeeHolidays.has(date)) return traveling ? 'F' : 'f'
        if (employeeAbsences?.has(date)) return employeeAccess?.has(date) ? 'B' : traveling ? 'A' : employeeExternal?.has(date) ? 'E' : 'a'
        // Dia com entrada no escritório e viagem no bTravel aparece como viagem (conta uma presença só)
        if (employeeAccess?.has(date)) return traveling ? 't' : 'o'
        if (traveling) return 't'
        if (employeeExternal?.has(date)) return 'e'
        return 'h'
      }).join(''),
    }
  })

  // Exceções do Management: comparação sem diferenciar maiúsculas, acentos e espaços extras
  const exclusionsByCategory = new Map<ExclusionCategory, Set<string>>()
  for (const rule of listExclusionRules()) {
    if (!exclusionsByCategory.has(rule.category)) exclusionsByCategory.set(rule.category, new Set())
    exclusionsByCategory.get(rule.category)!.add(normalizeExclusionValue(rule.value))
  }
  const visibleEmployees = exclusionsByCategory.size === 0 ? dashboardEmployees : dashboardEmployees.filter(employee => ![...exclusionsByCategory].some(([category, values]) => values.has(normalizeExclusionValue(employee[category]))))

  const result = { employees: visibleEmployees, businessDays, sources: { lenel: monthPrefix, it007: it007Period, it2001: it2001Period } }
  monthCache.set(monthPrefix, result)
  return result
}
