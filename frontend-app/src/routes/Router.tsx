import { useEffect, Suspense } from 'preact/compat'
import { lazy } from 'preact/compat'
import type { ComponentType } from 'preact'
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter-preact'
import { Compass } from 'lucide-preact'
import { env } from '@/lib/env'
import { flattenItems } from '@/modules/sidebar.config'
import { useRecentsStore } from '@/stores/recents'
import { Skeleton } from '@/components/ui/Skeleton'
import { Page } from '@/components/ui/Page'
import { ModuleGate } from '@/components/auth/ModuleGate'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

const items = flattenItems()

/**
 * Páginas migradas (Fase 3+). Carregadas sob demanda via lazy() para que
 * cada rota baixe seu próprio chunk e o bundle inicial fique pequeno.
 */
const migratedPages: Record<string, ComponentType> = {
  dashboard: lazy(() =>
    import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
  ),
  analytics: lazy(() =>
    import('./pages/DashboardPage').then((m) => ({ default: m.AnalyticsPage })),
  ),
  leads: lazy(() => import('./pages/LeadsPage').then((m) => ({ default: m.LeadsPage }))),
  'leads-duplicates': lazy(() => import('./pages/LeadsDuplicatesPage').then((m) => ({ default: m.LeadsDuplicatesPage }))),
  kanban: lazy(() => import('./pages/KanbanPage').then((m) => ({ default: m.KanbanPage }))),
  funnels: lazy(() =>
    import('./pages/FunnelsPage').then((m) => ({ default: m.FunnelsPage })),
  ),
  activities: lazy(() =>
    import('./pages/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })),
  ),
  tags: lazy(() => import('./pages/TagsPage').then((m) => ({ default: m.TagsPage }))),
  helpdesk: lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskPage }))),
  'helpdesk-sla': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskSlaPage }))),
  'helpdesk-automation': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskAutomationPage }))),
  'helpdesk-kb': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskKbPage }))),
  'helpdesk-csat': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskCsatPage }))),
  'helpdesk-orgs': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskOrgsPage }))),
  'helpdesk-reports': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskReportsPage }))),
  'helpdesk-channels': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskChannelsPage }))),
  'helpdesk-import': lazy(() => import('./pages/HelpdeskPage').then((m) => ({ default: m.HelpdeskImportPage }))),
  forms: lazy(() => import('./pages/FormsPage').then((m) => ({ default: m.FormsPage }))),
  chatbots: lazy(() =>
    import('./pages/ChatbotsPage').then((m) => ({ default: m.ChatbotsPage })),
  ),
  pages: lazy(() => import('./pages/PagesPage').then((m) => ({ default: m.PagesPage }))),
  templates: lazy(() =>
    import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
  ),
  conversations: lazy(() =>
    import('./pages/ConversationsPage').then((m) => ({ default: m.ConversationsPage })),
  ),
  'meta-ads-report': lazy(() => import('./pages/MetaAdsReportPage').then((m) => ({ default: m.MetaAdsReportPage }))),
  'funnel-report': lazy(() => import('./pages/FunnelReportPage').then((m) => ({ default: m.FunnelReportPage }))),
  conversions: lazy(() => import('./pages/ConversionsPage').then((m) => ({ default: m.ConversionsPage }))),
  tracking: lazy(() =>
    import('./pages/TrackingPage').then((m) => ({ default: m.TrackingPage })),
  ),
  links: lazy(() => import('./pages/LinksPage').then((m) => ({ default: m.LinksPage }))),
  intelligence: lazy(() =>
    import('./pages/IntelligencePage').then((m) => ({ default: m.IntelligencePage })),
  ),
  'meta-ads': lazy(() =>
    import('./pages/MetaAdsPage').then((m) => ({ default: m.MetaAdsPage })),
  ),
  'google-ads': lazy(() =>
    import('./pages/GoogleAdsPage').then((m) => ({ default: m.GoogleAdsPage })),
  ),
  'google-ads-report': lazy(() =>
    import('./pages/GoogleAdsReportPage').then((m) => ({ default: m.GoogleAdsReportPage })),
  ),
  utms: lazy(() =>
    import('./pages/UtmsPage').then((m) => ({ default: m.UtmsPage })),
  ),
  'whatsapp-link': lazy(() =>
    import('./pages/WhatsappLinkPage').then((m) => ({ default: m.WhatsappLinkPage })),
  ),
  qr: lazy(() =>
    import('./pages/QrCodePage').then((m) => ({ default: m.QrCodePage })),
  ),
  'url-inspector': lazy(() =>
    import('./pages/UrlInspectorPage').then((m) => ({ default: m.UrlInspectorPage })),
  ),
  personas: lazy(() =>
    import('./pages/PersonasPage').then((m) => ({ default: m.PersonasPage })),
  ),
  'conversation-audit': lazy(() =>
    import('./pages/ConversationAuditPage').then((m) => ({ default: m.ConversationAuditPage })),
  ),
  'ai-journey': lazy(() =>
    import('./pages/AiJourneyPage').then((m) => ({ default: m.AiJourneyPage })),
  ),
  'funnel-conversion': lazy(() =>
    import('./pages/FunnelConversionPage').then((m) => ({ default: m.FunnelConversionPage })),
  ),
  'sales-ai': lazy(() =>
    import('./pages/SalesAiPage').then((m) => ({ default: m.SalesAiPage })),
  ),
  workflows: lazy(() =>
    import('./pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
  ),
  'sales-cadences': lazy(() =>
    import('./pages/SalesCadencesPage').then((m) => ({ default: m.SalesCadencesPage })),
  ),
  today: lazy(() =>
    import('./pages/TodayPage').then((m) => ({ default: m.TodayPage })),
  ),
  jobs: lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage }))),
  'team-performance': lazy(() => import('./pages/TeamPerformancePage').then((m) => ({ default: m.TeamPerformancePage }))),
  whatsapp: lazy(() =>
    import('./pages/WhatsappPage').then((m) => ({ default: m.WhatsappPage })),
  ),
  'cloud-api': lazy(() =>
    import('./pages/CloudApiPage').then((m) => ({ default: m.CloudApiPage })),
  ),
  'whatsapp-templates': lazy(() =>
    import('./pages/WhatsappTemplatesPage').then((m) => ({ default: m.WhatsappTemplatesPage })),
  ),
  'whatsapp-dispatch': lazy(() =>
    import('./pages/WhatsappDispatchPage').then((m) => ({ default: m.WhatsappDispatchPage })),
  ),
  broadcast: lazy(() =>
    import('./pages/BroadcastPage').then((m) => ({ default: m.BroadcastPage })),
  ),
  settings: lazy(() =>
    import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
  ),
  'cad-teams': lazy(() =>
    import('./pages/CadastrosTeamsPage').then((m) => ({ default: m.CadastrosTeamsPage })),
  ),
  'cad-loss-reasons': lazy(() =>
    import('./pages/CadastrosLossReasonsPage').then((m) => ({ default: m.CadastrosLossReasonsPage })),
  ),
  'cad-custom-fields': lazy(() =>
    import('./pages/CadastrosCustomFieldsPage').then((m) => ({ default: m.CadastrosCustomFieldsPage })),
  ),
  'cad-business-hours': lazy(() =>
    import('./pages/CadastrosBusinessHoursPage').then((m) => ({ default: m.CadastrosBusinessHoursPage })),
  ),
  'cad-routing': lazy(() =>
    import('./pages/CadastrosRoutingPage').then((m) => ({ default: m.CadastrosRoutingPage })),
  ),
  'cad-leads-import': lazy(() =>
    import('./pages/LeadsImportPage').then((m) => ({ default: m.LeadsImportPage })),
  ),
  telegram: lazy(() =>
    import('./pages/TelegramPage').then((m) => ({ default: m.TelegramPage })),
  ),
  instagram: lazy(() =>
    import('./pages/InstagramPage').then((m) => ({ default: m.InstagramPage })),
  ),
  integrations: lazy(() =>
    import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
  ),
  voip: lazy(() =>
    import('./pages/VoipPage').then((m) => ({ default: m.VoipPage })),
  ),
  scheduling: lazy(() =>
    import('./pages/SchedulingPage').then((m) => ({ default: m.SchedulingPage })),
  ),
  educational: lazy(() =>
    import('./pages/educational/EducationalDashboardPage').then((m) => ({ default: m.EducationalDashboardPage })),
  ),
  'edu-levels': lazy(() =>
    import('./pages/educational/EducationalLevelsPage').then((m) => ({ default: m.EducationalLevelsPage })),
  ),
  'edu-modalities': lazy(() =>
    import('./pages/educational/EducationalModalitiesPage').then((m) => ({ default: m.EducationalModalitiesPage })),
  ),
  'edu-units': lazy(() =>
    import('./pages/educational/EducationalUnitsPage').then((m) => ({ default: m.EducationalUnitsPage })),
  ),
  'edu-campuses': lazy(() =>
    import('./pages/educational/EducationalCampusesPage').then((m) => ({ default: m.EducationalCampusesPage })),
  ),
  'edu-courses': lazy(() =>
    import('./pages/educational/EducationalCoursesPage').then((m) => ({ default: m.EducationalCoursesPage })),
  ),
  'aca-pessoas': lazy(() =>
    import('./pages/AcademicoPessoasPage').then((m) => ({ default: m.AcademicoPessoasPage })),
  ),
  'aca-assinatura': lazy(() =>
    import('./pages/AcademicoAssinaturaPage').then((m) => ({ default: m.AcademicoAssinaturaPage })),
  ),
  'aca-alunos': lazy(() =>
    import('./pages/AcademicoAlunosPage').then((m) => ({ default: m.AcademicoAlunosPage })),
  ),
  'aca-estrutura': lazy(() =>
    import('./pages/AcademicoEstruturaPage').then((m) => ({ default: m.AcademicoEstruturaPage })),
  ),
  'aca-curriculo': lazy(() =>
    import('./pages/AcademicoCurriculoPage').then((m) => ({ default: m.AcademicoCurriculoPage })),
  ),
  'aca-vestibular': lazy(() =>
    import('./pages/AcademicoVestibularPage').then((m) => ({ default: m.AcademicoVestibularPage })),
  ),
  'aca-avaliacao-inst': lazy(() =>
    import('./pages/AcademicoAvaliacaoInstPage').then((m) => ({ default: m.AcademicoAvaliacaoInstPage })),
  ),
  'aca-matriculas': lazy(() =>
    import('./pages/AcademicoMatriculasPage').then((m) => ({ default: m.AcademicoMatriculasPage })),
  ),
  'aca-movimentacoes': lazy(() =>
    import('./pages/AcademicoMovimentacoesPage').then((m) => ({ default: m.AcademicoMovimentacoesPage })),
  ),
  'aca-diario': lazy(() =>
    import('./pages/AcademicoDiarioPage').then((m) => ({ default: m.AcademicoDiarioPage })),
  ),
  'aca-docente': lazy(() =>
    import('./pages/AcademicoDocentePage').then((m) => ({ default: m.AcademicoDocentePage })),
  ),
  'aca-alocacao': lazy(() =>
    import('./pages/AcademicoAlocacaoPage').then((m) => ({ default: m.AcademicoAlocacaoPage })),
  ),
  'aca-cadastros': lazy(() =>
    import('./pages/AcademicoCadastrosPage').then((m) => ({ default: m.AcademicoCadastrosPage })),
  ),
  'aca-ged': lazy(() =>
    import('./pages/AcademicoGedPage').then((m) => ({ default: m.AcademicoGedPage })),
  ),
  'aca-tcc': lazy(() =>
    import('./pages/AcademicoTccPage').then((m) => ({ default: m.AcademicoTccPage })),
  ),
  'aca-diploma': lazy(() =>
    import('./pages/AcademicoDiplomaPage').then((m) => ({ default: m.AcademicoDiplomaPage })),
  ),
  'aca-acesso': lazy(() =>
    import('./pages/AcademicoAcessoPage').then((m) => ({ default: m.AcademicoAcessoPage })),
  ),
  'aca-ead': lazy(() =>
    import('./pages/AcademicoEadPage').then((m) => ({ default: m.AcademicoEadPage })),
  ),
  'aca-conselho': lazy(() =>
    import('./pages/AcademicoConselhoPage').then((m) => ({ default: m.AcademicoConselhoPage })),
  ),
  'aca-calendario': lazy(() =>
    import('./pages/AcademicoCalendarioPage').then((m) => ({ default: m.AcademicoCalendarioPage })),
  ),
  'aca-secretaria': lazy(() =>
    import('./pages/AcademicoSecretariaPage').then((m) => ({ default: m.AcademicoSecretariaPage })),
  ),
  'aca-portais-plus': lazy(() =>
    import('./pages/AcademicoPortaisPlusPage').then((m) => ({ default: m.AcademicoPortaisPlusPage })),
  ),
  'aca-requerimentos': lazy(() =>
    import('./pages/AcademicoRequerimentosPage').then((m) => ({ default: m.AcademicoRequerimentosPage })),
  ),
  'aca-egressos': lazy(() =>
    import('./pages/AcademicoEgressosPage').then((m) => ({ default: m.AcademicoEgressosPage })),
  ),
  'aca-estagio': lazy(() =>
    import('./pages/AcademicoEstagioPage').then((m) => ({ default: m.AcademicoEstagioPage })),
  ),
  'aca-censo': lazy(() =>
    import('./pages/AcademicoCensoPage').then((m) => ({ default: m.AcademicoCensoPage })),
  ),
  'aca-sistec': lazy(() =>
    import('./pages/AcademicoSistecPage').then((m) => ({ default: m.AcademicoSistecPage })),
  ),
  'aca-comunicacao': lazy(() =>
    import('./pages/AcademicoComunicacaoPage').then((m) => ({ default: m.AcademicoComunicacaoPage })),
  ),
  'aca-bi': lazy(() =>
    import('./pages/AcademicoBiPage').then((m) => ({ default: m.AcademicoBiPage })),
  ),
  'aca-financeiro': lazy(() =>
    import('./pages/AcademicoFinanceiroPage').then((m) => ({ default: m.AcademicoFinanceiroPage })),
  ),
  'aca-fin-banco': lazy(() =>
    import('./pages/AcademicoFinBancoPage').then((m) => ({ default: m.AcademicoFinBancoPage })),
  ),
  'aca-cobranca-fiscal': lazy(() =>
    import('./pages/AcademicoCobrancaFiscalPage').then((m) => ({ default: m.AcademicoCobrancaFiscalPage })),
  ),
  'edu-offerings': lazy(() =>
    import('./pages/educational/EducationalOfferingsPage').then((m) => ({ default: m.EducationalOfferingsPage })),
  ),
  'edu-entry-modes': lazy(() =>
    import('./pages/educational/EducationalEntryModesPage').then((m) => ({ default: m.EducationalEntryModesPage })),
  ),
  'edu-selection-processes': lazy(() =>
    import('./pages/educational/EducationalSelectionProcessesPage').then((m) => ({ default: m.EducationalSelectionProcessesPage })),
  ),
  'edu-doc-review': lazy(() =>
    import('./pages/educational/EducationalDocReviewPage').then((m) => ({ default: m.EducationalDocReviewPage })),
  ),
  'edu-evaluations': lazy(() =>
    import('./pages/educational/EducationalEvaluationsPage').then((m) => ({ default: m.EducationalEvaluationsPage })),
  ),
  'enrollment-portals': lazy(() =>
    import('./pages/EnrollmentPortalsPage').then((m) => ({ default: m.EnrollmentPortalsPage })),
  ),
  users: lazy(() =>
    import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
  ),
  make: lazy(() => import('./pages/MakePage').then((m) => ({ default: m.MakePage }))),
  'module-permissions': lazy(() =>
    import('./pages/ModulePermissionsPage').then((m) => ({ default: m.ModulePermissionsPage })),
  ),
  google: lazy(() =>
    import('./pages/GoogleSuitePage').then((m) => ({ default: m.GoogleSuitePage })),
  ),
  // Integrações — sub-itens com rotas dedicadas (substituem ?tab=X de Configurações)
  'integ-evolution': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationEvolutionPage })),
  ),
  'integ-kommo': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationKommoPage })),
  ),
  'integ-email': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationEmailPage })),
  ),
  'integ-sms': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationSmsPage })),
  ),
  'integ-ai': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationAiPage })),
  ),
  'integ-dns': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationDnsPage })),
  ),
  'integ-webhooks': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationWebhooksPage })),
  ),
  'integ-inbound-webhooks': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationInboundWebhooksPage })),
  ),
  'integ-db-connectors': lazy(() =>
    import('./pages/integrations/DbConnectors').then((m) => ({ default: m.DbConnectorsPage })),
  ),
  'integ-api-keys': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationApiKeysPage })),
  ),
  'integ-payments': lazy(() =>
    import('./pages/integrations/IntegrationStandalonePages').then((m) => ({ default: m.IntegrationPaymentsPage })),
  ),
}

