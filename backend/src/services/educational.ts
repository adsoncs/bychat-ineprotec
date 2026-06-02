// src/services/educational.ts
// Módulo Educacional — feature flag + seed de dados MEC.
// Ativado via setting `educational.enabled`. Quando ligado pela primeira vez,
// popula Níveis de Ensino e Modalidades com valores padrão do MEC.

import { prisma } from '../lib/prisma.js'
import { setModuleEnabled, isModuleEnabled } from '../lib/moduleManager.js'

const SETTING_SEEDED_KEY = 'educational.seeded'
const MODULE_ID = 'educacional'

// Níveis de ensino padrão do MEC
export const DEFAULT_LEVELS = [
  { nome: 'Educação Infantil',   codigo: 'INFANTIL',   ordem: 1 },
  { nome: 'Ensino Fundamental',  codigo: 'FUNDAMENTAL', ordem: 2 },
  { nome: 'Ensino Médio',        codigo: 'MEDIO',      ordem: 3 },
  { nome: 'Ensino Técnico',      codigo: 'TECNICO',    ordem: 4 },
  { nome: 'Graduação',           codigo: 'GRADUACAO',  ordem: 5 },
  { nome: 'Pós-Graduação',       codigo: 'POS',        ordem: 6 },
  { nome: 'MBA',                 codigo: 'MBA',        ordem: 7 },
  { nome: 'Mestrado',            codigo: 'MESTRADO',   ordem: 8 },
  { nome: 'Doutorado',           codigo: 'DOUTORADO',  ordem: 9 },
  { nome: 'Extensão',            codigo: 'EXTENSAO',   ordem: 10 },
]

// Modalidades padrão (decreto 2005/2017 e port. 2.117/2019)
export const DEFAULT_MODALITIES = [
  { nome: 'Presencial',    codigo: 'PRESENCIAL',    ordem: 1 },
  { nome: 'EAD',           codigo: 'EAD',           ordem: 2 },
  { nome: 'Semipresencial', codigo: 'SEMIPRESENCIAL', ordem: 3 },
  { nome: 'Híbrido',       codigo: 'HIBRIDO',       ordem: 4 },
]

// Custom fields padrão para captação educacional
export const DEFAULT_CUSTOM_FIELDS = [
  { key: 'edu_cpf',                  label: 'CPF',                     type: 'text',     group: 'educacional', position: 1 },
  { key: 'edu_rg',                   label: 'RG',                      type: 'text',     group: 'educacional', position: 2 },
  { key: 'edu_data_nascimento',      label: 'Data de Nascimento',      type: 'date',     group: 'educacional', position: 3 },
  { key: 'edu_escola_anterior',      label: 'Escola Anterior',         type: 'text',     group: 'educacional', position: 4 },
  { key: 'edu_ano_formacao_em',      label: 'Ano de Formação (EM)',    type: 'number',   group: 'educacional', position: 5 },
  { key: 'edu_nota_enem',            label: 'Nota ENEM',               type: 'number',   group: 'educacional', position: 6 },
  { key: 'edu_renda_familiar',       label: 'Renda Familiar',          type: 'text',     group: 'educacional', position: 7 },
  { key: 'edu_responsavel_nome',     label: 'Nome do Responsável',     type: 'text',     group: 'educacional', position: 8 },
  { key: 'edu_responsavel_telefone', label: 'Telefone do Responsável', type: 'phone',    group: 'educacional', position: 9 },
  { key: 'edu_bolsista',             label: 'É Bolsista?',             type: 'checkbox', group: 'educacional', position: 10 },
  { key: 'edu_tipo_bolsa',           label: 'Tipo de Bolsa',           type: 'text',     group: 'educacional', position: 11 },
]

