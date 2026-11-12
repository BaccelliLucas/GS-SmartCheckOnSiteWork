'use client'

import { useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { ArrowRight, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { clearStaleInteraction, loginRequest } from '@/lib/auth_config'

const boschLogoUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/Bosch_symbol_logo_black_red.png?version=1&modificationDate=1773863609000&api=v2'
const boschSupergraphicUrl = 'https://inside-docupedia.bosch.com/confluence/download/attachments/6951382648/supergraphic.jpg?version=1&modificationDate=1773863610000&api=v2'

function AuthCard({ children }: { children: React.ReactNode }) {
  return <div className="light grid min-h-screen place-items-center bg-[linear-gradient(135deg,#f4f9fc_0%,#f7fbfa_52%,#eef8ff_100%)] p-4 text-slate-700">
    <div className="w-full max-w-[460px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(23,67,96,0.16)]">
      <div className="h-[14px] w-full bg-[#e20015]" style={{ backgroundImage: `url(${boschSupergraphicUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
      {children}
      <div className="border-t border-[#e8edf1] bg-[#f3f5f7] px-6 py-4 text-center text-xs text-slate-500">© {new Date().getFullYear()} Robert Bosch GmbH. Todos os direitos reservados.</div>
    </div>
  </div>
}

export function LoadingScreen({ error = '' }: { error?: string }) {
  return <AuthCard>
    <div className="flex flex-col items-center px-8 py-16">
      <img src={boschLogoUrl} alt="Bosch" className="h-14 w-auto object-contain" />
      {error ? <p role="alert" className="mt-8 rounded-lg border border-[#f3c8cc] bg-[#fff4f5] px-4 py-2.5 text-xs font-medium text-[#b42330]">{error}</p> : <>
        <span className="mt-8 size-8 animate-spin rounded-full border-[3px] border-[#f3c8cc] border-t-[#e20015]" aria-hidden="true" />
        <p className="mt-4 text-sm text-slate-500">Verificando sua sessão...</p>
      </>}
    </div>
  </AuthCard>
}

export function LoginScreen({ error }: { error: string }) {
  const { instance } = useMsal()
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  function signIn() {
    setStarting(true)
    setStartError('')
    // Depois do login a Microsoft devolve para a mesma página em que a pessoa estava
    const start = () => instance.loginRedirect({ ...loginRequest, redirectStartPage: window.location.href })
    start()
      .catch(loginError => {
        // Marca de uma tentativa anterior que não terminou: limpa e tenta de novo uma vez
        if ((loginError as { errorCode?: string })?.errorCode !== 'interaction_in_progress') throw loginError
        clearStaleInteraction()
        return start()
      })
      .catch(loginError => {
        setStarting(false)
        setStartError(loginError instanceof Error ? loginError.message : 'Não foi possível iniciar o login.')
      })
  }

  const message = startError || error
  return <AuthCard>
    <div className="flex flex-col items-center px-8 pb-10 pt-12 text-center">
      <img src={boschLogoUrl} alt="Bosch" className="h-14 w-auto object-contain" />
      <h1 className="mt-10 text-2xl font-bold tracking-tight text-[#1a1f24]">Smart Check | On-Site Work</h1>
      <p className="mt-2 text-[15px] text-slate-500">Entre com sua conta Bosch</p>
      <button type="button" onClick={signIn} disabled={starting} className="group mt-10 flex h-14 w-full items-center gap-3 rounded-xl bg-[#007bc0] pl-2 pr-5 text-white shadow-[0_8px_20px_rgba(0,123,192,0.25)] transition hover:-translate-y-0.5 hover:bg-[#00629a] hover:shadow-[0_12px_28px_rgba(0,123,192,0.32)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#007bc0]/25 disabled:cursor-wait disabled:opacity-80 disabled:hover:translate-y-0">
        <span className="grid size-10 place-items-center rounded-lg bg-white/15" aria-hidden="true">
          <KeyRound className="size-5" />
        </span>
        <span className="flex-1 text-left text-[15px] font-semibold">{starting ? 'Redirecionando...' : 'Entrar com Single Sign-On'}</span>
        {starting
          ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          : <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />}
      </button>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Login único e seguro via Microsoft Azure (Entra ID)
      </p>
      {message && <p role="alert" className="mt-4 rounded-lg border border-[#f3c8cc] bg-[#fff4f5] px-4 py-2.5 text-xs font-medium text-[#b42330]">{message}</p>}
    </div>
  </AuthCard>
}
