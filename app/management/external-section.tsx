'use client'

import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Search } from 'lucide-react'

type ExternalService = { edv: string; name: string; date: string; location: string }

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const formatDate = (date: string) => date.split('-').reverse().join('/')

// Serviços externos do mês (arquivo com EDV, Data e Local): em dia útil contam como presença, como o bTravel
export function ExternalSection({ period: referencePeriod, refreshKey }: { period: string; refreshKey: number }) {
  // Começa no mês de referência da página e acompanha quando ele muda, mas pode ser trocado só aqui na tabela
  const [period, setPeriod] = useState(referencePeriod)
  const [services, setServices] = useState<ExternalService[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const periodLabel = `${monthNames[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return [...new Set([currentYear, currentYear - 1, Number(period.slice(0, 4)), ...periods.map(item => Number(item.slice(0, 4)))])].sort((first, second) => second - first)
  }, [periods, period])

  useEffect(() => setPeriod(referencePeriod), [referencePeriod])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/management/external?period=${period}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.json())
      .then((result: { services?: ExternalService[]; periods?: string[] }) => {
        setServices(result.services ?? [])
        setPeriods(result.periods ?? [])
        setLoading(false)
      })
      .catch(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, refreshKey])

  // Busca em todas as colunas (a data também pode ser digitada como DD/MM/AAAA)
  const term = normalize(search)
  const visibleServices = term ? services.filter(service => normalize(`${service.edv} ${service.name} ${formatDate(service.date)} ${service.location}`).includes(term)) : services
  const people = new Set(services.map(service => service.edv)).size
  const selectClass = 'h-8 rounded-lg border border-[#cfe3e6] bg-white px-2 text-xs font-semibold text-[#1f4f57] outline-none transition focus:border-[#0f8a9d] focus:ring-2 focus:ring-[#0f8a9d]/15'

  return <section className="rounded-2xl border border-[#d3e8eb] bg-white shadow-[0_12px_34px_rgba(15,104,118,0.07)]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1eff1] px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-[#e6f5f7] text-[#0f8a9d]"><Briefcase className="size-5" /></div>
        <div><h2 className="text-[17px] font-semibold text-[#1f4f57]">BIS - ITV</h2><p className="mt-0.5 text-xs text-slate-500">Registro de acesso e entradas em Itupeva</p></div>
      </div>
    </div>
    <div className="px-6 py-5">
      <div className="flex flex-col rounded-xl border border-[#d3e8eb] bg-[#fafdfd]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1eff1] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm text-[#1f4f57]">Serviços · {periodLabel}</strong>
            <span title={`${people} ${people === 1 ? 'pessoa' : 'pessoas'}`} className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#0f8a9d] ring-1 ring-[#d3e8eb]">{services.length}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#8fb5bb]" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar..." aria-label="Buscar por EDV, nome, data ou local" title="Busca por EDV, nome, data ou local" className="h-8 w-56 rounded-lg border border-[#cfe3e6] bg-white pl-8 pr-3 text-xs text-[#1f4f57] outline-none transition placeholder:text-slate-400 focus:border-[#0f8a9d] focus:ring-2 focus:ring-[#0f8a9d]/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <select aria-label="Mês do BIS - ITV" value={Number(period.slice(5, 7))} onChange={event => setPeriod(`${period.slice(0, 4)}-${event.target.value.padStart(2, '0')}`)} className={selectClass}>
                {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}{periods.includes(`${period.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`) ? ' •' : ''}</option>)}
              </select>
              <select aria-label="Ano do BIS - ITV" value={Number(period.slice(0, 4))} onChange={event => setPeriod(`${event.target.value}-${period.slice(5, 7)}`)} className={selectClass}>
                {years.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="p-4">
          {loading ? <p className="text-xs text-slate-400">Carregando...</p>
            : services.length === 0 ? <p className="rounded-lg border border-dashed border-[#d3e8eb] px-4 py-4 text-center text-xs text-slate-400">Nenhum registro do BIS - ITV em {periodLabel}. Envie o arquivo com as colunas <strong className="text-[#0f8a9d]">EDV, Data e Local</strong> em Fontes de dados.</p>
              : visibleServices.length === 0 ? <p className="text-xs text-slate-400">Nenhum serviço corresponde à busca.</p>
                // Cabeçalho (36px) + 10 linhas (40px): a partir da 11ª linha aparece a rolagem
                : <div className="max-h-[436px] overflow-y-auto rounded-lg border border-[#d3e8eb] bg-white">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[#eef7f8] text-[10px] font-bold uppercase tracking-[0.06em] text-[#4d7a82]">
                      <tr className="h-9">
                        <th className="px-3 font-bold">EDV</th>
                        <th className="px-3 font-bold">Nome</th>
                        <th className="px-3 font-bold">Data</th>
                        <th className="px-3 font-bold">Local</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleServices.map(service => <tr key={`${service.edv}|${service.date}|${service.location}`} className="h-10 border-t border-[#ebf4f5] text-[#1f4f57] transition hover:bg-[#f6fbfb]">
                        <td className="whitespace-nowrap px-3 font-semibold tabular-nums">{service.edv}</td>
                        <td className="max-w-[280px] truncate px-3" title={service.name || `${service.edv} (EDV não encontrado no IT007)`}>{service.name || '—'}</td>
                        <td className="whitespace-nowrap px-3 tabular-nums">{formatDate(service.date)}</td>
                        <td className="max-w-[320px] truncate px-3" title={service.location}>{service.location || '—'}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>}
        </div>
      </div>
    </div>
  </section>
}
