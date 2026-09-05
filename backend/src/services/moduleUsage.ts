// src/services/moduleUsage.ts
// Calcula o "uso real" de cada módulo (registros vivos no banco). Usado pela
// UI de Configurações → Módulos para decidir se ao desativar exige confirmação
// type-to-confirm. Tudo paralelo, conta barato (índices existem).

import { prisma } from '../lib/prisma.js'

// Cada item do array vira uma linha tipo "X cursos" no resumo da UI.
// total = soma dos counts (decide se mostra modal type-to-confirm).
export interface ModuleUsage {
  total: number
  items: Array<{ label: string; count: number }>
}

const SINCE_30D = () => {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d
}

async function safeCount<T>(p: Promise<T>): Promise<number> {
  try { return (await p) as any as number } catch { return 0 }
}

function pack(items: Array<{ label: string; count: number }>): ModuleUsage {
  const filtered = items.filter(i => i.count > 0)
  const total = filtered.reduce((a, b) => a + b.count, 0)
  return { total, items: filtered }
}

export async function getModuleUsage(moduleId: string): Promise<ModuleUsage> {
  switch (moduleId) {
    case 'educacional': {
      const [courses, offerings, processes, modes, units, campuses, levels] = await Promise.all([
        safeCount(prisma.course.count() as any),
        safeCount(prisma.courseOffering.count() as any),
        safeCount(prisma.selectionProcess.count() as any),
        safeCount(prisma.entryMode.count() as any),
        safeCount(prisma.educationalUnit.count() as any),
        safeCount(prisma.campus.count() as any),
        safeCount(prisma.educationalLevel.count() as any),
      ])
      return pack([
        { label: 'cursos', count: courses },
        { label: 'ofertas', count: offerings },
        { label: 'processos seletivos', count: processes },
        { label: 'modos de ingresso', count: modes },
        { label: 'unidades', count: units },
        { label: 'campus / locais', count: campuses },
        { label: 'níveis de ensino', count: levels },
      ])
    }

    case 'enrollment_portals': {
      const [portals, registrations, recentRegs] = await Promise.all([
        safeCount(prisma.enrollmentPortal.count({ where: { active: true } }) as any),
        safeCount(prisma.enrollmentRegistration.count() as any),
        safeCount(prisma.enrollmentRegistration.count({ where: { createdAt: { gte: SINCE_30D() } } }) as any),
      ])
      return pack([
        { label: 'portais ativos', count: portals },
        { label: 'inscrições (total)', count: registrations },
        { label: 'inscrições nos últimos 30 dias', count: recentRegs },
      ])
    }

    case 'workflows': {
      const [active, runs] = await Promise.all([
        safeCount(prisma.workflow.count({ where: { active: true } }) as any),
        safeCount(prisma.workflowExecution.count({ where: { createdAt: { gte: SINCE_30D() } } }) as any),
      ])
      return pack([
        { label: 'workflows ativos', count: active },
        { label: 'execuções nos últimos 30 dias', count: runs },
      ])
    }

    case 'captacao': {
      // Chatbots, formulários e landing pages viraram módulos próprios e têm
      // contagem própria logo abaixo. Aqui fica o que sobrou: a entrada por
      // integração e os modelos.
      const [webhooks, templates] = await Promise.all([
        safeCount(prisma.inboundWebhook.count() as any),
        safeCount(prisma.messageTemplate.count({ where: { active: true } }) as any),
      ])
      return pack([
        { label: 'webhooks de entrada', count: webhooks },
        { label: 'templates ativos', count: templates },
      ])
    }

    case 'chatbots': {
      const [total, ativos] = await Promise.all([
        safeCount(prisma.chatbot.count() as any),
        safeCount(prisma.chatbot.count({ where: { active: true } }) as any),
      ])
      return pack([
        { label: 'chatbots', count: total },
        { label: 'chatbots ativos', count: ativos },
      ])
    }

    case 'forms': {
      // A contagem de chatbots vinculados NÃO é decoração: desligar
      // Formulários derruba o chatbot em modo script, que lê os campos do form
      // para saber o que perguntar. É a informação que falta na hora de
      // decidir, e é aqui que ela aparece — no type-to-confirm da desativação.
      const [ativos, comChatbot, envios] = await Promise.all([
        safeCount(prisma.form.count({ where: { active: true } }) as any),
        safeCount(prisma.chatbot.count({ where: { formId: { not: null } } }) as any),
        safeCount(prisma.formSubmission.count() as any),
      ])
      return pack([
        { label: 'formulários ativos', count: ativos },
        { label: 'chatbots que dependem de um formulário', count: comChatbot },
        { label: 'respostas recebidas', count: envios },
      ])
    }

    case 'landing_pages': {
      const [publicadas, total] = await Promise.all([
        safeCount(prisma.landingPage.count({ where: { status: 'PUBLISHED' } }) as any),
        safeCount(prisma.landingPage.count() as any),
      ])
      return pack([
        { label: 'landing pages publicadas', count: publicadas },
        { label: 'landing pages no total', count: total },
      ])
    }

    case 'atendimento': {
      const [openTickets, recentMsgs] = await Promise.all([
        safeCount(prisma.lead.count({ where: { conversationOpenedAt: { not: null }, conversationClosedAt: null } }) as any),
        safeCount(prisma.message.count({ where: { timestamp: { gte: SINCE_30D() } } }) as any),
      ])
      return pack([
        { label: 'atendimentos abertos', count: openTickets },
        { label: 'mensagens nos últimos 30 dias', count: recentMsgs },
      ])
    }

    case 'leads': {
      const [qualified, unqualified] = await Promise.all([
        safeCount(prisma.lead.count({ where: { qualifiedAt: { not: null } } }) as any),
        safeCount(prisma.lead.count({ where: { qualifiedAt: null } }) as any),
      ])
      return pack([
        { label: 'leads qualificados', count: qualified },
        { label: 'conversas (não qualificados)', count: unqualified },
      ])
    }

    case 'kanban':
    case 'funnels': {
      const [funnels, stages] = await Promise.all([
        safeCount(prisma.funnel.count({ where: { active: true } }) as any),
        safeCount(prisma.stage.count({ where: { active: true } }) as any),
      ])
      return pack([
        { label: 'funis ativos', count: funnels },
        { label: 'etapas configuradas', count: stages },
      ])
    }

    case 'activities': {
      const [pending, recent] = await Promise.all([
        safeCount(prisma.activity.count({ where: { status: 'pending' } }) as any),
        safeCount(prisma.activity.count({ where: { createdAt: { gte: SINCE_30D() } } }) as any),
      ])
      return pack([
        { label: 'atividades pendentes', count: pending },
        { label: 'atividades nos últimos 30 dias', count: recent },
      ])
    }

    case 'tags': {
      const [tags, links] = await Promise.all([
        safeCount(prisma.tag.count({ where: { active: true } }) as any),
        safeCount(prisma.leadTag.count() as any),
      ])
      return pack([
        { label: 'tags ativas', count: tags },
        { label: 'leads com tag aplicada', count: links },
      ])
    }

    case 'marketing': {
      const [metaForms, links] = await Promise.all([
        safeCount(prisma.metaForm.count({ where: { status: 'active' } }) as any),
        safeCount((prisma as any).trackableLink?.count?.({ where: { active: true } }) ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'formulários Meta ativos', count: metaForms },
        { label: 'links rastreáveis ativos', count: links },
      ])
    }

    case 'vendas': {
      const [sales] = await Promise.all([
        safeCount(prisma.detectedSale.count() as any),
      ])
      return pack([
        { label: 'vendas registradas', count: sales },
      ])
    }

    case 'intelligence': {
      const [enrichments] = await Promise.all([
        safeCount(prisma.leadEnrichment.count() as any),
      ])
      return pack([
        { label: 'enriquecimentos rodados', count: enrichments },
      ])
    }

    case 'whatsapp': {
      const [instances] = await Promise.all([
        safeCount((prisma as any).whatsappInstance?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'instâncias configuradas', count: instances },
      ])
    }

    case 'google': {
      // A conta Google sustenta as outras integrações: desligar aqui derruba
      // Calendar, Gmail, Sheets, Drive, Tasks e Analytics de uma vez. Por isso
      // as integrações vinculadas entram na contagem — é o que a pessoa precisa
      // saber antes de confirmar, e não depois.
      const [conns, calendars, sheets] = await Promise.all([
        safeCount((prisma as any).googleConnection?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).googleCalendarIntegration?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).googleSheetIntegration?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'conexões OAuth configuradas', count: conns },
        { label: 'agendas vinculadas (param de sincronizar)', count: calendars },
        { label: 'planilhas vinculadas (param de sincronizar)', count: sheets },
      ])
    }

    case 'google_calendar': {
      const [integr] = await Promise.all([
        safeCount((prisma as any).googleCalendarIntegration?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([{ label: 'agendas vinculadas', count: integr }])
    }

    case 'google_data': {
      const [sheets, logs] = await Promise.all([
        safeCount((prisma as any).googleSheetIntegration?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).googleSheetLog?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'planilhas vinculadas', count: sheets },
        { label: 'sincronizações registradas', count: logs },
      ])
    }

    case 'teams': {
      const [teams, members] = await Promise.all([
        safeCount(prisma.team.count({ where: { active: true } }) as any),
        safeCount(prisma.teamMember.count() as any),
      ])
      return pack([
        { label: 'equipes ativas', count: teams },
        { label: 'membros vinculados', count: members },
      ])
    }

    case 'users': {
      const [users] = await Promise.all([
        safeCount(prisma.user.count({ where: { active: true } }) as any),
      ])
      return pack([
        { label: 'usuários ativos', count: users },
      ])
    }

    case 'tools': {
      const [utms, personas] = await Promise.all([
        safeCount(prisma.utmLink.count({ where: { archived: false } }) as any),
        safeCount(prisma.persona.count({ where: { active: true } }) as any),
      ])
      return pack([
        { label: 'UTMs salvas', count: utms },
        { label: 'personas/ICPs', count: personas },
      ])
    }

    case 'aca_estrutura': {
      const [disciplinas, turmas, matrizes] = await Promise.all([
        safeCount((prisma as any).acaDisciplina?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaTurma?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaMatriz?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'disciplinas', count: disciplinas },
        { label: 'turmas', count: turmas },
        { label: 'matrizes curriculares', count: matrizes },
      ])
    }

    case 'aca_matriculas': {
      const [alunos, matriculas] = await Promise.all([
        safeCount((prisma as any).aluno?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaMatricula?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'alunos', count: alunos },
        { label: 'matrículas', count: matriculas },
      ])
    }

    case 'aca_financeiro': {
      const [parcelas, acordos, nfse] = await Promise.all([
        safeCount((prisma as any).acaParcela?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaAcordo?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaNotaFiscal?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'parcelas', count: parcelas },
        { label: 'acordos/renegociações', count: acordos },
        { label: 'notas fiscais', count: nfse },
      ])
    }

    case 'aca_pedagogico': {
      const [diarios, resultados] = await Promise.all([
        safeCount((prisma as any).acaDiario?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaResultado?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'diários de classe', count: diarios },
        { label: 'resultados/fechamentos', count: resultados },
      ])
    }

    case 'aca_secretaria': {
      const [documentos, requerimentos, estagios] = await Promise.all([
        safeCount((prisma as any).acaDocumento?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaRequerimento?.count?.() ?? Promise.resolve(0)),
        safeCount((prisma as any).acaEstagio?.count?.() ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'documentos emitidos', count: documentos },
        { label: 'requerimentos', count: requerimentos },
        { label: 'estágios', count: estagios },
      ])
    }

    case 'aca_comunicacao': {
      const [recent] = await Promise.all([
        safeCount((prisma as any).acaComunicacao?.count?.({ where: { createdAt: { gte: SINCE_30D() } } }) ?? Promise.resolve(0)),
      ])
      return pack([
        { label: 'comunicações nos últimos 30 dias', count: recent },
      ])
    }

    default:
      return { total: 0, items: [] }
  }
}

// Helper paralelo para listar usage de TODOS os módulos de uma vez.
export async function getAllModuleUsage(moduleIds: string[]): Promise<Record<string, ModuleUsage>> {
  const entries = await Promise.all(
    moduleIds.map(async id => [id, await getModuleUsage(id)] as const),
  )
  return Object.fromEntries(entries)
}
