import { Menu, Search, LogOut, User as UserIcon, Sun, Moon, Monitor, Type, Shield, Settings as SettingsIcon, SlidersHorizontal, Eye, BarChart3, Headphones, Check, ChevronDown, LayoutGrid, MessageSquare } from '@/components/ui/icon-set'
import { Maximize, Minimize } from '@/components/ui/icons.custom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useState, useMemo, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/stores/sidebar'
import { useThemeStore, type Theme } from '@/stores/theme'
import { useFontSizeStore, FONT_SIZE_LABELS, type FontSize } from '@/stores/fontSize'
import { useT } from '@/i18n'
import { useAuth, useUpdateWorkStatus } from '@/hooks/useAuth'
import { ROLE_LABELS, type UserRole } from '@/hooks/useUsers'
import type { WorkStatus } from '@/stores/user'
import { ProfileModal } from './ProfileModal'
import { AccountPrefsModal } from '@/components/AccountPrefsModal'
import { WorkInbox } from './WorkInbox'
import { TopbarUtil } from './TopbarUtil'
import { useTopbarPulse } from '@/hooks/useTopbarPulse'
import { useMyPermissions } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'
import { sidebarSchema, findItem } from '@/modules/sidebar.config'
import { useFavoritesStore } from '@/stores/favorites'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'
import { ICON_SIZE } from '@/components/ui/Icon'

/**
 * Iniciais em cinza sólido, e não um degradê sorteado pelo e-mail.
 *
 * O gradiente por hash — dez pares de roxo, coral e teal — era a assinatura
 * visual mais reconhecível de interface gerada por IA, e não dizia nada que as
 * iniciais já não digam. A cor no avatar voltou a significar uma coisa só: o
 * anel de status de trabalho.
 */
function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || '').trim()
  if (!src) return '?'
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  return src.substring(0, 2).toUpperCase()
}

const ROLE_ICONS: Record<UserRole, typeof Shield> = {
  SUPERADMIN: Shield,
  ADMIN: Shield,
  MANAGER: BarChart3,
  AGENT: Headphones,
  VIEWER: Eye,
}

// ── Status de trabalho ────────────────────────────────────────────────────
const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  available: 'Disponível',
  away: 'Ausente',
  busy: 'Em pausa',
  offline: 'Offline',
}
const WORK_STATUS_COLORS: Record<WorkStatus, string> = {
  available: 'var(--color-success)',
  away: 'var(--color-warning)',
  busy: 'var(--color-danger)',
  offline: 'var(--color-fg-muted)',
}
const WORK_STATUS_HINTS: Record<WorkStatus, string> = {
  available: 'Você recebe leads novos automaticamente',
  away: 'Você não recebe novos leads (rotação pula você)',
  busy: 'Em atendimento focado — não recebe novos',
  offline: 'Você não está trabalhando agora',
}

interface TopbarProps {
  onOpenCommandPalette: () => void
  onToggleSidebar: () => void
}

/**
 * A barra superior — desenho de painel administrativo clássico, em duas faixas.
 *
 * Esta é a de cima, e ela pertence ao SISTEMA: é idêntica em toda tela, e é a
 * previsibilidade que faz a mão ir sozinha. A de baixo (`PageStrip`) pertence à
 * tela e muda com ela.
 *
 * A fileira da direita é lida como um bloco só porque todos os botões são
 * iguais — mesmo diâmetro, mesmo cinza, mesmo hover circular — e um risco
 * vertical separa a conta do resto. É o que permite ter várias utilidades sem
 * que o topo vire uma prateleira: o olho conta "utilidades", não seis decisões.
 */
