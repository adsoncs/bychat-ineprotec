// src/services/outboundRouter.ts
//
// Por qual número sai uma mensagem AUTOMÁTICA (fluxo, cadência, agendamento).
//
// Antes deste módulo cada fluxo escolhia sozinho, e todos escolhiam a Evolution
// — o worker `wf-whatsapp` chamava `/message/sendText` por fetch cru, sem nem
// passar pela abstração de provider. Uma linha não-oficial derrubada levava
// junto tudo o que era automático: em 19/08 foram 921 mensagens perdidas num
// só dia com "Connection Closed", em silêncio.
//
// A decisão está separada do envio (`decidirCanal` / `enviarAutomatico`) para
// que dê para conferir o roteamento de um lead sem mandar mensagem a ninguém.
//
// A regra, em ordem:
//
// 1. GRUPO → Evolution, sempre: a Cloud API não envia para JID @g.us.
//
// 2. Aviso INTERNO (sem lead) → o número de um colega é tão "frio" quanto o de
//    um desconhecido, então texto livre só pela Evolution. Com HSM aprovado, o
//    número oficial também alcança — e é o que segura o aviso de novo lead de
//    pé quando a linha não-oficial cai, que é quando ele mais importa.
//
// 3. Conversa que JÁ existe → o número dela. Trocar o remetente no meio abre um
//    segundo fio no aparelho do contato, vindo de um desconhecido, e a resposta
//    cai numa linha que não é a da conversa. Se esse número for a Cloud API,
//    ainda vale a janela de 24h: dentro dela vai texto, fora dela vai HSM.
//
// 4. Contato NOVO (lead de anúncio/formulário, o caso da maioria dos disparos)
//    → Cloud API com HSM aprovado. É aqui que está o ganho: número oficial, que
//    não cai por volume.
//
// 5. Sem HSM utilizável → Evolution. Rede de segurança explícita, não acidente.
//    "Utilizável" é mais que aprovado: com pendência de cobrança na conta, a
//    Meta aceita o envio e falha depois, então template ali não é caminho.
//
// QUEM USA (código comum, opt-in):
//   • sempre: o fluxo de atendimento do chatbot roteirizado (scriptedSupportFlow
//     → sendBotMessage), que pode estar numa conexão Cloud API sem instância;
//   • passo "Enviar WhatsApp" com `hsmTemplate` (HSM de reserva por NOME, só
//     fora da janela de 24h) — formato de passo que nasceu no terram;
//   • com o Setting `whatsapp.roteador_saida` ligado: TODO envio automático
//     (passo de fluxo sem template, agendamento, aviso à equipe). Desligado
//     (padrão), esses envios seguem pelos caminhos de sempre de cada módulo.

import { prisma } from '../lib/prisma.js'
import { buildBodyParams, renderTemplateText } from '../lib/waTemplateParams.js'
import { isSendableStatus } from './cloudApiTemplates.js'
import {
  CloudApiProvider,
  createEvolutionProvider,
  createEvolutionProviderFor,
  inboundChannelForLead,
} from './whatsappProvider.js'

/** Template aprovado a usar quando o contato está FORA da janela de 24h. */
export interface HsmSpec {
  /** Nome na Meta (ex.: "lembrete_reuniao_24h"). */
  name: string
  /** Valores por NOME de variável. */
  values: Record<string, string>
  /**
   * Em que ordem esses nomes entram nos {{1}}, {{2}}… quando o template aprovado
   * é POSICIONAL. Nem todo template usa `{{nome}}`: o beyond tinha um aprovado
   * com `{{1}}..{{4}}`, e sem esta lista cada variável saía como "—" — a Meta
   * aceita, o envio "dá certo", e o cliente lê travessões.
   */
  ordem?: string[]
}

export interface EnvioAutomatico {
  /** null = aviso interno ao operador (não entra na conversa de ninguém). */
  leadId: number | null
  /** Telefone ou JID de grupo (@g.us). */
  phone: string
  /** Texto livre — o que sai quando o canal permite. */
  texto: string
  /** Sem HSM, um contato frio só é alcançável pela Evolution. */
  hsm?: HsmSpec | null
  /**
   * Envio automático em lote (fluxo, inatividade): espera a vez na linha antes
   * de sair (ver ritmoEnvio.ts). Resposta de chatbot e aviso interno NÃO usam —
   * são conversa ativa e não podem atrasar.
   */
  ritmo?: boolean
}

