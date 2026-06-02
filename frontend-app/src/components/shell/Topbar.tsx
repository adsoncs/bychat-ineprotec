import { Menu, Search, LogOut, User as UserIcon, Sun, Moon, Monitor, Type, ChevronDown, Shield, Settings as SettingsIcon, Eye, BarChart3, Copy, Headphones } from 'lucide-preact'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/stores/sidebar'
import { useThemeStore, type Theme } from '@/stores/theme'
import { useFontSizeStore, FONT_SIZE_LABELS, type FontSize } from '@/stores/fontSize'
import { useLocaleStore, useT, type Locale } from '@/i18n'
import { useAuth, useUpdateWorkStatus } from '@/hooks/useAuth'
import { ROLE_LABELS, type UserRole } from '@/hooks/useUsers'
import type { WorkStatus } from '@/stores/user'
import { useDuplicatesCount } from '@/hooks/useLeads'
import { ProfileModal } from './ProfileModal'
import { TransferInbox } from '@/components/routing/TransferInbox'
import { cn } from '@/lib/cn'

// Palette para avatar — gradients suaves derivados do nome (determinístico)
const AVATAR_PALETTE: [string, string][] = [
  ['#1a73e8', '#4285f4'],  // azul
  ['#7c4dff', '#b388ff'],  // roxo
  ['#00897b', '#26a69a'],  // teal
  ['#e91e63', '#f06292'],  // rosa
  ['#ff7043', '#ffab91'],  // coral
  ['#43a047', '#66bb6a'],  // verde
  ['#3949ab', '#5c6bc0'],  // indigo
  ['#fb8c00', '#ffa726'],  // âmbar
  ['#5e35b1', '#7e57c2'],  // violeta
  ['#0097a7', '#26c6da'],  // ciano
]

