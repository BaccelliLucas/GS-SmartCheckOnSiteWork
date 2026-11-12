import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/components/auth/auth-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Smart Check | On-Site Work',
  description: 'Monitoramento corporativo de frequência presencial e contratos de trabalho.',
  icons: {
    icon: [
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
      {
        url: '/icon-32x32.png',
        sizes: '32x32',
        type: 'image/png',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
