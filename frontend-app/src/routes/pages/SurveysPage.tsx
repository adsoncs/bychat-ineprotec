// Pesquisas / NPS — lista, publicação do Flow e disparo.
//
// Três estados que o admin precisa distinguir sem abrir nada: rascunho (sem Flow
// publicado), pronta (Flow na Meta) e em campo (com convites enviados). Publicar é
// um passo separado de disparar de propósito — o Flow publicado é um RETRATO das
// perguntas, então mexer nas perguntas e disparar sem republicar mandaria o
// formulário velho para todo mundo.

import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ClipboardList, Plus, Send, UploadCloud, BarChart3, Trash2, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useCloudApiConnections, useCloudApiTemplates } from '@/hooks/useCloudApi'
import {
  useSurveys, useCreateSurvey, useDeleteSurvey, usePublishSurveyFlow, useDispatchSurvey,
  type Survey,
} from '@/hooks/useSurveys'
import { toast } from '@/lib/toast'

/** Uma linha por telefone (aceita "nome; telefone" ou só o telefone). */
function parseTargets(raw: string): { phone: string; nome?: string }[] {
  return raw
    .split(/[\n;,]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)[\s:|-]*(\+?[\d\s()-]{10,})$/)
      if (m && m[1] && m[1].trim()) return { phone: m[2]!.trim(), nome: m[1].trim() }
      return { phone: l }
    })
    .filter((t) => t.phone.replace(/\D/g, '').length >= 10)
}