/** A decisão, sem segredos: dá para logar e mostrar num diagnóstico. */
export interface Plano {
  canal: 'cloud_api' | 'evolution'
  formato: 'texto' | 'template'
  cloudApiConnectionId: number | null
  /** null na Evolution = usar a instância padrão da tenant. */
  instanceName: string | null
  templateName: string | null
  /** Em uma frase, por que este canal — é o que aparece no log de uma queda. */
  motivo: string
}

export interface ResultadoEnvio extends Plano {
  externalId: string | null
  /** O que o contato REALMENTE recebeu: o HSM renderizado não é o texto livre. */
  textoEnviado: string
}

const JANELA_MS = 24 * 60 * 60 * 1000

// ── Configuração (Settings) ─────────────────────────────────────────────────

export interface ConfigRoteador {
  /** `whatsapp.roteador_saida` — envios automáticos passam por aqui. Padrão: desligado. */
  ligado: boolean
  /**
   * `whatsapp.hsm_aviso_equipe` — nome do HSM aprovado para o aviso INTERNO à
   * equipe (novo lead / fila). O modelo usa as variáveis nomeadas {{contato}},
   * {{telefone}}, {{setor}} e {{pedido}}. Vazio = aviso só por texto livre.
   */
  hsmAvisoEquipe: string
}

const CONFIG_CACHE_MS = 30_000
let configCache: { at: number; cfg: ConfigRoteador } | null = null

/** Valor de Setting como texto: o banco guarda JSON (`"x"`, `true`, `"true"`). */
export function textoDaSetting(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/^"|"$/g, '').trim()
}

export function settingLigada(v: unknown): boolean {
  return ['true', '1', 'sim', 'on', 'yes'].includes(textoDaSetting(v).toLowerCase())
}

export async function configDoRoteador(): Promise<ConfigRoteador> {
  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) return configCache.cfg
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.roteador_saida', 'whatsapp.hsm_aviso_equipe'] } },
    select: { key: true, value: true },
  }).catch(() => [] as Array<{ key: string; value: unknown }>)
  const s = new Map(rows.map((r) => [r.key, r.value]))
  const cfg: ConfigRoteador = {
    ligado: settingLigada(s.get('whatsapp.roteador_saida')),
    hsmAvisoEquipe: textoDaSetting(s.get('whatsapp.hsm_aviso_equipe')),
  }
  configCache = { at: Date.now(), cfg }
  return cfg
}

/**
 * Nem toda mensagem da Cloud API carrega a conexão de origem: o webhook grava,
 * mas o motor de chatbot persiste sem — no terram são 128 das 144 recebidas.
 * Com UMA conexão ativa não há ambiguidade e o registro sem etiqueta pode ser
 * lido como dela; com várias, ignorar é o único jeito de não atribuir conversa
 * ao número errado.
 */
async function filtroDaConexao(connectionId: number) {
  const ativas = await prisma.cloudApiConnection.count({ where: { active: true } })
  return ativas <= 1
    ? { OR: [{ cloudApiConnectionId: connectionId }, { cloudApiConnectionId: null }] }
    : { cloudApiConnectionId: connectionId }
}

/**
 * Janela de atendimento da Meta. Conta só mensagens recebidas NA CLOUD API:
 * uma mensagem que chegou na Evolution não abre a janela do número oficial —
 * são dois números diferentes para quem está do outro lado.
 */
async function janelaAberta(leadId: number, connectionId: number): Promise<boolean> {
  const msg = await prisma.message.findFirst({
    where: {
      leadId,
      provider: 'cloud_api',
      fromMe: false,
      createdAt: { gt: new Date(Date.now() - JANELA_MS) },
      ...(await filtroDaConexao(connectionId)),
    },
    select: { id: true },
  })
  return !!msg
}

/**
 * Canal da conversa. `inboundChannelForLead` é a regra oficial, mas ela exige a
 * etiqueta de conexão que o motor de chatbot não grava — e sem este segundo
 * olhar o lead que só falou com o número oficial parecia não ter conversa
 * nenhuma, e receberia uma abordagem de contato novo.
 */
