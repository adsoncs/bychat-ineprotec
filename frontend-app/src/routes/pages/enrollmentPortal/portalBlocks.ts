import type {
  EnrollmentPortal,
  PortalField,
  PortalFieldType,
  PortalFormConfig,
  PortalStep,
} from '@/hooks/useEnrollmentPortals'
import type { EntryMode, SelectionProcess } from '@/hooks/useEducational'

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de bloco — uma camada semântica sobre PortalFormConfig.steps[]
// Cada bloco vira (ou não) um step do formConfig ao salvar.

export type BlockKey = 'identity' | 'coursePicker' | 'entryModes' | 'documents' | 'payment' | 'completion' | 'customStep'

export type CoursePickerMode = 'list' | 'quiz' | 'fixed'
export type CompletionBehavior = 'message' | 'redirect'

export interface ModeCustomField {
  type: PortalFieldType
  name: string
  label: string
  required?: boolean
}

export interface PerModeConfig { enabled: boolean; customFields: ModeCustomField[] }

export interface IdentityConfig { askBirthdate?: boolean; askAddress?: boolean }
export interface CoursePickerConfig { mode?: CoursePickerMode; fixedOfferingId?: number | null; quizHelperEnabled?: boolean }
export interface EntryModesConfig { perMode?: Record<string, PerModeConfig> }
export interface PaymentConfig { deadlineHours?: number | null }
export interface CompletionConfig { behavior?: CompletionBehavior; message?: string; target?: string }
export interface CustomStepConfig { name?: string; fields?: PortalField[] }

export type BlockConfig =
  | IdentityConfig
  | CoursePickerConfig
  | EntryModesConfig
  | PaymentConfig
  | CompletionConfig
  | CustomStepConfig
  | Record<string, never>

export interface FormBlock {
  key: BlockKey
  enabled: boolean
  config: BlockConfig
  /** Para roundtrip de customStep — preserva o step original. */
  _raw?: PortalStep
}

// ─────────────────────────────────────────────────────────────────────────────
// Definições estáticas

export interface BlockDef {
  key: BlockKey
  label: string
  icon: string
  description: string
  required?: boolean
  /** informativo = não vira step do formConfig (round-trip via _informativeBlocks). */
  informative?: boolean
}

