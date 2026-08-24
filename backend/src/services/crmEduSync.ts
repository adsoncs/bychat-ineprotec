// src/services/crmEduSync.ts
//
// Importador CRM Educacional (Wakeme) → bychat. Fluxo de MÃO ÚNICA: só traz
// dados de lá para cá; nada é escrito no CRM.
//
// Por que varredura fatiada em vez do modelo incremental do kommoSync:
// a API só expõe UM endpoint de leitura de leads (BuscarLeadsSemInscricao),
// sem paginação e filtrando por data de CRIAÇÃO. Não existe "o que mudou desde
// X". Então percorremos a linha do tempo em janelas curtas (padrão 15 dias) e
// deduplicamos pelo GUID via CrmEduMapping.
//
// LIMITE QUE O USUÁRIO PRECISA CONHECER: o endpoint devolve apenas leads com
// SituacaoFunil "Potencial". Quem se inscreveu/matriculou não vem por API — e
// um lead já importado que depois se inscreve simplesmente some da listagem,
// sem nenhum evento. Cobrir isso exige que a CRM Educacional configure as
// "URL's Post Lead/Inscrição" do concurso apontando para o bychat.

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { buscarLeadsSemInscricao, getCrmEduConfig, type CrmEduLead } from '../lib/crmEduClient.js'
import { generateUid } from './dedup.js'
import { phoneKey } from '../lib/phone.js'
import { classificarPorConcurso, areaParaCustomFields } from './leadArea.js'
import { classificarCanal, canalParaCustomFields } from './leadCanal.js'

/** Início da base da unialfa (o primeiro lead é de 2025-02-17; antes a API devolve null). */
export const INICIO_PADRAO = '2025-02-01'
const JANELA_DIAS_PADRAO = 15

export interface ProgressoSync {
  janelas: number
  janelaAtual: number
  lidos: number
  criados: number
  atualizados: number
  ignorados: number
  erros: number
  de: string
  ate: string
  iniciadoEm: Date
  concluidoEm?: Date
  ultimoErro?: string
}

