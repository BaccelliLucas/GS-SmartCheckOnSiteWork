import { NextResponse } from 'next/server'
import { database } from '@/lib/database'

export const runtime = 'nodejs'

// Serviços externos com data no mês (de qualquer arquivo importado), com o nome do IT007 mais recente do EDV
export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get('period') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: 'Mês inválido.' }, { status: 400 })
  const rows = database.prepare(`
    SELECT DISTINCT service.edv, service.service_date AS date, service.location,
      coalesce((SELECT full_name FROM employee_snapshots WHERE edv = service.edv ORDER BY period DESC LIMIT 1), '') AS name
    FROM external_services service
    WHERE service.service_date BETWEEN ? AND ?
    ORDER BY service.service_date, name
  `).all(`${period}-01`, `${period}-31`) as unknown as { edv: string; date: string; location: string; name: string }[]
  // Meses com serviço externo, para o filtro de mês e ano da tabela
  const periods = (database.prepare('SELECT DISTINCT substr(service_date, 1, 7) AS period FROM external_services ORDER BY 1 DESC').all() as unknown as { period: string }[]).map(row => row.period)
  return NextResponse.json({ period, periods, services: rows.map(row => ({ ...row, name: row.name.trim().replace(/\s+/g, ' ').toUpperCase() })) })
}
