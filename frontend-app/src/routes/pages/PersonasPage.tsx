import { useState } from 'preact/hooks'
import {
  User, Plus, Pencil, Trash2, Archive, ArchiveRestore, Star,
  Briefcase, MapPin, AlertTriangle, ShieldQuestion, Sparkles, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  usePersonas,
  useCreatePersona,
  useUpdatePersona,
  useSetDefaultPersona,
  useArchivePersona,
  useDeletePersona,
  type Persona,
  type PersonaInput,
} from '@/hooks/usePersonas'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

export function PersonasPage() {
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Persona | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Persona | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const personasQ = usePersonas(showArchived)
  const setDefault = useSetDefaultPersona()
  const archive = useArchivePersona()
  const del = useDeletePersona()

  return (
    <Page
      title="Personas / ICPs"
      description="Defina seus clientes ideais (dores, objeções, gatilhos, tom de voz). A persona marcada como padrão é injetada como contexto na IA do chatbot, no Sales AI e nas cadências."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova persona
          </Button>
        </div>
      }
    >
      <Card class="p-3">
        <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)}
          />
          Mostrar arquivadas
        </label>
      </Card>

      <div class="mt-3 space-y-2">
        {personasQ.isLoading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        {!personasQ.isLoading && (!personasQ.data || personasQ.data.data.length === 0) && (
          <EmptyState
            icon={<User size={20} />}
            title={showArchived ? 'Sem personas arquivadas' : 'Comece criando sua primeira persona'}
            description={showArchived ? '' : 'Quando o time todo conversa com o mesmo ICP em mente — discurso fica consistente, IA fica mais precisa, conversões sobem.'}
            action={!showArchived ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nova persona
              </Button>
            ) : undefined}
          />
        )}
        {!personasQ.isLoading && personasQ.data && personasQ.data.data.map(p => (
          <PersonaRow
            key={p.id}
            persona={p}
            onEdit={() => setEditing(p)}
            onDelete={() => setDeleting(p)}
            onArchive={() => archive.mutate(
              { id: p.id, archived: p.active },
              {
                onSuccess: () => toast(p.active ? 'Persona arquivada' : 'Persona restaurada', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              },
            )}
            onSetDefault={() => setDefault.mutate(p.id, {
              onSuccess: () => toast(`"${p.name}" agora é a persona padrão da IA`, 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          />
        ))}
      </div>

      {(creating || editing) && (
        <PersonaFormModal
          persona={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.name}"`}
          description="Exclusão definitiva. Se quiser preservar histórico, prefira arquivar."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Persona excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Personas/ICPs?"
        problem={<>
          A IA do sistema (chatbot, gerador de cadência, sales-ai) precisa saber <strong>com quem ela
          está falando</strong>. Sem persona, gera resposta genérica. Com persona detalhada (dores,
          gatilhos, tom), gera resposta <strong>personalizada</strong> — muda totalmente a qualidade.
        </>}
        steps={[
          {
            title: '👤 Crie sua persona ideal',
            body: <>Descreva o cliente ideal: cargo, setor, faixa de empresa, localização, faixa etária. Quanto mais detalhe, melhor a IA vai personalizar.</>,
          },
          {
            title: '💢 Mapeie dores e objeções',
            body: <>O que tira o sono dessa persona? Quais frases ela usa? Quais objeções aparecem ("já tenho fornecedor", "está caro", "vou pensar")? Isso vira contexto pra IA argumentar melhor.</>,
          },
          {
            title: '🎯 Gatilhos e tom de voz',
            body: <>O que motiva ela a comprar? (resultado, status, segurança, preço). E o tom: formal, descontraído, técnico, motivacional. Tudo entra no prompt da IA.</>,
          },
          {
            title: '⭐ Marque a persona padrão',
            body: <>Estrela em uma persona — vira a <strong>padrão da IA</strong> automaticamente. Esta é a que vai parar nos prompts do chatbot, sales-ai e gerador de cadência. Só uma pode ser padrão por vez.</>,
          },
          {
            title: '📚 Múltiplas personas',
            body: <>Se você atende públicos diferentes (B2B vs B2C, curso pra adulto vs criança), crie uma persona por segmento. Configure no chatbot/funil/cadência qual usar caso a caso.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Resultado prático',
          body: <>Sem persona definida, a IA escreve <em>"Olá, podemos te ajudar com nosso produto?"</em>. Com persona "gestor de PME, 35-50 anos, foco em ROI", escreve <em>"Olá! Sei como é difícil escalar sem perder margem — me conta como você está medindo o ROI hoje?"</em>. A diferença em conversão é gritante.</>,
        }}
      />
    </Page>
  )
}

function PersonaRow({ persona, onEdit, onDelete, onArchive, onSetDefault }: {
  persona: Persona
  onEdit: () => void
  onDelete: () => void
  onArchive: () => void
  onSetDefault: () => void
}) {
  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="text-sm font-semibold text-fg">{persona.name}</span>
            {persona.isDefault && <Badge tone="success" solid><Star size={10} /> Padrão IA</Badge>}
            {!persona.active && <Badge tone="warning">arquivada</Badge>}
            {persona.occupation && <span class="text-xs text-fg-muted flex items-center gap-1"><Briefcase size={10} /> {persona.occupation}</span>}
            {persona.location && <span class="text-xs text-fg-muted flex items-center gap-1"><MapPin size={10} /> {persona.location}</span>}
          </div>
          {persona.description && <p class="text-xs text-fg-muted mb-2 line-clamp-2">{persona.description}</p>}
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-3 text-[0.6875rem]">
            <Slot icon={<AlertTriangle size={10} class="text-danger" />} label="Dores" items={persona.painPoints} />
            <Slot icon={<ShieldQuestion size={10} class="text-warning" />} label="Objeções" items={persona.objections} />
            <Slot icon={<Sparkles size={10} class="text-success" />} label="Gatilhos" items={persona.triggers} />
          </div>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          {!persona.isDefault && persona.active && (
            <Button variant="secondary" size="sm" onClick={onSetDefault} title="Definir como persona padrão da IA">
              <Star size={12} /> Tornar padrão
            </Button>
          )}
          {persona.isDefault && (
            <div class="text-[0.6875rem] text-fg-subtle text-right">Em uso pela IA</div>
          )}
          <div class="flex gap-1 justify-end">
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onEdit} title="Editar" aria-label="Editar"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onArchive}
              title={persona.active ? 'Arquivar' : 'Restaurar'}
              aria-label={persona.active ? 'Arquivar' : 'Restaurar'}
            >
              {persona.active ? <Archive size={13} /> : <ArchiveRestore size={13} />}
            </button>
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
              onClick={onDelete} title="Excluir" aria-label="Excluir"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Slot({ icon, label, items }: { icon: any; label: string; items: string[] | null }) {
  const list = items ?? []
  return (
    <div>
      <div class="text-fg-muted flex items-center gap-1 mb-0.5">{icon} {label}</div>
      {list.length === 0 ? <em class="text-fg-subtle">—</em>
        : <ul class="text-fg space-y-0.5">{list.slice(0, 3).map(i => <li class="truncate" title={i}>• {i}</li>)}{list.length > 3 && <li class="text-fg-subtle">+ {list.length - 3} mais</li>}</ul>}
    </div>
  )
}

// ── FORM MODAL ─────────────────────────────────────

interface FormState {
  name: string
  description: string
  ageRange: string
  genderHint: string
  location: string
  occupation: string
  income: string
  painPoints: string
  objections: string
  triggers: string
  channels: string
  voiceTone: string
  examplePhrases: string
  goals: string
  isDefault: boolean
}

function fromPersona(p: Persona | null): FormState {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    ageRange: p?.ageRange ?? '',
    genderHint: p?.genderHint ?? '',
    location: p?.location ?? '',
    occupation: p?.occupation ?? '',
    income: p?.income ?? '',
    painPoints: (p?.painPoints ?? []).join('\n'),
    objections: (p?.objections ?? []).join('\n'),
    triggers: (p?.triggers ?? []).join('\n'),
    channels: (p?.channels ?? []).join('\n'),
    voiceTone: p?.voiceTone ?? '',
    examplePhrases: (p?.examplePhrases ?? []).join('\n'),
    goals: (p?.goals ?? []).join('\n'),
    isDefault: p?.isDefault ?? false,
  }
}

function toLines(s: string): string[] | null {
  const list = s.split('\n').map(l => l.trim()).filter(Boolean)
  return list.length > 0 ? list : null
}

function PersonaFormModal({ persona, onClose }: { persona: Persona | null; onClose: () => void }) {
  const isEdit = !!persona
  const [f, setF] = useState<FormState>(() => fromPersona(persona))
  const create = useCreatePersona()
  const update = useUpdatePersona()
  const isPending = create.isPending || update.isPending

  function up<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF(prev => ({ ...prev, [k]: v }))
  }

  function handleSave() {
    if (!f.name.trim()) { toast('Dê um nome à persona', 'danger'); return }
    const input: PersonaInput = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      ageRange: f.ageRange.trim() || null,
      genderHint: f.genderHint.trim() || null,
      location: f.location.trim() || null,
      occupation: f.occupation.trim() || null,
      income: f.income.trim() || null,
      painPoints: toLines(f.painPoints),
      objections: toLines(f.objections),
      triggers: toLines(f.triggers),
      channels: toLines(f.channels),
      voiceTone: f.voiceTone.trim() || null,
      examplePhrases: toLines(f.examplePhrases),
      goals: toLines(f.goals),
      isDefault: f.isDefault,
      active: true,
    }
    if (isEdit && persona) {
      update.mutate({ id: persona.id, ...input }, {
        onSuccess: () => { toast('Persona atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(input, {
        onSuccess: () => { toast('Persona criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar persona' : 'Nova persona'}
      description="Dores, objeções, gatilhos e tom de voz alimentam o contexto da IA. Liste 1 item por linha nos campos de lista."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome da persona *"
          value={f.name}
          onInput={(e) => up('name', (e.target as HTMLInputElement).value)}
          placeholder="Ex.: Gerente de marketing de uma PME"
        />

        <div>
          <label class="text-xs text-fg-muted block mb-1">Descrição (2-3 parágrafos)</label>
          <textarea
            value={f.description}
            onInput={(e) => up('description', (e.target as HTMLTextAreaElement).value)}
            placeholder="Quem é, contexto profissional, o que ela está tentando resolver…"
            rows={3}
            class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
          />
        </div>

        <fieldset class="rounded-md border border-border p-3">
          <legend class="text-xs font-medium text-fg-muted px-1">Demografia</legend>
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2">
            <Input label="Ocupação" value={f.occupation} onInput={(e) => up('occupation', (e.target as HTMLInputElement).value)} placeholder="Ex.: Diretora de marketing" />
            <Input label="Faixa etária" value={f.ageRange} onInput={(e) => up('ageRange', (e.target as HTMLInputElement).value)} placeholder="Ex.: 30-45 anos" />
            <Input label="Localização" value={f.location} onInput={(e) => up('location', (e.target as HTMLInputElement).value)} placeholder="Ex.: Interior SP/MG" />
            <Input label="Faixa de renda" value={f.income} onInput={(e) => up('income', (e.target as HTMLInputElement).value)} placeholder="Ex.: R$ 5k a R$ 15k" />
            <Input label="Gênero predominante" value={f.genderHint} onInput={(e) => up('genderHint', (e.target as HTMLInputElement).value)} placeholder="Ex.: Mulheres" />
          </div>
        </fieldset>

        <ListField label="Dores principais" value={f.painPoints} onInput={(v) => up('painPoints', v)} placeholder="Uma dor por linha…\n- Equipe pequena pra demanda\n- Falta de visibilidade do funil\n- Pressão por resultado mensal" />
        <ListField label="Objeções comuns" value={f.objections} onInput={(v) => up('objections', v)} placeholder="Uma objeção por linha…\n- Já tenho ferramenta X\n- Preço caro\n- Não tenho tempo de implementar" />
        <ListField label="Gatilhos de compra" value={f.triggers} onInput={(v) => up('triggers', v)} placeholder="Uma situação por linha…\n- Mudança de gestor\n- Queda em ROAS\n- Fim de trimestre" />
        <ListField label="Objetivos do cliente" value={f.goals} onInput={(v) => up('goals', v)} placeholder="Um objetivo por linha…\n- Aumentar conversão de leads\n- Reduzir tempo de resposta\n- Padronizar discurso da equipe" />
        <ListField label="Canais preferidos" value={f.channels} onInput={(v) => up('channels', v)} placeholder="Um canal por linha…\nWhatsApp\nE-mail\nInstagram" />

        <div>
          <label class="text-xs text-fg-muted block mb-1">Tom de voz ao falar com essa persona</label>
          <textarea
            value={f.voiceTone}
            onInput={(e) => up('voiceTone', (e.target as HTMLTextAreaElement).value)}
            placeholder="Profissional mas próximo. Evitar gírias. Usar exemplos pedagógicos. Cumprimentar pelo nome…"
            rows={3}
            class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
          />
        </div>

        <ListField label="Frases que ela usaria (vocabulário do cliente)" value={f.examplePhrases} onInput={(v) => up('examplePhrases', v)} placeholder="Uma frase por linha…\nMinha turma está desmotivada\nPrecisamos cumprir a meta do trimestre" />

        <label class="flex items-start gap-2 cursor-pointer rounded-md border border-accent/30 bg-accent/10 p-2.5">
          <input
            type="checkbox"
            checked={f.isDefault}
            onChange={(e) => up('isDefault', (e.target as HTMLInputElement).checked)}
            class="mt-0.5"
          />
          <div>
            <div class="text-sm font-medium text-fg flex items-center gap-1"><Star size={12} class="text-accent" /> Definir como persona padrão da IA</div>
            <div class="text-[0.6875rem] text-fg-muted">Esta persona será injetada como contexto base no chatbot, Sales AI e cadências. Só uma persona pode ser padrão por vez — marcar aqui desmarca a anterior.</div>
          </div>
        </label>
      </div>
    </Modal>
  )
}

function ListField({ label, value, onInput, placeholder }: {
  label: string
  value: string
  onInput: (v: string) => void
  placeholder?: string
}) {
  const count = value.split('\n').filter(l => l.trim()).length
  return (
    <div>
      <label class="text-xs text-fg-muted block mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span class="text-fg-subtle">{count} item{count === 1 ? '' : 's'}</span>
      </label>
      <textarea
        value={value}
        onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        rows={4}
        class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
      />
    </div>
  )
}
