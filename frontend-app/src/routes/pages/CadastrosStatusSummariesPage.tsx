import { Page } from '@/components/ui/Page'
import { StatusSummariesSettings } from './settings/StatusSummariesSettings'

export function CadastrosStatusSummariesPage() {
  return (
    <Page
      title="Resumos"
      description="Padronize o registro do atendimento: o operador escolhe o resumo que descreve a situação e o sistema move a etapa, gera as atividades com prazo e responsável, e classifica ganho ou perdido."
    >
      <StatusSummariesSettings />
    </Page>
  )
}