async function canalDaConversa(leadId: number): Promise<
  { kind: 'evolution'; instanceName: string } | { kind: 'cloud'; connectionId: number } | null
> {
  const oficial = await inboundChannelForLead(leadId)
  if (oficial?.kind === 'evolution' && oficial.instanceName) return { kind: 'evolution', instanceName: oficial.instanceName }
  if (oficial?.kind === 'cloud' && oficial.cloudApiConnectionId) return { kind: 'cloud', connectionId: oficial.cloudApiConnectionId }

  const ultima = await prisma.message.findFirst({
    where: { leadId, fromMe: false, isInternal: false },
    orderBy: { timestamp: 'desc' },
    select: { provider: true },
  })
  if (ultima?.provider === 'cloud_api') {
    const conn = await conexaoAtiva()
    if (conn) return { kind: 'cloud', connectionId: conn.id }
  }
  return null
}

type Conexao = { id: number; phoneNumberId: string; systemUserToken: string; wabaId: string | null }

async function conexaoAtiva(id?: number | null): Promise<Conexao | null> {
  return prisma.cloudApiConnection.findFirst({
    where: { active: true, ...(id ? { id } : {}) },
    select: { id: true, phoneNumberId: true, systemUserToken: true, wabaId: true },
  })
}

/**
 * Conexão para um envio SEM conversa (contato novo ou aviso interno): a que tem o
 * template aprovado na conta (WABA) dela. Modelo HSM pertence à WABA — pegar "a
 * primeira conexão ativa" mandaria o modelo de uma conta pelo número de outra, e
 * a Meta recusa com 132001. Ordem: conexão padrão primeiro, depois a mais antiga.
 * Sem HSM (ou sem conta que o tenha), cai na padrão — o chamador decide o resto.
 */
async function conexaoParaTemplate(hsm: HsmSpec | null): Promise<Conexao | null> {
  const { ORDEM_CONEXAO_PADRAO } = await import('./whatsappProvider.js')
  const conns = await prisma.cloudApiConnection.findMany({
    where: { active: true },
    orderBy: ORDEM_CONEXAO_PADRAO,
    select: { id: true, phoneNumberId: true, systemUserToken: true, wabaId: true },
  })
  if (hsm?.name) {
    for (const c of conns) if (await templateAprovado(c, hsm.name)) return c
  }
  return conns[0] ?? null
}

/**
 * Disjuntor de cobrança.
 *
 * O erro 131042 ("Business eligibility payment issue") NÃO aparece na resposta
 * do envio: a Meta devolve 200 com wamid e só depois manda `failed` pelo
 * webhook. Sem este disjuntor, cada template continuaria sendo despachado para
 * o vazio — com a mensagem marcada como enviada no painel e nada chegando ao
 * contato. Enquanto houver falha assim recente, template não é caminho; texto
 * livre dentro da janela segue normal, porque conversa de serviço não é cobrada.
 */
const JANELA_DISJUNTOR_MS = 6 * 60 * 60 * 1000

async function cobrancaBloqueada(connectionId: number): Promise<boolean> {
  // O log criado pelo webhook de status não sabe de qual conexão veio, então
  // vale a mesma tolerância da janela: com uma conexão ativa, é dela.
  const daConexao = await filtroDaConexao(connectionId)
  const falha = await prisma.cloudApiMessageLog.findFirst({
    where: {
      status: 'failed',
      errorCode: '131042',
      updatedAt: { gt: new Date(Date.now() - JANELA_DISJUNTOR_MS) },
      ...daConexao,
    },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  }).catch(() => null)
  if (!falha) return false

  // Uma entrega POSTERIOR à falha prova que a conta voltou a poder cobrar. Sem
  // esta checagem o disjuntor ficaria preso pelas 6h inteiras depois de o
  // pagamento ser regularizado — e no terram a regularização aconteceu a cinco
  // minutos de uma falha, o que teria deixado tudo na Evolution a tarde toda.
  const sucesso = await prisma.cloudApiMessageLog.findFirst({
    where: {
      status: { in: ['sent', 'delivered', 'read'] },
      updatedAt: { gt: falha.updatedAt },
      ...daConexao,
    },
    select: { id: true },
  }).catch(() => null)
  return !sucesso
}