const SelectionProcessDetail = lazy(() =>
  import('./pages/educational/EducationalSelectionProcessDetailPage').then(
    (m) => ({ default: m.EducationalSelectionProcessDetailPage }),
  ),
)

const FunnelDetail = lazy(() =>
  import('./pages/FunnelDetailPage').then((m) => ({ default: m.FunnelDetailPage })),
)

// Editor de formulário em tela dedicada (substitui os modais). Acesse via /app/forms/:id
const FormEditor = lazy(() =>
  import('./pages/FormEditorPage').then((m) => ({ default: m.FormEditorPage })),
)

const EnrollmentPortalDetail = lazy(() =>
  import('./pages/EnrollmentPortalDetailPage').then(
    (m) => ({ default: m.EnrollmentPortalDetailPage }),
  ),
)

const PageEditor = lazy(() =>
  import('./pages/PageEditorPage').then((m) => ({ default: m.PageEditorPage })),
)

const EnrollmentRegistrationDetail = lazy(() =>
  import('./pages/EnrollmentRegistrationDetailPage').then(
    (m) => ({ default: m.EnrollmentRegistrationDetailPage }),
  ),
)

const SalesCadenceDashboard = lazy(() =>
  import('./pages/SalesCadenceDashboardPage').then(
    (m) => ({ default: m.SalesCadenceDashboardPage }),
  ),
)

