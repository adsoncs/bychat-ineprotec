import type { ComponentChildren } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useT } from '@/i18n'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { CallWidget } from '@/components/voip/CallWidget'
import { WaCallWidget } from '@/components/voip/WaCallWidget'
import { initWaCallManager } from '@/lib/waCallManager'

interface AppShellProps {
  children: ComponentChildren
}

export function AppShell({ children }: AppShellProps) {
  const layout = useShellLayout()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const t = useT()

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
  // wa_call:* do WebSocket e controla a mídia. Cleanup ao desmontar.
  useEffect(() => initWaCallManager(), [])

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