export function Topbar({ onOpenCommandPalette, onToggleSidebar }: TopbarProps) {
  const layout = useShellLayout()
  const openDrawer = useSidebarStore((s) => s.openDrawer)
  const { user, logout } = useAuth()
  const t = useT()
  const [, navigate] = useLocation()
  const isMobile = layout === 'mobile'
  const role = (user?.role as UserRole | undefined) ?? undefined
  const displayName = user?.name?.trim() || user?.email || '—'
  const initials = getInitials(user?.name, user?.email)
  const [profileOpen, setProfileOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)

  // O contador de "conversas esperando" é o mesmo número da Supervisão, e só é
  // buscado para quem atende — para o financeiro ou o marketing seria um número
  // sobre uma fila que não é dele.
  const { data: perms } = useMyPermissions()
  const papel = useUserStore((st) => st.user?.role ?? null)
  const veAtendimento = papel === 'SUPERADMIN' || !!perms?.permissions?.['atendimento']?.canView
  // Vale no celular também: o contador de conversas esperando é o único sinal
  // de fila que sobra ali, já que a barra estreita não comporta mais nada.
  const pulse = useTopbarPulse(veAtendimento)
  const esperando = pulse.data?.esperando ?? 0

  return (
    <header class="app-topbar">
      <button
        type="button"
        class="size-9 grid place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg shrink-0"
        onClick={isMobile ? openDrawer : onToggleSidebar}
        aria-label={isMobile ? t('shell.menu.open') : 'Recolher ou expandir o menu'}
        title={isMobile ? t('shell.menu.open') : 'Recolher o menu (⌘B)'}
      >
        <Menu size={ICON_SIZE.md} />
      </button>

      {/* No celular o campo não cabe ao lado das utilidades — vira uma lupa, que
          abre o mesmo ⌘K. Some-lo por completo tiraria a busca de quem só usa o
          telefone, que é justamente quem não tem o atalho de teclado. */}
      {isMobile ? (
        <TopbarUtil titulo={t('shell.search.placeholder')} onClick={onOpenCommandPalette}>
          <Search size={ICON_SIZE.md} />
        </TopbarUtil>
      ) : (
        <button
          type="button"
          onClick={onOpenCommandPalette}
          class={cn(
            'flex items-center gap-2 h-9 px-3 rounded-lg text-sm min-w-0',
            'flex-1 max-w-[22rem] bg-surface-3 text-fg-muted hover:text-fg transition-colors',
          )}
          aria-label={t('shell.search.aria')}
        >
          <Search size={ICON_SIZE.md} class="shrink-0" />
          <span class="flex-1 text-left truncate">{t('shell.search.placeholder')}</span>
        </button>
      )}

      <div class="ml-auto flex items-center gap-0.5 min-w-0">
        {!isMobile && <MenuDeAtalhos />}
        {!isMobile && <BotaoTelaCheia />}
        <MenuDeTema />
        <TopbarUtil
          titulo={esperando ? `${esperando} conversa(s) esperando resposta` : 'Conversas'}
          onClick={() => navigate('/app/conversations')}
          badge={esperando}
        >
          <MessageSquare size={ICON_SIZE.md} />
        </TopbarUtil>
        <WorkInbox />
        <span class="w-px h-6 bg-border mx-2 shrink-0" aria-hidden="true" />
        <MenuDaConta
          displayName={displayName}
          email={user?.email ?? ''}
          initials={initials}
          role={role}
          onPerfil={() => setProfileOpen(true)}
          onPreferencias={() => setPrefsOpen(true)}
          onSair={logout}
        />
      </div>
      <ProfileModal open={profileOpen} onOpenChange={setProfileOpen} />
      <AccountPrefsModal open={prefsOpen} onOpenChange={setPrefsOpen} />
    </header>
  )
}

/**
 * O grid de atalhos.
 *
 * Num template ele existe para mostrar um componente; aqui só se justifica se
 * levar a algum lugar que a pessoa de fato usa. Por isso ele não é uma lista
 * fixa: são os FAVORITOS de quem está logado, completados com os atalhos do topo
 * do menu até fechar as nove células.
 */
