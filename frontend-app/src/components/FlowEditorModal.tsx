// FlowEditorModal — editor visual do Formulário do WhatsApp (Flow), desacoplado do
// formulário (reusa as mesmas chaves/qualificação). Permite controlar a mensagem
// inicial, o texto do botão (CTA), o título da tela e cada pergunta (rótulo/incluir/
// obrigatório), com preview. "Salvar" vale na hora para mensagem/CTA; "Publicar na
// Meta" republica o Flow (necessário ao mudar rótulos/campos/título).

import { useEffect, useState } from 'preact/hooks'
import { ChevronDown } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useFlowConfig, useSaveFlowConfig, usePublishFlow, type FlowFieldConfigItem } from '@/hooks/useCloudApi'

const CTA_MAX = 30
const TITLE_MAX = 30
const LABEL_MAX = 80

function Counter({ value, max }: { value: number; max: number }) {
  return <span class={`text-3xs ${value > max ? 'text-danger' : 'text-fg-muted'}`}>{value}/{max}</span>
}

export function FlowEditorModal({ formId, onClose }: { formId: number; onClose: () => void }) {
  const { data, isLoading } = useFlowConfig(formId)
  const save = useSaveFlowConfig()
  const publish = usePublishFlow()

  const [cta, setCta] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [screenTitle, setScreenTitle] = useState('')
  const [fields, setFields] = useState<FlowFieldConfigItem[]>([])

  useEffect(() => {
    if (data) {
      setCta(data.cta)
      setBodyText(data.bodyText)
      setScreenTitle(data.screenTitle)
      setFields(data.fields)
    }
  }, [data])

  function patchField(i: number, patch: Partial<FlowFieldConfigItem>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  function payload() {
    return {
      formId,
      cta: cta.slice(0, CTA_MAX),
      bodyText,
      screenTitle: screenTitle.slice(0, TITLE_MAX),
      fieldConfig: fields.map((f) => ({ key: f.key, label: f.label, include: f.include, required: f.required })),
    }
  }

  function handleSave(close = false) {
    save.mutate(payload(), {
      onSuccess: () => { toast('Formulário salvo (mensagem e botão já valem)', 'success'); if (close) onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function handlePublish() {
    // Salva a config e então republica o Flow na Meta.
    save.mutate(payload(), {
      onSuccess: () => publish.mutate({ formId }, {
        onSuccess: () => toast('Formulário publicado na Meta!', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      }),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const busy = save.isPending || publish.isPending
  const activeFields = fields.filter((f) => f.include)

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Formulário do WhatsApp (Flow)"
      description="Edite a mensagem, o botão e as perguntas. Não altera o formulário que roda separado."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Fechar</Button>
          <Button variant="ghost" size="sm" onClick={() => handleSave(false)} disabled={busy}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
          <Button variant="primary" size="sm" onClick={handlePublish} disabled={busy}>{publish.isPending ? 'Publicando…' : 'Salvar e publicar na Meta'}</Button>
        </>
      }
    >
      {isLoading || !data ? (
        <Skeleton class="h-80 w-full" />
      ) : (
        <div class="grid md:grid-cols-2 gap-5">
          {/* ── Edição ── */}
          <div class="space-y-4">
            <div>
              <Textarea
                label="Mensagem inicial (acompanha o botão)"
                rows={3}
                value={bodyText}
                onInput={(e) => setBodyText((e.target as HTMLTextAreaElement).value)}
                hint="É o texto que aparece junto do botão que abre o formulário."
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Input label="Texto do botão (CTA)" value={cta} onInput={(e) => setCta((e.target as HTMLInputElement).value)} />
                <div class="text-right mt-0.5"><Counter value={cta.length} max={CTA_MAX} /></div>
              </div>
              <div>
                <Input label="Título da tela" value={screenTitle} onInput={(e) => setScreenTitle((e.target as HTMLInputElement).value)} />
                <div class="text-right mt-0.5"><Counter value={screenTitle.length} max={TITLE_MAX} /></div>
              </div>
            </div>

            <div>
              <div class="text-sm font-medium text-fg mb-1">Perguntas do formulário</div>
              <p class="text-xs text-fg-muted mb-2">Reusa as perguntas do formulário (mesmas respostas/qualificação). Aqui você só ajusta o texto exibido, a ordem e o que entra.</p>
              <div class="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.key} class={`border rounded-lg p-2.5 ${f.include ? 'border-border' : 'border-border/50 opacity-60'}`}>
                    <div class="flex items-center gap-2">
                      <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer shrink-0">
                        <input type="checkbox" checked={f.include} onChange={(e) => patchField(i, { include: (e.target as HTMLInputElement).checked })} />
                        Incluir
                      </label>
                      <span class="text-3xs px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted shrink-0">{f.type}{f.hasOptions ? ' • opções' : ''}</span>
                      <span class="text-3xs text-fg-muted font-mono truncate">{f.key}</span>
                    </div>
                    {f.include && (
                      <div class="mt-2">
                        <Input
                          value={f.label}
                          placeholder={f.formLabel}
                          onInput={(e) => patchField(i, { label: (e.target as HTMLInputElement).value })}
                        />
                        <div class="flex items-center justify-between mt-0.5">
                          <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
                            <input type="checkbox" checked={f.required} onChange={(e) => patchField(i, { required: (e.target as HTMLInputElement).checked })} />
                            Obrigatório
                          </label>
                          <span class="flex items-center gap-2">
                            {f.label.length > 30 && <span class="text-3xs text-warning">vira subtítulo</span>}
                            <Counter value={f.label.length} max={LABEL_MAX} />
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Preview (mockup WhatsApp) ── */}
          <div>
            <div class="text-sm font-medium text-fg mb-2">Pré-visualização</div>
            <div class="rounded-xl bg-[#0b141a] p-3 space-y-3">
              {/* balão com a mensagem + botão */}
              <div class="bg-[#202c33] text-[#e9edef] rounded-lg rounded-tl-none p-2.5 text-sm max-w-[90%] whitespace-pre-wrap">
                {bodyText || <span class="text-[#8696a0]">(mensagem inicial vazia)</span>}
                <div class="mt-2 border-t border-white/10 pt-2 text-center text-[#53bdeb] font-medium text-sm">{cta || 'Preencher'}</div>
              </div>
              {/* "tela" do formulário */}
              <div class="bg-white rounded-lg overflow-hidden">
                <div class="bg-[#008069] text-white px-3 py-2 text-sm font-medium truncate">{screenTitle || data.formName}</div>
                <div class="p-3 space-y-3">
                  {activeFields.length === 0 ? (
                    <div class="text-xs text-gray-400">Nenhum campo ativo.</div>
                  ) : activeFields.map((f) => (
                    <div key={f.key}>
                      {f.label.length > 30 && <div class="text-xs font-semibold text-gray-800 mb-1">{f.label}</div>}
                      <label class="block text-2xs text-gray-500 mb-1">
                        {f.label.length > 30 ? (f.hasOptions ? 'Selecione' : 'Sua resposta') : f.label}{f.required ? ' *' : ''}
                      </label>
                      {f.hasOptions ? (
                        <div class="border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-400 flex items-center justify-between">Selecione <ChevronDown size={12} /></div>
                      ) : (
                        <div class="border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-300">—</div>
                      )}
                    </div>
                  ))}
                  <div class="bg-[#008069] text-white text-center rounded py-1.5 text-sm font-medium">{cta || 'Enviar'}</div>
                </div>
              </div>
            </div>
            {data.status === 'error' && data.lastError && (
              <div class="text-xs text-danger mt-2 bg-danger/10 rounded px-2 py-1.5">Último erro ao publicar: {data.lastError}</div>
            )}
            {data.metaFlowId && (
              <div class="text-2xs text-fg-muted mt-2">Publicado na Meta (id {data.metaFlowId}). Mudanças em rótulos/campos/título exigem "Publicar".</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
