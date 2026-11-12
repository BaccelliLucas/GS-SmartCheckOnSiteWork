import * as XLSX from 'xlsx'

export type CsvTable = {
  headers: string[]
  rows: string[][]
}

export function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function parseDelimitedText(content: string, delimiter: string, minColumns = 2): CsvTable {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  const normalizedContent = content.replace(/^\uFEFF/, '')

  for (let index = 0; index < normalizedContent.length; index += 1) {
    const character = normalizedContent[index]
    const nextCharacter = normalizedContent[index + 1]

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (character === delimiter && !quoted) {
      record.push(field.trim())
      field = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1
      record.push(field.trim())
      if (record.some(value => value !== '')) records.push(record)
      record = []
      field = ''
      continue
    }

    field += character
  }

  if (field || record.length) {
    record.push(field.trim())
    if (record.some(value => value !== '')) records.push(record)
  }

  if (records.length === 0) throw new Error('O arquivo está vazio.')

  const meaningfulRecords = records.filter((record, index) => !(index === 0 && record.length === 1 && /^sep=./i.test(record[0])))
  const headerIndex = meaningfulRecords.findIndex(record => record.filter(Boolean).length >= minColumns)
  if (headerIndex < 0) throw new Error('Não foi possível identificar o cabeçalho do arquivo.')
  const [headers, ...rows] = meaningfulRecords.slice(headerIndex)
  return { headers: headers.map(header => header.trim()), rows }
}

export function parseSemicolonCsv(content: string): CsvTable {
  return parseDelimitedText(content, ';')
}

function detectDelimiter(content: string) {
  const sample = content.split(/\r?\n/).find(line => line.trim() && !/^sep=./i.test(line.trim())) ?? ''
  const candidates = [';', '\t', ',']
  return candidates.sort((left, right) => sample.split(right).length - sample.split(left).length)[0]
}

// Células de data do Excel usam formatos dependentes da localidade (ex.: o formato padrão aparece como
// dd/mm/aaaa no Excel em português, mas é lido como m/d/yy). Converte o valor real para ISO.
function normalizeDateCells(sheet: XLSX.WorkSheet) {
  const pad = (value: number) => String(value).padStart(2, '0')
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address] as XLSX.CellObject
    if (cell.t !== 'n' || typeof cell.v !== 'number' || cell.v < 1 || !cell.z || !XLSX.SSF.is_date(cell.z)) continue
    const parsed = XLSX.SSF.parse_date_code(cell.v)
    const date = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
    cell.w = parsed.H || parsed.M || parsed.S ? `${date} ${pad(parsed.H)}:${pad(parsed.M)}:${pad(parsed.S)}` : date
  }
}

function parseWorkbook(buffer: ArrayBuffer, minColumns = 2): CsvTable {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: false, cellDates: false, cellNF: true })
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    normalizeDateCells(sheet)
    const records = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    }).map(row => row.map(value => String(value).trim()))
    const headerIndex = records.findIndex(record => record.filter(Boolean).length >= minColumns)
    if (headerIndex < 0) continue
    const [headers, ...rows] = records.slice(headerIndex)
    return { headers, rows: rows.filter(row => row.some(Boolean)) }
  }
  throw new Error('Nenhuma planilha com dados foi encontrada no arquivo Excel.')
}

// minColumns: quantas colunas preenchidas a linha de cabeçalho precisa ter (1 para listas simples, como a de exceções)
export function parseUploadedTable(fileName: string, buffer: ArrayBuffer, minColumns = 2): CsvTable {
  const extension = fileName.toLowerCase().split('.').pop()
  if (extension === 'xlsx' || extension === 'xls') return parseWorkbook(buffer, minColumns)
  if (extension === 'csv' || extension === 'txt') {
    const content = decodeCsv(buffer)
    return parseDelimitedText(content, detectDelimiter(content), minColumns)
  }
  throw new Error(`Formato não suportado em ${fileName}. Utilize XLSX, XLS, CSV ou TXT.`)
}

export function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function findColumn(headers: string[], expected: string, occurrence: 'first' | 'last' = 'first') {
  const normalizedExpected = normalizeHeader(expected)
  const matchingIndexes = headers
    .map((header, index) => normalizeHeader(header) === normalizedExpected ? index : -1)
    .filter(index => index >= 0)

  if (matchingIndexes.length === 0) return -1
  return occurrence === 'last' ? matchingIndexes.at(-1)! : matchingIndexes[0]
}

export function requireColumns(headers: string[], columns: string[]) {
  const missing = columns.filter(column => findColumn(headers, column) < 0)
  if (missing.length) throw new Error(`Colunas obrigatórias não encontradas: ${missing.join(', ')}`)
}

export function rowValue(row: string[], headers: string[], column: string, occurrence: 'first' | 'last' = 'first') {
  const index = findColumn(headers, column, occurrence)
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

export function rowObject(headers: string[], row: string[]) {
  const occurrences = new Map<string, number>()
  return Object.fromEntries(headers.map((header, index) => {
    const count = (occurrences.get(header) ?? 0) + 1
    occurrences.set(header, count)
    const key = count === 1 ? header : `${header} (${count})`
    return [key, row[index] ?? '']
  }))
}
