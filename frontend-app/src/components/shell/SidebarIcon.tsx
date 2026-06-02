import {
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  Users,
  KanbanSquare,
  GitFork,
  ListChecks,
  Tag,
  FormInput,
  Bot,
  Globe,
  Megaphone,
  Search,
  FileText,
  Link2,
  Compass,
  Activity,
  TrendingUp,
  BarChart3,
  LineChart,
  FileSpreadsheet,
  Workflow,
  Phone,
  Cloud,
  Send,
  Plug,
  Boxes,
  Settings,
  GanttChart,
  GraduationCap,
  Layers,
  Building2,
  MapPin,
  BookOpen,
  CalendarRange,
  FileCheck2,
  ClipboardList,
  School,
  Award,
  CreditCard,
  ShieldCheck,
  Trash2,
  Server,
  Map,
  Sun,
  Mail,
  Brain,
  Webhook,
  Key,
  Wrench,
  Copy,
  Clock,
  XCircle,
  Database,
  Upload,
} from 'lucide-preact'
import type { JSX as JSXNs } from 'preact'

/** Ícone do Instagram não existe no lucide-preact (logo de marca). Inline. */
function Instagram(props: { size?: number; class?: string }): JSXNs.Element {
  const { size = 24, class: className } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}
import type { IconName } from '@/modules/sidebar.config'
import { cn } from '@/lib/cn'

// Mapa explícito (não `import * as`) é o que permite o tree shaking
// deixar de fora os ~1700 ícones não usados.
const ICONS: Record<IconName, unknown> = {
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  Users,
  KanbanSquare,
  GitFork,
  ListChecks,
  Tag,
  FormInput,
  Bot,
  Globe,
  Megaphone,
  Search,
  FileText,
  Link2,
  Compass,
  Activity,
  TrendingUp,
  BarChart3,
  LineChart,
  FileSpreadsheet,
  Workflow,
  Phone,
  Cloud,
  Send,
  Instagram,
  Plug,
  Boxes,
  Settings,
  GanttChart,
  GraduationCap,
  Layers,
  Building2,
  MapPin,
  BookOpen,
  CalendarRange,
  FileCheck2,
  ClipboardList,
  School,
  Award,
  CreditCard,
  ShieldCheck,
  Trash2,
  Server,
  Map,
  Sun,
  Mail,
  Brain,
  Webhook,
  Key,
  Wrench,
  Copy,
  Clock,
  XCircle,
  Database,
  Upload,
}

interface SidebarIconProps {
  name: IconName
  size?: number
  class?: string
}

type IconRenderer = (props: { size?: number; class?: string }) => preact.JSX.Element

export function SidebarIcon({ name, size = 18, class: className }: SidebarIconProps) {
  const Icon = ICONS[name] as IconRenderer | undefined

  if (!Icon) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={cn('shrink-0', className)}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  }

  return <Icon size={size} class={cn('shrink-0', className)} />
}
