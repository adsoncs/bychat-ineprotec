import { Page } from '@/components/ui/Page'
import { BusinessHoursSettings } from './settings/BusinessHoursSettings'
import { OperatorIdentitySettings } from './settings/OperatorIdentitySettings'

export function CadastrosBusinessHoursPage() {
  return (
    <Page
      title="Atendimento"
      description="Defina horários de funcionamento e como o operador se identifica ao contato. Chatbots e atendimento usam essas regras."
    >
      <div class="space-y-8">
        <BusinessHoursSettings />
        <OperatorIdentitySettings />
      </div>
    </Page>
  )
}
