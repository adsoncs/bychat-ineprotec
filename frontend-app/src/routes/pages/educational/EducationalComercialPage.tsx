// Educacional › Comercial — vendas das inscrições, vendedores, metas e
// comissões por portal, curso e polo (Fase 3 da integração com Negociações).
import { Page } from '@/components/ui/Page'
import { PainelComercial } from '@/components/comercial/PainelComercial'

export function EducationalComercialPage() {
  return (
    <Page title="Comercial" description="Vendas das inscrições (propostas ganhas), vendedores × meta e comissões, por portal, curso e polo. São os mesmos dados de Negociações e Metas & Comissões.">
      <PainelComercial />
    </Page>
  )
}
