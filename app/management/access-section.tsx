'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LayoutDashboard, Plus, Search, Settings2, ShieldCheck, UsersRound, X } from 'lucide-react'

type AccessLevel = 'general' | 'detail' | 'management'
type AccessGrant = { email: string; levels: AccessLevel[]; updatedAt: string }

type AccessColor = { accent: string; soft: string; border: string; background: string; text: string }

// Cada acesso tem a sua cor: azul (geral), turquesa (detalhe) e índigo (Management)
const accessDefinitions: { key: AccessLevel; title: string; description: string; icon: typeof LayoutDashboard; color: AccessColor }[] = [
  { key: 'general', title: 'Status e Tipo de contrato (Acesso ao sistema)', description: 'Acesso geral ao sistema: evolução da presença no ano e distribuição dos contratos por área.', icon: LayoutDashboard, color: { accent: '#1475bd', soft: '#e7f2fa', border: '#c3dcef', background: '#f7fbfe', text: '#0f4f80' } },
  { key: 'detail', title: 'Presença no escritório e Colaboradores', description: 'Visão detalhada por pessoa: presença diária, calendário individual e lista de colaboradores com EDV e gestor.', icon: UsersRound, color: { accent: '#0f8a9d', soft: '#e2f4f6', border: '#b8e0e6', background: '#f6fcfc', text: '#0b5f6c' } },
  { key: 'management', title: 'Management', description: 'Administração do sistema: importação das bases e regras de negócio, como metas, feriados, exceções e acessos.', icon: Settings2, color: { accent: '#5b5bd6', soft: '#ededfc', border: '#d2d3f6', background: '#f9f9fe', text: '#3e3ea8' } },
]

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

