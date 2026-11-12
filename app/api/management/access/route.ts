import { NextResponse } from 'next/server'
import { database } from '@/lib/database'

export const runtime = 'nodejs'

// general = Status e Tipo de contrato; detail = Presença no escritório e Colaboradores; management = Management
const accessLevels = ['general', 'detail', 'management'] as const
type AccessLevel = (typeof accessLevels)[number]

function listGrants() {
  const rows = database.prepare('SELECT email, levels, updated_at AS updatedAt FROM access_grants ORDER BY email').all() as unknown as { email: string; levels: string; updatedAt: string }[]
  return rows.map(row => ({ email: row.email, levels: row.levels.split(',').filter(level => accessLevels.includes(level as AccessLevel)), updatedAt: row.updatedAt }))
}

function errorResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  return NextResponse.json({ grants: listGrants() })
}

// Cria ou atualiza os acessos de um e-mail
export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; levels?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse('Informe um e-mail válido.')
    const levels = Array.isArray(body.levels) ? accessLevels.filter(level => (body.levels as unknown[]).includes(level)) : []
    if (levels.length === 0) return errorResponse('Selecione ao menos um acesso.')
    database.prepare(`
      INSERT INTO access_grants (email, levels) VALUES (?, ?)
      ON CONFLICT(email) DO UPDATE SET levels = excluded.levels, updated_at = CURRENT_TIMESTAMP
    `).run(email, levels.join(','))
    return NextResponse.json({ grants: listGrants() })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Não foi possível salvar o acesso.')
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { email?: unknown }
    if (typeof body.email !== 'string') return errorResponse('E-mail inválido.')
    database.prepare('DELETE FROM access_grants WHERE email = ?').run(body.email.trim().toLowerCase())
    return NextResponse.json({ grants: listGrants() })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Não foi possível remover o acesso.')
  }
}