let emAndamento: ProgressoSync | null = null
export function progressoAtual(): ProgressoSync | null {
  return emAndamento
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Fatia [de, ate] em janelas de N dias (a API não pagina; a janela é o controle). */
export function montarJanelas(de: string, ate: string, dias: number): Array<{ de: string; ate: string }> {
  const out: Array<{ de: string; ate: string }> = []
  let cursor = new Date(`${de}T00:00:00Z`)
  const fim = new Date(`${ate}T00:00:00Z`)
  while (cursor <= fim) {
    const proximo = new Date(cursor)
    proximo.setUTCDate(proximo.getUTCDate() + dias - 1)
    out.push({ de: iso(cursor), ate: iso(proximo > fim ? fim : proximo) })
    cursor = new Date(proximo)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/** Nome do lead: NomeCompleto quando existir, senão Nome + SobreNome. */
function montarNome(l: CrmEduLead): string {
  const completo = (l.NomeCompleto || '').trim()
  if (completo) return completo.substring(0, 191)
  const junto = [l.Nome, l.SobreNome].filter(Boolean).join(' ').trim()
  return (junto || 'Sem nome').substring(0, 191)
}

/** Lê `{Id, Nome, NomeLogico}` — o formato que o Dynamics usa em toda referência. */
function ref(v: unknown): { id: string | null; nome: string | null } {
  if (!v || typeof v !== 'object') return { id: null, nome: null }
  const o = v as any
  return { id: o.Id ?? null, nome: o.Nome ?? null }
}

/**
 * Guarda os campos do CRM que não têm coluna própria no Lead. Só os preenchidos
 * — o payload tem 130 campos e 77 vêm sempre nulos.
 *
 * O que cada bloco representa (medido sobre 16.431 leads da unialfa):
 *  - ProprietarioPRO (31%) é o CONSULTOR de verdade. Não confundir com
 *    ProprietarioReferencia, que em 99% dos casos é o robô "Usuário Ficha de
 *    Inscrição" e não serve como responsável.
 *  - ContaReferencia (25%) é o polo que atende; UnidadeInteresse (25%) é o polo
 *    que o candidato procurou. São coisas diferentes e nem sempre coincidem.
 *  - CamposFormulario existe no payload mas veio vazio em 100% dos leads — não
 *    há campo personalizado por ali.
 */
function montarCustomFields(l: CrmEduLead): Record<string, unknown> {
  const cf: Record<string, unknown> = {}
  const consultor = ref(l.ProprietarioPRO)
  const polo = ref(l.ContaReferencia)
  const poloInteresse = ref(l.UnidadeInteresse)
  const codConsultor = ref(l.CodigoDoConsultor)

  const diretos: Array<[string, unknown]> = [
    ['crmedu_cpf', l.CPF],
    ['crmedu_rg', l.RG],
    ['crmedu_data_nascimento', l.DataNascimento],
    ['crmedu_nome_social', l.NomeSocial],
    ['crmedu_sexo_codigo', l.New_Sexo],
    ['crmedu_estado_civil', l.EstadoCivil],
    // localização
    ['crmedu_cep', l.CEP],
    ['crmedu_endereco_rua', l.EnderecoRua],
    ['crmedu_endereco_numero', l.EnderecoNumero],
    ['crmedu_endereco_bairro', l.EnderecoBairro],
    ['crmedu_endereco_complemento', l.EnderecoComplemento],
    ['crmedu_estado', l.EnderecoEstado],
    // funil e origem
    ['crmedu_situacao_funil', l.SituacaoFunil],
    // optionset numérico do Dynamics; o rótulo legível não vem pela API — na
    // unialfa 809220003 concentra o tráfego de Facebook e 200002 o presencial
    // (Ação Polo/Panfletagem), mas confirmar os nomes com a instituição.
    ['crmedu_origem_codigo', l.OrigemClientePotencial],
    ['crmedu_preferencia_contato', l.PreferenciaContato],
    // atendimento
    ['crmedu_consultor', consultor.nome],
    ['crmedu_consultor_id', consultor.id],
    ['crmedu_consultor_codigo', codConsultor.nome],
    ['crmedu_polo', polo.nome],
    ['crmedu_polo_id', polo.id],
    ['crmedu_polo_interesse', poloInteresse.nome],
    ['crmedu_atividades_polo', l.AtividadesDoPolo],
    // perfil acadêmico
    ['crmedu_nivel_ensino', l.NivelEnsino],
    ['crmedu_ano_formacao', l.AnoFormacao],
    // rastro
    ['crmedu_telefone_comercial', l.TelefoneComercial],
    ['crmedu_data_ultima_atividade', l.DataUltimaAtividade],
    ['crmedu_ip_aceite_lgpd', l.IpAceiteLgpd],
  ]
  for (const [k, v] of diretos) {
    if (v !== null && v !== undefined && v !== '') cf[k] = v
  }

  // Área de interesse pelo nome do processo seletivo ("EAD VESTIBULAR - 2026/33"
  // → Graduação/EAD). Só ~1,2% dos leads têm concurso preenchido — os demais
  // ficam sem `area_*` de propósito, porque a API não expõe curso/modalidade.
  const nomeConcurso = (l.ConcursoOrigem as any)?.Nome ?? null
  if (nomeConcurso) Object.assign(cf, areaParaCustomFields(classificarPorConcurso(nomeConcurso)))

  // Canal de captação: texto do CampaignSource quando existe, senão o optionset
  // de origem (que vem em 100% dos leads). Ver services/leadCanal.ts.
  Object.assign(cf, canalParaCustomFields(classificarCanal(l.CampaignSource, l.OrigemClientePotencial)))

  return cf
}

/**
 * Garante um User local para o consultor do CRM (idempotente por e-mail
 * sintético, já que a API não devolve o e-mail dele). Criado como AGENT ativo
 * mas SEM login utilizável: senha aleatória que ninguém conhece — quem for usar
 * define depois por recuperação. Mesmo padrão do importador da Kommo.
 */
async function garantirConsultor(nome: string, crmId: string | null): Promise<number | null> {
  const limpo = nome.trim().substring(0, 191)
  if (!limpo) return null
  const email = `crmedu-${(crmId || limpo.toLowerCase().replace(/[^a-z0-9]+/g, '-')).substring(0, 60)}@crmedu.local`
  const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existente) return existente.id
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
  const criado = await prisma.user.create({
    data: { email, name: limpo, role: 'AGENT', active: true, passwordHash, isAgent: true },
  })
  return criado.id
}

/** Tracking de campanha nas colunas nativas — é o que a tela de atribuição lê. */
function montarTracking(l: CrmEduLead): Record<string, string> {
  const t: Record<string, string> = {}
  if (l.CampaignName) t.campaignName = String(l.CampaignName).substring(0, 191)
  if (l.CampaignSource) t.utmSource = String(l.CampaignSource).substring(0, 191)
  if (l.CampaignMedium) t.utmMedium = String(l.CampaignMedium).substring(0, 191)
  if (l.CampaignContent) t.utmContent = String(l.CampaignContent).substring(0, 191)
  if (l.CampaignTerm) t.utmTerm = String(l.CampaignTerm).substring(0, 191)
  return t
}

function dataOuNulo(v: string | null): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

export interface OpcoesSync {
  de?: string
  ate?: string
  janelaDias?: number
  /** Só conta o que viria, sem gravar. */
  simular?: boolean
  /** Regrava mesmo sem alteração no CRM — use depois de mudar o mapeamento. */
  forcar?: boolean
  funnelId?: number | null
  teamId?: number | null
}

/**
 * Importa/atualiza os leads do período. Idempotente: o GUID do CRM é a chave,
 * então rodar de novo no mesmo intervalo atualiza em vez de duplicar.
 *
 * Leads SEM telefone são importados do mesmo jeito (decisão do usuário) — eles
 * entram como registro, mas não são contatáveis por WhatsApp.
 */
export async function sincronizar(opts: OpcoesSync = {}): Promise<ProgressoSync> {
  if (emAndamento && !emAndamento.concluidoEm) {
    throw new Error('Já existe uma sincronização em andamento')
  }
  const cfg = await getCrmEduConfig(true)
  if (!cfg.baseUrl || !cfg.username || !cfg.password) {
    throw new Error('CRM Educacional não configurado')
  }

  const de = opts.de || INICIO_PADRAO
  const ate = opts.ate || iso(new Date())
  const janelas = montarJanelas(de, ate, opts.janelaDias || JANELA_DIAS_PADRAO)

  const p: ProgressoSync = {
    janelas: janelas.length, janelaAtual: 0,
    lidos: 0, criados: 0, atualizados: 0, ignorados: 0, erros: 0,
    de, ate, iniciadoEm: new Date(),
  }
  emAndamento = p

  try {
    for (const j of janelas) {
      p.janelaAtual++
      let lote: CrmEduLead[] = []
      try {
        lote = await buscarLeadsSemInscricao(j.de, j.ate)
      } catch (e: any) {
        p.erros++
        p.ultimoErro = `janela ${j.de}..${j.ate}: ${e?.message || e}`
        console.error('[crmEduSync]', p.ultimoErro)
        continue // uma janela ruim não derruba a varredura inteira
      }
      p.lidos += lote.length
      if (opts.simular) continue

      for (const l of lote) {
        try {
          await gravarLead(l, opts, p)
        } catch (e: any) {
          p.erros++
          p.ultimoErro = `lead ${l.Id}: ${e?.message || e}`
          console.error('[crmEduSync]', p.ultimoErro)
        }
      }
      console.log(`[crmEduSync] janela ${p.janelaAtual}/${p.janelas} (${j.de}..${j.ate}) — ${lote.length} lidos · ${p.criados} criados · ${p.atualizados} atualizados`)
    }
    p.concluidoEm = new Date()
    return p
  } finally {
    if (!p.concluidoEm) p.concluidoEm = new Date()
  }
}

// ─────────────────────────────────────────────────────────────
// Sincronização automática
// ─────────────────────────────────────────────────────────────

/**
 * Ritmo do poll. Dois níveis, porque servem a coisas diferentes:
 *
 *  - POLL (a cada 10 min, janela de 2 dias): mantém o bychat colado no CRM.
 *    Custa ~1,4 MB e ~3 s por ciclo (medido na unialfa), ou seja ~144 chamadas
 *    por dia — folgado diante do teto de 50 req/min. A janela é de 2 dias, e
 *    não 1, para cobrir a virada do dia e a diferença de fuso: a API filtra por
 *    data de criação no horário local (-03) e nós calculamos em UTC.
 *
 *  - PASSADA PROFUNDA (1×/dia, de madrugada, janela de 7 dias): pega o que o
 *    poll não vê. Como o filtro é por data de CRIAÇÃO, um lead criado semana
 *    passada e editado hoje só reaparece na janela da criação — a janela larga
 *    recupera essas edições, e de quebra cobre qualquer ciclo que tenha falhado.
 */
const POLL_MS = 10 * 60 * 1000
const POLL_JANELA_DIAS = 2
const PROFUNDA_JANELA_DIAS = 7
const PROFUNDA_HORA_LOCAL = 3

/** Data de hoje no fuso de São Paulo — o mesmo que o CRM usa para filtrar. */
function hojeLocal(): { dia: string; hora: number } {
  const agora = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]))
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) }
}