/** O template só serve se a Meta já aprovou; PENDING/REJECTED é o mesmo que não ter. */
async function templateAprovado(conn: Conexao, name: string) {
  if (!name) return null
  const tpl = await prisma.cloudApiTemplate.findFirst({
    where: { name, ...(conn.wabaId ? { wabaId: conn.wabaId } : {}) },
    select: { name: true, language: true, components: true, status: true },
  })
  if (!tpl) return null
  if (!isSendableStatus(tpl.status)) {
    console.warn(`[outbound] template ${name} está ${tpl.status} — não é enviável`)
    return null
  }
  return tpl
}

/**
 * Instância padrão da tenant: o Setting configurado no painel, depois a env,
 * depois a única ativa que houver — cada candidata só vale se estiver ATIVA no
 * cadastro. `createEvolutionProvider()` sozinho lê apenas a env e não confere
 * nada: no terram o `EVOLUTION_INSTANCE` aponta para a `terram_n1`, que está
 * desconectada, enquanto o painel já tinha sido corrigido para a `terram_n2`.
 */
async function instanciaPadrao(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'whatsapp.evolution_instance' } }).catch(() => null)
  const doPainel = row ? String(row.value).replace(/^"|"$/g, '').trim() : ''
  for (const cand of [doPainel, process.env.EVOLUTION_INSTANCE || '']) {
    if (!cand) continue
    const ok = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: cand, active: true },
      select: { instanceName: true },
    })
    if (ok) return ok.instanceName
  }
  const ativas = await prisma.whatsAppInstance.findMany({
    where: { active: true }, orderBy: { id: 'asc' }, select: { instanceName: true }, take: 2,
  })
  return ativas.length === 1 ? ativas[0]!.instanceName : null
}

/**
 * Instância Evolution para um lead que ainda não tem conversa: a do chatbot que
 * atende esse lead, senão a do dono, senão a padrão.
 */
async function instanciaDeFallback(leadId: number | null): Promise<string | null> {
  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { chatbotId: true, assignedUserId: true },
    })
    if (lead?.chatbotId) {
      const byBot = await prisma.whatsAppInstance.findFirst({
        where: { chatbotId: lead.chatbotId, active: true },
        select: { instanceName: true },
      })
      if (byBot) return byBot.instanceName
    }
    if (lead?.assignedUserId) {
      const byOwner = await prisma.whatsAppInstance.findFirst({
        where: { ownerUserId: lead.assignedUserId, active: true },
        orderBy: { id: 'asc' },
        select: { instanceName: true },
      })
      if (byOwner) return byOwner.instanceName
    }
  }
  return instanciaPadrao()
}

function porEvolution(instanceName: string | null, motivo: string): Plano {
  return { canal: 'evolution', formato: 'texto', cloudApiConnectionId: null, instanceName, templateName: null, motivo }
}

/**
 * O template é utilizável AGORA? Devolve o nome, ou o motivo de não ser — que
 * vira o `motivo` do plano. Distinguir "não tem template" de "template existe
 * mas a conta não pode cobrar" é o que faz o log apontar para a ação certa.
 */
type Veredito = { nome: string } | { impedimento: string }

async function templateUtilizavel(conn: Conexao, hsm: HsmSpec | null): Promise<Veredito> {
  if (!hsm) return { impedimento: 'envio sem HSM configurado' }
  if (!(await templateAprovado(conn, hsm.name))) return { impedimento: `template ${hsm.name} não está aprovado` }
  if (await cobrancaBloqueada(conn.id)) {
    console.warn(`[outbound] template ${hsm.name} não será usado: a conta WhatsApp Business está com pendência de cobrança (131042) — configure a forma de pagamento no WhatsApp Manager`)
    return { impedimento: 'conta WhatsApp Business com pendência de cobrança (131042)' }
  }
  return { nome: hsm.name }
}

/**
 * Escolhe o canal SEM enviar nada. Útil para diagnosticar por que uma mensagem
 * saiu (ou vai sair) por determinado número.
 */
