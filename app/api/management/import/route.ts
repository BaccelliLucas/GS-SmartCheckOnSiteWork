import { NextResponse } from 'next/server'
import { parseUploadedTable } from '@/lib/csv'
import { database, markDataChanged, smartCheckDatabasePath } from '@/lib/database'
import { ImportSource, importSourceFiles, removeSourceImport, SourceFile } from '@/lib/import-data'
import { isExcludedHrArea } from '@/lib/presence'

export const runtime = 'nodejs'

type PresenceTarget = { subgroup: string; percentage: number }
type ContractPresenceTarget = { contractType: 'Presencial' | 'HO Preponderante' | 'Home Office 100%'; minimumDays: number }
type AreaHoliday = { hrArea: string; date: string }

const importSources: ImportSource[] = ['lenel', 'it007', 'it2001', 'btravel', 'external', 'exceptions']

function isValidHolidayList(value: unknown): value is AreaHoliday[] {
  return Array.isArray(value) && value.every(holiday => typeof holiday?.hrArea === 'string' && holiday.hrArea.trim() && /^\d{4}-\d{2}-\d{2}$/.test(holiday.date))
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0
}

export async function GET() {
  const imports = database.prepare('SELECT source, period, file_name AS fileName, row_count AS rowCount, imported_at AS importedAt FROM source_imports ORDER BY period DESC, source').all()
  const targets = database.prepare('SELECT subgroup, percentage FROM presence_targets ORDER BY subgroup').all()
  const contractTargets = database.prepare('SELECT contract_type AS contractType, minimum_days AS minimumDays FROM contract_presence_targets ORDER BY contract_type').all()
  const holidays = database.prepare('SELECT hr_area AS hrArea, holiday_date AS date FROM area_holidays ORDER BY hr_area, holiday_date').all()
  const hrAreas = (database.prepare("SELECT DISTINCT trim(hr_area_name) AS hr_area FROM employee_snapshots WHERE hr_area_name IS NOT NULL AND trim(hr_area_name) <> '' ORDER BY 1").all() as unknown as { hr_area: string }[]).map(area => area.hr_area).filter(area => !isExcludedHrArea(area))
  return NextResponse.json({ imports, targets, contractTargets, holidays, hrAreas, databasePath: smartCheckDatabasePath })
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { targets?: PresenceTarget[]; contractTargets?: ContractPresenceTarget[]; holidays?: AreaHoliday[] }
    if (!Array.isArray(body.targets) || body.targets.some(target => !target.subgroup?.trim() || !Number.isFinite(Number(target.percentage)))) {
      return NextResponse.json({ error: 'Configuração de metas inválida.' }, { status: 400 })
    }
    if (!isValidHolidayList(body.holidays)) {
      return NextResponse.json({ error: 'Configuração de feriados inválida.' }, { status: 400 })
    }
    const contractTypes = new Set(['Presencial', 'HO Preponderante', 'Home Office 100%'])
    if (!Array.isArray(body.contractTargets) || body.contractTargets.some(target => !contractTypes.has(target.contractType) || !Number.isInteger(Number(target.minimumDays)) || Number(target.minimumDays) < 0 || Number(target.minimumDays) > 31)) {
      return NextResponse.json({ error: 'Configuração de metas por contrato inválida.' }, { status: 400 })
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec('DELETE FROM presence_targets; DELETE FROM contract_presence_targets; DELETE FROM area_holidays;')
      const insertTarget = database.prepare('INSERT INTO presence_targets (subgroup, percentage) VALUES (?, ?)')
      for (const target of body.targets) insertTarget.run(target.subgroup.trim().toUpperCase(), Math.min(100, Math.max(0, Number(target.percentage))))
      const insertContractTarget = database.prepare('INSERT INTO contract_presence_targets (contract_type, minimum_days) VALUES (?, ?)')
      for (const target of body.contractTargets) insertContractTarget.run(target.contractType, Number(target.minimumDays))
      const insertHoliday = database.prepare('INSERT OR IGNORE INTO area_holidays (hr_area, holiday_date) VALUES (?, ?)')
      for (const holiday of body.holidays) insertHoliday.run(holiday.hrArea.trim(), holiday.date)
      database.exec('COMMIT')
      markDataChanged()
    } catch (saveError) {
      database.exec('ROLLBACK')
      throw saveError
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível salvar as configurações.' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const year = Number(formData.get('year'))
    const month = Number(formData.get('month'))
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Selecione um mês de referência válido.' }, { status: 400 })
    }

    const uploads = importSources.flatMap(source => {
      const file = formData.get(source)
      return isUploadedFile(file) ? [{ source, file }] : []
    })
    if (uploads.length === 0) return NextResponse.json({ error: 'Selecione ao menos um arquivo.' }, { status: 400 })

    const files: SourceFile[] = await Promise.all(uploads.map(async ({ source, file }) => ({
      source,
      fileName: file.name,
      table: parseUploadedTable(file.name, await file.arrayBuffer(), source === 'exceptions' ? 1 : 2),
    })))
    const result = importSourceFiles(files, { year, month })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível importar os arquivos.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { source?: string; period?: string }
    const source = importSources.find(item => item === body.source)
    if (!source || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period ?? '')) {
      return NextResponse.json({ error: 'Arquivo inválido.' }, { status: 400 })
    }
    removeSourceImport(source, body.period!)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível remover o arquivo.' }, { status: 400 })
  }
}
