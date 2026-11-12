import { NextResponse } from 'next/server'
import { dataVersion } from '@/lib/database'
import { computeMonthPresence, listPresenceTargets, listSourceImports, roundPercentage } from '@/lib/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resposta calculada por período, reaproveitada até a próxima importação ou alteração de configuração
const responseCache = new Map<string, string>()
let cachedDataVersion = -1

function jsonResponse(body: string) {
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const sourceImports = listSourceImports()
  const lenelImports = sourceImports.filter(item => item.source === 'lenel')
  if (lenelImports.length === 0) {
    return NextResponse.json({ hasData: false, employees: [], targets: [], filters: null })
  }

  const availablePeriods = lenelImports.map(item => ({ year: Number(item.period.slice(0, 4)), month: Number(item.period.slice(5, 7)) }))
  const searchParams = new URL(request.url).searchParams
  const requestedYear = Number(searchParams.get('year'))
  const requestedMonth = Number(searchParams.get('month'))
  const selectedPeriod = availablePeriods.find(period => period.year === requestedYear && period.month === requestedMonth) ?? availablePeriods[0]
  const year = selectedPeriod.year
  const month = selectedPeriod.month
  if (cachedDataVersion !== dataVersion()) {
    responseCache.clear()
    cachedDataVersion = dataVersion()
  }
  const cacheKey = `${year}-${month}`
  const cachedResponse = responseCache.get(cacheKey)
  if (cachedResponse) return jsonResponse(cachedResponse)

  const { employees: dashboardEmployees, businessDays, sources } = computeMonthPresence(year, month, sourceImports)
  const presencialCount = dashboardEmployees.filter(employee => employee.contractType === 'Presencial').length
  const totalAvailableBusinessDays = dashboardEmployees.reduce((sum, employee) => sum + employee.businessDays, 0)
  const overallPresence = totalAvailableBusinessDays
    ? Math.min(100, roundPercentage((dashboardEmployees.reduce((sum, employee) => sum + employee.entries, 0) / totalAvailableBusinessDays) * 100))
    : 0

  const body = JSON.stringify({
    hasData: true,
    reference: {
      year,
      month,
      monthName: new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))),
      businessDays,
      importedAt: lenelImports.find(item => item.period === sources.lenel)?.imported_at ?? '',
      sources,
    },
    kpis: { overallPresence, presencialCount, population: dashboardEmployees.length },
    employees: dashboardEmployees,
    targets: listPresenceTargets(),
    filters: {
      years: [...new Set(availablePeriods.map(period => String(period.year)))],
      months: availablePeriods.filter(period => period.year === year).map(period => String(period.month).padStart(2, '0')),
      periods: availablePeriods,
      divisions: [...new Set(dashboardEmployees.map(employee => employee.division))],
      organizationalUnits: [...new Set(dashboardEmployees.map(employee => employee.organizationalUnit))],
      hrAreas: [...new Set(dashboardEmployees.map(employee => employee.hrArea))],
      subgroups: [...new Set(dashboardEmployees.map(employee => employee.subgroup))],
      contractTypes: ['Presencial', 'HO Preponderante', 'Home Office 100%'],
    },
  })
  responseCache.set(cacheKey, body)
  return jsonResponse(body)
}