async function lerSetting(key: string): Promise<string | null> {
  const r = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  const v = r?.value
  return typeof v === 'string' ? v.replace(/^"|"$/g, '') : v ? String(v) : null
}

async function gravarSetting(key: string, value: string, label: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'crmedu', fieldType: 'text' },
    update: { value },
  })
}

/** Roda uma passada incremental dos últimos `dias`, sem forçar regravação. */
export async function sincronizarIncremental(dias = POLL_JANELA_DIAS): Promise<ProgressoSync | null> {
  const cfg = await getCrmEduConfig(true)
  if (!cfg.enabled) return null
  if (!cfg.baseUrl || !cfg.username || !cfg.password) {
    console.warn('[crmEduSync] agendado, mas a integração está sem configuração completa')
    return null
  }
  const emCurso = progressoAtual()
  if (emCurso && !emCurso.concluidoEm) {
    // uma carga manual longa está rodando — o próximo ciclo pega o que faltar
    return null
  }
  const de = new Date()
  de.setUTCDate(de.getUTCDate() - dias)
  const r = await sincronizar({ de: iso(de), janelaDias: Math.max(dias, 1) })
  await gravarSetting('crmedu.last_sync_at', new Date().toISOString(), 'Última verificação automática')
  return r
}

/**
 * Poll ativo: verifica a cada 10 minutos e faz uma passada larga por dia.
 * Só age onde a integração está ligada — em tenant sem `crmedu.enabled` o
 * ciclo sai de graça logo no começo.
 */
