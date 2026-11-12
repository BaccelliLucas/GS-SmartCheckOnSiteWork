'use client'

import { useEffect, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { ChevronDown, LogOut } from 'lucide-react'

function initials(name: string) {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/[\s,]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase() || '?'
}

// Pessoa logada (conta Microsoft) e opção de sair, no cabeçalho
export function UserMenu() {
  const { instance, accounts } = useMsal()
  const account = instance.getActiveAccount() ?? accounts[0]
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  if (!account) return null
  const name = account.name || account.username
  const claims = account.idTokenClaims as { email?: string; preferred_username?: string } | undefined
  const email = claims?.email || account.username

  return <div ref={containerRef} className="relative">
    <button type="button" onClick={() => setOpen(current => !current)} aria-haspopup="menu" aria-expanded={open} className="flex h-9 items-center gap-2 rounded-lg border border-transparent pl-1 pr-2 transition hover:border-[#d9e5ee] hover:bg-[#f4f9fc]">
      <span className="grid size-7 place-items-center rounded-full bg-[#1475bd] text-[11px] font-bold text-white">{initials(name)}</span>
      <span className="hidden max-w-44 truncate text-xs font-semibold text-slate-700 sm:block">{name}</span>
      <ChevronDown className={`size-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-xl border border-[#d9e5ee] bg-white shadow-[0_18px_48px_rgba(22,61,86,0.20)]">
      <div className="flex items-center gap-3 border-b border-[#e3ebf0] px-4 py-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1475bd] text-sm font-bold text-white">{initials(name)}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#183b56]">{name}</p>
          <p className="truncate text-xs text-slate-500">{email}</p>
        </div>
      </div>
      <button type="button" role="menuitem" onClick={() => instance.logoutRedirect({ account })} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-[#b42330] transition hover:bg-[#fff4f5]"><LogOut className="size-4" /> Sair</button>
    </div>}
  </div>
}
