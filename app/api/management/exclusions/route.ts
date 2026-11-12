import { NextResponse } from 'next/server'
import { database, dataVersion, markDataChanged } from '@/lib/database'
import { exclusionCategories, ExclusionCategory, isExcludedHrArea, listExclusionRules } from '@/lib/presence'

export const runtime = 'nodejs'

function distinctValues(sql: string, ...params: string[]) {
  return (database.prepare(sql).all(...params) as unknown as { value: string }[]).map(row => row.value).filter(Boolean)
}

// Sugestões para cadastrar exceções: valores do IT007 e do IT2001 mais recentes
function exclusionOptions(): Partial<Record<ExclusionCategory, string[]>> {
  const latestPeriod = (source: string) => (database.prepare('SELECT max(period) AS period FROM source_imports WHERE source = ?').get(source) as { period: string | null }).period ?? ''
  const it007Period = latestPeriod('it007')
  const it2001Period = latestPeriod('it2001')
  // Importações anteriores à captura de Posição ficam vazias nessa coluna; usa o snapshot mais recente que a possua
  const positionPeriod = (database.prepare("SELECT max(period) AS period FROM employee_snapshots WHERE length(trim(position_name)) > 0").get() as { period: string | null }).period ?? ''
  const flexibleSchedulePeriod = (database.prepare("SELECT max(period) AS period FROM employee_snapshots WHERE length(trim(flexible_schedule)) > 0").get() as { period: string | null }).period ?? ''
  return {
    division: distinctValues("SELECT DISTINCT trim(division) AS value FROM employee_snapshots WHERE period = ? AND trim(division) <> '' ORDER BY 1", it007Period),
    organizationalUnit: distinctValues("SELECT DISTINCT trim(organizational_unit) AS value FROM employee_units WHERE period = ? AND trim(organizational_unit) <> '' ORDER BY 1", it2001Period),
    hrArea: distinctValues("SELECT DISTINCT trim(hr_area_name) AS value FROM employee_snapshots WHERE period = ? AND trim(hr_area_name) <> '' ORDER BY 1", it007Period).filter(area => !isExcludedHrArea(area)),
    subgroup: distinctValues("SELECT DISTINCT upper(trim(subgroup)) AS value FROM employee_snapshots WHERE period = ? AND trim(subgroup) <> '' ORDER BY 1", it007Period),
    position: distinctValues("SELECT DISTINCT trim(position_name) AS value FROM employee_snapshots WHERE period = ? AND length(trim(position_name)) > 0 ORDER BY 1", positionPeriod),
    flexibleSchedule: distinctValues("SELECT DISTINCT trim(flexible_schedule) AS value FROM employee_snapshots WHERE period = ? AND trim(flexible_schedule) <> '' ORDER BY 1", flexibleSchedulePeriod),
  }
}

// Nome completo de cada EDV cadastrado, segundo o IT007 mais recente em que ele aparece
function edvNames() {
  const rows = database.prepare(`
    SELECT rule.value AS edv, (SELECT full_name FROM employee_snapshots WHERE edv = rule.value ORDER BY period DESC LIMIT 1) AS fullName
    FROM exclusion_rules rule WHERE rule.category = 'edv'
  `).all() as unknown as { edv: string; fullName: string | null }[]
  return Object.fromEntries(rows.filter(row => row.fullName?.trim()).map(row => [row.edv, row.fullName!.trim().replace(/\s+/g, ' ').toUpperCase()]))
}

function exclusionState() {
  const rules = listExclusionRules()
  const savedCategories = (database.prepare('SELECT category FROM exclusion_categories').all() as unknown as { category: ExclusionCategory }[]).map(row => row.category)
  return { rules, categories: [...new Set([...savedCategories, ...rules.map(rule => rule.category)])], names: edvNames() }
}

function isCategory(value: unknown): value is ExclusionCategory {
  return exclusionCategories.includes(value as ExclusionCategory)
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível salvar as exceções.' }, { status: 400 })
}

// Colaboradores do IT007 mais recente, para buscar EDVs pelo número ou pelo nome (recarregado a cada importação)
let employeeIndex: { version: number; employees: { edv: string; name: string; searchKey: string }[] } | null = null

function searchKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function searchEmployees(term: string) {
  if (!employeeIndex || employeeIndex.version !== dataVersion()) {
    const period = (database.prepare("SELECT max(period) AS period FROM source_imports WHERE source = 'it007'").get() as { period: string | null }).period ?? ''
    const rows = database.prepare('SELECT edv, full_name AS name FROM employee_snapshots WHERE period = ? ORDER BY full_name').all(period) as unknown as { edv: string; name: string }[]
    employeeIndex = { version: dataVersion(), employees: rows.map(row => {
      const name = row.name.trim().replace(/\s+/g, ' ').toUpperCase()
      return { edv: row.edv, name, searchKey: searchKey(`${row.edv} ${name}`) }
    }) }
  }
  // Todas as palavras digitadas precisam aparecer (ex.: "joao silva" encontra "JOAO PEDRO DA SILVA")
  const words = searchKey(term).replace(/^0+(?=\d)/, '').split(' ').filter(Boolean)
  if (words.length === 0) return []
  const matches = employeeIndex.employees.filter(employee => words.every(word => employee.searchKey.includes(word)))
  // Primeiro quem tem o EDV ou o nome começando pelo que foi digitado
  const startsWithTerm = (employee: { edv: string; searchKey: string }) => employee.edv.startsWith(words[0]) || employee.searchKey.startsWith(`${employee.edv} ${words[0]}`)
  return [...matches.filter(startsWithTerm), ...matches.filter(employee => !startsWithTerm(employee))].slice(0, 100).map(({ edv, name }) => ({ edv, name }))
}