const LeadDetail = lazy(() =>
  import('./pages/LeadDetailPage').then(
    (m) => ({ default: m.LeadDetailPage }),
  ),
)

// POC do builder visual — rota oculta, não aparece no menu.
// Acesse via /app/workflows/:id/canvas-poc
const WorkflowCanvasPoc = lazy(() =>
  import('./pages/WorkflowCanvasPocPage').then(
    (m) => ({ default: m.WorkflowCanvasPocPage }),
  ),
)

// Builder visual em tela dedicada (substitui o modal "Editar passos").
// Acesse via /app/workflows/:id/builder
const WorkflowBuilder = lazy(() =>
  import('./pages/WorkflowBuilderPage').then(
    (m) => ({ default: m.WorkflowBuilderPage }),
  ),
)

// Builder visual de cadências em tela dedicada.
// Acesse via /app/sales-cadences/:id/builder
const SalesCadenceBuilder = lazy(() =>
  import('./pages/SalesCadenceBuilderPage').then(
    (m) => ({ default: m.SalesCadenceBuilderPage }),
  ),
)

function NotFoundPage() {
  const [, navigate] = useLocation()
  return (
    <Page
      title="Página não encontrada"
      description="A rota acessada não existe. Use Cmd+K para buscar o que precisa."
    >
      <Card class="flex flex-col items-center text-center py-10 gap-4">
        <span class="size-14 rounded-full bg-surface-3 grid place-items-center text-fg-muted">
          <Compass size={28} />
        </span>
        <Button variant="primary" size="md" onClick={() => navigate('/dashboard')}>
          Voltar ao início
        </Button>
      </Card>
    </Page>
  )
}