export async function decidirCanal(env: EnvioAutomatico): Promise<Plano> {
  const { leadId, phone } = env
  const hsm = env.hsm ?? null
  // Guardado ao longo do caminho para que o fallback diga POR QUE não houve
  // template, em vez de um "sem HSM" genérico que manda procurar no lugar errado.
  let motivoSemTemplate = hsm ? `template ${hsm.name} indisponível` : 'envio sem HSM configurado'

  // 1. Grupo: só a Evolution alcança um JID @g.us.
  if (phone.includes('@g.us')) return porEvolution(await instanciaPadrao(), 'destino é um grupo — a Cloud API não envia para @g.us')

  // Aviso interno (sem lead): o número de um colega é tão frio quanto o de um
  // desconhecido, então texto livre só pela Evolution. Com HSM aprovado, porém,
  // o número oficial alcança — e é o que mantém o aviso de novo lead de pé
  // quando a linha não-oficial cai, que é justamente quando ele mais importa.
  if (!leadId) {
    if (hsm) {
      const conn = await conexaoParaTemplate(hsm)
      const vAviso = conn ? await templateUtilizavel(conn, hsm) : { impedimento: 'sem conexão Cloud API ativa' }
      if (conn && 'nome' in vAviso) {
        return { canal: 'cloud_api', formato: 'template', cloudApiConnectionId: conn.id, instanceName: null, templateName: vAviso.nome, motivo: 'aviso interno por template — número frio para texto livre' }
      }
      motivoSemTemplate = 'impedimento' in vAviso ? vAviso.impedimento : motivoSemTemplate
    }
    return porEvolution(await instanciaPadrao(), `aviso interno, sem lead; ${motivoSemTemplate}`)
  }

  // 2. Conversa existente: SÓ o número dela (regra de 22/09/2026 — ver
  //    whatsappProvider → canalDaConversa). Nada sai por outro número dentro de
  //    uma conversa: número fora do ar, ou janela fechada sem template, FALHA
  //    com o motivo, em vez de escorregar para a Evolution (outro número — um
  //    fio novo no aparelho do contato e a mensagem na conversa errada aqui).
  const { canalDaConversa: canalFixo, CanalDaConversaIndisponivel } = await import('./whatsappProvider.js')
  const fixo = await canalFixo(leadId)
  if (fixo && !fixo.ativo) throw new CanalDaConversaIndisponivel(fixo)
  const canal = fixo
    ? (fixo.kind === 'evolution'
        ? { kind: 'evolution' as const, instanceName: fixo.instanceName! }
        : { kind: 'cloud' as const, connectionId: fixo.cloudApiConnectionId! })
    : null
  if (canal?.kind === 'evolution') {
    return porEvolution(canal.instanceName, `conversa já acontece na instância ${canal.instanceName}`)
  }
  if (canal?.kind === 'cloud') {
    const conn = await conexaoAtiva(canal.connectionId)
    if (!conn) throw new Error('O número oficial desta conversa está fora do ar — a mensagem não sai por outro número.')
    if (await janelaAberta(leadId, conn.id)) {
      return { canal: 'cloud_api', formato: 'texto', cloudApiConnectionId: conn.id, instanceName: null, templateName: null, motivo: 'conversa na Cloud API com a janela de 24h aberta' }
    }
    const vFrio = await templateUtilizavel(conn, hsm)
    if ('nome' in vFrio) {
      return { canal: 'cloud_api', formato: 'template', cloudApiConnectionId: conn.id, instanceName: null, templateName: vFrio.nome, motivo: 'janela de 24h fechada — template aprovado' }
    }
    // Janela fechada e sem template: a Meta recusaria o texto livre, e a
    // conversa é deste número — não sai.
    throw new Error(`Conversa no número oficial com a janela de 24h fechada e ${vFrio.impedimento} — a mensagem não sai por outro número.`)
  }

  // 3. Contato novo (sem conversa) → Cloud API com HSM.
  if (!canal && hsm) {
    const conn = await conexaoParaTemplate(hsm)
    const vNovo = conn ? await templateUtilizavel(conn, hsm) : { impedimento: 'sem conexão Cloud API ativa' }
    if (conn && 'nome' in vNovo) {
      return { canal: 'cloud_api', formato: 'template', cloudApiConnectionId: conn.id, instanceName: null, templateName: vNovo.nome, motivo: 'contato novo — template aprovado pelo número oficial' }
    }
    motivoSemTemplate = 'impedimento' in vNovo ? vNovo.impedimento : motivoSemTemplate
  }

  // 5. Rede de segurança.
  return porEvolution(await instanciaDeFallback(leadId), motivoSemTemplate)
}

