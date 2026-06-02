import type { Story } from '@ladle/react'
import { Router as WouterRouter } from 'wouter-preact'
import { useEffect } from 'preact/hooks'
import { useSidebarStore } from '@/stores/sidebar'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export default {
  title: 'Shell / Sidebar',
}

function ShellFrame({ children }: { children: preact.ComponentChildren }) {
  return (
    <WouterRouter base="/app">
      <div class="app-shell" data-shell-layout="desktop">
        <Topbar onOpenCommandPalette={() => undefined} />
        {children}
        <main class="app-main">
          <div class="text-fg-muted text-sm">Conteúdo principal — sidebar deve estar à esquerda.</div>
        </main>
      </div>
    </WouterRouter>
  )
}

export const Expanded: Story = () => {
  const setMode = useSidebarStore((s) => s.setMode)
  useEffect(() => setMode('expanded'), [setMode])
  return (
    <ShellFrame>
      <Sidebar />
    </ShellFrame>
  )
}

export const Rail: Story = () => {
  const setMode = useSidebarStore((s) => s.setMode)
  useEffect(() => setMode('rail'), [setMode])
  return (
    <ShellFrame>
      <Sidebar />
    </ShellFrame>
  )
}

export const DrawerOpen: Story = () => {
  const openDrawer = useSidebarStore((s) => s.openDrawer)
  const setMode = useSidebarStore((s) => s.setMode)
  useEffect(() => {
    setMode('auto')
    openDrawer()
  }, [openDrawer, setMode])
  return (
    <ShellFrame>
      <Sidebar />
    </ShellFrame>
  )
}
DrawerOpen.parameters = {
  width: 'mobile',
}
