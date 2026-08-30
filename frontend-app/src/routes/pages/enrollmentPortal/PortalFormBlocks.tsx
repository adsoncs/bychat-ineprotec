import { useState } from 'preact/hooks'
import { Plus, Sparkles } from '@/components/ui/icon-set'
import type { EntryMode } from '@/hooks/useEducational'
import type { PortalFieldType } from '@/hooks/useEnrollmentPortals'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import {
  BLOCK_DEFS,
  TEMPLATES,
  countSpsUsingMode,
  readFormExtras,
  type BlockKey,
  type CompletionConfig,
  type CoursePickerConfig,
  type CoursePickerMode,
  type CustomStepConfig,
  type EntryModesConfig,
  type FormBlock,
  type IdentityConfig,
  type ModeCustomField,
  type PaymentConfig,
  type PerModeConfig,
} from './portalBlocks'

const FIELD_TYPES_FOR_CUSTOM: { value: PortalFieldType; label: string }[] = [
  { value: 'text',     label: 'Texto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'email',    label: 'E-mail' },
  { value: 'phone',    label: 'Telefone' },
  { value: 'cpf',      label: 'CPF' },
  { value: 'rg',       label: 'RG' },
  { value: 'cep',      label: 'CEP' },
  { value: 'date',     label: 'Data' },
  { value: 'number',   label: 'Número' },
  { value: 'select',   label: 'Seleção' },
]

interface PortalLite { selectionProcessIds: number[]; slug: string }

export interface SimpleEditorProps {
  blocks: FormBlock[]
  modes: EntryMode[]
  processes: { id: number; entryMode?: { code: string } | null }[]
  portal: PortalLite
  onChange: (blocks: FormBlock[]) => void
  onSwitchAdvanced: () => void
}

export function SimpleFormEditor({
  blocks, modes, processes, portal, onChange, onSwitchAdvanced,
}: SimpleEditorProps) {
  const noSpsSelected = portal.selectionProcessIds.length === 0
  const previewUrl = portal.slug ? `${location.origin}/portal/${portal.slug}` : null

  function applyTemplate(key: 'simples' | 'padrao' | 'completo') {
    const tpl = TEMPLATES.find((t) => t.key === key)
    if (!tpl) return
    if (!confirm(`Aplicar template "${tpl.label}"? Isso substitui os blocos atuais.`)) return
    onChange(JSON.parse(JSON.stringify(tpl.blocks)) as FormBlock[])
  }

  function toggleBlock(idx: number, on: boolean) {
    onChange(blocks.map((b, i) => (i === idx ? { ...b, enabled: on } : b)))
  }

  function updateBlockConfig<T>(idx: number, patch: Partial<T>) {
    onChange(blocks.map((b, i) => (i === idx ? { ...b, config: { ...(b.config as object), ...patch } } : b)))
  }

  function addCustomBlock() {
    const completionIdx = blocks.findIndex((b) => b.key === 'completion')
    const at = completionIdx >= 0 ? completionIdx : blocks.length
    const newBlock: FormBlock = {
      key: 'customStep',
      enabled: true,
      config: { name: 'Nova etapa', fields: [] },
      _raw: { id: `step-${Date.now().toString(36)}`, name: 'Nova etapa', fields: [] },
    }
    const next = blocks.slice()
    next.splice(at, 0, newBlock)
    onChange(next)
  }

  function removeCustomBlock(idx: number) {
    if (!confirm('Remover esta etapa custom? Os campos dela serão perdidos.')) return
    onChange(blocks.filter((_, i) => i !== idx))
  }

  function updateCustomBlockName(idx: number, name: string) {
    onChange(blocks.map((b, i) => {
      if (i !== idx) return b
      const cfg = { ...(b.config as CustomStepConfig), name }
      const _raw = b._raw ? { ...b._raw, name } : b._raw
      return _raw ? { ...b, config: cfg, _raw } : { ...b, config: cfg }
    }))
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="text-xs text-fg-muted">
          Ligue ou desligue os blocos abaixo. Cada bloco vira uma tela do formulário com campos prontos.
        </div>
        <div class="flex items-center gap-2">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              class="px-3 h-8 inline-flex items-center gap-1.5 text-xs text-accent border border-border rounded-md hover:bg-surface-3"
            >
              ↗ Ver como candidato
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={onSwitchAdvanced} title="Editor cru de campos (para casos complexos)">
            ⚙ Modo avançado
          </Button>
        </div>
      </div>

      <Card>
        <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted mb-2">
          ⚡ Tamanho do formulário
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => applyTemplate(t.key)}
              class="text-left p-2.5 rounded-md border border-border bg-surface hover:bg-surface-3 transition-colors"
            >
              <div class="text-sm font-medium text-accent">{t.label}</div>
              <div class="text-2xs text-fg-muted mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
        <div class="text-3xs text-fg-muted mt-2">
          Os campos extras de cada modo de ingresso (ENEM, Transferência, etc.) são aplicados automaticamente.
        </div>
      </Card>

      {noSpsSelected ? (
        <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          ⚠ Nenhum Processo Seletivo selecionado. Volte para a aba "O que oferece" para escolher pelo menos um.
        </div>
      ) : modes.length > 0 ? (
        <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
          <div>💡 <strong>Modos de ingresso detectados:</strong></div>
          <div class="flex flex-wrap gap-1 mt-1.5">
            {modes.map((m) => (
              <Badge key={m.code} tone="info">{m.icon ?? ''} {m.name}</Badge>
            ))}
          </div>
          <div class="mt-1.5 text-fg-muted">
            Configure cada um no bloco <strong>🎓 Modos de ingresso</strong> abaixo.
          </div>
        </div>
      ) : null}

      <div class="space-y-2">
        {blocks.map((b, idx) => (
          <BlockCard
            key={`${b.key}-${idx}`}
            block={b}
            idx={idx}
            modes={modes}
            processes={processes}
            portalSpIds={portal.selectionProcessIds}
            onToggle={(on) => toggleBlock(idx, on)}
            onUpdateConfig={(patch) => updateBlockConfig(idx, patch)}
            onRemoveCustom={() => removeCustomBlock(idx)}
            onUpdateCustomName={(name) => updateCustomBlockName(idx, name)}
          />
        ))}
      </div>

      <div class="flex justify-center">
        <Button variant="ghost" size="sm" onClick={addCustomBlock} class="border-dashed border border-accent/40 text-accent">
          <Plus size={12} /> Adicionar etapa custom
        </Button>
      </div>
    </div>
  )
}

