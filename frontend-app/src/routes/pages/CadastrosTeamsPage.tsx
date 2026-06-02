import { Page } from '@/components/ui/Page'
import { TeamsSettings } from './settings/TeamsSettings'

export function CadastrosTeamsPage() {
  return (
    <Page
      title="Equipes"
      description="Cadastre equipes para roteamento, atribuição e relatórios de performance."
    >
      <TeamsSettings />
    </Page>
  )
}