// Lista de exceções enviada para o mês (Exclusão_Base_MM_AA); sem nome na planilha, usa o do IT007
function monthlyExclusions(period: string) {
  const rows = database.prepare(`
    SELECT excluded.edv, coalesce(nullif(trim(excluded.full_name), ''), (SELECT full_name FROM employee_snapshots WHERE edv = excluded.edv ORDER BY period DESC LIMIT 1), '') AS name,
      coalesce(excluded.hrbp, '') AS hrbp, coalesce(excluded.justification, '') AS justification
    FROM excluded_employees excluded WHERE excluded.period = ?
  `).all(period) as unknown as { edv: string; name: string; hrbp: string; justification: string }[]
  const fileName = (database.prepare("SELECT file_name AS fileName FROM source_imports WHERE source = 'exceptions' AND period = ?").get(period) as { fileName: string } | undefined)?.fileName ?? null
  // Meses com lista enviada, para o filtro de mês e ano da tabela
  const periods = (database.prepare("SELECT period FROM source_imports WHERE source = 'exceptions' ORDER BY period DESC").all() as unknown as { period: string }[]).map(row => row.period)
  return { period, fileName, periods, employees: rows.map(row => ({ ...row, name: row.name.trim().replace(/\s+/g, ' ').toUpperCase() })).sort((first, second) => first.name.localeCompare(second.name, 'pt-BR')) }
}

const isPeriod = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const employeeTerm = params.get('employee')
  if (employeeTerm !== null) return NextResponse.json({ employees: searchEmployees(employeeTerm) })
  const period = params.get('period')
  if (period !== null) return isPeriod(period) ? NextResponse.json(monthlyExclusions(period)) : NextResponse.json({ error: 'Mês inválido.' }, { status: 400 })
  return NextResponse.json({ ...exclusionState(), options: exclusionOptions() })
}

// Cria a categoria (se ainda não existir) e adiciona os valores enviados; não apaga nada
export async function POST(request: Request) {
  try {
    const body = await request.json() as { category?: string; values?: unknown }
    if (!isCategory(body.category)) return NextResponse.json({ error: 'Categoria de exceção inválida.' }, { status: 400 })
    const category = body.category
    const values = Array.isArray(body.values) ? body.values.filter((value): value is string => typeof value === 'string' && value.trim() !== '') : []
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('INSERT OR IGNORE INTO exclusion_categories (category) VALUES (?)').run(category)
      const insertRule = database.prepare('INSERT OR IGNORE INTO exclusion_rules (category, value) VALUES (?, ?)')
      for (const value of values) insertRule.run(category, category === 'edv' ? value.trim().replace(/^0+(?=\d)/, '') : value.trim())
      database.exec('COMMIT')
    } catch (saveError) {
      database.exec('ROLLBACK')
      throw saveError
    }
    if (values.length) markDataChanged()
    return NextResponse.json(exclusionState())
  } catch (error) {
    return errorResponse(error)
  }
}

// Substitui a seleção inteira de uma categoria (usado pelo seletor no modelo dos filtros do cabeçalho)
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { category?: string; values?: unknown }
    if (!isCategory(body.category) || !Array.isArray(body.values)) return NextResponse.json({ error: 'Seleção de exceção inválida.' }, { status: 400 })
    const category = body.category
    const values = [...new Set(body.values.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map(value => category === 'edv' ? value.trim().replace(/^0+(?=\d)/, '') : value.trim()))]
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('INSERT OR IGNORE INTO exclusion_categories (category) VALUES (?)').run(category)
      database.prepare('DELETE FROM exclusion_rules WHERE category = ?').run(category)
      const insertRule = database.prepare('INSERT INTO exclusion_rules (category, value) VALUES (?, ?)')
      for (const value of values) insertRule.run(category, value)
      database.exec('COMMIT')
    } catch (saveError) {
      database.exec('ROLLBACK')
      throw saveError
    }
    markDataChanged()
    return NextResponse.json(exclusionState())
  } catch (error) {
    return errorResponse(error)
  }
}

// Remove um valor da categoria ou, sem valor, a categoria inteira com seus itens
export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { category?: string; value?: unknown; period?: unknown; edv?: unknown }
    // Tira uma pessoa da lista de exceções de um mês só
    if (body.period !== undefined) {
      if (!isPeriod(body.period) || typeof body.edv !== 'string') return NextResponse.json({ error: 'Exceção mensal inválida.' }, { status: 400 })
      database.prepare('DELETE FROM excluded_employees WHERE period = ? AND edv = ?').run(body.period, body.edv)
      database.prepare("UPDATE source_imports SET row_count = (SELECT count(*) FROM excluded_employees WHERE period = ?) WHERE source = 'exceptions' AND period = ?").run(body.period, body.period)
      markDataChanged()
      return NextResponse.json(monthlyExclusions(body.period))
    }
    if (!isCategory(body.category)) return NextResponse.json({ error: 'Categoria de exceção inválida.' }, { status: 400 })
    if (typeof body.value === 'string') {
      database.prepare('DELETE FROM exclusion_rules WHERE category = ? AND value = ?').run(body.category, body.value)
    } else {
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('DELETE FROM exclusion_rules WHERE category = ?').run(body.category)
        database.prepare('DELETE FROM exclusion_categories WHERE category = ?').run(body.category)
        database.exec('COMMIT')
      } catch (saveError) {
        database.exec('ROLLBACK')
        throw saveError
      }
    }
    markDataChanged()
    return NextResponse.json(exclusionState())
  } catch (error) {
    return errorResponse(error)
  }
}