export function startCrmEduScheduler(): void {
  let rodando = false

  async function tick(inicial = false): Promise<void> {
    if (rodando) return // não empilha ciclos se um deles demorar mais que o intervalo
    rodando = true
    try {
      const { dia, hora } = hojeLocal()
      const ultimaProfunda = await lerSetting('crmedu.last_deep_at')
      const devePassadaProfunda = ultimaProfunda !== dia && (hora >= PROFUNDA_HORA_LOCAL || inicial)

      if (devePassadaProfunda) {
        const r = await sincronizarIncremental(PROFUNDA_JANELA_DIAS)
        if (r) {
          await gravarSetting('crmedu.last_deep_at', dia, 'Dia da última passada profunda')
          console.log(`[crmEduSync] passada profunda (${PROFUNDA_JANELA_DIAS}d): ${r.lidos} lidos · ${r.criados} novos · ${r.atualizados} atualizados · ${r.erros} erros`)
        }
        return
      }

      const r = await sincronizarIncremental(POLL_JANELA_DIAS)
      // silencioso quando não há novidade — senão o log vira ruído a cada 10 min
      if (r && (r.criados > 0 || r.atualizados > 0 || r.erros > 0)) {
        console.log(`[crmEduSync] poll: ${r.criados} novos · ${r.atualizados} atualizados · ${r.erros} erros`)
      }
    } catch (e: any) {
      console.error('[crmEduSync] ciclo falhou:', e?.message || e)
    } finally {
      rodando = false
    }
  }

  // 60s de folga para não competir com o boot do servidor
  setTimeout(() => { tick(true) }, 60_000)
  setInterval(() => { tick(false) }, POLL_MS)
  console.log(`[crmEduSync] poll ativo — verifica a cada ${POLL_MS / 60000} min (janela de ${POLL_JANELA_DIAS}d) + passada de ${PROFUNDA_JANELA_DIAS}d 1×/dia após ${PROFUNDA_HORA_LOCAL}h`)
}

/**
 * Contatos "descartáveis" que a base do CRM usa quando o dado real não existe.
 * Deduplicar por eles fundiria pessoas diferentes: na unialfa há 41 leads com
 * 5562999999999, 1.127 com Testeead@gmail.com, 292 com sememail@gmail.com…
 */
const TELEFONE_DESCARTAVEL = /^55?(\d)\1{8,}$|^0+$|^(\d{2})?9?0{7,}$|^(\d)\1+$/
const EMAIL_DESCARTAVEL = /^(\.|teste|test|sem\s?email|sememail|naotem|nao\s?tem|noemail|no-?reply|nada)|@(ead\.com\.br|teste|example)/i

