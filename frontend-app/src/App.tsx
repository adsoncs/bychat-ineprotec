import { useEffect } from 'preact/hooks'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AuthGate } from '@/components/AuthGate'
import { AppShell } from '@/components/shell/AppShell'
import { Router } from '@/routes/Router'
import { startThemeAutoSync, useThemeStore } from '@/stores/theme'
import { startRealtimeBus } from '@/lib/realtime'
import { applyAppearance } from '@/lib/applyAppearance'
import { usePublicAppearance } from '@/hooks/useSettings'

function AppearanceSync() {
  const { data } = usePublicAppearance()
  // Reagir à mudança de tema: as customizações do Painel Admin (cores claras
  // legadas) só valem no tema claro. Quando o user troca para escuro, precisamos
  // re-aplicar para LIMPAR essas vars e devolver os tokens semânticos do tema.
  const theme = useThemeStore((s) => s.theme)
  useEffect(() => {
    if (data?.appearance) applyAppearance(data.appearance)
  }, [data?.appearance, theme])
  return null
}

export function App() {
  useEffect(() => startThemeAutoSync(), [])
  useEffect(() => startRealtimeBus({ qc: queryClient }), [])

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceSync />
      <AuthGate>
        <AppShell>
          <Router />
        </AppShell>
      </AuthGate>
    </QueryClientProvider>
  )
}
