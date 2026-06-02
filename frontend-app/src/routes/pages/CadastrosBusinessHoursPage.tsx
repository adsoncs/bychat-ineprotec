import { Page } from '@/components/ui/Page'
import { BusinessHoursSettings } from './settings/BusinessHoursSettings'

export function CadastrosBusinessHoursPage() {
  return (
    <Page
      title="Atendimento"
      description="Defina horários de funcionamento. Chatbots e atendimento usam para regras de resposta automática fora do expediente."
    >
      <BusinessHoursSettings />
    </Page>
  )
}
