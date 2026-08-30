// ModuleGate: wrapper de proteção pra rotas/páginas que dependem de um módulo.
//
// Antes de renderizar `children`, checa se o user atual:
//   1. Tem permissão (canView etc.) no `moduleId` → senão renderiza "Acesso negado"
//   2. O `moduleId` está ATIVO no tenant → senão renderiza "Módulo não disponível"
//
// Use envolvendo as páginas no Router (não dentro dos componentes — assim a UI
// nunca tenta nem disparar fetches contra endpoints que vão dar 403/404):
//
//   <Route path="/enrollment-portals">
//     {() => <ModuleGate moduleId="enrollment_portals"><EnrollmentPortalsPage/></ModuleGate>}
//   </Route>

import type { ComponentChildren } from 'preact'
import { useLocation } from 'wouter-preact'
import { Lock, Package, Loader2, Home } from '@/components/ui/icon-set'
import { useModuleAccess, type PermAction } from '@/hooks/usePermissions'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'

interface ModuleGateProps {
  moduleId: string
  action?: PermAction
  /** Título customizado pra Page wrapper quando bloqueia (default: "Acesso restrito") */
  fallbackTitle?: string
  children: ComponentChildren
}

export function ModuleGate({ moduleId, action = 'view', fallbackTitle, children }: ModuleGateProps) {
  const access = useModuleAccess(moduleId, action)

  if (access.status === 'allowed') return <>{children}</>

  if (access.status === 'loading') {
    return (
      <Page title={fallbackTitle ?? 'Carregando…'}>
        <div class="flex items-center justify-center py-20 text-fg-muted">
          <Loader2 size={20} class="animate-spin" />
        </div>
      </Page>
    )
  }

  if (access.status === 'inactive') {
    return <ModuleInactiveScreen moduleId={moduleId} />
  }

  return <ModuleDeniedScreen moduleId={moduleId} action={action} />
}

function ModuleInactiveScreen({ moduleId }: { moduleId: string }) {
  const [, navigate] = useLocation()
  return (
    <Page title="Módulo não disponível">
      <div class="mx-auto max-w-md flex flex-col items-center text-center gap-3 py-16">
        <div class="size-14 rounded-full bg-warning/10 text-warning grid place-items-center">
          <Package size={24} />
        </div>
        <h2 class="text-base font-semibold text-fg">Este módulo não está ativo nesta instalação</h2>
        <p class="text-sm text-fg-muted">
          O recurso <span class="font-mono text-fg">{moduleId}</span> está desativado neste tenant.
          Solicite ao administrador para ativá-lo se você precisa acessar.
        </p>
        <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
          <Home size={14} /> Voltar ao Dashboard
        </Button>
      </div>
    </Page>
  )
}

function ModuleDeniedScreen({ moduleId, action }: { moduleId: string; action: PermAction }) {
  const [, navigate] = useLocation()
  return (
    <Page title="Acesso restrito">
      <div class="mx-auto max-w-md flex flex-col items-center text-center gap-3 py-16">
        <div class="size-14 rounded-full bg-danger/10 text-danger grid place-items-center">
          <Lock size={24} />
        </div>
        <h2 class="text-base font-semibold text-fg">Você não tem permissão para esta página</h2>
        <p class="text-sm text-fg-muted">
          Seu perfil não tem autorização para {action === 'view' ? 'visualizar' : action} o módulo{' '}
          <span class="font-mono text-fg">{moduleId}</span>. Se precisa de acesso, peça ao administrador.
        </p>
        <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
          <Home size={14} /> Voltar ao Dashboard
        </Button>
      </div>
    </Page>
  )
}

/**
 * Restringe a tela a SUPERADMIN. Existe ao lado do ModuleGate porque algumas
 * telas não pertencem a um módulo — são configurações que mudam o significado do
 * dado para todos os usuários (ex.: o que a instalação chama de MQL no Relatório
 * de Funil). O backend também barra; isto evita que a UI tente o fetch e mostre
 * erro genérico de 403.
 */
export function SuperadminOnly({ children }: { children: ComponentChildren }) {
  const { user } = useAuth()
  const [, navigate] = useLocation()

  // Enquanto o usuário não carregou, não decide — negar aqui faria a tela
  // piscar "acesso restrito" a cada refresh para o próprio superadmin.
  if (!user) {
    return (
      <Page title="Carregando…">
        <div class="flex items-center justify-center py-20 text-fg-muted">
          <Loader2 size={20} class="animate-spin" />
        </div>
      </Page>
    )
  }

  if (user.role === 'SUPERADMIN') return <>{children}</>

  return (
    <Page title="Acesso restrito">
      <div class="mx-auto max-w-md flex flex-col items-center text-center gap-3 py-16">
        <div class="size-14 rounded-full bg-danger/10 text-danger grid place-items-center">
          <Lock size={24} />
        </div>
        <h2 class="text-base font-semibold text-fg">Somente superadmin</h2>
        <p class="text-sm text-fg-muted">
          Esta configuração altera como os indicadores são calculados para todos os usuários, por
          isso é restrita ao superadmin.
        </p>
        <Button variant="primary" size="sm" onClick={() => navigate('/dashboard')}>
          <Home size={14} /> Voltar ao Dashboard
        </Button>
      </div>
    </Page>
  )
}
