// Páginas dedicadas pros itens de integração que antes abriam como sub-tab
// dentro de Configurações. Cada uma só envelopa o componente original num
// `<Page>` próprio — todas as configurações persistidas no banco ficam intactas.
//
// Os componentes-fonte ficam em `routes/pages/settings/*` (continuam servindo
// como sub-tab quando alguém acessa `/app/settings?tab=...` direto via URL).

import { Page } from '@/components/ui/Page'
import { EmailSettings } from '../settings/EmailSettings'
import { SmsSettings } from '../settings/SmsSettings'
import { AiSettings } from '../settings/AiSettings'
import { DnsSettings } from '../settings/DnsSettings'
import { WebhooksSettings } from '../settings/WebhooksSettings'
import { InboundWebhooks } from './InboundWebhooks'
import { ApiKeysSettings } from '../settings/ApiKeysSettings'
import { PaymentsPage } from '../PaymentsPage'
import { EvolutionApiSettings } from '../settings/EvolutionApiSettings'
import { KommoIntegration } from './KommoIntegration'

export function IntegrationKommoPage() {
  return (
    <Page title="Kommo CRM" description="Importa leads, contatos, tags, notas e tarefas da Kommo CRM e mantém sincronizado.">
      <KommoIntegration />
    </Page>
  )
}

export function IntegrationEmailPage() {
  return (
    <Page title="E-mail" description="Provedor de envio (Resend ou SMTP) e remetente padrão das mensagens transacionais.">
      <EmailSettings />
    </Page>
  )
}

export function IntegrationSmsPage() {
  return (
    <Page title="SMS" description="Provedor de SMS (Comtele) e remetente padrão.">
      <SmsSettings />
    </Page>
  )
}

export function IntegrationAiPage() {
  return (
    <Page title="IA / Tokens" description="Tokens de provedores de IA (Anthropic, OpenAI) e modelo padrão usado nas funcionalidades de IA.">
      <AiSettings />
    </Page>
  )
}

export function IntegrationDnsPage() {
  return (
    <Page title="DNS" description="Registros DNS gerenciados pela plataforma (subdomínios de portais, etc).">
      <DnsSettings />
    </Page>
  )
}

export function IntegrationWebhooksPage() {
  return (
    <Page title="Webhooks de Saída" description="Endpoints HTTP externos que recebem eventos do sistema (Zapier, Make, integrações próprias).">
      <WebhooksSettings />
    </Page>
  )
}

export function IntegrationInboundWebhooksPage() {
  return (
    <Page title="Webhooks de Entrada" description="URLs que recebem dados de sistemas externos (Make, n8n, Zapier, formulários terceiros) e criam leads no CRM aplicando o mapping configurado.">
      <InboundWebhooks />
    </Page>
  )
}

export function IntegrationApiKeysPage() {
  return (
    <Page title="API Keys" description="Chaves de API pra integrações externas autenticarem requests à nossa API.">
      <ApiKeysSettings />
    </Page>
  )
}

export function IntegrationPaymentsPage() {
  // PaymentsPage já tem seu próprio <Page> wrapper — renderiza direto.
  return <PaymentsPage />
}

export function IntegrationEvolutionPage() {
  return (
    <Page title="Evolution API" description="Monitor de saúde, instâncias, webhook e versão da Evolution API.">
      <EvolutionApiSettings />
    </Page>
  )
}
