import { Page } from '@/components/ui/Page'
import { CustomFieldsSettings } from './settings/CustomFieldsSettings'

export function CadastrosCustomFieldsPage() {
  return (
    <Page
      title="Campos personalizados"
      description="Defina campos extras que aparecem no cadastro de Leads, Formulários e Portal de Matrículas."
    >
      <CustomFieldsSettings />
    </Page>
  )
}