function IndexRedirect() {
  const [, navigate] = useLocation()
  useEffect(() => {
    navigate('/dashboard', { replace: true })
  }, [navigate])
  return null
}

// Origens foi consolidado dentro de Rastreamento como aba (Fase 28). Mantém
// redirect pra deep-links antigos não quebrarem.
function SourcesRedirect() {
  const [, navigate] = useLocation()
  useEffect(() => {
    navigate('/tracking?tab=origins', { replace: true })
  }, [navigate])
  return null
}

// Planejamento, Instalações, Lixeira e Pagamentos foram movidos pra dentro
// de Configurações como sub-tabs. Mantém redirects pra bookmarks antigos.
function SettingsTabRedirect({ tab }: { tab: string }) {
  const [, navigate] = useLocation()
  useEffect(() => {
    navigate(`/settings?tab=${tab}`, { replace: true })
  }, [navigate, tab])
  return null
}

function RouteTracker() {
  const [location] = useLocation()
  const push = useRecentsStore((s) => s.push)

  useEffect(() => {
    const item = items.find((i) => i.href === `${env.appBasePath}${location}` || i.href === location)
    if (item) push(item.id)
  }, [location, push])

  return null
}

function RouteFallback() {
  return (
    <div class="space-y-3 p-4">
      <Skeleton class="h-8 w-48" />
      <Skeleton class="h-4 w-72" />
      <Skeleton class="h-64 w-full" />
    </div>
  )
}