function AccessModal({ grant, existingEmails, onClose, onSave }: {
  grant: AccessGrant | null
  existingEmails: Set<string>
  onClose: () => void
  onSave: (email: string, levels: AccessLevel[]) => Promise<string>
}) {
  const [email, setEmail] = useState(grant?.email ?? '')
  const [levels, setLevels] = useState<AccessLevel[]>(grant?.levels ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editing = grant !== null
  const normalizedEmail = email.trim().toLowerCase()
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  const duplicate = !editing && existingEmails.has(normalizedEmail)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function toggleLevel(level: AccessLevel) {
    setLevels(current => current.includes(level) ? current.filter(item => item !== level) : [...current, level])
  }

  async function save() {
    if (!validEmail) return setError('Informe um e-mail válido.')
    if (duplicate) return setError('Este e-mail já tem acesso. Use o lápis na lista para editar.')
    if (levels.length === 0) return setError('Selecione ao menos um acesso.')
    setSaving(true)
    const saveError = await onSave(normalizedEmail, levels)
    setSaving(false)
    if (saveError) setError(saveError)
    else onClose()
  }

  // Portal no body: fica fora do formulário de importação (Enter aqui não envia arquivos)
  return createPortal(<div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-50 grid place-items-center bg-[#17384f]/25 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="access-modal-title" className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#cfe0ee] bg-white shadow-[0_24px_70px_rgba(23,67,96,0.24)]">
      <div className="flex items-center justify-between border-b border-[#e1ecf4] px-5 py-4">
        <div><h3 id="access-modal-title" className="font-semibold text-[#183b56]">{editing ? 'Editar acesso' : 'Adicionar acesso'}</h3><p className="mt-0.5 text-xs text-[#4f7590]">Informe o e-mail e marque o que a pessoa pode acessar</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-[#eef6fc] hover:text-[#1475bd]"><X className="size-4" /></button>
      </div>
      <div className="space-y-5 overflow-y-auto p-5">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.09em] text-[#4f7590]">E-mail</span>
          <input autoFocus={!editing} readOnly={editing} type="email" value={email} onChange={event => { setEmail(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} placeholder="nome.sobrenome@br.bosch.com" className="h-10 w-full rounded-lg border border-[#cfe0ee] bg-white px-3 text-sm text-[#183b56] outline-none transition placeholder:text-slate-400 read-only:bg-[#f4f8fb] read-only:text-[#4f7590] focus:border-[#1475bd] focus:ring-3 focus:ring-[#1475bd]/10" />
        </label>
        <div>
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.09em] text-[#4f7590]">Acessos</span>
          <div className="space-y-2">
            {accessDefinitions.map(definition => {
              const selected = levels.includes(definition.key)
              const Icon = definition.icon
              const { color } = definition
              return <button key={definition.key} type="button" role="checkbox" aria-checked={selected} onClick={() => { toggleLevel(definition.key); setError('') }} className="flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition hover:brightness-[0.99]" style={selected ? { borderColor: color.accent, backgroundColor: color.soft, boxShadow: `0 0 0 3px ${color.accent}1a` } : { borderColor: '#dde8f0', backgroundColor: '#fff' }}>
                <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-white" style={selected ? { borderColor: color.accent, backgroundColor: color.accent } : { borderColor: '#b9cad5', backgroundColor: '#fff' }}>{selected && <Check className="size-3" strokeWidth={3} />}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: color.text }}><Icon className="size-4" style={{ color: color.accent }} />{definition.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">{definition.description}</span>
                </span>
              </button>
            })}
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg border border-[#f3c8cc] bg-[#fff4f5] px-3 py-2 text-xs font-medium text-[#b42330]">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e1ecf4] bg-[#f8fbfd] px-5 py-3">
        <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100">Cancelar</button>
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center rounded-lg bg-[#1475bd] px-4 text-sm font-semibold text-white transition hover:bg-[#0f63a2] disabled:cursor-wait disabled:opacity-60">{saving ? 'Salvando...' : editing ? 'Salvar' : 'Adicionar'}</button>
      </div>
    </div>
  </div>, document.body)
}

function initials(email: string) {
  const [first = '', second = ''] = email.split('@')[0].split(/[._-]+/)
  return (first[0] ?? '?').concat(second[0] ?? '').toUpperCase()
}

const validEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AccessRow({ definition, grants, search, onAdd, onRemove, onEdit }: {
  definition: (typeof accessDefinitions)[number]
  grants: AccessGrant[]
  search: string
  onAdd: (email: string) => Promise<string>
  onRemove: (grant: AccessGrant) => void
  onEdit: (grant: AccessGrant) => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const Icon = definition.icon
  const { color } = definition
  const members = grants.filter(grant => grant.levels.includes(definition.key))
  const visibleMembers = search ? members.filter(grant => grant.email.includes(search)) : members

  async function add() {
    const email = input.trim().toLowerCase()
    if (!email) return
    if (!validEmailPattern.test(email)) return setError('E-mail inválido')
    if (members.some(grant => grant.email === email)) return setError('Já tem este acesso')
    const addError = await onAdd(email)
    if (addError) setError(addError)
    else setInput('')
  }

  return <div className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center" style={{ borderColor: color.border, backgroundColor: color.background }}>
    <div className="flex w-full shrink-0 items-start gap-3 rounded-lg px-3 py-2.5 sm:w-72" style={{ backgroundColor: color.soft }}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white shadow-sm" style={{ backgroundColor: color.accent }}><Icon className="size-[18px]" /></span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <strong className="text-sm leading-5" style={{ color: color.text }}>{definition.title}</strong>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold ring-1" style={{ color: color.accent, ['--tw-ring-color' as string]: color.border }} title="Pessoas com este acesso">{members.length}</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{definition.description}</p>
      </div>
    </div>
    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
      {visibleMembers.map(grant => <span key={grant.email} className="group/badge inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-white pl-1 pr-1.5 text-xs font-semibold shadow-sm" style={{ borderColor: color.border, color: color.text }}>
        <button type="button" onClick={() => onEdit(grant)} title={`Editar acessos de ${grant.email}`} className="flex min-w-0 items-center gap-1.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: color.accent }}>{initials(grant.email)}</span>
          <span className="truncate">{grant.email}</span>
        </button>
        <button type="button" onClick={() => onRemove(grant)} aria-label={`Remover ${definition.title} de ${grant.email}`} className="grid size-5 shrink-0 place-items-center rounded-full opacity-50 transition hover:bg-[#fdecec] hover:text-[#c84d55] group-hover/badge:opacity-100">×</button>
      </span>)}
      {members.length === 0 && <span className="text-xs text-slate-400">Ninguém com este acesso ainda.</span>}
      {members.length > 0 && visibleMembers.length === 0 && <span className="text-xs text-slate-400">Nenhum e-mail encontrado.</span>}
    </div>
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <input value={input} onChange={event => { setInput(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add() } }} type="email" placeholder="Adicionar e-mail" aria-label={`Adicionar e-mail em ${definition.title}`} className="h-9 w-52 rounded-lg border bg-white px-3 text-xs font-medium text-[#183b56] outline-none transition placeholder:text-slate-400 focus:ring-2" style={{ borderColor: error ? '#e3a1a7' : color.border, ['--tw-ring-color' as string]: `${color.accent}26` }} />
        <button type="button" onClick={() => void add()} aria-label={`Adicionar e-mail em ${definition.title}`} className="grid size-9 place-items-center rounded-lg border bg-white transition hover:brightness-95" style={{ borderColor: color.border, color: color.accent }}><Plus className="size-4" /></button>
      </div>
      {error && <span className="text-[11px] font-medium text-[#c84d55]">{error}</span>}
    </div>
  </div>
}

export function AccessSection() {
  const [grants, setGrants] = useState<AccessGrant[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // null = fechado; 'new' = novo acesso; objeto = edição
  const [modal, setModal] = useState<AccessGrant | 'new' | null>(null)

  useEffect(() => {
    fetch('/api/management/access', { cache: 'no-store' })
      .then(response => response.json())
      .then((result: { grants?: AccessGrant[] }) => setGrants(result.grants ?? []))
      .catch(() => setError('Não foi possível carregar os acessos.'))
  }, [])

  async function request(method: 'POST' | 'DELETE', body: object) {
    try {
      const response = await fetch('/api/management/access', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { grants?: AccessGrant[]; error?: string }
      if (!response.ok) return result.error || 'Não foi possível salvar o acesso.'
      setGrants(result.grants ?? [])
      setError('')
      return ''
    } catch {
      return 'Não foi possível salvar o acesso.'
    }
  }

  // Adiciona o acesso da faixa sem mexer nos outros acessos que a pessoa já tem
  function addToLevel(email: string, level: AccessLevel) {
    const current = grants.find(grant => grant.email === email)?.levels ?? []
    return request('POST', { email, levels: [...new Set([...current, level])] })
  }

  // Tira só o acesso da faixa; sem nenhum acesso restante, a pessoa sai da lista
  async function removeFromLevel(grant: AccessGrant, level: AccessLevel) {
    const remaining = grant.levels.filter(item => item !== level)
    const removeError = remaining.length ? await request('POST', { email: grant.email, levels: remaining }) : await request('DELETE', { email: grant.email })
    if (removeError) setError(removeError)
  }

  const sortedGrants = useMemo(() => [...grants].sort((first, second) => collator.compare(first.email, second.email)), [grants])
  const term = search.trim().toLowerCase()

  return <section className="rounded-2xl border border-[#d3e3f0] bg-white shadow-[0_12px_34px_rgba(20,117,189,0.08)]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1ecf4] px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-[#e7f2fa] text-[#1475bd]"><ShieldCheck className="size-5" /></div>
        <div><h2 className="text-[17px] font-semibold text-[#183b56]">Acessos</h2>{error ? <p className="mt-0.5 text-xs font-semibold text-[#c84d55]">{error}</p> : <p className="mt-0.5 text-xs text-slate-500">Quem pode usar o Smart Check e quais partes do sistema cada pessoa vê. Clique em um e-mail para editar todos os acessos dele.</p>}</div>
      </div>
      <div className="flex items-center gap-2">
        {grants.length > 0 && <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#86a6bd]" />
          <input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} placeholder="Buscar e-mail..." className="h-9 w-56 rounded-lg border border-[#cfe0ee] bg-[#f8fbfd] pl-9 pr-3 text-sm text-[#183b56] outline-none transition placeholder:text-slate-400 focus:border-[#1475bd] focus:bg-white focus:ring-2 focus:ring-[#1475bd]/15" />
        </div>}
        <button type="button" onClick={() => setModal('new')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#bcd6ea] bg-[#eef6fc] px-3 text-xs font-semibold text-[#1269a8] transition hover:bg-[#e2eff9]"><Plus className="size-4" /> Adicionar</button>
      </div>
    </div>
    <div className="space-y-3 px-6 py-5">
      {accessDefinitions.map(definition => <AccessRow
        key={definition.key}
        definition={definition}
        grants={sortedGrants}
        search={term}
        onAdd={email => addToLevel(email, definition.key)}
        onRemove={grant => void removeFromLevel(grant, definition.key)}
        onEdit={grant => setModal(grant)}
      />)}
    </div>
    {modal && <AccessModal grant={modal === 'new' ? null : modal} existingEmails={new Set(grants.map(grant => grant.email))} onClose={() => setModal(null)} onSave={(email, levels) => request('POST', { email, levels })} />}
  </section>
}