export const BLOCK_DEFS: Record<BlockKey, BlockDef> = {
  identity: {
    key: 'identity',
    icon: '👤',
    label: 'Dados pessoais',
    description: 'Nome completo, e-mail, WhatsApp e CPF do candidato',
    required: true,
  },
  coursePicker: {
    key: 'coursePicker',
    icon: '📚',
    label: 'Escolha do curso',
    description: 'Como o candidato vai escolher a oferta de curso',
    required: true,
  },
  entryModes: {
    key: 'entryModes',
    icon: '🎓',
    label: 'Modos de ingresso',
    description: 'Campos extras pedidos para cada modo (ENEM, Transferência, etc.). Aparecem só para quem escolher curso desse modo',
  },
  documents: {
    key: 'documents',
    icon: '📄',
    label: 'Documentos',
    description: 'Ativa upload de documentos. A lista exata vem do modo de ingresso de cada processo seletivo',
    informative: true,
  },
  payment: {
    key: 'payment',
    icon: '💳',
    label: 'Taxa de inscrição',
    description: 'Cobrar taxa? A conexão de pagamento é configurada na aba Configurações',
    informative: true,
  },
  completion: {
    key: 'completion',
    icon: '✉',
    label: 'Mensagem final',
    description: 'O que o candidato vê depois de enviar a inscrição',
    required: true,
    informative: true,
  },
  customStep: {
    key: 'customStep',
    icon: '➕',
    label: 'Etapa custom',
    description: 'Etapa extra com campos livres',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates pré-definidos

export interface TemplateDef {
  key: 'simples' | 'padrao' | 'completo'
  label: string
  description: string
  blocks: FormBlock[]
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'simples',
    label: '🟢 Simples',
    description: 'Apenas o essencial: dados do candidato + curso desejado',
    blocks: [
      { key: 'identity',     enabled: true,  config: {} },
      { key: 'coursePicker', enabled: true,  config: { mode: 'list' } },
      { key: 'entryModes',   enabled: true,  config: { perMode: {} } },
      { key: 'completion',   enabled: true,  config: {} },
    ],
  },
  {
    key: 'padrao',
    label: '🔵 Padrão',
    description: 'Inclui upload de documentos e mensagem final personalizada',
    blocks: [
      { key: 'identity',     enabled: true,  config: { askBirthdate: true } },
      { key: 'coursePicker', enabled: true,  config: { mode: 'list' } },
      { key: 'entryModes',   enabled: true,  config: { perMode: {} } },
      { key: 'documents',    enabled: true,  config: {} },
      { key: 'completion',   enabled: true,  config: {} },
    ],
  },
  {
    key: 'completo',
    label: '🟣 Completo',
    description: 'Padrão + cobrança de taxa de inscrição',
    blocks: [
      { key: 'identity',     enabled: true,  config: { askBirthdate: true, askAddress: true } },
      { key: 'coursePicker', enabled: true,  config: { mode: 'list' } },
      { key: 'entryModes',   enabled: true,  config: { perMode: {} } },
      { key: 'documents',    enabled: true,  config: {} },
      { key: 'payment',      enabled: true,  config: { deadlineHours: 48 } },
      { key: 'completion',   enabled: true,  config: {} },
    ],
  },
]

const BLOCK_ORDER: BlockKey[] = ['identity', 'coursePicker', 'entryModes', 'documents', 'payment', 'customStep', 'completion']

export function defaultBlocks(): FormBlock[] {
  return [
    { key: 'identity',     enabled: true,  config: {} },
    { key: 'coursePicker', enabled: true,  config: { mode: 'list' } },
    { key: 'entryModes',   enabled: true,  config: { perMode: {} } },
    { key: 'documents',    enabled: false, config: {} },
    { key: 'payment',      enabled: false, config: { deadlineHours: 48 } },
    { key: 'completion',   enabled: true,  config: {} },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Modos detectados a partir dos SPs selecionados

/** Resolve modos únicos cobertos pelos SPs selecionados, casando com a lista completa de EntryMode (que contém defaultFormExtras). */
export function modesFromSelectedSps(processes: SelectionProcess[], portalSpIds: number[], allModes: EntryMode[]): EntryMode[] {
  const sps = processes.filter((s) => portalSpIds.includes(s.id))
  const codes = new Set<string>()
  for (const s of sps) {
    if (s.entryMode?.code) codes.add(s.entryMode.code)
  }
  return allModes.filter((m) => codes.has(m.code))
}

/** Conta SPs selecionados que usam um modo específico (por code). */
export function countSpsUsingMode(
  processes: { id: number; entryMode?: { code: string } | null }[],
  portalSpIds: number[],
  modeCode: string,
): number {
  return processes.filter((s) => portalSpIds.includes(s.id) && s.entryMode?.code === modeCode).length
}

interface FormExtraField {
  type?: string
  name?: string
  label?: string
  required?: boolean
}

export function readFormExtras(raw: unknown): FormExtraField[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').map((x) => {
    const out: FormExtraField = {}
    if (typeof x.type === 'string') out.type = x.type
    if (typeof x.name === 'string') out.name = x.name
    if (typeof x.label === 'string') out.label = x.label
    if (typeof x.required === 'boolean') out.required = x.required
    return out
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip blocks ↔ formConfig

interface InformativeBlocksMap {
  documents?: { enabled: boolean; config: BlockConfig }
  payment?: { enabled: boolean; config: BlockConfig }
  completion?: { enabled: boolean; config: BlockConfig }
}

interface FormConfigWithMeta extends PortalFormConfig {
  _informativeBlocks?: InformativeBlocksMap
}

/** Compila blocks → formConfig (steps + flag _informativeBlocks). */
export function formConfigFromBlocks(blocks: FormBlock[], modes: EntryMode[]): FormConfigWithMeta {
  const steps: PortalStep[] = []
  let stepIdx = 1
  const id = () => `step-${stepIdx++}`

  for (const b of blocks) {
    if (!b.enabled) continue
    const def = BLOCK_DEFS[b.key]
    if (def.informative) continue

    if (b.key === 'identity') {
      const cfg = b.config as IdentityConfig
      const fields: PortalField[] = [
        { type: 'text',  name: 'nome',     label: 'Nome completo', required: true },
        { type: 'email', name: 'email',    label: 'E-mail',        required: true },
        { type: 'phone', name: 'whatsapp', label: 'WhatsApp',      required: true },
        { type: 'cpf',   name: 'cpf',      label: 'CPF',           required: true },
      ]
      if (cfg.askBirthdate) fields.push({ type: 'date', name: 'nascimento', label: 'Data de nascimento', required: false })
      if (cfg.askAddress) {
        fields.push({ type: 'cep',  name: 'cep',      label: 'CEP',      required: true })
        fields.push({ type: 'text', name: 'endereco', label: 'Endereço', required: true })
      }
      steps.push({ id: id(), name: 'Dados pessoais', fields })
    } else if (b.key === 'coursePicker') {
      const cfg = b.config as CoursePickerConfig
      const field: PortalField & { config?: CoursePickerConfig } = {
        type: 'offering-picker',
        name: 'offeringId',
        label: 'Escolha o curso',
        required: true,
        config: {
          mode: cfg.mode ?? 'list',
          fixedOfferingId: cfg.fixedOfferingId ?? null,
          quizHelperEnabled: !!cfg.quizHelperEnabled,
        },
      }
      steps.push({ id: id(), name: 'Curso desejado', fields: [field] })
    } else if (b.key === 'entryModes') {
      const cfg = b.config as EntryModesConfig
      const perMode = cfg.perMode ?? {}
      for (const m of modes) {
        const mc = perMode[m.code] ?? { enabled: true, customFields: [] }
        if (mc.enabled === false) continue
        const extras = readFormExtras(m.defaultFormExtras)
        const customFields = mc.customFields ?? []
        const all: FormExtraField[] = [...extras, ...customFields]
        if (all.length === 0) continue
        const fields: PortalField[] = all.map((f) => ({
          type: (f.type ?? 'text') as PortalFieldType,
          name: f.name ?? '',
          label: f.label ?? f.name ?? '',
          required: f.required !== false,
          visibleWhen: { entryMode: [m.code] },
        }))
        steps.push({ id: id(), name: `Dados ${m.name}`, fields })
      }
    } else if (b.key === 'customStep') {
      const cfg = b.config as CustomStepConfig
      const raw = b._raw ?? { id: id(), name: cfg.name ?? 'Etapa', fields: cfg.fields ?? [] }
      steps.push({ id: id(), name: raw.name || 'Etapa', fields: raw.fields ?? [] })
    }
  }

  const informative: InformativeBlocksMap = {}
  for (const b of blocks) {
    const def = BLOCK_DEFS[b.key]
    if (!def.informative) continue
    informative[b.key as 'documents' | 'payment' | 'completion'] = {
      enabled: !!b.enabled,
      config: JSON.parse(JSON.stringify(b.config)) as BlockConfig,
    }
  }

  return { steps, _informativeBlocks: informative }
}

/** Decifra formConfig → blocks. Heurística baseada em nomes de campo. */
export function blocksFromFormConfig(formConfig: FormConfigWithMeta | null, portal: EnrollmentPortal | null): FormBlock[] {
  const steps = formConfig?.steps ?? []
  const informative = formConfig?._informativeBlocks ?? {}
  const out: FormBlock[] = []
  let identityFound = false
  let coursePickerFound = false
  const perMode: Record<string, PerModeConfig> = {}
  let entryModesFound = false

  for (const step of steps) {
    const fields = step.fields ?? []
    const names = fields.map((f) => (f.name ?? '').toLowerCase())
    const types = fields.map((f) => f.type)

    // identity: nome + email + cpf
    if (!identityFound && ['nome', 'email', 'cpf'].every((k) => names.includes(k))) {
      const cfg: IdentityConfig = {}
      if (names.includes('nascimento') || names.includes('birthdate') || names.includes('data_nascimento')) cfg.askBirthdate = true
      if (names.includes('cep') || names.includes('endereco')) cfg.askAddress = true
      out.push({ key: 'identity', enabled: true, config: cfg })
      identityFound = true
      continue
    }

    // coursePicker: type offering-picker
    if (!coursePickerFound && types.includes('offering-picker')) {
      const picker = fields.find((f) => f.type === 'offering-picker') as (PortalField & { config?: CoursePickerConfig }) | undefined
      out.push({
        key: 'coursePicker',
        enabled: true,
        config: {
          mode: picker?.config?.mode ?? 'list',
          fixedOfferingId: picker?.config?.fixedOfferingId ?? null,
          quizHelperEnabled: !!picker?.config?.quizHelperEnabled,
        },
      })
      coursePickerFound = true
      continue
    }

    // entryModes: step inteiro com fields que têm visibleWhen.entryMode
    const stepModeCodes = [...new Set(
      fields.flatMap((f) => (Array.isArray(f.visibleWhen?.entryMode) ? f.visibleWhen.entryMode : [])),
    )]
    if (
      stepModeCodes.length > 0 &&
      fields.every((f) => Array.isArray(f.visibleWhen?.entryMode) && f.visibleWhen.entryMode.length > 0)
    ) {
      entryModesFound = true
      for (const code of stepModeCodes) {
        perMode[code] ??= { enabled: true, customFields: [] }
      }
      continue
    }

    // step custom — preserva raw para round-trip
    out.push({
      key: 'customStep',
      enabled: true,
      config: { name: step.name, fields: JSON.parse(JSON.stringify(fields)) as PortalField[] },
      _raw: JSON.parse(JSON.stringify(step)) as PortalStep,
    })
  }

  // Garante presença dos defaults para o toggle aparecer mesmo desligado
  if (!identityFound)     out.unshift({ key: 'identity',     enabled: true, config: {} })
  if (!coursePickerFound) out.push   ({ key: 'coursePicker', enabled: true, config: { mode: 'list' } })
  if (!out.find((b) => b.key === 'entryModes')) out.push({ key: 'entryModes', enabled: entryModesFound || true, config: { perMode } })

  // Documents (sem coluna no portal — só round-trip via informative)
  if (!out.find((b) => b.key === 'documents')) {
    const saved = informative.documents ?? { enabled: false, config: {} as BlockConfig }
    out.push({ key: 'documents', enabled: !!saved.enabled, config: saved.config })
  }

  // Payment (enabled vem da coluna requirePayment do portal)
  if (!out.find((b) => b.key === 'payment')) {
    const saved = informative.payment ?? { enabled: false, config: {} as BlockConfig }
    const enabled = portal?.requirePayment ?? !!saved.enabled
    const cfg = { ...(saved.config as PaymentConfig) }
    if (cfg.deadlineHours == null && portal?.paymentDeadlineHours != null) cfg.deadlineHours = portal.paymentDeadlineHours
    out.push({ key: 'payment', enabled, config: cfg })
  }

  // Completion (sempre ativo; config das colunas cta* como fallback)
  if (!out.find((b) => b.key === 'completion')) {
    const saved = informative.completion ?? { enabled: true, config: {} as BlockConfig }
    const cfg = { ...(saved.config as CompletionConfig) }
    if (cfg.behavior == null && portal?.ctaBehavior) cfg.behavior = portal.ctaBehavior
    if (cfg.message == null && portal?.ctaMessage != null) cfg.message = portal.ctaMessage
    if (cfg.target == null && portal?.ctaTarget != null) cfg.target = portal.ctaTarget
    out.push({ key: 'completion', enabled: true, config: cfg })
  }

  // Reordena
  out.sort((a, b) => BLOCK_ORDER.indexOf(a.key) - BLOCK_ORDER.indexOf(b.key))
  return out
}

/** Sincroniza blocos informativos (payment/completion) nas colunas top-level do portal. */
export function applyInformativeBlocks(blocks: FormBlock[]): {
  requirePayment?: boolean
  paymentDeadlineHours?: number | undefined
  ctaBehavior?: CompletionBehavior | undefined
  ctaMessage?: string | null | undefined
  ctaTarget?: string | null | undefined
} {
  const out: ReturnType<typeof applyInformativeBlocks> = {}
  const payment = blocks.find((b) => b.key === 'payment')
  const completion = blocks.find((b) => b.key === 'completion')

  if (payment) {
    out.requirePayment = !!payment.enabled
    if (payment.enabled) {
      const cfg = payment.config as PaymentConfig
      if (cfg.deadlineHours != null && Number.isFinite(cfg.deadlineHours)) out.paymentDeadlineHours = cfg.deadlineHours
    }
  }
  if (completion?.enabled) {
    const cfg = completion.config as CompletionConfig
    if (cfg.behavior) out.ctaBehavior = cfg.behavior
    if (cfg.message != null) out.ctaMessage = cfg.message
    if (cfg.target != null) out.ctaTarget = cfg.target
  }
  return out
}
