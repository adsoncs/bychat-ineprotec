import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import {
  Sparkles, ShieldCheck, FileText, Download, RefreshCw,
  Trash2, Flag, Undo2,
} from 'lucide-preact'
import {
  useIntelLead,
  useDossier,
  useGrantLgpd,
  useRunEnrichment,
  useDeleteFact,
  useDisputeFact,
} from '@/hooks/useIntelligence'
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress'
import { DossierPanel } from '@/components/intelligence/DossierPanel'
import { PromotionsBanner } from '@/components/intelligence/PromotionsBanner'
import { ScanButton } from '@/components/intelligence/ScanButton'
import { LgpdBadge, lgpdSourceLabel } from '@/components/intelligence/LgpdBadge'
import { InsightsCard } from '@/components/intelligence/InsightsCard'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { downloadFile } from '@/lib/download'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * Conteúdo completo da inteligência de um lead — usado tanto no
 * `IntelDetailModal` (página global /app/intelligence) quanto inline na aba
 * "Inteligência" do detalhe do lead. Encapsula:
 *   - Card de status: LGPD badge + botões registrar/revogar, ScanButton, JSON/PDF
 *   - Card de progresso ao vivo durante enriquecimento
 *   - Tabs Resumo (Insights, Promoções, Dossier) / Fatos brutos
 *   - Lista de fatos por fonte com ações Contestar/Restaurar/Excluir (LGPD art. 18)
 *   - Diálogos de confirmação para excluir e contestar
 */

type DetailTab = 'summary' | 'facts'

