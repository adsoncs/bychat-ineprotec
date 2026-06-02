import { Page } from '@/components/ui/Page'
import { LossReasonsSettings } from './settings/LossReasonsSettings'

export function CadastrosLossReasonsPage() {
  return (
    <Page
      title="Objeções"
      description="Cadastre motivos de perda. São listados ao marcar um lead como Perdido e alimentam os relatórios de equipe."
    >
      <LossReasonsSettings />
    </Page>
  )
}