function getAvatarStyle(seed: string): { background: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const [from, to] = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!
  return { background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }
}

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || '').trim()
  if (!src) return '?'
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  return src.substring(0, 2).toUpperCase()
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `há ${hr}h`
  const d = Math.floor(hr / 24)
  if (d < 30) return `há ${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`
  const y = Math.floor(mo / 12)
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`
}

const ROLE_ICONS: Record<UserRole, typeof Shield> = {
  SUPERADMIN: Shield,
  ADMIN: Shield,
  MANAGER: BarChart3,
  AGENT: Headphones,
  VIEWER: Eye,
}

// Badge de role com estilo nobre — substitui o `danger` (vermelho) que dava
// destaque negativo. SUPERADMIN/ADMIN usam accent (azul de marca);
// MANAGER usa info; VIEWER usa neutral.
function RoleBadge({ role, size = 'sm' }: { role: UserRole; size?: 'xs' | 'sm' }) {
  const Icon = ROLE_ICONS[role]
  const isElevated = role === 'SUPERADMIN' || role === 'ADMIN'
  const tone = isElevated
    ? 'bg-accent/15 text-accent ring-accent/30'
    : role === 'MANAGER'
      ? 'bg-info/15 text-info ring-info/30'
      : 'bg-surface-3 text-fg-muted ring-border'
  const padding = size === 'xs' ? 'h-5 px-1.5 text-[0.625rem] gap-1' : 'h-6 px-2 text-[0.6875rem] gap-1.5'
  return (
    <span class={cn('inline-flex items-center rounded-full font-medium ring-1', tone, padding)}>
      <Icon size={size === 'xs' ? 10 : 12} />
      {ROLE_LABELS[role]}
    </span>
  )
}

interface TopbarProps {
  onOpenCommandPalette: () => void
}

export function Topbar({ onOpenCommandPalette }: TopbarProps) {
  const layout = useShellLayout()
  const openDrawer = useSidebarStore((s) => s.openDrawer)
  const { user, logout } = useAuth()
  const t = useT()
  const isMobile = layout === 'mobile'
  const role = (user?.role as UserRole | undefined) ?? undefined
  const displayName = user?.name?.trim() || user?.email || '—'
  const initials = getInitials(user?.name, user?.email)
  const avatarSeed = user?.email || user?.name || String(user?.id ?? 'x')
  const avatarStyle = getAvatarStyle(avatarSeed)
  const lastLoginRel = formatRelativeTime(user?.lastLoginAt)
  const memberSinceRel = formatRelativeTime(user?.createdAt)
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <header class="app-topbar">
      {isMobile && (
        <button
          type="button"
          class="size-9 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          onClick={openDrawer}
          aria-label={t('shell.menu.open')}
        >
          <Menu size={18} />
        </button>
      )}

      {isMobile ? (
        // No mobile o campo expandido com flex-1 + placeholder longo competia com
        // os ícones de ação e estourava o topbar. Vira só um ícone (abre o mesmo
        // command palette), alinhado à esquerda; o grupo de ações fica no ml-auto.
        <button
          type="button"
          onClick={onOpenCommandPalette}
          class="size-9 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          aria-label={t('shell.search.aria')}
        >
          <Search size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenCommandPalette}
          class={cn(
            'flex flex-1 min-w-0 items-center gap-2 h-9 px-3 rounded-md text-sm',
            'bg-surface text-fg-muted border border-border hover:bg-surface-inset',
            'max-w-md',
          )}
          aria-label={t('shell.search.aria')}
        >
          <Search size={16} class="shrink-0" />
          <span class="flex-1 text-left truncate">{t('shell.search.placeholder')}</span>
          <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 h-5 rounded border border-border text-[0.6875rem] text-fg-subtle font-mono shrink-0">
            <span>⌘</span>K
          </kbd>
        </button>
      )}

      <div class="ml-auto flex items-center gap-2">
        <TransferInbox />
        <DuplicatesBadge />
        <WorkStatusMenu />
        <FontSizeMenu />
        <LocaleMenu />
        <ThemeMenu />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              class="flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-full hover:bg-surface-3 transition-colors"
              aria-label={t('shell.user.menu')}
            >
              <span
                class="size-7 rounded-full grid place-items-center text-[0.6875rem] font-semibold text-white shadow-sm ring-1 ring-white/10"
                style={avatarStyle}
              >
                {initials}
              </span>
              <span class="hidden sm:inline text-xs font-semibold text-fg truncate max-w-[10rem]">
                {displayName}
              </span>
              <ChevronDown size={14} class="text-fg-subtle hidden sm:inline" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              class="min-w-[18rem] rounded-lg bg-surface-2 border border-border shadow-xl p-0 overflow-hidden"
              style={{ zIndex: 'var(--z-popover)' }}
            >
              {/* Header card com avatar grande */}
              <div class="flex items-start gap-3 p-3 bg-gradient-to-br from-surface-3/40 to-transparent">
                <span
                  class="size-12 rounded-full grid place-items-center text-base font-semibold text-white shadow-md ring-2 ring-white/10 shrink-0"
                  style={avatarStyle}
                >
                  {initials}
                </span>
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="text-sm font-semibold text-fg truncate">{displayName}</div>
                  <div class="text-[0.6875rem] text-fg-subtle truncate">{user?.email ?? ''}</div>
                  {role && <div class="pt-0.5"><RoleBadge role={role} size="xs" /></div>}
                </div>
              </div>

              {/* Metadata sutil */}
              {(lastLoginRel || memberSinceRel) && (
                <>
                  <DropdownMenu.Separator class="h-px bg-border" />
                  <div class="px-3 py-2 space-y-0.5 text-[0.6875rem] text-fg-subtle">
                    {lastLoginRel && (
                      <div class="flex items-center justify-between">
                        <span>Último acesso</span>
                        <span class="text-fg-muted">{lastLoginRel}</span>
                      </div>
                    )}
                    {memberSinceRel && (
                      <div class="flex items-center justify-between">
                        <span>Membro desde</span>
                        <span class="text-fg-muted">{memberSinceRel}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              <DropdownMenu.Separator class="h-px bg-border" />

              <div class="p-1">
                <DropdownMenu.Item
                  class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
                  onSelect={() => setProfileOpen(true)}
                >
                  <UserIcon size={14} class="text-fg-muted" />
                  Meu perfil
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
                  onSelect={() => { window.location.assign('/app/settings') }}
                >
                  <SettingsIcon size={14} class="text-fg-muted" />
                  Configurações
                </DropdownMenu.Item>
              </div>

              <DropdownMenu.Separator class="h-px bg-border" />

              <div class="p-1">
                <DropdownMenu.Item
                  class="flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer hover:bg-danger/10 text-danger outline-none"
                  onSelect={logout}
                >
                  <LogOut size={14} />
                  {t('shell.user.logout')}
                </DropdownMenu.Item>
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <ProfileModal open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  )
}

// Fase 24: Badge de "Leads duplicados pendentes" no topbar.
// Mostra contador discreto; clicar leva pra /app/leads/duplicates.
// Refetcha a cada 60s (igual cron do server-side).
function DuplicatesBadge() {
  const { data } = useDuplicatesCount()
  const [, navigate] = useLocation()
  const count = data?.count ?? 0
  if (count === 0) return null
  const display = count > 99 ? '99+' : String(count)
  return (
    <button
      type="button"
      class="relative size-9 grid place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
      onClick={() => navigate('/app/leads/duplicates')}
      aria-label={`${count} lead(s) duplicado(s) pendente(s) de revisão`}
      title={`${count} duplicado(s) pendente(s) — clique pra revisar`}
    >
      <Copy size={16} />
      <span class="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full bg-warning text-[0.625rem] font-bold text-white shadow-sm ring-2 ring-surface">
        {display}
      </span>
    </button>
  )
}

// Menu de status de trabalho do operador. Disponível/Ausente/Em pausa/Offline.
// Renderiza um dot colorido no botão e troca via PUT /admin/me/work-status.
const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  available: 'Disponível',
  away: 'Ausente',
  busy: 'Em pausa',
  offline: 'Offline',
}
const WORK_STATUS_COLORS: Record<WorkStatus, string> = {
  available: '#22c55e', // verde
  away: '#f59e0b',      // âmbar
  busy: '#dc2626',      // vermelho
  offline: '#9ca3af',   // cinza
}
const WORK_STATUS_HINTS: Record<WorkStatus, string> = {
  available: 'Você recebe leads novos automaticamente',
  away: 'Você não recebe novos leads (rotação pula você)',
  busy: 'Em atendimento focado — não recebe novos',
  offline: 'Você não está trabalhando agora',
}

function WorkStatusMenu() {
  const { user } = useAuth()
  const update = useUpdateWorkStatus()
  const status: WorkStatus = (user?.workStatus as WorkStatus | undefined) ?? 'offline'
  const items: WorkStatus[] = ['available', 'away', 'busy', 'offline']
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="flex items-center gap-1.5 h-9 px-2 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          aria-label={`Status: ${WORK_STATUS_LABELS[status]}`}
          title={`Status: ${WORK_STATUS_LABELS[status]} — ${WORK_STATUS_HINTS[status]}`}
        >
          <span
            class="size-2.5 rounded-full ring-2 ring-surface"
            style={{ background: WORK_STATUS_COLORS[status] }}
          />
          <span class="hidden md:inline text-[0.6875rem] font-medium">
            {WORK_STATUS_LABELS[status]}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[14rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <div class="px-2 py-1.5 text-[0.625rem] uppercase tracking-wider text-fg-subtle font-semibold">
            Status de trabalho
          </div>
          {items.map((s) => {
            const isCurrent = s === status
            return (
              <DropdownMenu.Item
                key={s}
                disabled={update.isPending || isCurrent}
                class={cn(
                  'flex items-start gap-2 px-2 py-1.5 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none',
                  isCurrent && 'bg-surface-3',
                )}
                onSelect={() => { if (!isCurrent) update.mutate(s) }}
              >
                <span
                  class="size-2.5 rounded-full mt-1.5 shrink-0"
                  style={{ background: WORK_STATUS_COLORS[s] }}
                />
                <span class="flex-1 min-w-0">
                  <span class="block text-fg font-medium">{WORK_STATUS_LABELS[s]}</span>
                  <span class="block text-[0.6875rem] text-fg-subtle leading-tight">{WORK_STATUS_HINTS[s]}</span>
                </span>
                {isCurrent && <span class="text-accent text-xs mt-1">●</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function FontSizeMenu() {
  const size = useFontSizeStore((s) => s.size)
  const setSize = useFontSizeStore((s) => s.setSize)
  const items: { value: FontSize; label: string }[] = [
    { value: 'comfortable', label: FONT_SIZE_LABELS.comfortable },
    { value: 'large', label: FONT_SIZE_LABELS.large },
    { value: 'larger', label: FONT_SIZE_LABELS.larger },
  ]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-9 grid place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          aria-label="Tamanho da fonte"
          title="Tamanho da fonte"
        >
          <Type size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[10rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {items.map((it) => {
            const isCurrent = it.value === size
            return (
              <DropdownMenu.Item
                key={it.value}
                class={cn(
                  'flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none',
                  isCurrent && 'text-fg font-medium',
                )}
                onSelect={() => setSize(it.value)}
              >
                <span class="flex-1">{it.label}</span>
                {isCurrent && <span class="text-accent">●</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function LocaleMenu() {
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useLocaleStore((s) => s.setLocale)
  const t = useT()
  const items: { value: Locale; label: string; flag: string }[] = [
    { value: 'pt', label: t('locale.pt'), flag: '🇧🇷' },
    { value: 'en', label: t('locale.en'), flag: '🇬🇧' },
    { value: 'es', label: t('locale.es'), flag: '🇪🇸' },
  ]
  const current = items.find((i) => i.value === locale) ?? items[0]!
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="h-9 px-2 rounded-md text-xs font-medium text-fg-muted hover:bg-surface-3 hover:text-fg flex items-center gap-1"
          aria-label={t('locale.label')}
          title={t('locale.label')}
        >
          <span aria-hidden="true">{current.flag}</span>
          <span class="hidden sm:inline uppercase">{locale}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[10rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {items.map((it) => {
            const isCurrent = it.value === locale
            return (
              <DropdownMenu.Item
                key={it.value}
                class={cn(
                  'flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none',
                  isCurrent && 'text-fg font-medium',
                )}
                onSelect={() => setLocale(it.value)}
              >
                <span aria-hidden="true">{it.flag}</span>
                <span class="flex-1">{it.label}</span>
                {isCurrent && <span class="text-accent">●</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ThemeMenu() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const t = useT()
  const Icon = theme === 'light' ? Sun : theme === 'system' ? Monitor : Moon
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
          class="size-9 grid place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          aria-label={t('shell.theme.label')}
          title={t('shell.theme.label')}
        >
          <Icon size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="min-w-[10rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {items.map((it) => {
            const Active = it.icon
            const isCurrent = it.value === theme
            return (
              <DropdownMenu.Item
                key={it.value}
                class={cn(
                  'flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none',
                  isCurrent && 'text-fg font-medium',
                )}
                onSelect={() => setTheme(it.value)}
              >
                <Active size={14} />
                <span class="flex-1">{it.label}</span>
                {isCurrent && <span class="text-accent">●</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