// Modos de ingresso padrão (Fase 1 — fundação de "Modos de Ingresso")
// evaluationType: none | docs | enem | exam_online | exam_presencial
// Os modos com exam_* ainda não têm evaluator implementado (fase futura),
// mas já são catalogados para UI e modelagem de dados.
export const DEFAULT_ENTRY_MODES = [
  {
    code: 'vestibular_online', name: 'Vestibular Online', icon: '💻', ordem: 1,
    description: 'Prova digital com correção automática de questões objetivas e redação. Implementação completa em fase futura.',
    evaluationType: 'exam_online', requiresClassification: true,
    defaultFormExtras: null,
  },
  {
    code: 'vestibular_presencial', name: 'Vestibular Presencial', icon: '🏫', ordem: 2,
    description: 'Prova física em local e data agendados. Nota inserida manualmente ou via import de CSV.',
    evaluationType: 'exam_presencial', requiresClassification: true,
    defaultFormExtras: null,
  },
  {
    code: 'enem', name: 'Nota do ENEM', icon: '📝', ordem: 3,
    description: 'Candidato envia boletim do ENEM; nota é extraída por IA e comparada com nota de corte da oferta.',
    evaluationType: 'enem', requiresClassification: true,
    defaultFormExtras: [
      { name: 'enemInscricao', label: 'Nº de inscrição do ENEM', type: 'text', required: true },
      { name: 'enemAno', label: 'Ano da prova', type: 'number', required: true },
      { name: 'enemTreineiro', label: 'Fez como treineiro?', type: 'checkbox', required: false },
    ],
  },
  {
    code: 'transferencia', name: 'Transferência', icon: '🔁', ordem: 4,
    description: 'Aluno de outra IES migrando para a instituição. Requer histórico escolar, comprovante de matrícula anterior e ementas.',
    evaluationType: 'docs', requiresClassification: false,
    defaultFormExtras: [
      { name: 'iesAnterior', label: 'IES de origem', type: 'text', required: true },
      { name: 'cursoAnterior', label: 'Curso de origem', type: 'text', required: true },
    ],
  },
  {
    code: 'segunda_graduacao', name: 'Segunda Graduação', icon: '🎓', ordem: 5,
    description: 'Portador de diploma de graduação iniciando segundo curso. Requer diploma e histórico do curso anterior.',
    evaluationType: 'docs', requiresClassification: false,
    defaultFormExtras: [
      { name: 'cursoAnteriorConcluido', label: 'Curso já concluído', type: 'text', required: true },
      { name: 'iesAnteriorConcluido', label: 'IES do curso concluído', type: 'text', required: true },
    ],
  },
  {
    code: 'pos_graduacao', name: 'Pós-Graduação', icon: '📚', ordem: 6,
    description: 'Lato ou stricto sensu. Requer diploma, histórico e CV. Pode incluir análise de projeto ou entrevista.',
    evaluationType: 'docs', requiresClassification: false,
    defaultFormExtras: [
      { name: 'graduacaoArea', label: 'Área de graduação', type: 'text', required: true },
    ],
  },
  {
    code: 'extensao', name: 'Curso de Extensão', icon: '✨', ordem: 7,
    description: 'Curso livre/extensão. Sem avaliação — aprovação automática após cadastro (e pagamento, se houver).',
    evaluationType: 'none', requiresClassification: false,
    defaultFormExtras: null,
  },
  {
    code: 'bolsa', name: 'Concurso de Bolsas', icon: '🏆', ordem: 8,
    description: 'Inscrição para bolsa de estudos (mérito ou renda). Requer documentação específica. Feature completa em fase futura.',
    evaluationType: 'docs', requiresClassification: true,
    defaultFormExtras: null,
  },
]

