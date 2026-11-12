import { Configuration, RedirectRequest } from '@azure/msal-browser'

// Registro do Smart Check no Microsoft Entra ID (Azure AD) da Bosch
const CLIENT_ID = '5fd431fe-f078-41da-a1f8-a19bb7a8df0e'
const TENANT_ID = '0ae51e19-07c8-4e4b-bb6d-648ee58410f4'
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`

// No servidor não existe window; o login só roda no navegador
const origin = typeof window === 'undefined' ? undefined : window.location.origin

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: AUTHORITY,
    redirectUri: origin, // Precisa estar cadastrada no Azure como "Single-page application"
    postLogoutRedirectUri: origin,
  },
  cache: {
    cacheLocation: 'sessionStorage', // A sessão vale enquanto a aba/navegador estiver aberto
  },
}

// Escopos pedidos no login: identificação básica (nome e e-mail)
export const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email'],
}

// O MSAL marca "login em andamento" em msal.interaction.status e só apaga a marca do mesmo Client ID.
// Uma tentativa interrompida (ou feita com outro Client ID) deixa a marca e todo login seguinte falha
// com interaction_in_progress; depois que a volta do login foi processada, a marca não vale mais.
export function clearStaleInteraction() {
  try {
    window.sessionStorage.removeItem('msal.interaction.status')
  } catch {}
}
