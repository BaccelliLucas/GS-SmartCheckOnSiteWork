import { database, markDataChanged } from '@/lib/database'
import { CsvTable, findColumn, normalizeHeader, requireColumns, rowValue } from '@/lib/csv'

export type ImportSource = 'lenel' | 'it007' | 'it2001' | 'btravel' | 'external' | 'exceptions'
export type SourceFile = { source: ImportSource; fileName: string; table: CsvTable }
export type ReferencePeriod = { year: number; month: number }

function normalizeEdv(value: string) {
  return value.trim().replace(/^0+(?=\d)/, '')
}

function parseAccessDate(value: string) {
  const trimmed = value.trim()
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`

  const brazilianMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (brazilianMatch) return `${brazilianMatch[3]}-${brazilianMatch[2].padStart(2, '0')}-${brazilianMatch[1].padStart(2, '0')}`

  const brazilianShortYearMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?!\d)/)
  if (brazilianShortYearMatch) return `20${brazilianShortYearMatch[3]}-${brazilianShortYearMatch[2].padStart(2, '0')}-${brazilianShortYearMatch[1].padStart(2, '0')}`

  throw new Error(`Data inválida no arquivo Lenel: ${value}`)
}

function parseOptionalDate(value: string) {
  const trimmed = value.trim()
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

function firstAvailableValue(row: string[], headers: string[], columns: string[]) {
  for (const column of columns) {
    const value = rowValue(row, headers, column)
    if (value) return value
  }
  return ''
}

function nonEmptyLastValue(row: string[], headers: string[], column: string) {
  return rowValue(row, headers, column, 'last') || rowValue(row, headers, column, 'first')
}

export function formatPeriod(period: ReferencePeriod) {
  return `${period.year}-${String(period.month).padStart(2, '0')}`
}

function periodLabel(period: ReferencePeriod) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(period.year, period.month - 1, 1)))
}

const requiredColumns: Record<ImportSource, string[]> = {
  lenel: ['Nº pess.', 'Data'],
  it007: ['Nº pess.', 'Nome do empregado ou candidato', 'Subgrupo empregados', 'Área de recursos humanos'],
  it2001: ['Nº pess.', 'Unidade organizacional'],
  btravel: [],
  external: ['EDV', 'Data'],
  exceptions: [],
}

const sourceNames: Record<ImportSource, string> = { lenel: 'Lenel', it007: 'IT007', it2001: 'IT2001', btravel: 'bTravel',external: 'BIS - ITV', exceptions: 'Exceções' }

// Exportações em formato de relatório trazem linhas de título antes do cabeçalho: procura a linha com as colunas obrigatórias
function withHeaderRow(table: CsvTable, columns: string[]): CsvTable {
  const hasColumns = (row: string[]) => columns.every(column => findColumn(row, column) >= 0)
  if (hasColumns(table.headers)) return table
  const headerIndex = table.rows.slice(0, 50).findIndex(hasColumns)
  if (headerIndex < 0) return table
  return { headers: table.rows[headerIndex].map(header => header.trim()), rows: table.rows.slice(headerIndex + 1) }
}

// O TXT do Lenel pode vir sem cabeçalho (EDV;Data;Catraca): nesse caso a primeira linha já é um registro
function withLenelHeaders(table: CsvTable): CsvTable {
  if (findColumn(table.headers, 'Nº pess.') >= 0 && findColumn(table.headers, 'Data') >= 0) return table
  // Linhas podem começar com separador (coluna vazia antes do EDV)
  const offset = Math.max(0, table.headers.findIndex(value => value.trim() !== ''))
  const [edv = '', date = ''] = table.headers.slice(offset)
  const looksLikeRecord = /^\d+$/.test(edv.trim()) && /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}/.test(date.trim())
  if (!looksLikeRecord) return table
  const columnNames = ['Nº pess.', 'Data', 'Catraca']
  const headers = table.headers.map((_, index) => columnNames[index - offset] ?? `Coluna ${index + 1}`)
  return { headers, rows: [table.headers, ...table.rows] }
}

function importLenel(table: CsvTable, period: ReferencePeriod) {
  const periodPrefix = formatPeriod(period)
  const firstDay = `${periodPrefix}-01`
  const lastDay = `${periodPrefix}-${String(new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()).padStart(2, '0')}`
  const accessDays = new Map<string, { edv: string; accessDate: string }>()
  let rowsInPeriod = 0
  let ignoredRows = 0
  let earliestDate = ''
  let latestDate = ''
  for (const row of table.rows) {
    const edv = normalizeEdv(rowValue(row, table.headers, 'Nº pess.'))
    if (!edv) continue
    const accessDate = parseAccessDate(rowValue(row, table.headers, 'Data'))
    if (!earliestDate || accessDate < earliestDate) earliestDate = accessDate
    if (accessDate > latestDate) latestDate = accessDate
    if (accessDate < firstDay || accessDate > lastDay) {
      ignoredRows += 1
      continue
    }
    rowsInPeriod += 1
    accessDays.set(`${edv}|${accessDate}`, { edv, accessDate })
  }
  if (rowsInPeriod === 0) {
    const range = earliestDate ? ` As datas do arquivo vão de ${earliestDate.split('-').reverse().join('/')} a ${latestDate.split('-').reverse().join('/')}.` : ''
    throw new Error(`O arquivo Lenel não tem registros de ${periodLabel(period)}.${range}`)
  }

  database.prepare('DELETE FROM access_days WHERE access_date BETWEEN ? AND ?').run(firstDay, lastDay)
  const insertAccess = database.prepare('INSERT INTO access_days (edv, access_date) VALUES (?, ?)')
  for (const day of accessDays.values()) insertAccess.run(day.edv, day.accessDate)
  return { rows: rowsInPeriod, ignoredRows }
}

function importIt007(table: CsvTable, period: ReferencePeriod) {
  const periodKey = formatPeriod(period)
  // A divisão vem de "Abreviatura de Unid. Org."; arquivos sem essa coluna usam "Divisão"
  const divisionColumn = findColumn(table.headers, 'Abreviatura de Unid. Org.') >= 0 ? 'Abreviatura de Unid. Org.' : 'Divisão'
  database.prepare('DELETE FROM employee_snapshots WHERE period = ?').run(periodKey)
  const insertEmployee = database.prepare(`
    INSERT OR REPLACE INTO employee_snapshots (
      period, edv, full_name, subgroup, hr_area_name, division, position_name, flexible_schedule, predominant_home_office, disciplinary_manager, manager_name, manager_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let rows = 0
  for (const row of table.rows) {
    const edv = normalizeEdv(rowValue(row, table.headers, 'Nº pess.'))
    if (!edv) continue
    rows += 1
    insertEmployee.run(
      periodKey,
      edv,
      rowValue(row, table.headers, 'Nome do empregado ou candidato'),
      rowValue(row, table.headers, 'Subgrupo empregados'),
      rowValue(row, table.headers, 'Área de recursos humanos'),
      rowValue(row, table.headers, divisionColumn),
      rowValue(row, table.headers, 'Posição'),
      rowValue(row, table.headers, 'Jornada Flexível'),
      nonEmptyLastValue(row, table.headers, 'Home Office Preponderante'),
      rowValue(row, table.headers, 'Gestor Disciplinar'),
      [firstAvailableValue(row, table.headers, ['Disc. Mng. FirstName', 'Disc. Mng. First Name']), rowValue(row, table.headers, 'Disc. Mng. LastName')].filter(Boolean).join(' '),
      rowValue(row, table.headers, 'Disc. Manager Email'),
    )
  }
  return { rows, ignoredRows: 0 }
}

function importIt2001(table: CsvTable, period: ReferencePeriod) {
  const periodKey = formatPeriod(period)
  database.prepare('DELETE FROM absence_records WHERE period = ?').run(periodKey)
  database.prepare('DELETE FROM employee_units WHERE period = ?').run(periodKey)
  const insertAbsence = database.prepare('INSERT INTO absence_records (period, edv, absence_type, start_date, end_date, days, calendar_days) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const organizationalUnits = new Map<string, string>()
  let rows = 0
  for (const row of table.rows) {
    const edv = normalizeEdv(rowValue(row, table.headers, 'Nº pess.'))
    if (!edv) continue
    rows += 1
    const organizationalUnit = rowValue(row, table.headers, 'Unidade organizacional')
    if (organizationalUnit) organizationalUnits.set(edv, organizationalUnit)
    const absenceType = firstAvailableValue(row, table.headers, ['TpAus/p', 'Tp.aus.p', 'Tp.aus.p.'])
    if (!absenceType.trim()) continue
    insertAbsence.run(
      periodKey,
      edv,
      absenceType,
      parseOptionalDate(rowValue(row, table.headers, 'Início')),
      parseOptionalDate(rowValue(row, table.headers, 'Fim')),
      rowValue(row, table.headers, 'Dias'),
      rowValue(row, table.headers, 'D.calend'),
    )
  }
  const insertUnit = database.prepare('INSERT INTO employee_units (period, edv, organizational_unit) VALUES (?, ?, ?)')
  for (const [edv, organizationalUnit] of organizationalUnits) insertUnit.run(periodKey, edv, organizationalUnit)
  return { rows, ignoredRows: 0 }
}

// bTravel: o arquivo é guardado como veio e as viagens são montadas no cálculo de presença
function storeRawFile(source: ImportSource) {
  return (table: CsvTable, period: ReferencePeriod) => {
    const rows = table.rows.filter(row => row.some(Boolean))
    database.prepare('INSERT OR REPLACE INTO raw_source_files (source, period, headers, rows) VALUES (?, ?, ?, ?)').run(source, formatPeriod(period), JSON.stringify(table.headers), JSON.stringify(rows))
    return { rows: rows.length, ignoredRows: 0 }
  }
}

const btravelBaseColumns = ['Matrícula', 'Data Embarque', 'Data Retorno']

// bTravel das bases antigas (Matrícula;Data Embarque;Data Retorno): cada linha é uma viagem do embarque ao retorno.
// As viagens vão para btravel_trips e se somam a cada arquivo; não substituem nem são substituídas pelo Excel do bTravel
function importBtravelBase(table: CsvTable) {
  const insertTrip = database.prepare('INSERT OR IGNORE INTO btravel_trips (edv, start_date, end_date) VALUES (?, ?, ?)')
  let rows = 0
  let ignoredRows = 0
  for (const row of table.rows) {
    const edv = normalizeEdv(rowValue(row, table.headers, 'Matrícula'))
    if (!edv) continue
    const start = parseOptionalDate(rowValue(row, table.headers, 'Data Embarque'))
    const end = parseOptionalDate(rowValue(row, table.headers, 'Data Retorno')) || start
    if (!/^\d+$/.test(edv) || !start) {
      ignoredRows += 1
      continue
    }
    insertTrip.run(edv, start, end < start ? start : end)
    rows += 1
  }
  if (rows === 0) throw new Error('bTravel: nenhuma linha com matrícula e data válidas.')
  return { rows, ignoredRows, keepExistingImport: true }
}

function importBtravel(table: CsvTable, period: ReferencePeriod) {
  if (btravelBaseColumns.every(column => findColumn(table.headers, column) >= 0)) return importBtravelBase(table)
  return storeRawFile('btravel')(table, period)
}

// Serviço externo: uma linha por EDV e dia (colunas EDV, Data e Local); linhas sem EDV ou com data inválida são ignoradas
function importExternal(table: CsvTable, period: ReferencePeriod) {
  const periodKey = formatPeriod(period)
  const services = new Map<string, { edv: string; date: string; location: string }>()
  let ignoredRows = 0
  for (const row of table.rows) {
    const edv = normalizeEdv(rowValue(row, table.headers, 'EDV'))
    if (!edv) continue
    const date = parseOptionalDate(rowValue(row, table.headers, 'Data'))
    if (!/^\d+$/.test(edv) || !date) {
      ignoredRows += 1
      continue
    }
    const location = rowValue(row, table.headers, 'Local').replace(/\s+/g, ' ')
    services.set(`${edv}|${date}|${location}`, { edv, date, location })
  }
  if (services.size === 0) throw new Error('BIS - ITV: nenhuma linha com EDV e data válidos.')
  database.prepare('DELETE FROM external_services WHERE period = ?').run(periodKey)
  const insertService = database.prepare('INSERT INTO external_services (period, edv, service_date, location) VALUES (?, ?, ?, ?)')
  for (const service of services.values()) insertService.run(periodKey, service.edv, service.date, service.location)
  return { rows: services.size, ignoredRows }
}

const exceptionEdvColumns =['Nº pess.', 'EDV', 'Nº pessoal', 'Matrícula']

// Colunas da planilha Exclusão_Base_MM_AA, reconhecidas por parte do nome (ex.: "HRBP que pediu", "Cargo / Justificativa")
function exceptionColumn(headers: string[], keywords: string[], skip: number[] = []) {
  const normalized = headers.map(normalizeHeader)
  return normalized.findIndex((header, index) => !skip.includes(index) && keywords.some(keyword => header.includes(keyword)))
}

// Lista de exceções: usa a coluna de EDV pelo nome; sem cabeçalho reconhecido, a primeira coluna (o cabeçalho pode já ser um EDV)
function importExceptions(sourceTable: CsvTable, period: ReferencePeriod) {
  const periodKey = formatPeriod(period)
  const edvColumnIn = (row: string[]) => {
    const index = exceptionEdvColumns.map(column => findColumn(row, column)).find(found => found >= 0) ?? exceptionColumn(row, ['edv', 'matricula'])
    return index >= 0 ? index : undefined
  }
  // A planilha pode ter linhas de título antes do cabeçalho
  const headerIndex = edvColumnIn(sourceTable.headers) === undefined ? sourceTable.rows.slice(0, 50).findIndex(row => edvColumnIn(row) !== undefined) : -1
  const table = headerIndex < 0 ? sourceTable : { headers: sourceTable.rows[headerIndex], rows: sourceTable.rows.slice(headerIndex + 1) }
  const namedColumn = edvColumnIn(table.headers)
  const column = namedColumn ?? Math.max(0, table.headers.findIndex(value => value.trim() !== ''))
  const hrbpColumn = namedColumn === undefined ? -1 : exceptionColumn(table.headers, ['hrbp', 'solicitante', 'pediu'], [column])
  const nameColumn = namedColumn === undefined ? -1 : exceptionColumn(table.headers, ['nome'], [column, hrbpColumn])
  const justificationColumn = namedColumn === undefined ? -1 : exceptionColumn(table.headers, ['cargo', 'justificativa', 'motivo'], [column, hrbpColumn, nameColumn])
  const cell = (row: string[], index: number) => index >= 0 ? (row[index] ?? '').trim().replace(/\s+/g, ' ') : ''
  const rows = [...(namedColumn === undefined ? [table.headers] : []), ...table.rows]
  const exclusions = new Map<string, { name: string; hrbp: string; justification: string }>()
  for (const row of rows) {
    const edv = normalizeEdv(row[column] ?? '')
    if (/^\d+$/.test(edv)) exclusions.set(edv, { name: cell(row, nameColumn), hrbp: cell(row, hrbpColumn), justification: cell(row, justificationColumn) })
  }
  if (exclusions.size === 0) throw new Error('Nenhum EDV encontrado. Use uma coluna "EDV" ou "Nº pess.", ou deixe os EDVs na primeira coluna.')
  database.prepare('DELETE FROM excluded_employees WHERE period = ?').run(periodKey)
  const insertExclusion = database.prepare('INSERT INTO excluded_employees (period, edv, full_name, hrbp, justification) VALUES (?, ?, ?, ?, ?)')
  for (const [edv, details] of exclusions) insertExclusion.run(periodKey, edv, details.name, details.hrbp, details.justification)
  return { rows: exclusions.size, ignoredRows: 0 }
}

// keepExistingImport: não troca o arquivo já registrado no histórico daquele mês (as bases antigas do bTravel se somam a ele)
const importers: Record<ImportSource, (table: CsvTable, period: ReferencePeriod) => { rows: number; ignoredRows: number; keepExistingImport?: boolean }> = {
  lenel: importLenel,
  it007: importIt007,
  it2001: importIt2001,
  btravel: importBtravel,
  external: importExternal,
  exceptions: importExceptions,
}

// Importa um ou mais arquivos para o mês de referência; cada fonte substitui apenas os próprios dados daquele mês
export function importSourceFiles(sourceFiles: SourceFile[], period: ReferencePeriod) {
  if (sourceFiles.length === 0) throw new Error('Selecione ao menos um arquivo.')
  const files = sourceFiles.map(file => {
    const table = withHeaderRow(file.table, requiredColumns[file.source])
    return { ...file, table: file.source === 'lenel' ? withLenelHeaders(table) : table }
  })
  for (const file of files) {
    try {
      requireColumns(file.table.headers, requiredColumns[file.source])
    } catch (error) {
      throw new Error(`${sourceNames[file.source]}: ${error instanceof Error ? error.message : 'arquivo inválido.'}`)
    }
  }

  const periodKey = formatPeriod(period)
  const results: Partial<Record<ImportSource, { rows: number; ignoredRows: number }>> = {}
  database.exec('BEGIN IMMEDIATE')
  try {
    const registerImport = database.prepare('INSERT OR REPLACE INTO source_imports (source, period, file_name, row_count, imported_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
    const registerIfMissing = database.prepare('INSERT OR IGNORE INTO source_imports (source, period, file_name, row_count, imported_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
    for (const file of files) {
      const { keepExistingImport, ...result } = importers[file.source](file.table, period)
      ;(keepExistingImport ? registerIfMissing : registerImport).run(file.source, periodKey, file.fileName, result.rows)
      results[file.source] = result
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  markDataChanged()
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return { period: periodKey, results }
}

// Remove um arquivo do histórico: apaga o registro da importação e os dados que ele gerou naquele mês
export function removeSourceImport(source: ImportSource, periodKey: string) {
  const [year, month] = periodKey.split('-').map(Number)
  const firstDay = `${periodKey}-01`
  const lastDay = `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  const statements: Record<ImportSource, [string, ...string[]][]> = {
    lenel: [['DELETE FROM access_days WHERE access_date BETWEEN ? AND ?', firstDay, lastDay]],
    it007: [['DELETE FROM employee_snapshots WHERE period = ?', periodKey]],
    it2001: [['DELETE FROM absence_records WHERE period = ?', periodKey], ['DELETE FROM employee_units WHERE period = ?', periodKey]],
    btravel: [['DELETE FROM raw_source_files WHERE source = ? AND period = ?', 'btravel', periodKey]],
    external: [['DELETE FROM external_services WHERE period = ?', periodKey]],
    exceptions: [['DELETE FROM excluded_employees WHERE period = ?', periodKey]],
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    const removed = database.prepare('DELETE FROM source_imports WHERE source = ? AND period = ?').run(source, periodKey)
    if (Number(removed.changes) === 0) throw new Error('Arquivo não encontrado no histórico.')
    for (const [sql, ...parameters] of statements[source]) database.prepare(sql).run(...parameters)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  markDataChanged()
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

// Dados guardados de um arquivo do histórico, como tabela para download. Lenel, IT007, IT2001, serviço externo e
// exceções são guardados já tratados, então a planilha traz as colunas do banco, não as do arquivo original
export function exportSourceImport(source: ImportSource, periodKey: string): CsvTable & { fileName: string } {
  const imported = database.prepare('SELECT file_name AS fileName FROM source_imports WHERE source = ? AND period = ?').get(source, periodKey) as { fileName: string } | undefined
  if (!imported) throw new Error('Arquivo não encontrado no histórico.')
  const [year, month] = periodKey.split('-').map(Number)
  const firstDay = `${periodKey}-01`
  const lastDay = `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  const query = (sql: string, ...parameters: string[]) => (database.prepare(sql).all(...parameters) as unknown as Record<string, unknown>[]).map(row => Object.values(row).map(value => value == null ? '' : String(value)))
  const tables: Record<ImportSource, () => CsvTable> = {
    lenel: () => ({ headers: ['Nº pess.', 'Data'], rows: query('SELECT edv, access_date FROM access_days WHERE access_date BETWEEN ? AND ? ORDER BY access_date, edv', firstDay, lastDay) }),
    it007: () => ({
      headers: ['Nº pess.', 'Nome do empregado ou candidato', 'Subgrupo empregados', 'Área de recursos humanos', 'Divisão', 'Posição', 'Home Office Preponderante', 'Gestor Disciplinar', 'Nome do gestor', 'Disc. Manager Email'],
      rows: query('SELECT edv, full_name, subgroup, hr_area_name, division, position_name, flexible_schedule, predominant_home_office, disciplinary_manager, manager_name, manager_email FROM employee_snapshots WHERE period = ? ORDER BY edv', periodKey),
    }),
    // Colaboradores sem ausência aparecem só com a unidade organizacional
    it2001: () => ({
      headers: ['Nº pess.', 'Unidade organizacional', 'TpAus/p', 'Início', 'Fim', 'Dias', 'D.calend'],
      rows: query(`
        SELECT a.edv, coalesce(u.organizational_unit, ''), a.absence_type, a.start_date, a.end_date, a.days, a.calendar_days
        FROM absence_records a LEFT JOIN employee_units u ON u.period = a.period AND u.edv = a.edv WHERE a.period = ?1
        UNION ALL
        SELECT u.edv, u.organizational_unit, '', '', '', '', '' FROM employee_units u
        WHERE u.period = ?1 AND NOT EXISTS (SELECT 1 FROM absence_records a WHERE a.period = u.period AND a.edv = u.edv)
        ORDER BY 1, 4`, periodKey),
    }),
    btravel: () => {
      const file = database.prepare("SELECT headers, rows FROM raw_source_files WHERE source = 'btravel' AND period = ?").get(periodKey) as { headers: string; rows: string } | undefined
      if (file) return { headers: JSON.parse(file.headers), rows: JSON.parse(file.rows) }
      // Mês registrado só por bases antigas (TXT): viagens que passam pelo mês
      return { headers: btravelBaseColumns, rows: query('SELECT edv, start_date, end_date FROM btravel_trips WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, edv', lastDay, firstDay) }
    },
    external: () => ({ headers: ['EDV', 'Data', 'Local'], rows: query('SELECT edv, service_date, location FROM external_services WHERE period = ? ORDER BY service_date, edv', periodKey) }),
    exceptions: () => ({ headers: ['EDV', 'Nome', 'HRBP', 'Justificativa'], rows: query('SELECT edv, full_name, hrbp, justification FROM excluded_employees WHERE period = ? ORDER BY edv', periodKey) }),
  }
  return { fileName: imported.fileName, ...tables[source]() }
}
