'use client'

import { ReactNode, useEffect, useState } from 'react'
import { AuthenticationResult, EventMessage, EventType, InteractionStatus, PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useIsAuthenticated, useMsal } from '@azure/msal-react'
import { clearStaleInteraction, msalConfig } from '@/lib/auth_config'
import { LoadingScreen, LoginScreen } from './login-screen'

// Uma única instância do MSAL para a aba inteira (o React monta os componentes duas vezes em desenvolvimento;
// duas instâncias disputariam a resposta do login da Microsoft)
let msalReady: Promise<{ instance: PublicClientApplication; error: string }> | null = null

function startMsal() {
  msalReady ??= (async () => {
    const instance = new PublicClientApplication(msalConfig)
    await instance.initialize()
    let error = ''
    try {
      // Volta do login da Microsoft: lê a resposta que veio no endereço (#code=...)
      const result = await instance.handleRedirectPromise()
      if (result?.account) instance.setActiveAccount(result.account)
    } catch (redirectError) {
      error = loginErrorMessage(redirectError)
    }
    clearStaleInteraction()
    if (!instance.getActiveAccount() && instance.getAllAccounts()[0]) instance.setActiveAccount(instance.getAllAccounts()[0])
    instance.addEventCallback((event: EventMessage) => {
      const account = (event.payload as AuthenticationResult | null)?.account
      if (event.eventType === EventType.LOGIN_SUCCESS && account) instance.setActiveAccount(account)
    })
    return { instance, error }
  })()
  return msalReady
}

// Mostra o código do Azure (AADSTS...) e o endereço de retorno usado, para conferir com o registro do app
function loginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const code = message.match(/AADSTS\d+/)?.[0]
  const redirectUri = msalConfig.auth.redirectUri
  if (code === 'AADSTS50011') return `AADSTS50011: o endereço de retorno ${redirectUri} não está cadastrado no app do Azure (Authentication → Single-page application).`
  if (code === 'AADSTS9002326') return `AADSTS9002326: no Azure, ${redirectUri} está cadastrado como "Web". Ele precisa estar em "Single-page application".`
  if (code === 'AADSTS700016') return 'AADSTS700016: o Client ID não foi encontrado neste tenant. Confira o CLIENT_ID e o TENANT_ID em lib/auth_config.ts.'
  if (code === 'AADSTS50105') return 'AADSTS50105: sua conta não tem acesso a este aplicativo. Peça para ser incluído no app do Azure.'
  if (message.includes('user_cancelled')) return 'O login foi cancelado.'
  return message ? `Não foi possível entrar (retorno: ${redirectUri}). ${message}` : 'Não foi possível entrar.'
}

function AuthGate({ children, loginError }: { children: ReactNode; loginError: string }) {
  const isAuthenticated = useIsAuthenticated()
  const { inProgress } = useMsal()
  if (isAuthenticated) return children
  if (inProgress !== InteractionStatus.None) return <LoadingScreen />
  return <LoginScreen error={loginError} />
}

// Exige login Microsoft (SSO) antes de mostrar qualquer página do Smart Check
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ instance: PublicClientApplication; error: string } | null>(null)
  const [startError, setStartError] = useState('')

  useEffect(() => {
    let active = true
    startMsal()
      .then(result => { if (active) setState(result) })
      .catch(error => { if (active) setStartError(loginErrorMessage(error)) })
    return () => {
      active = false
    }
  }, [])

  if (!state) return <LoadingScreen error={startError} />
  return <MsalProvider instance={state.instance}><AuthGate loginError={state.error}>{children}</AuthGate></MsalProvider>
}
