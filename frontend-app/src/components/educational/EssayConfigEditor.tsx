import { useEffect, useState } from 'preact/hooks'
import { Save, RotateCcw, Sparkles, Shield } from '@/components/ui/icon-set'
import {
  useUpdateSelectionProcess,
  DEFAULT_ESSAY_AI_CRITERIA,
  type SelectionProcess,
  type EssayAiCriterion,
} from '@/hooks/useEducational'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

function readCriteria(raw: unknown): EssayAiCriterion[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_ESSAY_AI_CRITERIA
  return raw
    .map((c) => {
      const obj = c as Record<string, unknown>
      const rawKey = obj.key
      if (typeof rawKey !== 'string' || !rawKey) return null
      const rawLabel = obj.label
      const label = typeof rawLabel === 'string' && rawLabel ? rawLabel : rawKey
      const weight = Number(obj.weight ?? 0) || 0
      return { key: rawKey, label, weight }
    })
    .filter((c): c is EssayAiCriterion => c !== null)
}

export function EssayConfigEditor({ process }: { process: SelectionProcess }) {
  const update = useUpdateSelectionProcess()

  const [duration, setDuration] = useState(process.essayDurationMinutes?.toString() ?? '')
  const [attempts, setAttempts] = useState(process.essayMaxAttempts.toString())
  const [cutoff, setCutoff] = useState(process.essayCutoff?.toString() ?? '')
  const [minWords, setMinWords] = useState(process.essayMinWords?.toString() ?? '')
  const [maxWords, setMaxWords] = useState(process.essayMaxWords?.toString() ?? '')
  const [pasteBlocked, setPasteBlocked] = useState(process.essayPasteBlocked)
  const [aiEnabled, setAiEnabled] = useState(process.essayAiEnabled)
  const [autoApprove, setAutoApprove] = useState(process.essayAiAutoApprove)
  const [criteria, setCriteria] = useState<EssayAiCriterion[]>(readCriteria(process.essayAiCriteria))

  useEffect(() => {
    setDuration(process.essayDurationMinutes?.toString() ?? '')
    setAttempts(process.essayMaxAttempts.toString())
    setCutoff(process.essayCutoff?.toString() ?? '')
    setMinWords(process.essayMinWords?.toString() ?? '')
    setMaxWords(process.essayMaxWords?.toString() ?? '')
    setPasteBlocked(process.essayPasteBlocked)
    setAiEnabled(process.essayAiEnabled)
    setAutoApprove(process.essayAiAutoApprove)
    setCriteria(readCriteria(process.essayAiCriteria))
  }, [process])

  const sum = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0)

  function updateCriterionWeight(idx: number, weight: number) {
    setCriteria((prev) => prev.map((c, i) => (i === idx ? { ...c, weight } : c)))
  }

  function resetCriteria() {
    setCriteria(DEFAULT_ESSAY_AI_CRITERIA)
  }

  function handleSave() {
    if (sum !== 100) {
      toast(`Soma dos pesos é ${sum} — precisa ser exatamente 100`, 'danger')
      return
    }
    const toIntOrNull = (s: string) => {
      const t = s.trim()
      if (!t) return null
      const n = parseInt(t)
      return Number.isFinite(n) ? n : null
    }
    const toFloatOrNull = (s: string) => {
      const t = s.trim()
      if (!t) return null
      const n = parseFloat(t)
      return Number.isFinite(n) ? n : null
    }
    update.mutate({
      id: process.id,
      essayDurationMinutes: toIntOrNull(duration),
      essayMaxAttempts: parseInt(attempts) || 1,
      essayCutoff: toFloatOrNull(cutoff),
      essayMinWords: toIntOrNull(minWords),
      essayMaxWords: toIntOrNull(maxWords),
      essayPasteBlocked: pasteBlocked,
      essayAiEnabled: aiEnabled,
      essayAiAutoApprove: autoApprove,
      essayAiCriteria: criteria,
    }, {
      onSuccess: () => toast('Configuração de redação salva', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div>
            <div class="text-sm font-semibold text-fg">✍ Redação Online</div>
            <div class="text-xs text-fg-muted mt-0.5">
              Configurações, anti-fraude e critérios de correção IA aplicados a todos os candidatos.
            </div>
          </div>
        </div>

        <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning mb-3">
          💡 <strong>Multi-tema:</strong> cadastre temas na aba "Temas de redação". O candidato recebe um sorteado aleatoriamente ao iniciar. Sem temas, a redação fica indisponível.
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Input
              label="Duração (min)"
              type="number"
              min="1"
              max="600"
              value={duration}
              onInput={(e) => setDuration((e.target as HTMLInputElement).value)}
              placeholder="Ex: 90"
            />
            <div class="text-2xs text-fg-muted mt-1">Vazio = sem timer</div>
          </div>
          <Input
            label="Tentativas"
            type="number"
            min="1"
            max="10"
            value={attempts}
            onInput={(e) => setAttempts((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Nota de corte (0–100)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={cutoff}
            onInput={(e) => setCutoff((e.target as HTMLInputElement).value)}
            placeholder="Ex: 60"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Input
            label="Mínimo de palavras"
            type="number"
            min="0"
            value={minWords}
            onInput={(e) => setMinWords((e.target as HTMLInputElement).value)}
            placeholder="Ex: 200"
          />
          <Input
            label="Máximo de palavras"
            type="number"
            min="0"
            value={maxWords}
            onInput={(e) => setMaxWords((e.target as HTMLInputElement).value)}
            placeholder="Ex: 500"
          />
        </div>

        <div class="rounded-md border border-border bg-surface p-3 mt-3 flex flex-wrap gap-6">
          <label class="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input type="checkbox" checked={pasteBlocked} onChange={(e) => setPasteBlocked((e.target as HTMLInputElement).checked)} />
            <Shield size={14} class="text-fg-muted" /> Bloquear copiar/colar
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled((e.target as HTMLInputElement).checked)} />
            <Sparkles size={14} class="text-fg-muted" /> Correção automática por IA (Claude)
          </label>
        </div>
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-2">⚖ Veredito após correção da IA</div>
        <div class="space-y-2">
          <VerdictOption
            checked={!autoApprove}
            onSelect={() => setAutoApprove(false)}
            title="👁 Aguardar revisão humana"
            badge="recomendado"
            description="A IA corrige e gera parecer técnico, mas a aprovação final é decisão humana. Mais seguro."
          />
          <VerdictOption
            checked={autoApprove}
            onSelect={() => setAutoApprove(true)}
            title="⚡ Aprovar/reprovar direto pela IA"
            description="Compara a nota da IA com a nota de corte e marca aprovado/reprovado automaticamente. Mais rápido — exige cutoff configurado e correção IA habilitada."
          />
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div>
            <div class="text-sm font-semibold text-fg">Critérios de correção IA · pesos</div>
            <div class="text-xs text-fg-muted">A IA pontua cada critério (0–100) e gera nota global ponderada.</div>
          </div>
          <Button size="sm" variant="ghost" onClick={resetCriteria}>
            <RotateCcw size={12} /> Restaurar padrão
          </Button>
        </div>

        <div class="divide-y divide-border">
          {criteria.map((c, idx) => (
            <div key={c.key} class="grid grid-cols-[1fr_5rem] gap-3 items-center py-2">
              <div class="min-w-0">
                <div class="text-sm font-medium text-fg truncate">{c.label}</div>
                <code class="text-3xs text-fg-muted font-mono">{c.key}</code>
              </div>
              <Input
                type="number"
                min="0"
                max="100"
                value={c.weight.toString()}
                onInput={(e) => updateCriterionWeight(idx, parseInt((e.target as HTMLInputElement).value) || 0)}
                class="text-right"
              />
            </div>
          ))}
        </div>

        <div class={cn('text-right text-xs mt-2 font-medium', sum === 100 ? 'text-success' : 'text-danger')}>
          Soma dos pesos: <strong>{sum}</strong> / 100
        </div>
      </Card>

      <div class="flex justify-end">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
          <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar configuração'}
        </Button>
      </div>
    </div>
  )
}

function VerdictOption({
  checked, onSelect, title, badge, description,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  badge?: string | undefined
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      class={cn(
        'w-full text-left rounded-md border p-3 transition-colors',
        checked
          ? 'border-accent bg-accent/10'
          : 'border-border bg-surface hover:bg-surface-3',
      )}
    >
      <div class="flex items-start gap-3">
        <input type="radio" checked={checked} readOnly class="mt-1 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-fg">
            {title}
            {badge && <span class="ml-2 text-2xs font-normal text-fg-muted">({badge})</span>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  )
}

export function PresencialConfigEditor({ process }: { process: SelectionProcess }) {
  const update = useUpdateSelectionProcess()
  const [cutoff, setCutoff] = useState(process.presencialCutoff?.toString() ?? '')

  useEffect(() => {
    setCutoff(process.presencialCutoff?.toString() ?? '')
  }, [process])

  function handleSave() {
    const t = cutoff.trim()
    const value = t ? (Number.isFinite(parseFloat(t)) ? parseFloat(t) : null) : null
    update.mutate({ id: process.id, presencialCutoff: value }, {
      onSuccess: () => toast('Nota de corte salva', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="text-sm font-semibold text-fg mb-1">🏫 Configuração do Vestibular Presencial</div>
      <div class="text-xs text-fg-muted mb-3">
        Nota mínima para aprovação na prova presencial (lançada manualmente em Avaliações).
      </div>
      <div class="max-w-xs">
        <Input
          label="Nota de corte (0–100)"
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={cutoff}
          onInput={(e) => setCutoff((e.target as HTMLInputElement).value)}
          placeholder="Ex: 50"
        />
      </div>
      <div class="flex justify-end mt-3">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
          <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  )
}