// Catálogo master de tipos de documento. aiAnalysisTemplate referencia um prompt
// no worker wf-document-review (F2) — null significa que o documento só é revisado
// por operador humano, sem análise automática por IA.
export const DEFAULT_DOCUMENT_TYPES = [
  { code: 'rg',                     name: 'RG',                          category: 'identity',  ordem: 1,  aiAnalysisTemplate: 'rg_cpf' },
  { code: 'cpf',                    name: 'CPF',                         category: 'identity',  ordem: 2,  aiAnalysisTemplate: 'rg_cpf' },
  { code: 'comprovante_residencia', name: 'Comprovante de Residência',   category: 'identity',  ordem: 3,  aiAnalysisTemplate: 'address_proof' },
  { code: 'foto_3x4',               name: 'Foto 3x4',                    category: 'identity',  ordem: 4,  aiAnalysisTemplate: null },
  { code: 'certidao_nascimento',    name: 'Certidão de Nascimento',      category: 'identity',  ordem: 5,  aiAnalysisTemplate: null },
  { code: 'historico_escolar',      name: 'Histórico Escolar',           category: 'academic',  ordem: 10, aiAnalysisTemplate: 'academic_history' },
  { code: 'diploma',                name: 'Diploma',                     category: 'academic',  ordem: 11, aiAnalysisTemplate: 'diploma' },
  { code: 'certificado_conclusao',  name: 'Certificado de Conclusão',    category: 'academic',  ordem: 12, aiAnalysisTemplate: 'diploma' },
  { code: 'ementa',                 name: 'Ementa das Disciplinas',      category: 'academic',  ordem: 13, aiAnalysisTemplate: null },
  { code: 'comprovante_matricula',  name: 'Comprovante de Matrícula',    category: 'academic',  ordem: 14, aiAnalysisTemplate: null },
  { code: 'cv',                     name: 'Currículo (CV)',              category: 'academic',  ordem: 15, aiAnalysisTemplate: null },
  { code: 'boletim_enem',           name: 'Boletim ENEM',                category: 'enem',      ordem: 20, aiAnalysisTemplate: 'enem_score' },
  { code: 'comprovante_renda',      name: 'Comprovante de Renda',        category: 'financial', ordem: 30, aiAnalysisTemplate: null },
]

// Matriz de documentos exigidos por modo. Cada entrada é
// { entryCode, docCode, required, ordem, helpText? }.
export const DEFAULT_ENTRY_MODE_DOC_REQS = [
  // Vestibular (online e presencial) — documentos básicos de identidade
  { entryCode: 'vestibular_online',      docCode: 'rg',  required: true, ordem: 1 },
  { entryCode: 'vestibular_online',      docCode: 'cpf', required: true, ordem: 2 },
  { entryCode: 'vestibular_online',      docCode: 'foto_3x4', required: false, ordem: 3 },
  { entryCode: 'vestibular_presencial',  docCode: 'rg',  required: true, ordem: 1 },
  { entryCode: 'vestibular_presencial',  docCode: 'cpf', required: true, ordem: 2 },
  { entryCode: 'vestibular_presencial',  docCode: 'foto_3x4', required: false, ordem: 3 },

  // ENEM — boletim + identidade
  { entryCode: 'enem', docCode: 'rg',           required: true, ordem: 1 },
  { entryCode: 'enem', docCode: 'cpf',          required: true, ordem: 2 },
  { entryCode: 'enem', docCode: 'boletim_enem', required: true, ordem: 3, helpText: 'Baixe o boletim oficial no site do INEP/gov.br. Será processado automaticamente.' },

  // Transferência — histórico + ementas + comprovante
  { entryCode: 'transferencia', docCode: 'rg',                    required: true, ordem: 1 },
  { entryCode: 'transferencia', docCode: 'cpf',                   required: true, ordem: 2 },
  { entryCode: 'transferencia', docCode: 'comprovante_residencia', required: false, ordem: 3 },
  { entryCode: 'transferencia', docCode: 'historico_escolar',     required: true, ordem: 10, helpText: 'Histórico completo do curso em andamento, assinado pela IES de origem.' },
  { entryCode: 'transferencia', docCode: 'comprovante_matricula', required: true, ordem: 11 },
  { entryCode: 'transferencia', docCode: 'ementa',                required: false, ordem: 12, helpText: 'Ementas das disciplinas cursadas para análise de aproveitamento.' },

  // Segunda Graduação — diploma + histórico
  { entryCode: 'segunda_graduacao', docCode: 'rg',               required: true, ordem: 1 },
  { entryCode: 'segunda_graduacao', docCode: 'cpf',              required: true, ordem: 2 },
  { entryCode: 'segunda_graduacao', docCode: 'diploma',          required: true, ordem: 10 },
  { entryCode: 'segunda_graduacao', docCode: 'historico_escolar', required: true, ordem: 11, helpText: 'Histórico final do curso concluído.' },

  // Pós-Graduação — diploma + histórico graduação + CV
  { entryCode: 'pos_graduacao', docCode: 'rg',               required: true, ordem: 1 },
  { entryCode: 'pos_graduacao', docCode: 'cpf',              required: true, ordem: 2 },
  { entryCode: 'pos_graduacao', docCode: 'diploma',          required: true, ordem: 10 },
  { entryCode: 'pos_graduacao', docCode: 'historico_escolar', required: true, ordem: 11 },
  { entryCode: 'pos_graduacao', docCode: 'cv',               required: true, ordem: 12, helpText: 'Currículo atualizado em PDF.' },

  // Extensão — sem documentos (aprovação automática)

  // Bolsa — identidade + comprovante de renda (expansão na fase de Bolsa)
  { entryCode: 'bolsa', docCode: 'rg',                    required: true, ordem: 1 },
  { entryCode: 'bolsa', docCode: 'cpf',                   required: true, ordem: 2 },
  { entryCode: 'bolsa', docCode: 'comprovante_residencia', required: true, ordem: 3 },
  { entryCode: 'bolsa', docCode: 'comprovante_renda',     required: true, ordem: 4, helpText: 'Últimos 3 meses de comprovantes de renda do candidato e do grupo familiar.' },
]

