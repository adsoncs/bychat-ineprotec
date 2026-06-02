import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, FileCheck2, FileText, ScrollText, Settings2 } from 'lucide-preact'
import {
  useSelectionProcess,
  useUpdateSelectionProcess,
  useCloneSPDocsFromMode,
  type SelectionProcess,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { DocumentRequirementsEditor } from '@/components/educational/DocumentRequirementsEditor'
import { EssayTopicsEditor } from '@/components/educational/EssayTopicsEditor'
import { EssayConfigEditor, PresencialConfigEditor } from '@/components/educational/EssayConfigEditor'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tab = 'overview' | 'documents' | 'evaluation' | 'topics'

export function EducationalSelectionProcessDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { data, isLoading, error } = useSelectionProcess(Number.isFinite(id) ? id : null)
  const [, navigate] = useLocation()
  const [tab, setTab] = useState<Tab>('overview')

  const process = data?.process
  const evalType = process?.entryMode?.evaluationType
  const showEssayTab = evalType === 'exam_online'
  const showEvalTab = evalType === 'exam_online' || evalType === 'exam_presencial'

  return (
    <Page
      title={process?.nome ?? 'Processo seletivo'}
      description={process?.entryMode?.name ?? 'Configuração do processo seletivo'}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate('/educational/selection-processes')}>
          <ChevronLeft size={14} /> Voltar
        </Button>
      }
    >
      {isLoading && (
        <>
          <Skeleton class="h-10 w-64" />
          <Skeleton class="h-32 w-full" />
        </>
      )}

      {error && (
        <Card>
          <div class="text-sm text-danger">Erro: {(error).message}</div>
        </Card>
      )}

      {process && (
        <>
          <ProcessTabs tab={tab} onChange={setTab} showEssayTab={showEssayTab} showEvalTab={showEvalTab} />

          {tab === 'overview' && <OverviewTab process={process} />}
          {tab === 'documents' && <DocumentsTab process={process} />}
          {tab === 'evaluation' && showEvalTab && (
            evalType === 'exam_online'
              ? <EssayConfigEditor process={process} />
              : <PresencialConfigEditor process={process} />
          )}
          {tab === 'topics' && showEssayTab && <EssayTopicsEditor selectionProcessId={process.id} />}
        </>
      )}
    </Page>
  )
}

function ProcessTabs({
  tab, onChange, showEssayTab, showEvalTab,
}: { tab: Tab; onChange: (t: Tab) => void; showEssayTab: boolean; showEvalTab: boolean }) {
  const tabs: { id: Tab; label: string; icon: preact.ComponentChildren }[] = [
    { id: 'overview', label: 'Visão geral', icon: <FileCheck2 size={14} /> },
    { id: 'documents', label: 'Documentos', icon: <FileText size={14} /> },
  ]
  if (showEvalTab) tabs.push({ id: 'evaluation', label: 'Avaliação', icon: <Settings2 size={14} /> })
  if (showEssayTab) tabs.push({ id: 'topics', label: 'Temas de redação', icon: <ScrollText size={14} /> })

  return (
    <div class="border-b border-border flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          class={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-[1px]',
            tab === t.id
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg',
          )}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