/**
 * Envia uma mensagem automática pelo canal certo. Lança se o envio falhar — quem
 * chama decide entre repetir (fila) e registrar a falha.
 */
export async function enviarAutomatico(env: EnvioAutomatico): Promise<ResultadoEnvio> {
  const r = await enviarAutomaticoPlano(env)
  // Primeira mensagem de uma conversa sem número: o número usado passa a ser o
  // DELA (whatsappProvider → canalDaConversa). Grupo e aviso interno não têm lead.
  if (env.leadId && r.externalId && !env.phone.includes('@g.us')) {
    const { canalDaConversa: canalFixo } = await import('./whatsappProvider.js')
    if (!(await canalFixo(env.leadId))) {
      const { adotarNoCanal } = await import('./contactIdentity.js')
      await adotarNoCanal(env.leadId, r.canal === 'cloud_api' ? { cloudApiConnectionId: r.cloudApiConnectionId } : { instanceName: r.instanceName })
    }
  }
  return r
}

async function enviarAutomaticoPlano(env: EnvioAutomatico): Promise<ResultadoEnvio> {
  const plano = await decidirCanal(env)

  if (plano.canal === 'cloud_api') {
    const conn = await conexaoAtiva(plano.cloudApiConnectionId)
    if (!conn) throw new Error('Conexão Cloud API saiu do ar entre a decisão e o envio')
    const provider = new CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
    if (env.ritmo) {
      const { esperarVez } = await import('./ritmoEnvio.js')
      await esperarVez(provider as any)
    }

    if (plano.formato === 'template') {
      const tpl = await templateAprovado(conn, plano.templateName || '')
      if (!tpl) throw new Error(`Template ${plano.templateName} deixou de estar aprovado`)
      const values = env.hsm?.values ?? {}
      const ordem = env.hsm?.ordem
      const { params, faltando } = buildBodyParams(tpl.components, values, ordem)
      // Mensagem incompleta não sai. A Meta aceitaria com o placeholder e o envio
      // contaria como sucesso — o contato receberia "Olá, —!". Lançar devolve o
      // caso a quem chamou, que já sabe tratar falha de envio.
      if (faltando.length) {
        throw new Error(
          `Template ${tpl.name}: ${faltando.map((t) => `{{${t}}}`).join(', ')} sem valor`
          + ` — envio cancelado para não mandar uma mensagem com "—".`,
        )
      }
      const r = await provider.sendTemplate(
        env.phone, tpl.name, tpl.language || 'pt_BR',
        params.length ? [{ type: 'body', parameters: params }] : [],
      )
      // Liga o wamid à conexão e ao template: é o que faz o custo aparecer nos
      // relatórios e o que dá ao disjuntor de cobrança um log com dono.
      if (r.messageId) {
        const { recordOutbound } = await import('./cloudApiBilling.js')
        await recordOutbound({
          wamid: r.messageId, connectionId: conn.id, leadId: env.leadId, templateName: tpl.name,
        }).catch((e: any) => console.warn('[outbound] registro de custo falhou:', e?.message))
      }
      return { ...plano, externalId: r.messageId, textoEnviado: renderTemplateText(tpl.components, values, ordem) }
    }

    const r = await provider.sendText(env.phone, env.texto)
    return { ...plano, externalId: r.messageId, textoEnviado: env.texto }
  }

  const provider = plano.instanceName ? createEvolutionProviderFor(plano.instanceName) : createEvolutionProvider()
  if (env.ritmo) {
    // Teto diário da linha QR (ver ritmoEnvio.ts): cheio, o worker reagenda.
    const { esperarVez, linhaDoProvider, consumirTeto, TetoDiarioCheio } = await import('./ritmoEnvio.js')
    const linha = linhaDoProvider(provider as any)
    if (linha && !(await consumirTeto(linha, 'evolution'))) throw new TetoDiarioCheio(linha)
    await esperarVez(provider as any)
  }
  const r = await provider.sendText(env.phone, env.texto)
  return { ...plano, instanceName: provider.instanceName, externalId: r.messageId, textoEnviado: env.texto }
}