export function IntelLeadDetail({ leadId }: { leadId: number }) {
  const [tab, setTab] = useState<DetailTab>('summary')
  const [showDisputed, setShowDisputed] = useState(false)
  const detail = useIntelLead(leadId, { includeDisputed: tab === 'facts' && showDisputed })
  const dossier = useDossier(leadId)
  const grant = useGrantLgpd()
  const run = useRunEnrichment()
  const delFact = useDeleteFact()
  const dispute = useDisputeFact()
  const [confirmDelFact, setConfirmDelFact] = useState<{ id: number; field: string } | null>(null)
  const [confirmDispute, setConfirmDispute] = useState<{ id: number; field: string; source: string; restore: boolean } | null>(null)
  const [disputeReason, setDisputeReason] = useState('')

  function handleDownloadPdf() {
    void downloadFile(`/bychat/leads/${leadId}/dossier.pdf`, `dossie-${leadId}.pdf`)
      .catch((e: unknown) => toast((e as Error).message, 'danger'))
  }

  function handleDownloadJson() {
    void downloadFile(`/bychat/leads/${leadId}/dossier`, `dossie-${leadId}.json`)
      .catch((e: unknown) => toast((e as Error).message, 'danger'))
  }

  const data = detail.data
  const dossierData = dossier.data
  const isLoading = detail.isLoading || dossier.isLoading
  const totalFacts = data?.totalFacts ?? 0
  const progress = useEnrichmentProgress(leadId)
  const isRunning = data?.lead.enrichmentStatus === 'running' || progress !== null

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!data) return <EmptyState title="Sem dados de inteligência" />

  return (
    <div class="space-y-3">
      {/* Ações + status LGPD + downloads */}
      <Card class="p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-2 text-xs flex-wrap">
            <LgpdBadge consent={data.lead.lgpdConsent} source={data.lead.lgpdConsentSource ?? null} />
            {data.lead.lgpdConsent && (
              <span class="text-fg-subtle">{lgpdSourceLabel(data.lead.lgpdConsentSource ?? null)}</span>
            )}
            {data.lead.lgpdConsent && data.lead.lgpdConsentAt && (
              <span class="text-fg-subtle">· {formatDateTime(data.lead.lgpdConsentAt)}</span>
            )}
            {data.lead.enrichedAt && (
              <span class="text-fg-subtle">· enriquecido em {formatDateTime(data.lead.enrichedAt)}</span>
            )}
          </div>
          <div class="flex-1" />
          <Button
            variant={data.lead.lgpdConsent ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => grant.mutate({ id: leadId, consent: !data.lead.lgpdConsent }, {
              onSuccess: () => toast(data.lead.lgpdConsent ? 'Consentimento revogado' : 'Consentimento registrado', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
            disabled={grant.isPending}
          >
            <ShieldCheck size={12} /> {data.lead.lgpdConsent ? 'Revogar LGPD' : 'Registrar LGPD'}
          </Button>
          <ScanButton
            onScan={(mode, force) => run.mutate({ id: leadId, mode, ...(force ? { force: true } : {}) }, {
              onSuccess: () => toast(`Scan ${mode === 'quick' ? 'rápido' : 'completo'} na fila`, 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
            disabled={run.isPending || !data.lead.lgpdConsent}
          />
          <Button variant="secondary" size="sm" onClick={handleDownloadJson} disabled={totalFacts === 0}>
            <FileText size={12} /> JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownloadPdf} disabled={totalFacts === 0}>
            <Download size={12} /> PDF
          </Button>
        </div>
      </Card>

      {isRunning && (
        <Card class="p-3 border-info/40 bg-info/5">
          <div class="flex items-center gap-2 text-xs text-fg mb-2">
            <RefreshCw size={12} class="animate-spin text-info" />
            <span class="font-medium">Enriquecendo lead…</span>
            {progress && progress.total > 0 && (
              <span class="text-fg-muted">
                Provider <span class="text-fg">{progress.provider}</span> ({progress.index}/{progress.total})
                {progress.factsSoFar > 0 && <> · {progress.factsSoFar} fatos coletados</>}
              </span>
            )}
          </div>
          <div class="h-1 rounded-full bg-surface-3 overflow-hidden">
            <div
              class="h-full bg-info transition-all"
              style={{ width: progress && progress.total > 0 ? `${Math.round((progress.index / progress.total) * 100)}%` : '8%' }}
            />
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div class="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
          Resumo
        </TabButton>
        <TabButton active={tab === 'facts'} onClick={() => setTab('facts')}>
          Fatos brutos {totalFacts > 0 && <span class="text-fg-subtle">({totalFacts})</span>}
        </TabButton>
      </div>

      {tab === 'summary' && (
        <>
          <InsightsCard leadId={leadId} />
          <PromotionsBanner leadId={leadId} />
          {!dossierData || dossierData.totalFacts === 0 ? (
            <EmptyState
              icon={<Sparkles size={24} />}
              title="Sem dados ainda"
              description={data.lead.lgpdConsent
                ? 'Clique em "Enriquecer" para iniciar a coleta de fatos públicos.'
                : 'Registre o consentimento LGPD para habilitar o enriquecimento.'}
            />
          ) : (
            <DossierPanel data={dossierData} />
          )}
        </>
      )}

      {tab === 'facts' && (
        <div>
          <div class="flex items-center gap-2 mb-2 text-xs">
            <label class="inline-flex items-center gap-1.5 text-fg-muted cursor-pointer">
              <input
                type="checkbox"
                class="size-3.5 cursor-pointer accent-accent"
                checked={showDisputed}
                onChange={(e) => setShowDisputed((e.target as HTMLInputElement).checked)}
              />
              Mostrar fatos contestados
            </label>
          </div>
          {totalFacts === 0 ? (
            <p class="text-xs text-fg-muted">Nenhum fato coletado ainda.</p>
          ) : (
            <div class="space-y-3">
              {Object.entries(data.bySource).map(([source, facts]) => (
                <div key={source}>
                  <div class="text-xs font-semibold text-fg-muted mb-1.5 uppercase tracking-wide">{source}</div>
                  <ul class="divide-y divide-border bg-surface rounded-md border border-border">
                    {facts.map((f) => {
                      const isDisputed = f.status === 'disputed'
                      return (
                        <li
                          key={f.id}
                          class={cn(
                            'px-3 py-2 flex items-center gap-2 text-xs',
                            isDisputed && 'opacity-60 line-through decoration-danger/60',
                          )}
                        >
                          <code class="font-mono text-fg-subtle w-32 shrink-0 truncate">{f.field}</code>
                          <span class="text-fg flex-1 truncate">{f.value}</span>
                          {isDisputed && <Badge tone="danger">Contestado</Badge>}
                          {f.confidence !== null && (
                            <Badge
                              tone={f.confidence >= 0.7 ? 'success' : f.confidence >= 0.4 ? 'warning' : 'neutral'}
                              solid={f.confidence >= 0.4}
                            >
                              {Math.round(f.confidence * 100)}%
                            </Badge>
                          )}
                          <button
                            type="button"
                            class="size-6 rounded grid place-items-center text-fg-muted hover:text-warning hover:bg-surface-3"
                            onClick={() => {
                              setDisputeReason('')
                              setConfirmDispute({ id: f.id, field: f.field, source, restore: !!isDisputed })
                            }}
                            aria-label={isDisputed ? 'Restaurar fato' : 'Marcar como incorreto'}
                            title={isDisputed ? 'Restaurar fato' : 'Marcar como incorreto'}
                          >
                            {isDisputed ? <Undo2 size={10} /> : <Flag size={10} />}
                          </button>
                          <button
                            type="button"
                            class="size-6 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                            onClick={() => setConfirmDelFact({ id: f.id, field: f.field })}
                            aria-label="Excluir fato"
                            title="Excluir (LGPD art. 18)"
                          >
                            <Trash2 size={10} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmDelFact && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmDelFact(null) }}
          title={`Excluir fato "${confirmDelFact.field}"`}
          description="Direito à exclusão (LGPD art. 18). O fato será removido permanentemente."
          destructive
          confirmLabel="Excluir"
          loading={delFact.isPending}
          onConfirm={() => delFact.mutate({ leadId, factId: confirmDelFact.id }, {
            onSuccess: () => { toast('Fato excluído', 'success'); setConfirmDelFact(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {confirmDispute && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setConfirmDispute(null) }}
          title={confirmDispute.restore ? 'Restaurar fato' : 'Marcar fato como incorreto'}
          description={`${confirmDispute.source} · ${confirmDispute.field}`}
          size="md"
          footer={
            <div class="flex justify-end gap-2 w-full">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDispute(null)}>Cancelar</Button>
              <Button
                variant={confirmDispute.restore ? 'primary' : 'danger'}
                size="sm"
                disabled={dispute.isPending}
                onClick={() => dispute.mutate(
                  {
                    leadId,
                    factId: confirmDispute.id,
                    restore: confirmDispute.restore,
                    ...(disputeReason.trim() ? { reason: disputeReason.trim() } : {}),
                  },
                  {
                    onSuccess: () => {
                      toast(confirmDispute.restore ? 'Fato restaurado' : 'Fato contestado', 'success')
                      setConfirmDispute(null)
                    },
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  },
                )}
              >
                {confirmDispute.restore ? 'Restaurar' : 'Contestar'}
              </Button>
            </div>
          }
        >
          <div class="space-y-3 text-xs">
            {confirmDispute.restore ? (
              <p class="text-fg-muted leading-relaxed">
                Este fato voltará a ser considerado pelo dossiê e pelas promoções automáticas.
              </p>
            ) : (
              <>
                <p class="text-fg-muted leading-relaxed">
                  O fato será ocultado do dossiê e das sugestões de abordagem, mas permanece no banco
                  para auditoria. Use isso quando o dado estiver errado ou desatualizado — o motor
                  pode usar essa sinalização para de-priorizar a fonte no futuro.
                </p>
                <div>
                  <label class="block text-fg-muted mb-1">Motivo (opcional)</label>
                  <textarea
                    value={disputeReason}
                    onInput={(e) => setDisputeReason((e.target as HTMLTextAreaElement).value)}
                    placeholder="Ex.: empresa errada, lead trocou de cidade…"
                    rows={3}
                    class="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-fg focus:outline-none focus:border-accent"
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'h-9 px-3 -mb-px text-xs font-medium border-b-2 transition-colors',
        active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