export function SurveysPage() {
  const [, navigate] = useLocation()
  const { data, isLoading } = useSurveys()
  const items = data?.items ?? []

  const [creating, setCreating] = useState(false)
  const [publishing, setPublishing] = useState<Survey | null>(null)
  const [dispatching, setDispatching] = useState<Survey | null>(null)
  const [removing, setRemoving] = useState<Survey | null>(null)
  const del = useDeleteSurvey()

  return (
    <Page
      title="Pesquisas"
      description="Pesquisas de satisfação e NPS enviadas por WhatsApp."
      actions={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Nova pesquisa</Button>}
    >
      {isLoading ? (
        <div class="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-20 rounded-lg" />)}</div>
      ) : !items.length ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title="Nenhuma pesquisa criada"
          description="Crie uma pesquisa, publique o formulário no WhatsApp e dispare para a sua lista."
          action={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Nova pesquisa</Button>}
        />
      ) : (
        <div class="space-y-3">
          {items.map((s) => (
            <Card key={s.id} class="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-fg">{s.name}</span>
                  {!s.active && <Badge tone="neutral">Inativa</Badge>}
                  {s.flowId ? <Badge tone="success">Formulário publicado</Badge> : <Badge tone="warning">Rascunho</Badge>}
                </div>
                <p class="text-xs text-fg-muted">
                  {s.questions?.length ?? 0} pergunta(s) · {s.responses ?? 0} resposta(s) de {s.invites ?? 0} convite(s)
                </p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => setPublishing(s)}>
                  <UploadCloud size={14} /> {s.flowId ? 'Republicar' : 'Publicar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDispatching(s)} disabled={!s.flowId}>
                  <Send size={14} /> Disparar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/app/surveys/${s.id}`)}>
                  <BarChart3 size={14} /> Resultados
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(s)} aria-label="Remover">
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} />}
      {publishing && <PublishModal survey={publishing} onClose={() => setPublishing(null)} />}
      {dispatching && <DispatchModal survey={dispatching} onClose={() => setDispatching(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remover pesquisa"
        description={`"${removing?.name}" e todas as suas respostas serão apagadas. Pesquisas que já receberam resposta não podem ser removidas — desative-as.`}
        confirmLabel="Remover"
        destructive
        onConfirm={() => {
          if (!removing) return
          del.mutate(removing.id, {
            onSuccess: () => { toast('Pesquisa removida', 'success'); setRemoving(null) },
            onError: (e: any) => toast(e?.payload?.error || 'Não foi possível remover', 'danger'),
          })
        }}
      />
    </Page>
  )
}

// ── Criar ────────────────────────────────────────────────────────────────────

function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateSurvey()
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Nova pesquisa"
      description="Depois de criar, monte as perguntas e publique o formulário no WhatsApp."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate(
              { name: name.trim(), description: description.trim() || null, questions: [] },
              { onSuccess: () => { toast('Pesquisa criada', 'success'); onClose() },
                onError: (e: any) => toast(e?.payload?.error || 'Erro ao criar', 'danger') },
            )}
          >
            {create.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Nome" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: NPS 2º Workshop" />
        <Textarea label="Descrição (opcional)" rows={2} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
      </div>
    </Modal>
  )
}

// ── Publicar o Flow ──────────────────────────────────────────────────────────

function PublishModal({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const { data } = useCloudApiConnections()
  const conns = (data?.connections ?? []).filter((c) => c.active)
  const [connectionId, setConnectionId] = useState<number | null>(conns[0]?.id ?? null)
  const publish = usePublishSurveyFlow()
  const noQuestions = !survey.questions?.length

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={survey.flowId ? 'Republicar formulário' : 'Publicar formulário no WhatsApp'}
      description="O formulário vira um WhatsApp Flow nativo, com uma tela por seção."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!connectionId || noQuestions || publish.isPending}
            onClick={() => publish.mutate(
              { id: survey.id, connectionId: connectionId! },
              { onSuccess: () => { toast('Formulário publicado na Meta', 'success'); onClose() },
                onError: (e: any) => toast(e?.payload?.error || 'Erro ao publicar', 'danger') },
            )}
          >
            {publish.isPending ? 'Publicando…' : 'Publicar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {noQuestions && (
          <p class="text-xs text-warning flex items-start gap-2">
            <AlertTriangle size={14} class="mt-0.5 shrink-0" />
            Esta pesquisa ainda não tem perguntas.
          </p>
        )}
        <Select
          label="Conexão Cloud API"
          hint="O número pelo qual a pesquisa será enviada."
          value={connectionId ?? ''}
          onChange={(e) => setConnectionId(Number((e.target as HTMLSelectElement).value) || null)}
        >
          <option value="">— selecione —</option>
          {conns.map((c) => <option key={c.id} value={c.id}>{c.displayName || c.displayPhone} ({c.displayPhone})</option>)}
        </Select>
        <p class="text-xs text-fg-subtle">
          O formulário publicado é um retrato das perguntas de agora. Se mudar alguma pergunta depois, publique de novo — senão o disparo sai com a versão antiga.
        </p>
      </div>
    </Modal>
  )
}

// ── Disparar ─────────────────────────────────────────────────────────────────

function DispatchModal({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const { data: tpl } = useCloudApiTemplates()
  const templates = (tpl?.templates ?? []).filter((t: any) => t.status === 'APPROVED')
  const [raw, setRaw] = useState('')
  const [templateName, setTemplateName] = useState('')
  const dispatch = useDispatchSurvey()
  const targets = useMemo(() => parseTargets(raw), [raw])

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Disparar pesquisa"
      description={`"${survey.name}" será enviada para a lista abaixo.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!targets.length || dispatch.isPending}
            onClick={() => dispatch.mutate(
              { id: survey.id, targets, templateName: templateName || null },
              {
                onSuccess: (r) => {
                  toast(`${r.sent} enviada(s), ${r.skipped} ignorada(s), ${r.failed} falha(s)`, r.failed ? 'danger' : 'success')
                  if (r.errors?.length) console.warn('[pesquisa] falhas:', r.errors)
                  onClose()
                },
                onError: (e: any) => toast(e?.payload?.error || 'Erro ao disparar', 'danger'),
              },
            )}
          >
            {dispatch.isPending ? 'Enviando…' : `Enviar para ${targets.length}`}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select
          label="Template de convite"
          hint="Necessário para falar com quem não conversou com a empresa nas últimas 24 horas — que é o caso de uma pesquisa pós-evento. O template precisa ter um botão do tipo Flow."
          value={templateName}
          onChange={(e) => setTemplateName((e.target as HTMLSelectElement).value)}
        >
          <option value="">Sem template (só para conversas abertas nas últimas 24h)</option>
          {templates.map((t: any) => <option key={t.id} value={t.name}>{t.name}</option>)}
        </Select>
        <Textarea
          label="Destinatários"
          rows={8}
          value={raw}
          onInput={(e) => setRaw((e.target as HTMLTextAreaElement).value)}
          placeholder={'Um por linha:\nMaria Silva; 62 99999-0000\n62 98888-0000'}
          hint="Aceita 'nome; telefone' ou só o telefone. Quem já respondeu ou já tem convite em aberto é ignorado automaticamente."
        />
        <p class="text-xs text-fg-muted">
          {targets.length} destinatário(s) reconhecido(s){raw.trim() && !targets.length ? ' — verifique o formato dos números' : ''}.
        </p>
      </div>
    </Modal>
  )
}
