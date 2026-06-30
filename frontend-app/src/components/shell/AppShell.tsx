import type { ComponentChildren } from 'preact'
import { useState, useEffect, useMemo } from 'preact/hooks'
import { useDbConnectorNames } from '@/hooks/useDbConnectors'
import { setDbConnectorNames } from '@/lib/leadSourceLabels'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useT } from '@/i18n'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { CallWidget } from '@/components/voip/CallWidget'
import { WaCallWidget } from '@/components/voip/WaCallWidget'
import { initWaCallManager } from '@/lib/waCallManager'
import { env } from '@/lib/env'

interface AppShellProps {
  children: ComponentChildren
}

export function AppShell({ children }: AppShellProps) {
  const layout = useShellLayout()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const t = useT()

  // Alimenta o mapa id→nome dos Conectores de BD para que leadSourceLabel()
  // mostre o nome amigável do canal (em vez de "db_connector:1") em funis,
  // relatórios, Leads, Kanban e Conversas. useMemo roda no render, antes dos
  // filhos, então o rótulo já sai resolvido quando os dados chegam.
  const { data: dbConnNames } = useDbConnectorNames()
  useMemo(() => {
    if (dbConnNames?.items) {
      setDbConnectorNames(Object.fromEntries(dbConnNames.items.map((c) => [c.id, c.name])))
    }
  }, [dbConnNames])

  // Cmd+K / Ctrl+K abre a palette globalmente
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Inicializa o gerenciador de chamadas WhatsApp (WebRTC): escuta os eventos
  // wa_call:* do WebSocket e controla a mídia. Só quando a feature está habilitada.
  useEffect(() => {
    if (!env.waCalling) return
    return initWaCallManager()
  }, [])

  return (
    <div class="app-shell" data-shell-layout={layout}>
      <a href="#main-content" class="skip-link">
        {t('shell.skipToContent')}
      </a>
      <Topbar onOpenCommandPalette={() => setPaletteOpen(true)} />
      <Sidebar />
      <main id="main-content" class="app-main" tabIndex={-1}>
        {children}
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <CallWidget />
      <WaCallWidget />
    </div>
  )
}