function telefoneUtilizavel(tel: string): boolean {
  const d = tel.replace(/\D/g, '')
  if (d.length < 12) return false
  if (TELEFONE_DESCARTAVEL.test(d)) return false
  const corpo = d.slice(-8)
  // preenchimento típico: 00000000, 99999999, 32323232, 12345678
  if (/^(\d)\1{7}$/.test(corpo)) return false
  if (/^(\d\d)\1{3}$/.test(corpo)) return false
  if (corpo === '12345678') return false
  if ((corpo.match(/0/g) || []).length >= 6) return false
  return true
}

function emailUtilizavel(email: string): boolean {
  const e = email.trim().toLowerCase()
  return !!e && e.includes('@') && !EMAIL_DESCARTAVEL.test(e)
}

/**
 * Procura um lead que já represente esta pessoa no bychat — tipicamente um que
 * entrou pelo Meta Ads antes de o CRM Educacional recebê-lo pelo ads-raptor.
 *
 * O MESMO lead chega por dois caminhos:
 *   Meta Ads → bychat                                  (source: meta_lead_ads)
 *   Meta Ads → ads-raptor → CRM Educacional → bychat   (source: crmedu_import)
 * Sem esta busca, cada lead do Meta vira dois registros — foi o que gerou os
 * 515 duplicados mesclados em 2026-07-29.
 *
 * Devolve null quando a evidência é fraca ou ambígua: contato descartável, ou
 * mais de um lead com o mesmo contato (aí ninguém sabe qual é o certo, e criar
 * um registro novo é menos danoso do que grudar no lead errado).
 */
async function encontrarLeadExistente(whatsapp: string, email: string): Promise<number | null> {
  if (whatsapp && telefoneUtilizavel(whatsapp)) {
    const chave = phoneKey(whatsapp)
    if (chave) {
      const achados = await prisma.lead.findMany({ where: { phoneKey: chave }, select: { id: true }, take: 2 })
      if (achados.length === 1) return achados[0]!.id
      if (achados.length > 1) return null // ambíguo — não arrisca
    }
  }
  if (email && emailUtilizavel(email)) {
    const achados = await prisma.lead.findMany({ where: { email }, select: { id: true }, take: 2 })
    if (achados.length === 1) return achados[0]!.id
  }
  return null
}