// Etapas padrão do funil de captação educacional.
// consumesSlot=true → lead nesta etapa ocupa vaga da CourseOffering. Inscrição
// não consome; só Pagou Taxa em diante. Desistente devolve a vaga (false).
export const DEFAULT_FUNNEL_STAGES = [
  { key: 'INTERESSADO',   name: 'Interessado',   color: '#9e9e9e', position: 1, consumesSlot: false },
  { key: 'VISITA',        name: 'Visitou',       color: '#03a9f4', position: 2, consumesSlot: false },
  { key: 'INSCRITO',      name: 'Inscrito',      color: '#1a73e8', position: 3, consumesSlot: false },
  { key: 'PAGOU_TAXA',    name: 'Pagou Taxa',    color: '#00bcd4', position: 4, consumesSlot: true  },
  { key: 'CLASSIFICADO',  name: 'Classificado',  color: '#8bc34a', position: 5, consumesSlot: true  },
  { key: 'CONVOCADO',     name: 'Convocado',     color: '#cddc39', position: 6, consumesSlot: true  },
  { key: 'MATRICULADO',   name: 'Matriculado',   color: '#137333', position: 7, consumesSlot: true  },
  { key: 'DESISTENTE',    name: 'Desistente',    color: '#c5221f', position: 8, consumesSlot: false },
]

// Wrappers em torno do moduleManager genérico — preservam a API pública.
export async function isEducationalEnabled(): Promise<boolean> {
  return isModuleEnabled(MODULE_ID)
}

export async function setEducationalEnabled(enabled: boolean): Promise<void> {
  await setModuleEnabled(MODULE_ID, enabled)
}

// Side effect REMOVIDO em 2026-04-25 (decisão de produto): ativar o módulo não
// pré-popula mais nada na UI (níveis, modalidades, custom fields, modos de
// ingresso, tipos de documento). O cliente cadastra cada item por demanda
// usando o CRUD da própria UI. As tabelas já existem via migrations Prisma —
// nada precisa ser criado em runtime para a feature funcionar.
//
// Quem precisar rodar o seed manualmente (instalação demo, ambiente dev):
// POST /api/admin/educacional/seed?force=1 ainda funciona via UI/curl.