interface BlockCardProps {
  block: FormBlock
  idx: number
  modes: EntryMode[]
  processes: { id: number; entryMode?: { code: string } | null }[]
  portalSpIds: number[]
  onToggle: (on: boolean) => void
  onUpdateConfig: (patch: Record<string, unknown>) => void
  onRemoveCustom: () => void
  onUpdateCustomName: (name: string) => void
}

function BlockCard({
  block, idx, modes, processes, portalSpIds, onToggle, onUpdateConfig, onRemoveCustom, onUpdateCustomName,
}: BlockCardProps) {
  const def = BLOCK_DEFS[block.key]
  const enabled = !!block.enabled
  const required = !!def.required

  return (
    <div class={cn(
      'rounded-md border-2 overflow-hidden transition-colors',
      enabled ? 'border-accent bg-accent/5' : 'border-border bg-surface',
    )}>
      <div class="flex items-center gap-3 p-3">
        <div class="text-2xl shrink-0">{def.icon}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-fg flex items-center gap-2 flex-wrap">
            {def.label}
            {required && <Badge tone="info">obrigatório</Badge>}
          </div>
          <div class="text-2xs text-fg-muted mt-0.5">{def.description}</div>
        </div>
        {required ? (
          <span class="text-2xs text-fg-muted px-2">sempre ativo</span>
        ) : (
          <label class="relative inline-block w-10 h-6 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle((e.target as HTMLInputElement).checked)}
              class="opacity-0 w-0 h-0"
            />
            <span class={cn(
              'absolute inset-0 rounded-full transition-colors',
              enabled ? 'bg-accent' : 'bg-surface-3',
            )} />
            <span class={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
            )} />
          </label>
        )}
      </div>

      {enabled && (
        <div class="border-t border-border p-3 pl-12">
          {block.key === 'identity'     && <IdentityConfigEditor     config={block.config as IdentityConfig}     onUpdate={onUpdateConfig} />}
          {block.key === 'coursePicker' && <CoursePickerConfigEditor config={block.config as CoursePickerConfig} onUpdate={onUpdateConfig} />}
          {block.key === 'entryModes'   && <EntryModesConfigEditor   config={block.config as EntryModesConfig}   modes={modes} processes={processes} portalSpIds={portalSpIds} onUpdate={onUpdateConfig} />}
          {block.key === 'documents'    && <DocumentsConfigInfo />}
          {block.key === 'payment'      && <PaymentConfigEditor      config={block.config as PaymentConfig}      onUpdate={onUpdateConfig} />}
          {block.key === 'completion'   && <CompletionConfigEditor   config={block.config as CompletionConfig}   onUpdate={onUpdateConfig} />}
          {block.key === 'customStep'   && (
            <CustomStepConfigEditor
              config={block.config as CustomStepConfig}
              idx={idx}
              onUpdateName={onUpdateCustomName}
              onRemove={onRemoveCustom}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Configs por bloco

function IdentityConfigEditor({ config, onUpdate }: {
  config: IdentityConfig
  onUpdate: (patch: Partial<IdentityConfig>) => void
}) {
  return (
    <div>
      <div class="flex flex-wrap gap-4">
        <label class="inline-flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
          <input type="checkbox" checked={!!config.askBirthdate} onChange={(e) => onUpdate({ askBirthdate: (e.target as HTMLInputElement).checked })} />
          Pedir data de nascimento
        </label>
        <label class="inline-flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
          <input type="checkbox" checked={!!config.askAddress} onChange={(e) => onUpdate({ askAddress: (e.target as HTMLInputElement).checked })} />
          Pedir endereço (CEP + rua)
        </label>
      </div>
      <div class="text-2xs text-fg-muted mt-2">
        Campos básicos sempre incluídos: nome, e-mail, WhatsApp, CPF.
      </div>
    </div>
  )
}

function CoursePickerConfigEditor({ config, onUpdate }: {
  config: CoursePickerConfig
  onUpdate: (patch: Partial<CoursePickerConfig>) => void
}) {
  const mode = config.mode ?? 'list'
  const options: { value: CoursePickerMode; icon: string; title: string; desc: string }[] = [
    { value: 'list',  icon: '📋', title: 'Lista de cursos',     desc: 'Mostra todos os cursos com filtros (nível, modalidade, campus, turno).' },
    { value: 'quiz',  icon: '💡', title: 'Quiz "Me ajude"',    desc: 'Faz perguntas e sugere cursos compatíveis ao final.' },
    { value: 'fixed', icon: '📌', title: 'Curso pré-fixado',   desc: 'Portal só inscreve em uma oferta específica.' },
  ]

  return (
    <div>
      <div class="text-2xs text-fg-muted mb-1.5">Como o candidato vai escolher o curso:</div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            class={cn(
              'flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors',
              mode === opt.value ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-3',
            )}
          >
            <input
              type="radio"
              name="cp-mode"
              checked={mode === opt.value}
              onChange={() => onUpdate({ mode: opt.value })}
              class="mt-0.5"
            />
            <div class="min-w-0">
              <div class="text-xs font-medium text-fg">{opt.icon} {opt.title}</div>
              <div class="text-2xs text-fg-muted mt-0.5">{opt.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === 'list' && (
        <div class="mt-3 pt-3 border-t border-dashed border-border">
          <label class="inline-flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.quizHelperEnabled}
              onChange={(e) => onUpdate({ quizHelperEnabled: (e.target as HTMLInputElement).checked })}
              class="mt-0.5"
            />
            <span class="text-fg">
              <strong><Sparkles size={12} class="inline" /> Mostrar atalho "Me ajude a escolher"</strong>
              <span class="text-fg-muted"> — botão acima da lista que abre o quiz de recomendação por IA.</span>
            </span>
          </label>
        </div>
      )}

      {mode === 'fixed' && (
        <div class="mt-3 pt-3 border-t border-dashed border-border">
          <Input
            label="ID da oferta"
            type="number"
            value={config.fixedOfferingId?.toString() ?? ''}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value
              onUpdate({ fixedOfferingId: v ? parseInt(v) : null })
            }}
            placeholder="Ex: 42"
          />
          <div class="text-2xs text-fg-muted mt-1">
            Cole o ID da oferta única que este portal vai inscrever.
          </div>
        </div>
      )}
    </div>
  )
}

function EntryModesConfigEditor({ config, modes, processes, portalSpIds, onUpdate }: {
  config: EntryModesConfig
  modes: EntryMode[]
  processes: { id: number; entryMode?: { code: string } | null }[]
  portalSpIds: number[]
  onUpdate: (patch: Partial<EntryModesConfig>) => void
}) {
  const perMode = config.perMode ?? {}
  const [addingFieldFor, setAddingFieldFor] = useState<string | null>(null)

  function setPerMode(code: string, next: PerModeConfig) {
    onUpdate({ perMode: { ...perMode, [code]: next } })
  }

  function toggleMode(code: string, enabled: boolean) {
    const cur = perMode[code] ?? { enabled: true, customFields: [] }
    setPerMode(code, { ...cur, enabled })
  }

  function addModeCustomField(code: string, field: ModeCustomField) {
    const cur = perMode[code] ?? { enabled: true, customFields: [] }
    setPerMode(code, { ...cur, customFields: [...cur.customFields, field] })
    setAddingFieldFor(null)
  }

  function removeModeCustomField(code: string, fieldIdx: number) {
    if (!confirm('Remover este campo extra deste portal?')) return
    const cur = perMode[code]
    if (!cur) return
    setPerMode(code, { ...cur, customFields: cur.customFields.filter((_, i) => i !== fieldIdx) })
  }

  if (modes.length === 0) {
    return (
      <div class="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
        ⚠ Nenhum modo de ingresso detectado. Selecione Processos Seletivos na aba "O que oferece" para ver os modos.
      </div>
    )
  }

  return (
    <div class="space-y-2">
      <div class="text-2xs text-fg-muted">
        Os campos extras de cada modo são definidos em Educacional → Modos de Ingresso. Aqui você só decide se serão pedidos no formulário deste portal.
      </div>
      {modes.map((m) => {
        const cfg = perMode[m.code] ?? { enabled: true, customFields: [] }
        const enabled = cfg.enabled !== false
        const extras = readFormExtras(m.defaultFormExtras)
        const customFields = cfg.customFields
        const spsCount = countSpsUsingMode(processes, portalSpIds, m.code)

        return (
          <div
            key={m.code}
            class={cn(
              'rounded-md border p-3 transition-colors',
              enabled ? 'border-accent bg-surface' : 'border-border bg-surface-2',
            )}
          >
            <div class="flex items-start gap-2 mb-2">
              <div class="text-lg shrink-0">{m.icon ?? '🎓'}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-fg">{m.name}</div>
                <div class="text-2xs text-fg-muted mt-0.5">
                  {evalLabel(m.evaluationType)} · {spsCount} processo{spsCount === 1 ? '' : 's'} usa{spsCount === 1 ? '' : 'm'} este modo
                </div>
              </div>
              <label class="relative inline-block w-9 h-5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => toggleMode(m.code, (e.target as HTMLInputElement).checked)}
                  class="opacity-0 w-0 h-0"
                />
                <span class={cn(
                  'absolute inset-0 rounded-full transition-colors',
                  enabled ? 'bg-accent' : 'bg-surface-3',
                )} />
                <span class={cn(
                  'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
                  enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                )} />
              </label>
            </div>

            {enabled && (
              <>
                {extras.length === 0 && customFields.length === 0 ? (
                  <div class="text-2xs italic text-fg-muted">Nenhum campo extra definido para este modo.</div>
                ) : (
                  <>
                    <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted mb-1">
                      Campos pedidos quando candidato escolher este modo:
                    </div>
                    <div class="flex flex-wrap gap-1">
                      {extras.map((f, i) => (
                        <span key={`x-${i}`} class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-2xs bg-info/15 text-info">
                          {f.required !== false && <strong>*&nbsp;</strong>}
                          {f.label ?? f.name}
                        </span>
                      ))}
                      {customFields.map((f, i) => (
                        <span key={`c-${i}`} class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs bg-warning/15 text-warning">
                          {f.required !== false && <strong>*&nbsp;</strong>}
                          {f.label ?? f.name}
                          <button
                            type="button"
                            onClick={() => removeModeCustomField(m.code, i)}
                            class="text-warning hover:text-danger ml-0.5"
                            aria-label="Remover"
                          >×</button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div class="mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAddingFieldFor(m.code)}
                    class="border border-dashed border-border text-fg-muted"
                  >
                    + Campo extra só neste portal
                  </Button>
                </div>
              </>
            )}
          </div>
        )
      })}

      {addingFieldFor !== null && (
        <AddCustomFieldModal
          modeCode={addingFieldFor}
          onClose={() => setAddingFieldFor(null)}
          onSave={(field) => addModeCustomField(addingFieldFor, field)}
        />
      )}
    </div>
  )
}

function evalLabel(t: string): string {
  return ({
    enem: 'Avaliação por ENEM',
    docs: 'Avaliação por documentos',
    exam_online: 'Vestibular online',
    exam_presencial: 'Vestibular presencial',
    none: 'Aprovação automática',
  } as Record<string, string>)[t] ?? t
}

function AddCustomFieldModal({ modeCode, onClose, onSave }: {
  modeCode: string
  onClose: () => void
  onSave: (f: ModeCustomField) => void
}) {
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<PortalFieldType>('text')
  const [required, setRequired] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function autoName(v: string) {
    setLabel(v)
    if (!name) {
      const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      setName(slug)
    }
  }

  function handleSave() {
    if (!label.trim()) { setError('Rótulo obrigatório'); return }
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) { setError('Nome técnico inválido — use letras, números e _'); return }
    onSave({ type, name, label, required })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Campo extra · modo "${modeCode}"`}
      description="Esse campo aparece só quando o candidato escolhe um curso desse modo, neste portal específico."
      size="md"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="sm" variant="primary" onClick={handleSave}>Adicionar</Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Rótulo" value={label} onInput={(e) => autoName((e.target as HTMLInputElement).value)} placeholder="Ex.: Nome da sua orientadora" />
        <Input label="Nome técnico (sem espaço)" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="orientadora" />
        <Select label="Tipo" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as PortalFieldType)}>
          {FIELD_TYPES_FOR_CUSTOM.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
        <label class="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={required} onChange={(e) => setRequired((e.target as HTMLInputElement).checked)} />
          Obrigatório
        </label>
        {error && <div class="text-xs text-danger">{error}</div>}
      </div>
    </Modal>
  )
}

function DocumentsConfigInfo() {
  return (
    <div class="text-2xs text-fg-muted leading-relaxed">
      A lista exata de documentos é definida pelo <strong>modo de ingresso</strong> de cada processo seletivo (ou pela personalização do processo, em Educacional → Processos Seletivos → Documentos).
      <br />
      Após enviar a inscrição, o candidato é direcionado para uma página dedicada onde envia os documentos (PDF/JPG).
    </div>
  )
}

function PaymentConfigEditor({ config, onUpdate }: {
  config: PaymentConfig
  onUpdate: (patch: Partial<PaymentConfig>) => void
}) {
  return (
    <div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Prazo (horas)"
          type="number"
          min="1"
          max="720"
          value={(config.deadlineHours ?? 48).toString()}
          onInput={(e) => {
            const v = parseInt((e.target as HTMLInputElement).value)
            onUpdate({ deadlineHours: Number.isFinite(v) ? v : 48 })
          }}
        />
      </div>
      <div class="rounded-md border border-warning/30 bg-warning/10 p-2 text-2xs text-warning mt-2">
        ⚠ Para a cobrança funcionar, configure uma <strong>conexão de pagamento</strong> em Configurações → Pagamento.
      </div>
      <div class="text-2xs text-fg-muted mt-1">
        O <strong>valor da taxa</strong> é definido em cada Processo Seletivo (Educacional → Processos Seletivos).
      </div>
    </div>
  )
}

function CompletionConfigEditor({ config, onUpdate }: {
  config: CompletionConfig
  onUpdate: (patch: Partial<CompletionConfig>) => void
}) {
  const beh = config.behavior ?? 'message'
  return (
    <div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <label class={cn(
          'flex items-start gap-2 p-2 rounded border cursor-pointer',
          beh === 'message' ? 'border-accent bg-accent/10' : 'border-border bg-surface',
        )}>
          <input type="radio" name="cmp-beh" checked={beh === 'message'} onChange={() => onUpdate({ behavior: 'message' })} class="mt-0.5" />
          <div>
            <div class="text-xs font-medium text-fg">💬 Mostrar mensagem</div>
            <div class="text-2xs text-fg-muted">Exibe um texto de agradecimento na própria página.</div>
          </div>
        </label>
        <label class={cn(
          'flex items-start gap-2 p-2 rounded border cursor-pointer',
          beh === 'redirect' ? 'border-accent bg-accent/10' : 'border-border bg-surface',
        )}>
          <input type="radio" name="cmp-beh" checked={beh === 'redirect'} onChange={() => onUpdate({ behavior: 'redirect' })} class="mt-0.5" />
          <div>
            <div class="text-xs font-medium text-fg">↗ Redirecionar URL</div>
            <div class="text-2xs text-fg-muted">Manda o candidato para outra página (ex: site da faculdade).</div>
          </div>
        </label>
      </div>

      {beh === 'redirect' ? (
        <Input
          label="URL de destino"
          type="url"
          value={config.target ?? ''}
          onInput={(e) => onUpdate({ target: (e.target as HTMLInputElement).value })}
          placeholder="https://exemplo.com/obrigado"
        />
      ) : (
        <Textarea
          label="Mensagem de agradecimento"
          value={config.message ?? 'Inscrição recebida com sucesso! Em breve você receberá as próximas instruções.'}
          onInput={(e) => onUpdate({ message: (e.target as HTMLTextAreaElement).value })}
          rows={3}
        />
      )}
    </div>
  )
}

function CustomStepConfigEditor({ config, onUpdateName, onRemove }: {
  config: CustomStepConfig
  idx: number
  onUpdateName: (name: string) => void
  onRemove: () => void
}) {
  const fieldsCount = config.fields?.length ?? 0
  return (
    <div>
      <div class="text-2xs text-fg-muted mb-2">
        Etapa custom com {fieldsCount} campo(s). Para edição completa de campos custom, use o <strong>Modo avançado</strong>.
      </div>
      <Input
        label="Nome da etapa"
        value={config.name ?? ''}
        onInput={(e) => onUpdateName((e.target as HTMLInputElement).value)}
      />
      <div class="mt-2">
        <Button size="sm" variant="ghost" onClick={onRemove} class="text-danger border border-danger/30 hover:bg-danger/10">
          Remover esta etapa
        </Button>
      </div>
    </div>
  )
}

export type { BlockKey }