async function gravarLead(l: CrmEduLead, opts: OpcoesSync, p: ProgressoSync): Promise<void> {
  if (!l.Id) { p.ignorados++; return }

  const whatsapp = (l.TelefoneCelular || l.TelefoneComercial || '').substring(0, 30)
  const email = (l.Email || '').substring(0, 191)
  const nome = montarNome(l)
  const cf = montarCustomFields(l)
  const tracking = montarTracking(l)
  const criadoEm = dataOuNulo(l.DataCriacao)
  const modificadoEm = l.DataModificacao ?? null

  // Consultor do CRM vira responsável do lead no bychat.
  const consultor = ref(l.ProprietarioPRO)
  const responsavelId = consultor.nome ? await garantirConsultor(consultor.nome, consultor.id) : null

  // Consentimento LGPD registrado no CRM alimenta as colunas nativas.
  const lgpd: Record<string, unknown> = {}
  if (l.AceitouLgpd) {
    lgpd.lgpdConsent = true
    const quando = dataOuNulo(l.DataAceiteLgpd as string | null)
    if (quando) lgpd.lgpdConsentAt = quando
  }

  const cidade = (l.EnderecoCidade ? String(l.EnderecoCidade) : '').substring(0, 100)

  const existente = await prisma.crmEduMapping.findUnique({
    where: { entityType_crmId: { entityType: 'lead', crmId: l.Id } },
    select: { localId: true, meta: true },
  })

  if (existente) {
    // Só toca no banco se o CRM registrou alteração desde a última passada —
    // numa revarredura de 17 meses isso evita dezenas de milhares de UPDATEs.
    // `forcar` existe para reprocessar quando o MAPEAMENTO muda (campos novos),
    // caso em que o DataModificacao do CRM continua igual e nada seria gravado.
    const visto = (existente.meta as any)?.dataModificacao ?? null
    if (!opts.forcar && visto && modificadoEm && visto === modificadoEm) { p.ignorados++; return }

    const atual = await prisma.lead.findUnique({
      where: { id: existente.localId },
      select: {
        customFields: true, utmSource: true, utmMedium: true, utmContent: true, utmTerm: true,
        campaignName: true, campaignId: true, assignedUserId: true, source: true,
      },
    })
    if (!atual) {
      // o lead local sumiu (merge/exclusão) — o mapping é repontado ou some junto,
      // então aqui só não fazemos nada em vez de estourar
      p.ignorados++
      return
    }
    const mesclado = { ...((atual.customFields as any) || {}), ...cf }

    // Tracking e responsável só PREENCHEM lacunas, nunca sobrescrevem. Um lead
    // que veio do Meta Ads (ou que foi mesclado com um) tem atribuição melhor
    // que a do CRM — campanha, conjunto e anúncio — e não pode ser rebaixado
    // por um `CampaignSource: "Facebook"` genérico na próxima passada.
    const trackingSeguro: Record<string, string> = {}
    for (const [k, v] of Object.entries(tracking)) {
      if (!(atual as any)[k]) trackingSeguro[k] = v
    }

    await prisma.lead.update({
      where: { id: existente.localId },
      data: {
        nome,
        ...(whatsapp ? { whatsapp, phoneKey: phoneKey(whatsapp) } : {}),
        ...(email ? { email } : {}),
        ...(cidade ? { cidade } : {}),
        customFields: mesclado as any,
        ...trackingSeguro,
        ...lgpd,
        // não rouba o lead de quem já o assumiu no bychat
        ...(responsavelId && !atual.assignedUserId ? { assignedUserId: responsavelId } : {}),
      },
    })
    await prisma.crmEduMapping.update({
      where: { entityType_crmId: { entityType: 'lead', crmId: l.Id } },
      data: { localId: existente.localId, meta: { dataModificacao: modificadoEm } as any, syncedAt: new Date() },
    })
    p.atualizados++
    return
  }

  // Antes de criar: esta pessoa já pode estar no bychat, vinda do Meta Ads.
  // Nesse caso VINCULAMOS (mapping + enriquecimento) em vez de duplicar.
  const jaExiste = await encontrarLeadExistente(whatsapp, email)
  if (jaExiste) {
    const atual = await prisma.lead.findUnique({
      where: { id: jaExiste },
      select: { customFields: true, cidade: true, assignedUserId: true, utmSource: true, campaignName: true },
    })
    const mesclado = { ...((atual?.customFields as any) || {}), ...cf }
    const trackingSeguro: Record<string, string> = {}
    for (const [k, v] of Object.entries(tracking)) {
      if (!(atual as any)?.[k]) trackingSeguro[k] = v
    }
    await prisma.lead.update({
      where: { id: jaExiste },
      data: {
        customFields: mesclado as any,
        ...(cidade && !atual?.cidade ? { cidade } : {}),
        ...trackingSeguro,
        ...lgpd,
        ...(responsavelId && !atual?.assignedUserId ? { assignedUserId: responsavelId } : {}),
      },
    })
    await prisma.crmEduMapping.create({
      data: { entityType: 'lead', crmId: l.Id, localId: jaExiste, meta: { dataModificacao: modificadoEm, vinculadoA: 'lead_existente' } as any },
    })
    p.atualizados++
    return
  }

  // Lista de bloqueio — a carga do CRM Educacional é automática.
  const { rejectLeadEntry } = await import('./leadBlocklist.js')
  if (await rejectLeadEntry({ email, whatsapp }, 'CRM Educacional').catch(() => null)) {
    p.ignorados = (p.ignorados ?? 0) + 1
    return
  }

  const lead = await prisma.lead.create({
    data: {
      uid: await generateUid(),
      empresa: 'CRM Educacional',
      nome,
      whatsapp,
      ...(whatsapp ? { phoneKey: phoneKey(whatsapp) } : {}),
      email,
      ...(cidade ? { cidade } : {}),
      formData: { source: 'crmedu', crmEduId: l.Id, dataModificacao: modificadoEm } as any,
      scores: {},
      lastStep: 0,
      completed: false,
      status: 'NOVO',
      funnelId: opts.funnelId ?? undefined,
      teamId: opts.teamId ?? undefined,
      source: 'crmedu_import',
      sourceId: l.Id,
      ...(responsavelId ? { assignedUserId: responsavelId, assignedAt: criadoEm ?? new Date() } : {}),
      ...lgpd,
      ...tracking,
      customFields: Object.keys(cf).length > 0 ? (cf as any) : undefined,
      createdAt: criadoEm,
      // Lead vindo de CRM é lead real: já entra qualificado, senão a listagem e
      // o kanban (que filtram qualifiedAt != null) o escondem.
      qualifiedAt: criadoEm ?? new Date(),
      qualificationSource: 'crmedu_import',
    },
  })
  await prisma.crmEduMapping.create({
    data: { entityType: 'lead', crmId: l.Id, localId: lead.id, meta: { dataModificacao: modificadoEm } as any },
  })
  p.criados++
}