export async function seedDefaults(force = false): Promise<{ seeded: boolean; counts: any }> {
  // Evita re-seed — marca em setting depois do primeiro sucesso
  if (!force) {
    const marker = await prisma.setting.findUnique({ where: { key: SETTING_SEEDED_KEY } })
    if (marker) return { seeded: false, counts: {} }
  }

  // Seed níveis (só adiciona os que não existem)
  let levelsCreated = 0
  for (const l of DEFAULT_LEVELS) {
    const exists = await prisma.educationalLevel.findUnique({ where: { codigo: l.codigo } }).catch(() => null)
    if (!exists) {
      await prisma.educationalLevel.create({ data: l })
      levelsCreated++
    }
  }

  // Seed modalidades
  let modalitiesCreated = 0
  for (const m of DEFAULT_MODALITIES) {
    const exists = await prisma.modality.findUnique({ where: { codigo: m.codigo } }).catch(() => null)
    if (!exists) {
      await prisma.modality.create({ data: m })
      modalitiesCreated++
    }
  }

  // Seed custom fields (ignora os que já existem pela key)
  let cfCreated = 0
  for (const cf of DEFAULT_CUSTOM_FIELDS) {
    const exists = await prisma.customField.findUnique({ where: { key: cf.key } }).catch(() => null)
    if (!exists) {
      try {
        await prisma.customField.create({
          data: {
            key: cf.key,
            label: cf.label,
            type: cf.type,
            group: cf.group,
            position: cf.position,
            active: true,
          },
        })
        cfCreated++
      } catch (err) {
        console.error('[educational] falha ao criar custom field', cf.key, err)
      }
    }
  }

  // Seed modos de ingresso + tipos de documento + requirements (F1 Modos de Ingresso)
  const entrySeed = await seedEntryModesAndDocuments()

  // Marca como seeded
  await prisma.setting.upsert({
    where: { key: SETTING_SEEDED_KEY },
    create: {
      key: SETTING_SEEDED_KEY,
      value: new Date().toISOString(),
      label: 'Data do seed inicial educacional',
      grp: 'educational',
      fieldType: 'text',
    },
    update: { value: new Date().toISOString() },
  })

  return {
    seeded: true,
    counts: {
      levels: levelsCreated,
      modalities: modalitiesCreated,
      customFields: cfCreated,
      entryModes: entrySeed.entryModesCreated,
      documentTypes: entrySeed.documentTypesCreated,
      entryModeDocReqs: entrySeed.requirementsCreated,
    },
  }
}

// Heurística para inferir qual EntryMode aplicar a SelectionProcess existentes
// que não tinham modo antes da feature. Usada só no backfill 1x.
// Ordem importa: regras mais específicas primeiro.
export function inferEntryModeCode(nome: string, descricao?: string | null): string {
  const text = `${nome} ${descricao || ''}`.toLowerCase()
  const has = (...needles: string[]) => needles.some(n => text.includes(n))

  if (has('enem', 'sisu', 'prouni')) return 'enem'
  if (has('transferência', 'transferencia', 'transfer')) return 'transferencia'
  if (has('segunda graduação', 'segunda graduacao', '2ª graduação', '2a graduacao', 'portador de diploma', 'portadordediploma')) return 'segunda_graduacao'
  if (has('pós-graduação', 'pos-graduacao', 'pós graduação', 'pos graduacao', 'pós-grad', 'mba', 'mestrado', 'doutorado', 'especialização', 'especializacao')) return 'pos_graduacao'
  if (has('extensão', 'extensao', 'curso livre', 'curso de extensão')) return 'extensao'
  if (has('bolsa', 'concurso de bolsa')) return 'bolsa'
  if (has('online', 'digital', 'agendado', 'eletrônico', 'eletronico')) return 'vestibular_online'
  // default: vestibular presencial é o formato tradicional mais comum em IES
  return 'vestibular_presencial'
}

// Atribui um EntryMode aos SelectionProcess que ainda estão com entryModeId=null.
// Idempotente: só toca processos sem modo atribuído. Retorna lista de mudanças.
export async function backfillSelectionProcessEntryModes(): Promise<{ updated: number; changes: Array<{ id: number; nome: string; code: string }> }> {
  const pending = await prisma.selectionProcess.findMany({
    where: { entryModeId: null },
    select: { id: true, nome: true, descricao: true },
  })
  if (pending.length === 0) return { updated: 0, changes: [] }

  const modes = await prisma.entryMode.findMany({ select: { id: true, code: true } })
  const byCode = new Map(modes.map(m => [m.code, m.id]))

  const changes: Array<{ id: number; nome: string; code: string }> = []
  for (const p of pending) {
    const code = inferEntryModeCode(p.nome, p.descricao)
    const modeId = byCode.get(code)
    if (!modeId) continue
    await prisma.selectionProcess.update({
      where: { id: p.id },
      data: { entryModeId: modeId },
    })
    changes.push({ id: p.id, nome: p.nome, code })
  }
  return { updated: changes.length, changes }
}

