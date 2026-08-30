import { useState, useEffect, useMemo } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { useLocation } from 'wouter-preact'
import { usePrimaryInstall } from '@/hooks/usePrimaryInstall'
import {
  Palette, Shield, Package, Home,
  Mail, Copy,
  Map, Server, Trash2, Sparkles, HelpCircle, Scale, Building2,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { cn } from '@/lib/cn'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { HomeScreenSettings } from './settings/HomeScreenSettings'
import { SecuritySettings } from './settings/SecuritySettings'
import { WebhooksSettings } from './settings/WebhooksSettings'
import { ApiKeysSettings } from './settings/ApiKeysSettings'
import { ModulesSettings } from './settings/ModulesSettings'
import { EmailSettings } from './settings/EmailSettings'
import { SmsSettings } from './settings/SmsSettings'
import { AiSettings } from './settings/AiSettings'
import { DnsSettings } from './settings/DnsSettings'
import { GoogleAccountSettings } from './settings/GoogleAccountSettings'
import { DedupSettings } from './settings/DedupSettings'
import { IntegrationsSettings } from './settings/IntegrationsSettings'
import { EvolutionApiSettings } from './settings/EvolutionApiSettings'
import { SystemEmailsSettings } from './settings/SystemEmailsSettings'
import { IntelligenceSettings } from './settings/IntelligenceSettings'
import { LegalSettings } from './settings/LegalSettings'
import { CompanySettings } from './settings/CompanySettings'
import { TrashPage } from './TrashPage'
import { PaymentsPage } from './PaymentsPage'

// Instalações e Planejamento existem SÓ na instalação principal (bychat-beyond).
// `VITE_PRIMARY_INSTALL=1` vive apenas no frontend-app/.env do beyond — nos
// tenants a constante vira `false` literal em build-time e o Rollup elimina os
// `import()` abaixo como código morto: os chunks nem chegam a ser gerados.
//
// Isso importa porque o gate de runtime (`isPrimary`) é só visual — os assets
// de /app/assets/* são públicos, então com import estático o roadmap interno da
// Beyond ficava baixável sem login no subdomínio de cada cliente.
const PRIMARY_BUILD = import.meta.env.VITE_PRIMARY_INSTALL === '1'

const RoadmapPage = PRIMARY_BUILD
  ? lazy(() => import('./RoadmapPage').then((m) => ({ default: m.RoadmapPage })))
  : null
const InstallationsPage = PRIMARY_BUILD
  ? lazy(() => import('./InstallationsPage').then((m) => ({ default: m.InstallationsPage })))
  : null

export type Tab =
  | 'appearance' | 'home-screen' | 'fields' | 'teams' | 'security'
  | 'webhooks' | 'api-keys' | 'modules'
  | 'email' | 'sms' | 'ai' | 'dns' | 'business-hours' | 'my-google' | 'loss-reasons' | 'dedup' | 'integrations' | 'evolution'
  | 'roadmap' | 'installations' | 'trash' | 'payments' | 'system-emails' | 'intelligence' | 'legal' | 'company'

// Tabs visíveis no menu lateral de Configurações.
// Itens de integração (email, sms, ai, dns, webhooks, api-keys, payments,
// evolution, my-google, integrations) foram movidos pro grupo "Integrações"
// no menu principal — continuam acessíveis por deep-link `?tab=X` aqui.
//
// `primaryOnly: true` esconde a aba nas instalações filhas (subdomínios
// tipo terram, vantari) e só renderiza no tenant principal (bychat.ia.br).
// Detecção via usePrimaryInstall() → backend isPrimaryInstall() →
// MARKETING_HOST setado no .env.
const tabs: { id: Tab; label: string; icon: preact.JSX.Element; primaryOnly?: boolean }[] = [
  { id: 'appearance', label: 'Aparência', icon: <Palette size={14} /> },
  { id: 'home-screen', label: 'Tela inicial', icon: <Home size={14} /> },
  { id: 'company', label: 'Empresa', icon: <Building2 size={14} /> },
  { id: 'security', label: 'Segurança', icon: <Shield size={14} /> },
  { id: 'modules', label: 'Módulos', icon: <Package size={14} /> },
  { id: 'dedup', label: 'Duplicação', icon: <Copy size={14} /> },
  { id: 'intelligence', label: 'Inteligência', icon: <Sparkles size={14} /> },
  { id: 'system-emails', label: 'Emails do Sistema', icon: <Mail size={14} /> },
  { id: 'legal', label: 'LGPD / Legal', icon: <Scale size={14} /> },
  { id: 'installations', label: 'Instalações', icon: <Server size={14} />, primaryOnly: true },
  { id: 'trash', label: 'Lixeira', icon: <Trash2 size={14} /> },
  { id: 'roadmap', label: 'Planejamento', icon: <Map size={14} />, primaryOnly: true },
]

// Abas migradas para /app/cadastros/* — preserva bookmarks com ?tab=X
const MIGRATED_TAB_REDIRECTS: Record<string, string> = {
  teams: '/cadastros/teams',
  'loss-reasons': '/cadastros/loss-reasons',
  fields: '/cadastros/custom-fields',
  'business-hours': '/cadastros/business-hours',
}

// Lê ?tab=X da URL pra deep-link (ex.: banner do GoogleAdsPage manda direto pra integrations)
function readTabFromUrl(): Tab {
  if (typeof window === 'undefined') return 'appearance'
  const v = new URLSearchParams(window.location.search).get('tab')
  const valid: Tab[] = ['appearance', 'fields', 'teams', 'security', 'webhooks', 'api-keys', 'modules', 'email', 'sms', 'ai', 'dns', 'business-hours', 'my-google', 'loss-reasons', 'dedup', 'integrations', 'evolution', 'roadmap', 'installations', 'trash', 'payments', 'system-emails', 'intelligence', 'legal']
  return (valid as string[]).includes(v ?? '') ? (v as Tab) : 'appearance'
}

export function SettingsPage() {
  const [, navigate] = useLocation()
  const [tab, setTab] = useState<Tab>(readTabFromUrl())
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const { isPrimary, isLoading: primaryLoading } = usePrimaryInstall()

  // Abas exclusivas do tenant principal (bychat-beyond). Em filhas (terram,
  // vantari, novos clientes) somem do menu E não renderizam o conteúdo
  // mesmo se a URL pedir (defesa em profundidade).
  const PRIMARY_ONLY_TABS = new Set<Tab>(['installations', 'roadmap'])
  const visibleTabs = useMemo(
    () => tabs.filter((t) => !t.primaryOnly || (PRIMARY_BUILD && isPrimary)),
    [isPrimary],
  )

  // Se URL pedir aba primary-only numa instalação filha, redireciona pra Aparência.
  useEffect(() => {
    if (primaryLoading) return
    if ((!isPrimary || !PRIMARY_BUILD) && PRIMARY_ONLY_TABS.has(tab)) setTab('appearance')
  }, [primaryLoading, isPrimary, tab])

  // Bookmarks antigos: ?tab=teams|loss-reasons|fields|business-hours → /cadastros/*
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = new URLSearchParams(window.location.search).get('tab')
    if (v && MIGRATED_TAB_REDIRECTS[v]) {
      navigate(MIGRATED_TAB_REDIRECTS[v], { replace: true })
    }
  }, [navigate])

  // Reage a mudança de URL (back/forward) e atualiza ao trocar tab
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (tab === 'appearance') params.delete('tab')
    else params.set('tab', tab)
    const qs = params.toString()
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState({}, '', newUrl)
    }
  }, [tab])

  return (
    <Page
      title="Configurações"
      description="Ajustes do sistema, branding, equipes, segurança e integrações."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex gap-4 flex-col lg:flex-row">
        <aside class="lg:w-56 shrink-0">
          <nav class="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                class={cn(
                  'inline-flex items-center gap-2 px-3 h-9 rounded-md text-sm font-medium transition-colors text-left whitespace-nowrap',
                  tab === t.id
                    ? 'bg-accent text-fg-on-brand'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </aside>
        <div class="flex-1 min-w-0">
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'home-screen' && <HomeScreenSettings />}
          {tab === 'email' && <EmailSettings onGoToTab={setTab} />}
          {tab === 'sms' && <SmsSettings />}
          {tab === 'ai' && <AiSettings />}
          {tab === 'dns' && <DnsSettings />}
          {tab === 'security' && <SecuritySettings />}
          {tab === 'webhooks' && <WebhooksSettings />}
          {tab === 'api-keys' && <ApiKeysSettings />}
          {tab === 'modules' && <ModulesSettings />}
          {tab === 'my-google' && <GoogleAccountSettings />}
          {tab === 'dedup' && <DedupSettings />}
          {tab === 'integrations' && <IntegrationsSettings />}
          {tab === 'evolution' && <EvolutionApiSettings />}
          {tab === 'system-emails' && <SystemEmailsSettings />}
          {tab === 'intelligence' && <IntelligenceSettings />}
          {tab === 'legal' && <LegalSettings />}
          {tab === 'company' && <CompanySettings />}
          {tab === 'roadmap' && isPrimary && RoadmapPage && (
            <Suspense fallback={null}><RoadmapPage /></Suspense>
          )}
          {tab === 'installations' && isPrimary && InstallationsPage && (
            <Suspense fallback={null}><InstallationsPage /></Suspense>
          )}
          {tab === 'trash' && <TrashPage />}
          {tab === 'payments' && <PaymentsPage />}
        </div>
      </div>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Configurações?"
        problem={<>
          É o "painel de controle" do sistema. Tudo que <strong>não cabe no dia a dia</strong> mas
          influencia em como tudo funciona vive aqui: aparência, equipes, segurança, e-mails,
          janelas comerciais, prompts de IA, dedup, módulos, lixeira, integrações técnicas.
        </>}
        steps={[
          {
            title: '🎨 Aparência',
            body: <>Logo, cor primária, fonte, modo claro/escuro. Vale pra toda a interface do <strong>seu</strong> sistema (não dos clientes). Tamanho de fonte (Confortável/Grande/Maior) também tá aqui.</>,
          },
          {
            title: '👥 Equipes + Segurança',
            body: <>Crie equipes (Vendas SP, Pós-venda…). Em Segurança: políticas de senha, 2FA, bloqueio de IPs, whitelist, sessões. Painel de auditoria de ações sensíveis.</>,
          },
          {
            title: '✉️ E-mail / SMS / IA',
            body: <>Configure SMTP do e-mail transacional, conta SMS, chaves Anthropic/OpenAI. Sem essas configurações, o sistema funciona mas com recursos limitados (sem IA, sem e-mail de notificação, etc.).</>,
          },
          {
            title: '🕐 Horários, Objeções, Dedup',
            body: <>Horário comercial (define janelas de envio das cadências), motivos de perda padronizados (lista pra usar quando marca lead como Perdido), regra de dedup (como detectar duplicado).</>,
          },
          {
            title: '🗑️ Lixeira + Módulos',
            body: <>Itens excluídos vão pra <strong>Lixeira</strong> — dá pra restaurar. <strong>Módulos</strong>: liga/desliga features inteiras do sistema (Educacional, Pagamentos, etc.) — útil pra simplificar interface pra times que não usam tudo.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Alteração com cuidado',
          body: <>Algumas configurações afetam o sistema inteiro (políticas de senha, dedup, módulos). Mude em horário de baixo movimento e <strong>avise a equipe</strong>. Mudança em horário comercial faz cadências pausarem ou disparar fora de hora.</>,
        }}
      />
    </Page>
  )
}
