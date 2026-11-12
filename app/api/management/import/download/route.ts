import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { exportSourceImport, ImportSource } from '@/lib/import-data'

export const runtime = 'nodejs'

const importSources: ImportSource[] = ['lenel', 'it007', 'it2001', 'btravel', 'external', 'exceptions']

// Baixa os dados de um arquivo do histórico (fonte + mês) como XLSX
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const source = importSources.find(item => item === searchParams.get('source'))
    const period = searchParams.get('period') ?? ''
    if (!source || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return NextResponse.json({ error: 'Arquivo inválido.' }, { status: 400 })
    }
    const { fileName, headers, rows } = exportSourceImport(source, period)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Dados')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const downloadName = `${fileName.replace(/\.[^.]+$/, '')}.xlsx`
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${downloadName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível baixar o arquivo.' }, { status: 400 })
  }
}