// Seed idempotente dos catálogos de Modo de Ingresso + Tipo de Documento + matriz
// de requisitos. Pode ser executado múltiplas vezes — só cria o que falta.
// Exposto separadamente para permitir re-seed forçado sem rodar seedDefaults inteiro.
export async function seedEntryModesAndDocuments(): Promise<{ entryModesCreated: number; documentTypesCreated: number; requirementsCreated: number }> {
  let entryModesCreated = 0
  let documentTypesCreated = 0
  let requirementsCreated = 0

  // Entry Modes
  for (const m of DEFAULT_ENTRY_MODES) {
    const exists = await prisma.entryMode.findUnique({ where: { code: m.code } }).catch(() => null)
    if (!exists) {
      await prisma.entryMode.create({ data: m as any })
      entryModesCreated++
    }
  }

  // Document Types
  for (const d of DEFAULT_DOCUMENT_TYPES) {
    const exists = await prisma.documentType.findUnique({ where: { code: d.code } }).catch(() => null)
    if (!exists) {
      await prisma.documentType.create({ data: d })
      documentTypesCreated++
    }
  }

  // Requirements (precisa resolver FK ids dos codes)
  const modeByCode = new Map<string, number>()
  const docByCode = new Map<string, number>()
  for (const em of await prisma.entryMode.findMany({ select: { id: true, code: true } })) modeByCode.set(em.code, em.id)
  for (const dt of await prisma.documentType.findMany({ select: { id: true, code: true } })) docByCode.set(dt.code, dt.id)

  for (const req of DEFAULT_ENTRY_MODE_DOC_REQS) {
    const entryModeId = modeByCode.get(req.entryCode)
    const documentTypeId = docByCode.get(req.docCode)
    if (!entryModeId || !documentTypeId) continue

    const exists = await prisma.entryModeDocumentRequirement
      .findUnique({ where: { entryModeId_documentTypeId: { entryModeId, documentTypeId } } })
      .catch(() => null)
    if (!exists) {
      await prisma.entryModeDocumentRequirement.create({
        data: {
          entryModeId,
          documentTypeId,
          required: req.required,
          ordem: req.ordem,
          helpText: (req as any).helpText ?? null,
        },
      })
      requirementsCreated++
    }
  }

  return { entryModesCreated, documentTypesCreated, requirementsCreated }
}

// (Antigo `requireEducationalEnabled` foi removido — gateamento agora é feito
// pelo modulePermissionHook global + sincronização em setEducationalEnabled.)

// Cria o funil "Captação Educacional" com as etapas padrão (idempotente).
// Se o funil já existe, restaura quaisquer etapas padrão que tenham sido removidas
// — assim re-rodar o seed após admin apagar uma etapa devolve o funil para o estado completo.
// Retorna { created, restoredStages } onde restoredStages = etapas re-criadas.
export async function seedEducationalFunnel(): Promise<{ created: boolean; funnel: any; restoredStages: number }> {
  const existing = await prisma.funnel.findFirst({
    where: { name: 'Captação Educacional' },
    include: { stages: true },
  })

  if (existing) {
    const existingKeys = new Set(existing.stages.map(s => s.key))
    const missing = DEFAULT_FUNNEL_STAGES.filter(s => !existingKeys.has(s.key))
    if (missing.length === 0) {
      return { created: false, funnel: existing, restoredStages: 0 }
    }
    await prisma.stage.createMany({
      data: missing.map(s => ({
        funnelId: existing.id,
        key: s.key,
        name: s.name,
        color: s.color,
        position: s.position,
        active: true,
        consumesSlot: s.consumesSlot,
      })),
    })
    const refreshed = await prisma.funnel.findUnique({
      where: { id: existing.id },
      include: { stages: true },
    })
    return { created: false, funnel: refreshed, restoredStages: missing.length }
  }

  const funnel = await prisma.funnel.create({
    data: {
      name: 'Captação Educacional',
      description: 'Funil pré-configurado para instituições de ensino. Criado automaticamente ao ativar o módulo Educacional.',
      isDefault: false,
      active: true,
      stages: {
        create: DEFAULT_FUNNEL_STAGES.map(s => ({
          key: s.key,
          name: s.name,
          color: s.color,
          position: s.position,
          active: true,
          consumesSlot: s.consumesSlot,
        })),
      },
    },
    include: { stages: true },
  })
  return { created: true, funnel, restoredStages: 0 }
}