export function Router() {
  return (
    <WouterRouter base={env.appBasePath}>
      <RouteTracker />
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={IndexRedirect} />
          <Route path="/sources" component={SourcesRedirect} />
          <Route path="/roadmap">{() => <SettingsTabRedirect tab="roadmap" />}</Route>
          <Route path="/installations">{() => <SettingsTabRedirect tab="installations" />}</Route>
          <Route path="/trash">{() => <SettingsTabRedirect tab="trash" />}</Route>
          <Route path="/payments">{() => <SettingsTabRedirect tab="payments" />}</Route>
          <Route path="/educational/selection-processes/:id">
            {(params: { id: string }) => (
              <ModuleGate moduleId="educacional"><SelectionProcessDetail params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/funnels/:id">
            {(params: { id: string }) => (
              <ModuleGate moduleId="funnels"><FunnelDetail params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/forms/:id">
            {(params: { id: string }) => (
              <ModuleGate moduleId="captacao"><FormEditor params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/enrollment-portals/:portalId/registrations/:regId">
            {(params: { portalId: string; regId: string }) => (
              <ModuleGate moduleId="enrollment_portals">
                <EnrollmentRegistrationDetail params={params} />
              </ModuleGate>
            )}
          </Route>
          <Route path="/enrollment-portals/:id">
            {(params: { id: string }) => (
              <ModuleGate moduleId="enrollment_portals"><EnrollmentPortalDetail params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/pages/:id/editor">
            {(params: { id: string }) => (
              <ModuleGate moduleId="captacao"><PageEditor params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/sales-cadences/:id/dashboard">
            {(params: { id: string }) => (
              <ModuleGate moduleId="sales_engagement"><SalesCadenceDashboard params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/sales-cadences/:id/builder">
            {(params: { id: string }) => (
              <ModuleGate moduleId="sales_engagement"><SalesCadenceBuilder params={params} /></ModuleGate>
            )}
          </Route>
          {/* POC do builder visual — DEVE vir antes de /workflows mapeado por flattenItems */}
          <Route path="/workflows/:id/canvas-poc">
            {(params: { id: string }) => (
              <ModuleGate moduleId="workflows"><WorkflowCanvasPoc params={params} /></ModuleGate>
            )}
          </Route>
          {/* Builder visual em tela dedicada — substitui o modal "Editar passos" */}
          <Route path="/workflows/:id/builder">
            {(params: { id: string }) => (
              <ModuleGate moduleId="workflows"><WorkflowBuilder params={params} /></ModuleGate>
            )}
          </Route>
          {/* Importante: /leads/duplicates e /leads/import ANTES de /leads/:id pra não cair no detail */}
          <Route path="/leads/duplicates">
            {() => {
              const Migrated = migratedPages['leads-duplicates']
              if (!Migrated) return null
              return <ModuleGate moduleId="leads"><Migrated /></ModuleGate>
            }}
          </Route>
          <Route path="/leads/import">
            {() => {
              const Migrated = migratedPages['cad-leads-import']
              if (!Migrated) return null
              // Importação é admin-only; gated por 'settings' como no sidebar.
              return <ModuleGate moduleId="settings"><Migrated /></ModuleGate>
            }}
          </Route>
          <Route path="/leads/:id/:section">
            {(params: { id: string; section: string }) => (
              <ModuleGate moduleId="leads"><LeadDetail params={params} /></ModuleGate>
            )}
          </Route>
          <Route path="/leads/:id">
            {(params: { id: string }) => (
              <ModuleGate moduleId="leads"><LeadDetail params={params} /></ModuleGate>
            )}
          </Route>
          {items.map((item) => {
            const Migrated = migratedPages[item.id]
            if (!Migrated) return null
            const path = item.href.replace(env.appBasePath, '')
            // Fase 2.2 da blindagem: TODA rota catalogada com `permission` passa
            // por ModuleGate. AGENT/VIEWER que digitar URL direta vê tela
            // amigável "Módulo não disponível" / "Acesso restrito" em vez de
            // erro genérico de fetch. SUPERADMIN sempre passa.
            const RouteEl = item.permission
              ? () => <ModuleGate moduleId={item.permission!}><Migrated /></ModuleGate>
              : () => <Migrated />
            return <Route key={item.id} path={path} component={RouteEl} />
          })}
          {/* Fallback p/ paths de auth — durante o tick em que o AuthGate
              está redirecionando, o WouterRouter ainda pode estar montado
              com location='/login'. Renderiza nada em vez de NotFoundPage. */}
          <Route path="/login">{() => null}</Route>
          <Route path="/forgot-password">{() => null}</Route>
          <Route path="/reset-password">{() => null}</Route>
          <Route component={NotFoundPage} />
        </Switch>
      </Suspense>
    </WouterRouter>
  )
}
