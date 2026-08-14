import type { ComponentChildren } from 'preact'
import { useState, useEffect, useMemo } from 'preact/hooks'
import { useDbConnectorNames } from '@/hooks/useDbConnectors'
import { setDbConnectorNames } from '@/lib/leadSourceLabels'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useSidebarStore, resolveSidebarMode } from '@/stores/sidebar'
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

  // O conteúdo à direita se desloca pelo modo EFETIVO da sidebar, não pelo
  // tamanho da janela: recolher o menu num monitor grande precisa devolver o
  // espaço, senão sobra uma faixa vazia do tamanho da diferença.
  const sidebarMode = useSidebarStore((s) => s.mode)
  const setSidebarMode = useSidebarStore((s) => s.setMode)
  const effectiveSidebarMode = resolveSidebarMode(layout, sidebarMode)

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

  // Cmd+K / Ctrl+K abre a palette globalmente; Cmd+B / Ctrl+B recolhe o menu
  // (mesmo atalho do VS Code). No mobile a navegação é o drawer — o atalho ali
  // deixaria o usuário com uma tira de ícones sem como voltar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (key === 'b' && layout !== 'mobile') {
        e.preventDefault()
        setSidebarMode(effectiveSidebarMode === 'rail' ? 'expanded' : 'rail')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, effectiveSidebarMode, setSidebarMode])

  // Inicializa o gerenciador de chamadas WhatsApp (WebRTC): escuta os eventos
  // wa_call:* do WebSocket e controla a mídia. Só quando a feature está habilitada.
  useEffect(() => {
    if (!env.waCalling) return
    return initWaCallManager()
  }, [])

  return (
    <div class="app-shell" data-shell-layout={layout} data-sidebar-mode={effectiveSidebarMode}>
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
