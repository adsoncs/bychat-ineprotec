// src/services/alertLinks.ts
//
// Para onde cada alerta leva, e o que se pode fazer nele sem sair do sino.
//
// Existe porque o diagnóstico que abriu este trabalho vale para todos os tipos,
// não só para reunião: o botão de desfecho da Agenda nunca foi usado — nenhuma
// vez em toda a história do sistema — porque exigia voltar a uma tela que
// ninguém revisita. Alerta que só aponta o problema repete esse erro; a pessoa
// lê, concorda, e não faz nada porque agir dá trabalho.
//
// Duas coisas diferentes, e as duas importam:
//   `link`  — para onde o item vive. Um clique e a pessoa está lá.
//   `acoes` — o que resolve a CONDIÇÃO ali mesmo, sem navegar.
//
// Nem todo alerta tem ação: reconectar um token não é botão, é um fluxo de
// OAuth. Nesses casos o link já é o ganho: em vez de "descobrir onde se
// reconecta o Google", a pessoa chega na tela.

/** Ação oferecida na linha do alerta. */
export interface AcaoDeAlerta {
  /** Valor aceito por POST /api/alerts/:id/action. */
  action: string
  /** Rótulo curto do botão. */
  label: string
  /** 'primary' pinta como confirmação; 'neutral' como alternativa. */
  tom: 'primary' | 'neutral'
}

export interface DestinoDoAlerta {
  link: string | null
  acoes: AcaoDeAlerta[]
}

interface Contexto {
  entityType: string | null
  entityId: number | null
  /** Do metadata do alerta — vários itens vivem dentro da tela do lead. */
  leadId?: number | null
}

// ── Onde cada coisa realmente mora ─────────────────────────────────────────
//
// Dois cuidados aqui, os dois aprendidos errando:
//
// 1. **Sem `/app`.** O sino navega com o `navigate()` do wouter, e o roteador
//    está montado com `base={env.appBasePath}` (= `/app`). O caminho entregue
//    aqui é RELATIVO a essa base: escrever "/app/settings" produzia
//    "/app/app/settings" e caía no NotFound. Todo caminho abaixo começa depois
//    da base.
//
// 2. **A página dedicada, não a aba de Configurações.** Os destinos eram
//    "/settings?tab=whatsapp" e "?tab=meetings" — abas que não existem: o
//    `readTabFromUrl` do SettingsPage descarta o que não conhece e abre
//    "Aparência". A pessoa clicava no alerta de linha caída e chegava na tela
//    de cores. Cada integração tem a sua própria tela no menu, e é lá que se
//    conserta.
const LINHAS_WHATSAPP = '/whatsapp'          // conectar, reconectar, QR
const EVOLUTION = '/integrations/evolution'  // a API e o webhook
const CLOUD_API = '/cloud-api'
const GOOGLE = '/google'                     // aba escolhida por ?tab=
const REUNIOES = '/meetings'
const AGENDA = '/scheduling'

export function destinoDoAlerta(ctx: Contexto): DestinoDoAlerta {
  const { entityType, entityId, leadId } = ctx

  switch (entityType) {
    case 'booking':
      // A reunião tem as duas coisas: a pergunta se resolve no sino, e o link
      // leva à agenda para quem quiser ver o contexto antes de responder.
      return {
        link: AGENDA,
        acoes: [
          { action: 'completed', label: 'Aconteceu', tom: 'primary' },
          { action: 'no_show', label: 'Não veio', tom: 'neutral' },
        ],
      }

    case 'activity':
      // Concluir resolve a condição. Reagendar não entra como botão: escolher
      // data nova é formulário, e formulário dentro de uma gaveta de 28rem é
      // pior que a tela que já existe para isso.
      return {
        link: leadId ? `/leads/${leadId}/activities` : null,
        acoes: [{ action: 'completed', label: 'Concluí', tom: 'primary' }],
      }

    case 'negotiation':
      // Sem ação: o que fazer com uma proposta parada é retomar a conversa, e
      // isso não cabe em botão. O link abre a negociação já na aba certa.
      return { link: leadId ? `/leads/${leadId}/negociacao` : null, acoes: [] }

    case 'lead':
      // Sem ação, e é decisão: o que resolve um lead parado é falar com ele, e
      // isso não cabe num botão de gaveta. Encerrar o ciclo também não entra —
      // marcar alguém como perdido a partir de um aviso, sem abrir a conversa,
      // é o tipo de clique de que a pessoa se arrepende.
      //
      // O destino é a CONVERSA, não a ficha. Este alerta só nasce quando a
      // última mensagem é do contato — logo a conversa existe por construção, e
      // a providência é responder, o que a ficha do lead não permite fazer. Era
      // o único destino que não levava ao lugar onde a coisa vive: a atividade
      // atrasada abre em /activities, a proposta parada em /negociacao.
      //
      // `?leadId=` é o mesmo caminho do "Abrir conversa" do menu do lead: a
      // ConversationsPage varre todos os baldes e escopos até achar o ticket.
      // Sem acesso àquela conversa a seleção apenas não acontece e a pessoa
      // cai na lista — degrada sem quebrar.
      return { link: entityId ? `/conversations?leadId=${entityId}` : null, acoes: [] }

    case 'whatsapp_instance':
      // Onde se reconecta e se lê o QR — não a aba de configurações.
      return { link: LINHAS_WHATSAPP, acoes: [] }

    case 'evolution':
      // API fora do ar e webhook fora de lugar são da integração, não de uma
      // linha: mandar para a lista de linhas faria procurar defeito onde não
      // está.
      return { link: EVOLUTION, acoes: [] }

    case 'cloud_api_connection':
      return { link: CLOUD_API, acoes: [] }

    // As quatro caras do Google moram na mesma tela, em abas diferentes. O
    // `?tab=` só funciona porque a página passou a lê-lo — antes ela abria
    // sempre em Sheets, e o alerta de Gmail levava a uma planilha.
    case 'google_connection':
      return { link: `${GOOGLE}?tab=account`, acoes: [] }
    case 'gmail_config':
      return { link: `${GOOGLE}?tab=gmail`, acoes: [] }
    case 'google_calendar_integration':
      return { link: `${GOOGLE}?tab=calendar`, acoes: [] }
    case 'google_sheet_integration':
      return { link: `${GOOGLE}?tab=sheets`, acoes: [] }

    case 'meeting_recording':
      // Não depende de `entityId`: a falha do bot se resolve na configuração de
      // gravação, e antes um id ausente deixava o alerta sem link nenhum.
      return { link: REUNIOES, acoes: [] }

    default:
      return { link: null, acoes: [] }
  }
}
