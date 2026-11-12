import { NextResponse } from 'next/server'
import { dataVersion } from '@/lib/database'
import { computeMonthPresence, listSourceImports } from '@/lib/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Atributos usados pelos filtros, na mesma ordem das colunas de cada linha
const dimensions = ['division', 'organizationalUnit', 'hrArea', 'subgroup', 'contractType'] as const

const responseCache = new Map<number, string>()
let cachedDataVersion = -1

// Histórico do ano para a aba Status: por mês, uma linha por colaborador
// [divisão, unidade, área, subgrupo, contrato (índices nos dicionários), entradas, dias úteis]
export async function GET(request: Request) {
  const sourceImports = listSourceImports()
  const lenelPeriods = sourceImports.filter(item => item.source === 'lenel').map(item => item.period)
  const requestedYear = Number(new URL(request.url).searchParams.get('year'))
  const year = Number.isInteger(requestedYear) && requestedYear > 0 ? requestedYear : Number(lenelPeriods[0]?.slice(0, 4))
  if (!year) return NextResponse.json({ year: null, months: [], dictionaries: null })

  if (cachedDataVersion !== dataVersion()) {
    responseCache.clear()
    cachedDataVersion = dataVersion()
  }
  const cached = responseCache.get(year)
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

  const dictionaries = Object.fromEntries(dimensions.map(dimension => [dimension, [] as string[]])) as Record<(typeof dimensions)[number], string[]>
  const indexes = Object.fromEntries(dimensions.map(dimension => [dimension, new Map<string, number>()])) as Record<(typeof dimensions)[number], Map<string, number>>
  const indexOf = (dimension: (typeof dimensions)[number], value: string) => {
    let index = indexes[dimension].get(value)
    if (index === undefined) {
      index = dictionaries[dimension].length
      dictionaries[dimension].push(value)
      indexes[dimension].set(value, index)
    }
    return index
  }

  const months = lenelPeriods
    .filter(period => period.startsWith(`${year}-`))
    .sort()
    .map(period => {
      const month = Number(period.slice(5, 7))
      const { employees } = computeMonthPresence(year, month, sourceImports)
      return {
        month,
        rows: employees.map(employee => [...dimensions.map(dimension => indexOf(dimension, employee[dimension])), employee.entries, employee.businessDays]),
      }
    })

  const body = JSON.stringify({ year, months, dictionaries })
  responseCache.set(year, body)
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}