function MenuDeAtalhos() {
  const [, navigate] = useLocation()
  const favoritos = useFavoritesStore((s) => s.ids)

  const celulas = useMemo(() => {
    const escolhidos: typeof sidebarSchema.pinned = []
    const vistos = new Set<string>()
    for (const id of favoritos) {
      const it = findItem(id)
      if (it && !vistos.has(it.id)) { escolhidos.push(it); vistos.add(it.id) }
    }
    for (const it of sidebarSchema.pinned) {
      if (escolhidos.length >= 9) break
      if (!vistos.has(it.id)) { escolhidos.push(it); vistos.add(it.id) }
    }
    return escolhidos.slice(0, 9)
  }, [favoritos])

  if (celulas.length === 0) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-9 grid place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
          aria-label="Atalhos"
          title="Atalhos"
        >
          <LayoutGrid size={ICON_SIZE.md} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="w-[16rem] rounded-lg bg-surface-2 border border-border shadow-xl surface-raised p-2"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <div class="px-1 pb-2 text-3xs uppercase tracking-wider text-fg-muted font-semibold">
            Atalhos
          </div>
          <div class="grid grid-cols-3 gap-0.5">
            {celulas.map((it) => (
              <DropdownMenu.Item
                key={it.id}
                class="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-lg cursor-pointer hover:bg-surface-3 outline-none text-center"
                onSelect={() => { if (it.href) navigate(it.href) }}
              >
                <Icon name={it.icon} size="md" class="text-accent" />
                <span class="text-3xs text-fg-muted leading-tight line-clamp-2">{it.label}</span>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * Tela cheia.
 *
 * O F11 do navegador faz o mesmo, e por isso este botão só se paga se souber o
 * estado: ele escuta `fullscreenchange`, então sair pelo F11 ou pelo Esc troca o
 * ícone aqui também. Um botão que mostra "entrar" com a tela já cheia é pior que
 * não ter botão.
 */
function BotaoTelaCheia() {
  const [cheia, setCheia] = useState(false)

  useEffect(() => {
    const sincronizar = () => setCheia(!!document.fullscreenElement)
    sincronizar()
    document.addEventListener('fullscreenchange', sincronizar)
    return () => document.removeEventListener('fullscreenchange', sincronizar)
  }, [])

  // Alguns navegadores recusam a promessa (política do site, iframe sem
  // permissão). O catch existe para o erro não subir como rejeição não tratada
  // — o botão simplesmente não faz nada, e o estado continua verdadeiro.
  function alternar() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  if (typeof document !== 'undefined' && !document.documentElement.requestFullscreen) return null

  return (
    <TopbarUtil titulo={cheia ? 'Sair da tela cheia' : 'Tela cheia'} onClick={alternar}>
      {cheia ? <Minimize size={ICON_SIZE.md} /> : <Maximize size={ICON_SIZE.md} />}
    </TopbarUtil>
  )
}

/** Tema: o ícone mostra o tema em vigor, o menu troca. */
function MenuDeTema() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const t = useT()
  const Atual = theme === 'light' ? Sun : theme === 'system' ? Monitor : Moon
  const items: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('shell.theme.light'), icon: Sun },
    { value: 'dark', label: t('shell.theme.dark'), icon: Moon },
    { value: 'system', label: t('shell.theme.system'), icon: Monitor },
  ]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-9 grid place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
          aria-label={t('shell.theme.label')}
          title={t('shell.theme.label')}
        >
          <Atual size={ICON_SIZE.md} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[10rem] rounded-lg bg-surface-2 border border-border shadow-lg surface-raised p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {items.map((it) => {
            const Icone = it.icon
            const atual = it.value === theme
            return (
              <DropdownMenu.Item
                key={it.value}
                class={cn(
                  'flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none',
                  atual && 'text-fg font-medium',
                )}
                onSelect={() => setTheme(it.value)}
              >
                <Icone size={ICON_SIZE.sm} />
                <span class="flex-1">{it.label}</span>
                {atual && <Check size={ICON_SIZE.sm} class="text-accent" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * A conta: avatar, nome e papel, um sob o outro.
 *
 * Custa largura e não serve para nada operacional — e é justamente o que faz o
 * painel parecer um sistema com gente e papel, em vez de uma ferramenta anônima.
 * O anel colorido no avatar carrega o status de trabalho, e trocá-lo é a
 * primeira linha do menu: some uma pílula da barra sem que a operação perca o
 * controle que usa todo dia.
 */
function MenuDaConta(
  { displayName, email, initials, role, onPerfil, onPreferencias, onSair }: {
    displayName: string
    email: string
    initials: string
    role: UserRole | undefined
    onPerfil: () => void
    onPreferencias: () => void
    onSair: () => void
  },
) {
  const t = useT()
  const { user } = useAuth()
  const update = useUpdateWorkStatus()
  const status: WorkStatus = (user?.workStatus as WorkStatus | undefined) ?? 'offline'
  const size = useFontSizeStore((st) => st.size)
  const setSize = useFontSizeStore((st) => st.setSize)
  const Papel = role ? ROLE_ICONS[role] : null
  const tamanhos: FontSize[] = ['comfortable', 'large', 'larger']
  const estados: WorkStatus[] = ['available', 'away', 'busy', 'offline']

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="flex items-center gap-2 h-11 pl-1 pr-2 rounded-full hover:bg-surface-3 transition-colors min-w-0"
          aria-label={t('shell.user.menu')}
        >
          <span class="relative grid place-items-center shrink-0">
            <span class="size-8 rounded-full grid place-items-center text-2xs font-semibold bg-surface-3 text-fg ring-1 ring-border">
              {initials}
            </span>
            <span
              class="absolute bottom-0 right-0 size-2.5 rounded-full ring-2 ring-surface"
              style={{ background: WORK_STATUS_COLORS[status] }}
            />
          </span>
          <span class="hidden lg:block min-w-0 text-left leading-tight">
            <span class="block text-xs font-semibold text-fg truncate max-w-[9rem]">{displayName}</span>
            <span class="block text-3xs text-fg-muted truncate max-w-[9rem]">
              {role ? ROLE_LABELS[role] : ''}
            </span>
          </span>
          <ChevronDown size={ICON_SIZE.sm} class="text-fg-muted hidden lg:block shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[17rem] rounded-panel bg-surface-2 border border-border shadow-xl surface-raised p-0 overflow-hidden"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <div class="flex items-start gap-3 p-3">
            <span class="size-10 rounded-full grid place-items-center text-xs font-semibold bg-surface-3 text-fg ring-1 ring-border shrink-0">
              {initials}
            </span>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="text-sm font-semibold text-fg truncate">{displayName}</div>
              <div class="text-2xs text-fg-muted truncate">{email}</div>
              {role && Papel && (
                <span class="inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-3xs font-medium text-fg-muted ring-1 ring-border">
                  <Papel size={ICON_SIZE.xs} />
                  {ROLE_LABELS[role]}
                </span>
              )}
            </div>
          </div>

          <DropdownMenu.Separator class="h-px bg-border" />

          <div class="p-1">
            <div class="px-2.5 pt-1.5 pb-1 text-3xs uppercase tracking-wider text-fg-muted font-semibold">
              Status de trabalho
            </div>
            {estados.map((st) => {
              const atual = st === status
              return (
                <DropdownMenu.Item
                  key={st}
                  disabled={update.isPending || atual}
                  class={cn(
                    'flex items-center gap-2.5 h-8 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg',
                    atual && 'bg-surface-3',
                  )}
                  onSelect={() => { if (!atual) update.mutate(st) }}
                  title={WORK_STATUS_HINTS[st]}
                >
                  <span class="size-2.5 rounded-full shrink-0" style={{ background: WORK_STATUS_COLORS[st] }} />
                  <span class="flex-1">{WORK_STATUS_LABELS[st]}</span>
                  {atual && <Check size={ICON_SIZE.sm} class="text-accent" />}
                </DropdownMenu.Item>
              )
            })}
          </div>

          <DropdownMenu.Separator class="h-px bg-border" />

          {/* O tema mora na barra; aqui fica só o tamanho do texto, que não tem
              outro atalho e é ajuste de acessibilidade. A casa dos dois continua
              sendo Configurações › Aparência. */}
          <div class="p-3 space-y-1.5">
            <div class="text-3xs uppercase tracking-wider text-fg-muted font-semibold flex items-center gap-1.5">
              <Type size={ICON_SIZE.xs} /> Tamanho do texto
            </div>
            <div class="flex gap-1 p-0.5 rounded-lg bg-surface-3">
              {tamanhos.map((v) => (
                <button
                  key={v}
                  type="button"
                  class={cn(
                    'flex-1 h-7 rounded-md text-2xs',
                    v === size ? 'bg-surface-2 text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => setSize(v)}
                >
                  {FONT_SIZE_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          <DropdownMenu.Separator class="h-px bg-border" />

          <div class="p-1">
            <DropdownMenu.Item
              class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
              onSelect={onPerfil}
            >
              <UserIcon size={ICON_SIZE.sm} class="text-fg-muted" />
              Meu perfil
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
              onSelect={onPreferencias}
            >
              <SlidersHorizontal size={ICON_SIZE.sm} class="text-fg-muted" />
              Minhas preferências
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
              onSelect={() => { window.location.assign('/app/settings') }}
            >
              <SettingsIcon size={ICON_SIZE.sm} class="text-fg-muted" />
              Configurações
            </DropdownMenu.Item>
          </div>

          <DropdownMenu.Separator class="h-px bg-border" />

          <div class="p-1">
            <DropdownMenu.Item
              class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-danger/10 text-danger outline-none"
              onSelect={onSair}
            >
              <LogOut size={ICON_SIZE.sm} />
              {t('shell.user.logout')}
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