function OverviewTab({ process: p }: { process: SelectionProcess }) {
  const meta: { label: string; value: preact.ComponentChildren }[] = [
    { label: 'Modo de ingresso', value: p.entryMode?.name ?? '—' },
    { label: 'Unidade', value: p.unit?.nome ?? '—' },
    { label: 'Nível', value: p.level?.nome ?? '—' },
    { label: 'Período letivo', value: p.periodoLetivo ?? '—' },
    { label: 'Status', value: p.status },
    { label: 'Slug público', value: p.slug ? <code class="text-fg">{p.slug}</code> : '—' },
    { label: 'Taxa de inscrição', value: p.taxaInscricao != null ? `R$ ${p.taxaInscricao.toFixed(2)}` : '—' },
    { label: 'Nota de corte', value: p.notaCorte != null ? p.notaCorte.toString() : '—' },
  ]

  return (
    <div class="space-y-3">
      <Card>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {meta.map((m) => (
            <div key={m.label} class="flex items-center gap-2 text-sm">
              <span class="text-fg-subtle text-xs w-32 shrink-0">{m.label}</span>
              <span class="text-fg truncate">{m.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {p.descricao && (
        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1">Descrição</div>
          <div class="text-sm text-fg whitespace-pre-wrap">{p.descricao}</div>
        </Card>
      )}

      {p.editalUrl && (
        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1">Edital</div>
          <a href={p.editalUrl} class="text-sm text-accent hover:underline" target="_blank" rel="noopener noreferrer">
            {p.editalUrl}
          </a>
        </Card>
      )}

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Datas</div>
        <div class="space-y-1 text-sm">
          <DateLine label="Inscrições" from={p.inicioInscricao} to={p.terminoInscricao} />
          <DateLine label="Matrículas" from={p.inicioMatricula} to={p.terminoMatricula} />
        </div>
      </Card>

      {p._count && (
        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Atividade</div>
          <div class="grid grid-cols-2 gap-3">
            <Stat label="Ofertas vinculadas" value={p._count.offerings} />
            <Stat label="Inscrições" value={p._count.registrations} />
          </div>
        </Card>
      )}
    </div>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function DateLine({ label, from, to }: { label: string; from: string | null; to: string | null }) {
  return (
    <div class="flex items-center gap-3">
      <span class="text-fg-subtle text-xs w-24">{label}</span>
      <span class="text-fg tabular-nums">{fmtDate(from)} → {fmtDate(to)}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div class="text-xs text-fg-subtle">{label}</div>
      <div class="text-2xl font-semibold text-fg tabular-nums">{value}</div>
    </div>
  )
}

function DocumentsTab({ process: p }: { process: SelectionProcess }) {
  const update = useUpdateSelectionProcess()
  const clone = useCloneSPDocsFromMode(p.id)

  const useCustom = p.useCustomDocuments
  const inheritedDocs = p.entryMode?.documentRequirements ?? []
  const customDocs = p.documentRequirements ?? []

  function toggleCustom() {
    update.mutate({ id: p.id, useCustomDocuments: !useCustom }, {
      onSuccess: () => toast(useCustom ? 'Voltou a herdar do modo' : 'Documentos customizados ativados', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleClone() {
    clone.mutate(undefined, {
      onSuccess: (r) => {
        if (r.cloned > 0) toast(`${r.cloned} documento(s) clonado(s) do modo`, 'success')
        else toast('Nada a clonar — todos os defaults já estão na lista', 'info')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="text-sm font-medium text-fg">
              {useCustom ? 'Lista customizada para este processo' : `Herdando do modo "${p.entryMode?.name ?? '—'}"`}
            </div>
            <div class="text-xs text-fg-subtle mt-0.5">
              {useCustom
                ? 'Os candidatos veem os documentos abaixo, ignorando o default do modo de ingresso.'
                : 'Os candidatos veem os documentos default do modo. Ative o toggle para sobrescrever.'}
            </div>
          </div>
          <Button size="sm" variant={useCustom ? 'secondary' : 'primary'} onClick={toggleCustom} disabled={update.isPending}>
            {useCustom ? 'Voltar ao default do modo' : 'Customizar para este processo'}
          </Button>
        </div>
      </Card>

      {!useCustom && (
        <DocumentRequirementsEditor
          owner={{ kind: 'entry-mode', entryModeId: p.entryModeId ?? 0 }}
          requirements={inheritedDocs}
          readonly
          banner={
            <>
              Visualização do default do modo. Para editar este conjunto, vá em{' '}
              <a href="/app/educational/entry-modes" class="text-accent hover:underline">Modos de ingresso</a> ou
              ative o toggle acima para customizar só este processo.
            </>
          }
        />
      )}

      {useCustom && (
        <DocumentRequirementsEditor
          owner={{ kind: 'selection-process', selectionProcessId: p.id }}
          requirements={customDocs}
          banner={
            customDocs.length === 0 && inheritedDocs.length > 0
              ? <>O modo "{p.entryMode?.name}" possui {inheritedDocs.length} documento(s). Use "Clonar do modo de ingresso" abaixo pra começar a partir do default.</>
              : undefined
          }
          onCloneFromMode={inheritedDocs.length > 0 ? handleClone : undefined}
          cloneLoading={clone.isPending}
        />
      )}
    </div>
  )
}
