import { FaixaDoPortal } from '@/lib/identidadePortal'
import { ListaDeFaturas, Recolhivel, ResumoValores, TentativasDeCobranca, type Tentativa } from '@/components/educational/PagamentosDaMatricula'
import { ComercialInscricaoCard } from '@/components/comercial/ComercialInscricaoCard'
import { ContratoPresencialModal, HistoricoDaInscricao, PagamentoManualModal } from './enrollmentPortal/InscricaoAssistida'
import { AbaFinanceiro } from './enrollmentPortal/matricula/AbaFinanceiro'
import { AbaCadastro } from './enrollmentPortal/matricula/AbaCadastro'
import { PedirAssinatura } from './enrollmentPortal/matricula/PedirAssinatura'
import { BotaoDispensa, SeloDispensa, invalidarInscricao } from './enrollmentPortal/matricula/Dispensa'
import { chamarComoAgente } from './enrollmentPortal/matricula/sessao'
import { AvisoDeTransferencia, BotaoTransferirCurso } from './enrollmentPortal/matricula/TransferirCurso'
import { useRef, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter-preact'
import {
  ChevronLeft, FileCheck2, AlertCircle, Bot, ExternalLink, Download, RefreshCw, Bell, CheckCircle, XCircle, Clock, Award, Send, Pencil, CreditCard, FileText, QrCode, Copy, Eye, Lock, GraduationCap, LayoutDashboard, IdCard, Wallet, History as IconeHistorico, Paperclip, Trash2,
} from '@/components/ui/icon-set'
import {
  useRegistrationReview,
  useRegistrationFull,
  useReviewDocument,
  useRenotifyDocument,
  useReanalyzeDocument,
  useBulkApproveAi,
  useUpdateEnemImport,
  useResendMagicLink,
  useResendRegistrationLink,
  useSyncRegistrationPayment,
  type RegistrationReview,
  type DocumentSlot,
  type EnrollmentDocument,
  type DocumentStatus,
  type EnemImportFull,
  useEnrollmentPortals,
} from '@/hooks/useEnrollmentPortals'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { variacaoDaOferta } from '@/lib/variacaoDaOferta'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { downloadFile } from '@/lib/download'
import { api } from '@/lib/apiClient'
import { resumoDoPlano, reais } from '@/lib/cobrancas'
import { ContratoDaInscricaoCard } from './contratos/ContratoDaInscricaoCard'
import { EssayReviewModal } from './educational/EducationalEvaluationsPage'
import { useEssaySubmission } from '@/hooks/useEducationalReview'
import { toast } from '@/lib/toast'
import { formatRelative } from '@/lib/format'
import { paymentStatusLabel, paymentStatusTone, paymentMethodLabel } from '@/lib/paymentLabels'
import { SeiInscricaoCard } from './integrations/SeiIntegration'
import { MoodleInscricaoCard } from './integrations/MoodleIntegration'
import { SomenteLeitura } from '@/components/auth/SomenteLeitura'
import { useCan } from '@/hooks/usePermissions'
import { SeloIntegridade } from '@/components/educational/IntegridadePainel'

const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
}

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  pending: 'Aguardando pagamento',
  submitted: 'Enviada',
  paid: 'Paga',
  docs_uploaded: 'Docs enviados',
  docs_reviewing: 'Docs em análise',
  docs_approved: 'Docs aprovados',
  docs_rejected: 'Docs rejeitados',
  reviewing: 'Em análise',
  approved: 'Aprovada',
  enrolled: 'Matriculada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
}

export function EnrollmentRegistrationDetailPage({ params }: { params: { portalId: string; regId: string } }) {
  const portalId = parseInt(params.portalId)
  const regId = parseInt(params.regId)
  const { data, isLoading, error } = useRegistrationReview(Number.isFinite(regId) ? regId : null)
  const [, navigate] = useLocation()

  const review = data
  // Três chamadas separadas: hook não pode ficar atrás de um && (mudaria a ordem).
  const edPortal = useCan('enrollment_portals', 'edit')
  const edRevisao = useCan('edu_revisao_documentos', 'edit')
  const edAvaliacao = useCan('edu_avaliacoes', 'edit')
  const podeEditarPortal = edPortal && edRevisao && edAvaliacao
  // Inscrição assistida: mesma permissão do "Nova inscrição".
  const podeAtender = useCan('enrollment_portals', 'create')
  // Permissão própria, ou quem já dá baixa no Financeiro do portal.
  const pmTela = useCan('edu_pagamento_manual', 'edit')
  const pmFinanceiro = useCan('edu_financeiro_portal', 'edit')
  const podePagamentoManual = pmTela || pmFinanceiro
  const [pagamentoManual, setPagamentoManual] = useState(false)
  const podeContratoPapel = useCan('edu_contrato_presencial', 'edit')
  const [contratoPapel, setContratoPapel] = useState(false)
  // Mesma consulta do cabeçalho (cache compartilhado): ordena os cards das etapas.
  const etapasDaPagina = useQuery({
    queryKey: ['registration-etapas', regId],
    queryFn: () => api.get<{ inscricao: EtapaAdmin[]; painel: EtapaAdmin[] }>(`/admin/enrollment-registrations/${regId}/etapas`),
    enabled: Number.isFinite(regId),
    staleTime: 15_000,
  })
  // A aba fica na URL: recarregar ou mandar o endereço abre no mesmo lugar.
  const [aba, setAbaInterna] = useState<AbaMatricula>(() => {
    const v = new URLSearchParams(window.location.search).get('aba')
    return (ABAS_VALIDAS as string[]).includes(v ?? '') ? v as AbaMatricula : 'resumo'
  })
  const setAba = (a: AbaMatricula) => {
    setAbaInterna(a)
    const q = new URLSearchParams(window.location.search)
    q.set('aba', a)
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
  }
  const todasAsEtapas = unirEtapas(etapasDaPagina.data?.inscricao, etapasDaPagina.data?.painel)
  const etapaAnalise = todasAsEtapas.find((e) => e.chave === 'analise')
  const etapaContrato = todasAsEtapas.find((e) => e.chave === 'contrato')
  const temAvaliacao = !!review?.essay?.required || todasAsEtapas.some((e) => e.chave === 'prova')
  const aberta = !!review && !['cancelled', 'merged', 'expired'].includes(String(review.registration.status))
  const dispensasDaTela = ((review?.registration.formData as any)?._dispensas ?? {}) as { etapas?: Record<string, { motivo: string; por: string; em: string }> }
  const verComoAluno = useMutation({
    mutationFn: () => api.post<{ url: string }>('/admin/inscricao-assistida', { portalId, leadId: review?.lead?.id ?? null }),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  function handleReceipt() {
    downloadFile(
      `/admin/enrollment-registrations/${regId}/receipt.pdf`,
      `comprovante-${review?.registration.candidateCode ?? regId}.html`,
    )
      .then(() => toast('Comprovante baixado', 'success'))
      .catch((e) => toast((e as Error).message, 'danger'))
  }

  return (
    <Page
      title={review?.registration.candidateCode ?? 'Inscrição'}
      description={review?.lead?.nome ?? 'Detalhe da inscrição'}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => {
            const de = new URLSearchParams(window.location.search).get('de')
            navigate(de && de.startsWith('/') && !de.startsWith('//') ? de : `/enrollment-portals/${portalId}`)
          }}>
            <ChevronLeft size={14} /> Voltar
          </Button>
          {review && podeAtender && review.lead?.id && aberta && (
            <Button variant="secondary" size="sm" disabled={verComoAluno.isPending} onClick={() => verComoAluno.mutate()}
              title="Abre em outra aba o portal como o aluno vê esta inscrição">
              <Eye size={12} /> Ver como o aluno vê
            </Button>
          )}
          {review && <BotaoTransferirCurso registrationId={review.registration.id} portalIdAtual={portalId} aberta={aberta} />}
          {review && (
            <Button variant="secondary" size="sm" onClick={handleReceipt}>
              <Download size={12} /> Comprovante
            </Button>
          )}
        </>
      }
    >
      {isLoading && (
        <>
          <Skeleton class="h-32 w-full" />
          <Skeleton class="h-48 w-full" />
        </>
      )}
      {error && (
        <Card>
          <div class="text-sm text-danger">Erro ao carregar inscrição: {(error).message}</div>
        </Card>
      )}

      {review && (
        <>
          {!podeEditarPortal && (
            <div class="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
              Você vê esta inscrição, mas as ações que exigem "Editar" (no Portal, na Revisão de documentos ou em Avaliações) ficam desativadas para o seu perfil.
            </div>
          )}
          <FaixaDaInscricao portalId={review.portal?.id ?? portalId} polo={typeof (review.registration.formData as any)?.campusNome === 'string' ? (review.registration.formData as any).campusNome : null} />
          <AvisoDeTransferencia registrationId={review.registration.id} />
          <StatusBanner review={review} aoAbrirEtapa={(chave) => setAba(abaDaEtapa(chave))} />
          <AbasDaMatricula aba={aba} aoMudar={setAba} etapas={todasAsEtapas} temAvaliacao={temAvaliacao} />

          {aba === 'resumo' && (
            <div class="grid gap-3">
              <EtapasCard registrationId={review.registration.id} etapas={todasAsEtapas} dispensas={dispensasDaTela.etapas} aoAbrir={(chave) => setAba(abaDaEtapa(chave))} podeOperar={podeAtender && aberta} />
              <div class="grid gap-3 lg:grid-cols-2">
                <CandidateCard review={review} />
                <RegistrationCard review={review} />
              </div>
              <SomenteLeitura aviso={false} tela="enrollment_portals"><CandidatePortalCard review={review} /></SomenteLeitura>
              <ComercialInscricaoCard registrationId={review.registration.id} />
              {/* Última etapa: a matrícula no ERP acadêmico. Some sozinho com a integração desligada. */}
              <SeiInscricaoCard registrationId={review.registration.id} />
              <MoodleInscricaoCard registrationId={review.registration.id} />
            </div>
          )}

          {aba === 'cadastro' && (podeAtender && aberta
            ? <AbaCadastro review={review} podeEditar />
            : <div class="grid gap-3"><CandidateCard review={review} /><DadosCadastroCard review={review} /><RegistrationCard review={review} /></div>)}

          {aba === 'financeiro' && (podeAtender ? (
            <AbaFinanceiro registrationId={review.registration.id} pago={review.registration.paymentStatus === 'paid'} fechada={!aberta}
              acoes={podePagamentoManual && review.registration.paymentStatus !== 'paid' && aberta
                ? <Button variant="secondary" size="sm" onClick={() => setPagamentoManual(true)} title="Pagamento recebido fora do gateway (dinheiro, Pix direto, maquininha), com comprovante">Registrar pagamento manual</Button>
                : undefined}>
              <SomenteLeitura aviso={false} tela="enrollment_portals"><PaymentMethodsBlock registrationId={review.registration.id} podeOperar={podeAtender} /></SomenteLeitura>
            </AbaFinanceiro>
          ) : <SomenteLeitura aviso={false} tela="enrollment_portals"><PaymentMethodsBlock registrationId={review.registration.id} podeOperar={podeAtender} /></SomenteLeitura>)}

          {aba === 'documentos' && (
            <div class="grid gap-3">
              {etapaAnalise?.analise && <SomenteLeitura aviso={false} tela="edu_revisao_documentos"><AnaliseAcademicaCard registrationId={review.registration.id} etapa={etapaAnalise} /></SomenteLeitura>}
              <SomenteLeitura aviso={false} tela="edu_revisao_documentos">
                <SlotsCard review={review} podeOperar={podeAtender && aberta} />
                {(review.extras.length > 0 || (podeAtender && aberta)) && <ExtrasCard extras={review.extras} registrationId={review.registration.id} podeOperar={podeAtender && aberta} />}
                {review.autoAdvance.enabled && <AutoAdvanceCard review={review} />}
                <BulkActionsCard registrationId={review.registration.id} />
              </SomenteLeitura>
            </div>
          )}

          {aba === 'contrato' && (
            <div class="grid gap-3">
              {aberta && etapaContrato && etapaContrato.situacao !== 'feito' && podeAtender && (
                <PedirAssinatura registrationId={review.registration.id} whatsapp={review.lead?.whatsapp} />
              )}
              {aberta && etapaContrato && podeAtender && (etapaContrato.situacao !== 'feito' || etapaContrato.dispensada) && (
                <Card>
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div class="text-xs text-fg-muted max-w-2xl">
                      Se o aluno assinou a via impressa, anexe aqui.
                      {dispensasDaTela.etapas?.contrato && <div class="mt-1"><SeloDispensa dispensa={dispensasDaTela.etapas.contrato} /></div>}
                    </div>
                    <div class="flex items-center gap-1.5">
                      {podeContratoPapel && <Button variant="secondary" size="sm" onClick={() => setContratoPapel(true)}>Contrato assinado no papel</Button>}
                      <BotaoDispensa registrationId={review.registration.id} tipo="etapa" chave="contrato" nome="Contrato" dispensa={dispensasDaTela.etapas?.contrato} aviso={AVISO_DISPENSA.contrato} />
                    </div>
                  </div>
                </Card>
              )}
              <SomenteLeitura aviso={false} tela="enrollment_portals"><ContratoDaInscricaoCard registrationId={review.registration.id} /></SomenteLeitura>
            </div>
          )}

          {aba === 'avaliacao' && (
            <div class="grid gap-3">
              <SomenteLeitura aviso={false} tela="edu_avaliacoes"><RedacaoCard review={review} /></SomenteLeitura>
              {/* Notas do ENEM: não é etapa da jornada; o bloco some sozinho sem nota importada. */}
              <SomenteLeitura aviso={false} tela="edu_avaliacoes"><EnemBlock registrationId={review.registration.id} /></SomenteLeitura>
            </div>
          )}

          {aba === 'historico' && (
            <Card>
              <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Histórico da inscrição</div>
              <HistoricoDaInscricao registrationId={review.registration.id} />
            </Card>
          )}

          {contratoPapel && (
            <ContratoPresencialModal registrationId={review.registration.id} candidateCode={review.registration.candidateCode}
              nomeCandidato={review.lead?.nome} onClose={() => setContratoPapel(false)} />
          )}
          {pagamentoManual && (
            <PagamentoManualModal registrationId={review.registration.id} candidateCode={review.registration.candidateCode} onClose={() => setPagamentoManual(false)} />
          )}
        </>
      )}
    </Page>
  )
}

// ── Abas da matrícula interna ───────────────────────────────────────────────

type AbaMatricula = 'resumo' | 'cadastro' | 'financeiro' | 'documentos' | 'contrato' | 'avaliacao' | 'historico'
const ABAS_VALIDAS: AbaMatricula[] = ['resumo', 'cadastro', 'financeiro', 'documentos', 'contrato', 'avaliacao', 'historico']
const abaDaEtapa = (chave: string): AbaMatricula =>
  chave === 'cadastro' ? 'cadastro' : chave === 'pagamento' ? 'financeiro' : chave === 'contrato' ? 'contrato' : chave === 'prova' ? 'avaliacao' : 'documentos'

/** Etapas da inscrição e do portal logado, sem repetir (vale a da inscrição). */
function unirEtapas(a: EtapaAdmin[] | undefined, b: EtapaAdmin[] | undefined): EtapaAdmin[] {
  const out = [...(a ?? [])]
  for (const e of b ?? []) if (!out.some((x) => x.chave === e.chave)) out.push(e)
  return out
}

function AbasDaMatricula({ aba, aoMudar, etapas, temAvaliacao }: { aba: AbaMatricula; aoMudar: (a: AbaMatricula) => void; etapas: EtapaAdmin[]; temAvaliacao: boolean }) {
  const lista: Array<{ id: AbaMatricula; rotulo: string; icone: preact.ComponentChildren }> = [
    { id: 'resumo', rotulo: 'Resumo', icone: <LayoutDashboard size={14} /> },
    { id: 'cadastro', rotulo: 'Cadastro', icone: <IdCard size={14} /> },
    { id: 'financeiro', rotulo: 'Financeiro', icone: <Wallet size={14} /> },
    { id: 'documentos', rotulo: 'Documentos', icone: <FileCheck2 size={14} /> },
    { id: 'contrato', rotulo: 'Contrato', icone: <FileText size={14} /> },
    ...(temAvaliacao ? [{ id: 'avaliacao' as AbaMatricula, rotulo: 'Avaliação', icone: <Award size={14} /> }] : []),
    { id: 'historico', rotulo: 'Histórico', icone: <IconeHistorico size={14} /> },
  ]
  // Bolinha: pendente em âmbar, aguardando a equipe em azul, concluída em verde.
  const situacao = (id: AbaMatricula) => {
    const daAba = etapas.filter((e) => abaDaEtapa(e.chave) === id && id !== 'resumo')
    if (!daAba.length) return null
    if (daAba.some((e) => e.situacao === 'pendente')) return 'bg-warning'
    if (daAba.some((e) => e.situacao === 'aguardando')) return 'bg-info'
    return 'bg-success'
  }
  return (
    <div class="border-b border-border flex gap-1 overflow-x-auto" role="tablist">
      {lista.map((t) => {
        const cor = situacao(t.id)
        return (
          <button key={t.id} type="button" role="tab" aria-selected={aba === t.id}
            class={`inline-flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-[1px] ${aba === t.id ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'}`}
            onClick={() => aoMudar(t.id)}>
            {t.icone} {t.rotulo}
            {cor && <span class={`inline-block size-1.5 rounded-full ${cor}`} />}
          </button>
        )
      })}
    </div>
  )
}

/** O que falta nesta inscrição, numa tabela só, com o caminho para resolver. */
const ETAPAS_QUE_DISPENSAM = ['cadastro', 'analise', 'documentos', 'contrato', 'prova']
const AVISO_DISPENSA: Record<string, string> = {
  contrato: 'O aceite não é simulado: a etapa conclui para o aluno e para o funil, mas SEI e Moodle continuam esperando o contrato assinado.',
}
function EtapasCard({ registrationId, etapas, dispensas, aoAbrir, podeOperar }: {
  registrationId: number
  etapas: EtapaAdmin[]
  dispensas: Record<string, { motivo: string; por: string; em: string }> | undefined
  aoAbrir: (chave: string) => void
  podeOperar: boolean
}) {
  if (!etapas.length) return null
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Etapas</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[36rem]">
          <thead><tr class="text-left text-xs text-fg-subtle border-b border-border">
            <th class="py-1.5 pr-3 font-medium">Etapa</th><th class="py-1.5 px-2 font-medium">Situação</th><th class="py-1.5 px-2 font-medium">Detalhe</th><th class="py-1.5" />
          </tr></thead>
          <tbody>
            {etapas.map((e) => {
              const sit = SITUACAO_ETAPA[e.situacao] ?? SITUACAO_ETAPA.pendente!
              const d = dispensas?.[e.chave]
              return (
                <tr key={e.chave} class="border-b border-border last:border-0 align-top">
                  <td class="py-2 pr-3 text-fg whitespace-nowrap">{e.titulo}</td>
                  <td class="py-2 px-2 whitespace-nowrap"><Badge tone={sit.tone}>{e.dispensada ? 'dispensada' : sit.rotulo}</Badge></td>
                  <td class="py-2 px-2 text-xs text-fg-muted">
                    {e.detalhe}
                    {e.bloqueada && <div class="text-2xs text-fg-subtle">Para o aluno: {e.bloqueada.motivo}</div>}
                    {d && <SeloDispensa dispensa={d} />}
                  </td>
                  <td class="py-1.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => aoAbrir(e.chave)}>Abrir</Button>
                    {podeOperar && ETAPAS_QUE_DISPENSAM.includes(e.chave) && (d || e.situacao !== 'feito') && (
                      <BotaoDispensa registrationId={registrationId} tipo="etapa" chave={e.chave} nome={e.titulo} dispensa={d} aviso={AVISO_DISPENSA[e.chave]} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/**
 * Anexa pela mesma rota do aluno: entra igual e aparece na tela dele.
 * Requisito com frente e verso abre a escolha dos dois arquivos (ou um único
 * com as duas faces, como um PDF escaneado).
 */
function AnexarDocumento({ registrationId, typeCode, rotulo, frenteVerso = false, class: classe }: { registrationId: number; typeCode: string; rotulo: string; frenteVerso?: boolean; class?: string }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [aberto, setAberto] = useState(false)
  const enviar = useMutation({
    mutationFn: ({ frente, verso }: { frente: File; verso?: File | null }) => {
      const fd = new FormData()
      fd.append('type', typeCode); fd.append('label', rotulo)
      fd.append('file', frente)
      if (verso) fd.append('verso', verso)
      return chamarComoAgente(registrationId, () => '/candidate/documents', { method: 'POST', form: fd })
    },
    onSuccess: () => { toast('Documento anexado', 'success'); invalidarInscricao(qc, registrationId); setAberto(false) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  return (
    <span class={classe}>
      <input ref={input} type="file" class="hidden" accept=".pdf,image/*"
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) enviar.mutate({ frente: f }); (e.target as HTMLInputElement).value = '' }} />
      <Button size="sm" variant="secondary" disabled={enviar.isPending} onClick={() => frenteVerso ? setAberto(true) : input.current?.click()}>
        <Paperclip size={12} /> {enviar.isPending ? 'Enviando…' : 'Anexar'}
      </Button>
      {aberto && <AnexarFrenteVersoModal rotulo={rotulo} enviando={enviar.isPending} onClose={() => setAberto(false)} onEnviar={(frente, verso) => enviar.mutate({ frente, verso })} />}
    </span>
  )
}

function AnexarFrenteVersoModal({ rotulo, enviando, onClose, onEnviar }: { rotulo: string; enviando: boolean; onClose: () => void; onEnviar: (frente: File, verso: File | null) => void }) {
  const [unico, setUnico] = useState(false)
  const [frente, setFrente] = useState<File | null>(null)
  const [verso, setVerso] = useState<File | null>(null)
  const pronto = !!frente && (unico || !!verso)
  const Campo = ({ titulo, arquivo, onEscolher }: { titulo: string; arquivo: File | null; onEscolher: (f: File | null) => void }) => (
    <label class="flex flex-col gap-1">
      <span class="text-xs font-semibold text-fg-muted">{titulo}</span>
      <input type="file" accept=".pdf,image/*" class="text-xs text-fg file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-fg"
        onChange={(e) => onEscolher((e.target as HTMLInputElement).files?.[0] ?? null)} />
      {arquivo && <span class="text-2xs text-fg-muted truncate">{arquivo.name}</span>}
    </label>
  )
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={`Anexar ${rotulo}`} size="sm"
      description="Este documento é pedido com frente e verso."
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="primary" disabled={!pronto || enviando} onClick={() => frente && onEnviar(frente, unico ? null : verso)}>{enviando ? 'Enviando…' : 'Anexar'}</Button>
      </>}>
      <div class="grid gap-3">
        <Campo titulo={unico ? 'Arquivo com as duas faces' : 'Frente'} arquivo={frente} onEscolher={setFrente} />
        {!unico && <Campo titulo="Verso" arquivo={verso} onEscolher={setVerso} />}
        <label class="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={unico} onChange={(e) => setUnico((e.target as HTMLInputElement).checked)} />
          Tenho um arquivo único com frente e verso (ex.: PDF escaneado)
        </label>
      </div>
    </Modal>
  )
}

function RemoverDocumento({ registrationId, docId }: { registrationId: number; docId: number }) {
  const qc = useQueryClient()
  const remover = useMutation({
    mutationFn: () => chamarComoAgente(registrationId, () => `/candidate/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Documento removido', 'success'); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  return <Button size="sm" variant="ghost" disabled={remover.isPending} onClick={() => remover.mutate()}><Trash2 size={12} /> Remover</Button>
}

function EnemBlock({ registrationId }: { registrationId: number }) {
  const { data } = useRegistrationFull(registrationId)
  const imports = data?.registration.enemScoreImports ?? []
  const [editing, setEditing] = useState<EnemImportFull | null>(null)

  if (imports.length === 0) return null

  return (
    <Card>
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted inline-flex items-center gap-2">
          <Award size={12} /> ENEM ({imports.length})
        </div>
      </div>
      <ul class="space-y-2">
        {imports.map((imp) => (
          <li key={imp.id} class="rounded-md border border-border p-3 bg-surface">
            <div class="flex items-start gap-3 flex-wrap">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="text-sm font-medium text-fg">{imp.nome ?? '—'}</span>
                  {imp.inscricao && <code class="text-2xs text-fg-muted font-mono">{imp.inscricao}</code>}
                  {imp.ano && <span class="text-2xs text-fg-muted">ENEM {imp.ano}</span>}
                  {imp.treineiro && <Badge tone="info">Treineiro</Badge>}
                  {imp.passed === true && <Badge tone="success">Aprovado</Badge>}
                  {imp.passed === false && <Badge tone="danger">Reprovado</Badge>}
                  {imp.passed === null && <Badge tone="warning">Pendente</Badge>}
                </div>
                <div class="text-xs text-fg-muted">
                  Média: <strong class="text-fg">{imp.mediaSimples?.toFixed(1) ?? '—'}</strong>
                  {imp.cutoffScore !== null && <span class="text-fg-muted"> · corte {imp.cutoffScore}</span>}
                  {imp.aiConfidence !== null && <span class="text-fg-muted"> · IA {Math.round(imp.aiConfidence * 100)}%</span>}
                </div>
                <div class="text-2xs text-fg-muted mt-1">
                  CN {imp.cienciasNatureza ?? '—'} · CH {imp.cienciasHumanas ?? '—'} · LG {imp.linguagens ?? '—'} · MT {imp.matematica ?? '—'} · RD {imp.redacao ?? '—'}
                </div>
                {imp.validationNote && (
                  <div class="text-2xs text-fg-muted mt-1 italic">"{imp.validationNote}"</div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setEditing(imp)}>
                <Pencil size={11} /> Editar notas
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <EnemEditModal imp={editing} registrationId={registrationId} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function PaymentMethodsBlock({ registrationId, podeOperar }: { registrationId: number; podeOperar: boolean }) {
  const { data } = useRegistrationFull(registrationId)
  const sync = useSyncRegistrationPayment(registrationId)
  const methods = data?.registration.paymentMethods ?? []
  const paymentStatus = data?.registration.paymentStatus
  const requirePayment = !!data?.registration.portal?.requirePayment

  // Pode aparecer mesmo sem methods (modo link antigo) — desde que requirePayment.
  if (methods.length === 0 && !requirePayment) return null

  const hasPending = methods.some(m => m.status !== 'paid') || paymentStatus !== 'paid'
  const resumo = resumoDoPlano(data?.registration.paymentPlan, { status: paymentStatus ?? null, valor: data?.registration.paymentAmount ?? null })
  const descontos = resumo ? resumo.descontoCupom + resumo.descontoAVista : 0

  function handleSync() {
    sync.mutate(undefined, {
      onSuccess: (r) => {
        if (r.transitionedToPaid) {
          toast('Pagamento confirmado!', 'success')
        } else {
          const stillPending = r.results.find(x => x.error)
          if (stillPending?.error) toast(stillPending.error, 'warning')
          else toast('Sincronizado — status atual no provider mantido.', 'info')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div class="text-xs uppercase tracking-wider text-fg-muted inline-flex items-center gap-2">
          <CreditCard size={12} /> Pagamentos
        </div>
        {hasPending && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            disabled={sync.isPending}
            title="Consulta o status atual no gateway (Asaas, Pagar.me ou iugu) e replica no banco. Útil quando o webhook não chegou."
          >
            <RefreshCw size={11} class={sync.isPending ? 'animate-spin' : ''} />
            {sync.isPending ? 'Consultando…' : 'Consultar gateway'}
          </Button>
        )}
      </div>
      <div class="space-y-4">
        {resumo && (
          <ResumoValores itens={[
            { rotulo: 'Valor de tabela', valor: reais(resumo.valorCheio) },
            { rotulo: 'Descontos', valor: descontos > 0 ? `−${reais(descontos)}` : '—', tom: descontos > 0 ? 'success' : undefined, extra: [resumo.cupom && `cupom ${resumo.cupom}`, resumo.descontoAVista > 0 && 'à vista'].filter(Boolean).join(' · ') },
            resumo.acrescimo > 0 && { rotulo: 'Juros do parcelamento', valor: `+${reais(resumo.acrescimo)}` },
            { rotulo: paymentStatus === 'paid' ? 'Recebido' : 'A receber', valor: reais(resumo.valorCobrado), extra: [resumo.meio && paymentMethodLabel(resumo.meio), resumo.parcelas > 1 && `${resumo.parcelas}x`].filter(Boolean).join(' · ') || null },
          ]} />
        )}
        {methods.length === 0 && data?.registration.paymentUrl ? (
          <div class="text-sm text-fg-muted">
            Pagamento por link, sem cobrança registrada: <a href={data.registration.paymentUrl} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">abrir link de pagamento ↗</a>
          </div>
        ) : (
          <ListaDeFaturas registrationId={registrationId} origem="inscricao" podeOperar={podeOperar} />
        )}
        {methods.length > 0 && (
          <Recolhivel titulo={`Histórico técnico · ${methods.length} ${methods.length === 1 ? 'tentativa' : 'tentativas'} no gateway`} dica="cada cobrança criada no gateway, com o código">
            <TentativasDeCobranca tentativas={methods as unknown as Tentativa[]} />
          </Recolhivel>
        )}
      </div>
    </Card>
  )
}

function EnemEditModal({
  imp, registrationId, onClose,
}: { imp: EnemImportFull; registrationId: number; onClose: () => void }) {
  const update = useUpdateEnemImport(registrationId)
  const [scores, setScores] = useState({
    linguagens: imp.linguagens?.toString() ?? '',
    cienciasHumanas: imp.cienciasHumanas?.toString() ?? '',
    cienciasNatureza: imp.cienciasNatureza?.toString() ?? '',
    matematica: imp.matematica?.toString() ?? '',
    redacao: imp.redacao?.toString() ?? '',
  })
  const [decision, setDecision] = useState<'auto' | 'true' | 'false'>(
    imp.passed === true ? 'true' : imp.passed === false ? 'false' : 'auto',
  )
  const [note, setNote] = useState(imp.validationNote ?? '')

  function n(v: string): number | null {
    if (v.trim() === '') return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }

  function patch<K extends keyof typeof scores>(k: K, v: string) {
    setScores((s) => ({ ...s, [k]: v }))
  }

  function handleSave() {
    update.mutate({
      importId: imp.id,
      linguagens: n(scores.linguagens),
      cienciasHumanas: n(scores.cienciasHumanas),
      cienciasNatureza: n(scores.cienciasNatureza),
      matematica: n(scores.matematica),
      redacao: n(scores.redacao),
      passed: decision === 'true' ? true : decision === 'false' ? false : null,
      validationNote: note.trim() || null,
    }, {
      onSuccess: () => { toast('Notas atualizadas', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Editar notas ENEM"
      description={imp.nome ?? imp.inscricao ?? `Import #${imp.id}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input label="Linguagens" type="number" step="0.1" value={scores.linguagens} onInput={(e) => patch('linguagens', (e.target as HTMLInputElement).value)} />
          <Input label="C. Humanas" type="number" step="0.1" value={scores.cienciasHumanas} onInput={(e) => patch('cienciasHumanas', (e.target as HTMLInputElement).value)} />
          <Input label="C. Natureza" type="number" step="0.1" value={scores.cienciasNatureza} onInput={(e) => patch('cienciasNatureza', (e.target as HTMLInputElement).value)} />
          <Input label="Matemática" type="number" step="0.1" value={scores.matematica} onInput={(e) => patch('matematica', (e.target as HTMLInputElement).value)} />
        </div>
        <Input label="Redação" type="number" step="0.1" value={scores.redacao} onInput={(e) => patch('redacao', (e.target as HTMLInputElement).value)} />
        <Select label="Decisão de classificação" value={decision} onChange={(e) => setDecision((e.target as HTMLSelectElement).value as 'auto' | 'true' | 'false')}>
          <option value="auto">Automática (média × corte)</option>
          <option value="true">Forçar APROVADO</option>
          <option value="false">Forçar REPROVADO</option>
        </Select>
        <Textarea
          label="Nota do operador (opcional)"
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          rows={2}
          placeholder="Ex.: Nota de Redação ilegível, confirmada por e-mail com candidato"
        />
      </div>
    </Modal>
  )
}

function CandidatePortalCard({ review }: { review: RegistrationReview }) {
  const slug = review.portal?.slug
  const code = review.registration.candidateCode
  const [resending, setResending] = useState(false)
  const [linkGerado, setLinkGerado] = useState<{ url: string; ttlHoras: number } | null>(null)
  const resend = useResendMagicLink(slug ?? '')
  const gerar = useResendRegistrationLink()

  if (!slug) return null

  const candidateUrl = `${window.location.origin}/candidato/${code}`
  const semContato = !review.lead?.email && !review.lead?.whatsapp

  function handleResend() {
    if (semContato) {
      toast('Lead não tem email nem WhatsApp', 'danger'); return
    }
    setResending(true)
    resend.mutate(
      review.lead!.email ? { email: review.lead!.email } : { whatsapp: review.lead!.whatsapp ?? '' },
      {
        onSuccess: () => { toast('Magic link reenviado', 'success'); setResending(false) },
        onError: (e: unknown) => { toast((e as Error).message, 'danger'); setResending(false) },
      },
    )
  }

  /**
   * Gera o link SEM enviar nada.
   *
   * Quem está atendendo já costuma estar falando com a pessoa no Conversas — aí
   * disparar uma mensagem automática por fora atrapalha em vez de ajudar. Com o
   * link em mãos, a secretaria cola onde a conversa já está acontecendo.
   */
  function handleGerar() {
    gerar.mutate({ id: review.registration.id, enviar: false }, {
      onSuccess: (r) => setLinkGerado({ url: r.url, ttlHoras: r.ttlHoras ?? 48 }),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function copiar(texto: string, label: string) {
    void navigator.clipboard.writeText(texto)
      .then(() => toast(`${label} copiado`, 'success'))
      .catch(() => toast('Não foi possível copiar — selecione o texto e copie à mão', 'warning'))
  }

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="text-xs uppercase tracking-wider text-fg-muted">Portal do candidato</div>
          <a
            href={candidateUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-accent hover:underline truncate inline-flex items-center gap-1 mt-0.5"
          >
            {candidateUrl} <ExternalLink size={12} />
          </a>
          <div class="text-2xs text-fg-muted mt-0.5">
            URL pública onde o candidato faz login com email/WhatsApp para enviar documentos.
          </div>
        </div>
        <div class="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={() => copiar(candidateUrl, 'Link')}>
            Copiar link
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGerar} disabled={gerar.isPending}>
            <QrCode size={12} /> {gerar.isPending ? 'Gerando…' : 'Gerar link de acesso'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleResend}
            disabled={resending || resend.isPending || semContato}
            title={semContato ? 'Lead sem email nem WhatsApp' : ''}
          >
            <Send size={12} /> {resending || resend.isPending ? 'Enviando…' : 'Enviar ao candidato'}
          </Button>
        </div>
      </div>

      {/* O link entra direto na tela, para ser copiado e colado onde a conversa
          já está — não só disparado por fora. */}
      {linkGerado && (
        <div class="mt-3 rounded-md border border-border bg-surface p-3">
          <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div class="text-xs font-medium text-fg">Link de acesso direto</div>
            <div class="text-2xs text-fg-muted">
              Vale por {linkGerado.ttlHoras} horas e uma única vez · abre o portal do aluno já logado
            </div>
          </div>
          <div class="flex gap-2 items-start">
            <code class="flex-1 min-w-0 text-2xs text-fg-muted break-all bg-bg rounded px-2 py-1.5">
              {linkGerado.url}
            </code>
            <Button variant="secondary" size="sm" onClick={() => copiar(linkGerado.url, 'Link de acesso')}>
              <Copy size={12} /> Copiar
            </Button>
          </div>
          <div class="text-2xs text-warning mt-2">
            Quem abrir este link entra no portal do aluno — mande só para ele e não abra para testar, ou o link deixa de valer.
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Análise acadêmica (ex.: transferência): os documentos analisados, o parecer
 * (período de ingresso, aproveitamento) e a resposta do candidato. Emitir o
 * parecer avisa o candidato; deferido aprova os documentos da análise.
 */
const STATUS_DOC_ANALISE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; rotulo: string }> = {
  faltando: { tone: 'neutral', rotulo: 'não enviado' },
  pending: { tone: 'info', rotulo: 'enviado' },
  approved: { tone: 'success', rotulo: 'aprovado' },
  rejected: { tone: 'danger', rotulo: 'recusado' },
}
export function AnaliseAcademicaCard({ registrationId, etapa }: { registrationId: number; etapa: EtapaAdmin }) {
  const qc = useQueryClient()
  const a = etapa.analise!
  const p = a.parecer
  const [editando, setEditando] = useState(!p)
  const [resultado, setResultado] = useState<'deferido' | 'indeferido'>(p?.resultado ?? 'deferido')
  const [periodo, setPeriodo] = useState(p?.periodo ?? '')
  const [aproveitamento, setAproveitamento] = useState(p?.aproveitamento ?? '')
  const [observacao, setObservacao] = useState(p?.observacao ?? '')
  const [enviando, setEnviando] = useState(false)
  const faltaDoc = a.documentos.some((d) => d.status === 'faltando' || d.status === 'rejected')
  // Aprovação simples (ex.: ENEM, portador de diploma): não há parecer nem aceite —
  // aprovar os documentos já libera a próxima etapa.
  const simples = a.modo === 'documentos'

  async function emitir() {
    if (resultado === 'deferido' && !periodo.trim()) { toast('Informe o período de ingresso.', 'danger'); return }
    if (resultado === 'indeferido' && !observacao.trim()) { toast('Explique o motivo — o candidato vai ler.', 'danger'); return }
    if (p && !confirm('Reemitir o parecer? O candidato precisará responder de novo.')) return
    setEnviando(true)
    try {
      await api.post(`/admin/enrollment-registrations/${registrationId}/analise`, { resultado, periodo, aproveitamento, observacao })
      toast('Parecer emitido — o candidato foi avisado', 'success')
      setEditando(false)
      void qc.invalidateQueries({ queryKey: ['registration-etapas', registrationId] })
      void qc.invalidateQueries({ queryKey: ['registration-review', registrationId] })
      void qc.invalidateQueries({ queryKey: ['analises-academicas'] })
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setEnviando(false)
    }
  }

  const resposta = !p ? null
    : p.resultado === 'indeferido' ? { tone: 'neutral' as const, rotulo: 'indeferido — pode escolher outra forma de ingresso' }
    : p.aceite?.decisao === 'aceito' ? { tone: 'success' as const, rotulo: `aceito pelo candidato em ${new Date(p.aceite.em).toLocaleDateString('pt-BR')}` }
    : p.aceite?.decisao === 'desistiu' ? { tone: 'danger' as const, rotulo: `candidato desistiu em ${new Date(p.aceite.em).toLocaleDateString('pt-BR')}` }
    : { tone: 'warning' as const, rotulo: 'aguardando resposta do candidato' }

  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <GraduationCap size={16} class="text-accent" />
        <div class="text-xs uppercase tracking-wider text-fg-muted">Análise acadêmica</div>
        <Badge tone={etapa.situacao === 'feito' ? 'success' : etapa.situacao === 'aguardando' ? 'info' : 'warning'}>{etapa.detalhe}</Badge>
      </div>

      <div class="text-xs text-fg-muted mb-1">Documentos analisados (os arquivos estão no bloco de documentos)</div>
      <div class="flex flex-wrap gap-2 mb-4">
        {a.documentos.map((d) => {
          const st = STATUS_DOC_ANALISE[d.status] ?? STATUS_DOC_ANALISE.pending!
          return <Badge key={d.code} tone={st.tone}>{d.nome}: {st.rotulo}</Badge>
        })}
      </div>

      {simples && (
        <div class="text-2xs text-fg-muted">
          Nesta forma de ingresso a análise é só do documento: aprove ou recuse cada um (no bloco de documentos ou em
          Educacional › Análise de Documentos). Aprovado, a próxima etapa é liberada; recusado, o candidato reenvia.
          Não há parecer, período de ingresso nem aceite do candidato.
        </div>
      )}

      {!simples && p && !editando && (
        <div class="rounded-md border border-border p-3 text-sm space-y-1.5 mb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <b>{p.resultado === 'deferido' ? 'Deferido' : 'Indeferido'}</b>
            <span class="text-xs text-fg-muted">em {new Date(p.emitidoEm).toLocaleString('pt-BR')}{p.emitidoPor?.nome ? ` por ${p.emitidoPor.nome}` : ''}</span>
            {resposta && <Badge tone={resposta.tone}>{resposta.rotulo}</Badge>}
          </div>
          {p.periodo && <div><span class="text-fg-muted">Período de ingresso:</span> {p.periodo}</div>}
          {p.aproveitamento && <div class="whitespace-pre-line"><span class="text-fg-muted">Aproveitamento:</span> {p.aproveitamento}</div>}
          {p.observacao && <div class="whitespace-pre-line"><span class="text-fg-muted">{p.resultado === 'deferido' ? 'Observações' : 'Motivo'}:</span> {p.observacao}</div>}
          {p.aceite?.decisao !== 'desistiu' && (
            <Button size="sm" variant="ghost" onClick={() => setEditando(true)}><Pencil size={12} /> Reemitir parecer</Button>
          )}
        </div>
      )}

      {!simples && editando && (
        <div class="space-y-3">
          {faltaDoc && <div class="text-xs text-warning">Ainda há documento da análise não enviado ou recusado.</div>}
          <div class="flex gap-4 text-sm">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`res-${registrationId}`} checked={resultado === 'deferido'} onChange={() => setResultado('deferido')} /> Deferido
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`res-${registrationId}`} checked={resultado === 'indeferido'} onChange={() => setResultado('indeferido')} /> Indeferido
            </label>
          </div>
          {resultado === 'deferido' && (
            <>
              <Input label="Período de ingresso" placeholder="Ex.: 3º período" value={periodo} onInput={(e: any) => setPeriodo(e.currentTarget.value)} />
              <Textarea label="Aproveitamento de estudos" rows={4} placeholder="Disciplinas aproveitadas, carga horária, pendências…" value={aproveitamento} onInput={(e: any) => setAproveitamento(e.currentTarget.value)} />
            </>
          )}
          <Textarea label={resultado === 'deferido' ? 'Observações (opcional)' : 'Motivo do indeferimento'} rows={3} value={observacao} onInput={(e: any) => setObservacao(e.currentTarget.value)} />
          <div class="text-2xs text-fg-muted">
            O candidato vê o parecer no portal (e recebe aviso, se a automação "Notificar — Parecer da análise acadêmica" estiver ligada).
            {resultado === 'deferido' ? ' Deferido: os documentos da análise ficam aprovados e ele decide se continua.' : ' Indeferido: ele pode refazer a inscrição por outra forma de ingresso.'}
          </div>
          <div class="flex gap-2">
            <Button size="sm" onClick={emitir} disabled={enviando}><Send size={12} /> {enviando ? 'Emitindo…' : p ? 'Reemitir parecer' : 'Emitir parecer'}</Button>
            {p && <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={enviando}>Cancelar</Button>}
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Etapa "Redação online": situação, nota e a correção completa (o mesmo modal
 * da tela Avaliações › Redação). Antes a etapa abria o bloco do ENEM — que fica
 * vazio numa inscrição de vestibular — e a redação não aparecia.
 */
const SITUACAO_REDACAO: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; rotulo: string }> = {
  sem: { tone: 'warning', rotulo: 'Não iniciada' },
  draft: { tone: 'warning', rotulo: 'Em andamento' },
  submitted: { tone: 'info', rotulo: 'Enviada' },
  ai_reviewing: { tone: 'info', rotulo: 'Em correção pela IA' },
  needs_human: { tone: 'warning', rotulo: 'Aguardando correção' },
  approved: { tone: 'success', rotulo: 'Aprovada' },
  rejected: { tone: 'danger', rotulo: 'Reprovada' },
  expired: { tone: 'danger', rotulo: 'Tempo esgotado' },
}
function RedacaoCard({ review }: { review: RegistrationReview }) {
  const e = review.essay
  const qc = useQueryClient()
  const [abrir, setAbrir] = useState(false)
  // Fechou a correção: atualiza a inscrição (card, cabeçalho e etapas).
  function fechar() {
    setAbrir(false)
    void qc.invalidateQueries({ queryKey: ['registration-review', review.registration.id] })
    void qc.invalidateQueries({ queryKey: ['registration-etapas', review.registration.id] })
  }
  const detalhe = useEssaySubmission(abrir && e?.submissionId ? e.submissionId : null)
  const sit = SITUACAO_REDACAO[e?.situacao ?? 'sem'] ?? { tone: 'neutral' as const, rotulo: e?.situacao ?? '—' }
  // Rascunho também abre: é onde a coordenação vê quem travou e libera nova tentativa.
  const podeAbrir = !!e?.submissionId
  const aCorrigir = e?.situacao === 'submitted' || e?.situacao === 'needs_human' || e?.situacao === 'ai_reviewing'
  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-xs uppercase tracking-wider text-fg-muted inline-flex items-center gap-2">
          <Pencil size={12} /> Redação online
        </div>
        <Badge tone={sit.tone}>{sit.rotulo}{e?.score != null && <span class="font-mono"> · nota {Math.round(e.score)}</span>}</Badge>
        <SeloIntegridade pct={e?.aiPct ?? null} status={e?.integridade ?? null} decisao={e?.decisaoIntegridade ?? null} />
      </div>
      <div class="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p class="text-sm text-fg-muted m-0">
          {!e?.submissionId
            ? 'O candidato ainda não começou a redação.'
            : e.situacao === 'draft'
              ? 'O candidato começou a redação e ainda não enviou.'
              : `Enviada${e.enviadaEm ? ` ${formatRelative(e.enviadaEm)}` : ''}.${aCorrigir ? ' Falta a correção.' : ''}`}
        </p>
        {podeAbrir && (
          <Button size="sm" variant={aCorrigir ? 'primary' : 'secondary'} onClick={() => setAbrir(true)}>
            <FileText size={12} /> {aCorrigir ? 'Corrigir redação' : e?.situacao === 'draft' ? 'Ver tentativa' : 'Ver redação'}
          </Button>
        )}
      </div>
      {abrir && detalhe.data?.item && <EssayReviewModal essay={detalhe.data.item} onClose={fechar} />}
    </Card>
  )
}

export interface EtapaAdmin {
  /** A equipe dispensou esta etapa (matrícula interna). */
  dispensada?: boolean
  chave: string; titulo: string; situacao: 'feito' | 'aguardando' | 'pendente'; detalhe: string; obrigatoria: boolean
  /** Segura as seguintes até ser concluída (Portal › Etapas). */
  trava?: boolean
  /** Travada por uma etapa anterior ainda não concluída. */
  bloqueada?: { titulo: string; motivo: string } | null
  /** Só na análise acadêmica. */
  analise?: {
    documentos: Array<{ code: string; nome: string; status: string; reviewNote: string | null }>
    parecer: {
      resultado: 'deferido' | 'indeferido'; periodo: string | null; aproveitamento: string | null; observacao: string | null
      emitidoEm: string; emitidoPor?: { nome: string | null }; aceite: { decisao: 'aceito' | 'desistiu'; em: string } | null
    } | null
    /** 'documentos' = só aprovar/recusar o documento (ex.: ENEM, diploma), sem parecer. */
    modo?: 'parecer' | 'documentos'
  }
}
const SITUACAO_ETAPA: Record<string, { tone: 'success' | 'info' | 'warning'; icon: any; rotulo: string }> = {
  feito: { tone: 'success', icon: <CheckCircle size={11} />, rotulo: 'concluído' },
  aguardando: { tone: 'info', icon: <Clock size={11} />, rotulo: 'em análise' },
  pendente: { tone: 'warning', icon: <AlertCircle size={11} />, rotulo: 'pendente' },
}

function StatusBanner({ review, aoAbrirEtapa }: { review: RegistrationReview; aoAbrirEtapa?: (chave: string) => void }) {
  // Etapas configuradas no portal (aba Etapas), na ordem da tela de inscrição —
  // o mesmo que o candidato vê. Os badges fixos (documentos, pagamento)
  // ignoravam a configuração: o contrato nem aparecia.
  const etapasQ = useQuery({
    queryKey: ['registration-etapas', review.registration.id],
    queryFn: () => api.get<{ inscricao: EtapaAdmin[]; painel: EtapaAdmin[] }>(`/admin/enrollment-registrations/${review.registration.id}/etapas`),
    staleTime: 15_000,
  })
  const etapas = etapasQ.data?.inscricao ?? []
  const inscStatus = review.registration.status
  const inscLabel = REGISTRATION_STATUS_LABELS[inscStatus] ?? inscStatus
  const inscTone = REGISTRATION_STATUS_TONE[inscStatus] ?? 'info'

  const docsConfig = {
    complete: { tone: 'success' as const, icon: <CheckCircle size={11} />, label: 'Documentos completos' },
    pending:  { tone: 'warning' as const, icon: <Clock size={11} />, label: 'Documentos pendentes' },
    rejected: { tone: 'danger'  as const, icon: <XCircle size={11} />, label: 'Documentos rejeitados' },
  }[review.completion]

  // Pagamento (se houver) — exibe junto pra dar a visão completa.
  const payStatus = review.registration.paymentStatus
  const payAmount = review.registration.paymentAmount != null ? Number(review.registration.paymentAmount) : null

  // Redação (se for parte do entry mode)
  const essay = review.essay
  const essayConfig: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info'; icon: any; label: string }> = {
    pending:   { tone: 'warning', icon: <Clock size={11} />, label: 'Redação pendente' },
    submitted: { tone: 'info',    icon: <FileText size={11} />, label: 'Redação enviada' },
    reviewing: { tone: 'warning', icon: <Bot size={11} />, label: 'Redação em análise' },
    approved:  { tone: 'success', icon: <CheckCircle size={11} />, label: 'Redação aprovada' },
    rejected:  { tone: 'danger',  icon: <XCircle size={11} />, label: 'Redação rejeitada' },
  }
  const essayBadge = essay?.required ? essayConfig[essay.status] : null

  return (
    <Card>
      <div class="flex items-center gap-2 flex-wrap">
        <code class="text-sm text-fg font-mono font-medium px-2 py-0.5 rounded bg-surface-3 border border-border">
          {review.registration.candidateCode}
        </code>
        <Badge tone={inscTone}>
          <span class="inline-flex items-center gap-1">
            <FileCheck2 size={11} /> {inscLabel}
          </span>
        </Badge>
        {/* Mesmo curso com versões (ex.: Tradicional × Certificação por Competência): a versão fica à vista. */}
        {variacaoDaOferta(review.processRegistration?.offering) && (
          <Badge tone="info"><span title="Versão do curso (oferta)">{variacaoDaOferta(review.processRegistration?.offering)}</span></Badge>
        )}
        {etapas.length > 0 && etapas.map((e, i) => {
          const sit: { tone: 'success' | 'info' | 'warning' | 'neutral'; icon: any; rotulo: string } = e.bloqueada
            ? { tone: 'neutral', icon: <Lock size={11} />, rotulo: 'travada para o aluno' }
            : SITUACAO_ETAPA[e.situacao] ?? SITUACAO_ETAPA.pendente
          return (
            <button type="button" key={e.chave} class="cursor-pointer" onClick={() => aoAbrirEtapa?.(e.chave)} title={e.bloqueada ? e.bloqueada.motivo : `${e.detalhe}${e.trava ? ' · trava as etapas seguintes até ser concluída' : ''}`}>
              <Badge tone={sit.tone}>
                <span class="inline-flex items-center gap-1">
                  {sit.icon} <span class="font-mono opacity-70">{i + 1}.</span> {e.titulo}: {sit.rotulo}
                  {e.trava && !e.bloqueada && e.situacao !== 'feito' && <Lock size={10} class="opacity-70" />}
                  {e.chave === 'pagamento' && payAmount != null && <span class="font-mono">· {payAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>}
                </span>
              </Badge>
            </button>
          )
        })}
        {etapas.length === 0 && !etapasQ.isLoading && (
        <Badge tone={docsConfig.tone}>
          <span class="inline-flex items-center gap-1">
            {docsConfig.icon} {docsConfig.label}
          </span>
        </Badge>
        )}
        {essayBadge && !etapas.some((e) => e.chave === 'prova') && (
          <Badge tone={essayBadge.tone}>
            <span class="inline-flex items-center gap-1">
              {essayBadge.icon} {essayBadge.label}
              {essay?.score != null && <span class="font-mono">· {Math.round(essay.score)}</span>}
            </span>
          </Badge>
        )}
        {payStatus && !etapas.some((e) => e.chave === 'pagamento') && (
          <Badge tone={paymentStatusTone(payStatus)}>
            <span class="inline-flex items-center gap-1">
              <CreditCard size={11} /> {paymentStatusLabel(payStatus)}
              {payAmount != null && <span class="font-mono">· R$ {payAmount.toFixed(2)}</span>}
            </span>
          </Badge>
        )}
        <span class="text-2xs text-fg-muted ml-auto">
          Criada {formatRelative(review.registration.createdAt)}
        </span>
      </div>
    </Card>
  )
}

const REGISTRATION_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'info',
  pending: 'warning',
  submitted: 'info',
  paid: 'success',
  docs_uploaded: 'info',
  docs_reviewing: 'warning',
  docs_approved: 'success',
  docs_rejected: 'danger',
  reviewing: 'warning',
  approved: 'success',
  enrolled: 'success',
  rejected: 'danger',
  cancelled: 'info',
  expired: 'info',
}

function CandidateCard({ review }: { review: RegistrationReview }) {
  if (!review.lead) return null
  const fd = (review.registration.formData ?? {})
  const cpf = (fd.cpf as string | undefined) ?? null

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Candidato</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Field label="Nome" value={review.lead.nome ?? '—'} />
        {cpf && <Field label="CPF" value={cpf} />}
        <Field label="E-mail" value={review.lead.email ?? '—'} />
        <Field label="WhatsApp" value={review.lead.whatsapp ?? '—'} />
      </div>
      <a
        href={`/app/leads/${review.lead.id}`}
        class="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-3"
      >
        Abrir lead no CRM <ExternalLink size={11} />
      </a>
    </Card>
  )
}

// Tudo o que o candidato respondeu no formulário da inscrição. O card do
// candidato mostra só a identificação; endereço, escolaridade e as perguntas
// próprias do portal ficavam só no banco, e a secretaria não tinha onde ler
// para cadastrar. Os mesmos dados espelham em campos personalizados do lead.
function DadosCadastroCard({ review }: { review: RegistrationReview }) {
  const grupos = (review.cadastro ?? []).filter((g) => g.campos.length > 0)
  if (grupos.length === 0) return null

  const preenchidos = grupos.flatMap((g) => g.campos).filter((c) => c.valor !== "").length

  function copiarTudo() {
    const txt = grupos
      .map((g) => [g.grupo, ...g.campos.map((c) => `${c.rotulo}: ${c.valor || "—"}`)].join("\n"))
      .join("\n\n")
    navigator.clipboard.writeText(txt)
      .then(() => toast("Dados copiados", "success"))
      .catch(() => toast("Falha ao copiar", "danger"))
  }

  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted">Dados do cadastro</div>
        <span class="text-2xs text-fg-muted">{preenchidos} preenchidos</span>
        <Button variant="ghost" size="sm" class="ml-auto" onClick={copiarTudo}>
          <Copy size={12} /> Copiar tudo
        </Button>
      </div>
      <div class="space-y-4">
        {grupos.map((g) => (
          <div key={g.grupo}>
            <div class="text-2xs uppercase tracking-wider text-accent font-medium mb-1.5">{g.grupo}</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {g.campos.map((c) => (
                <Field key={c.chave} label={c.rotulo} value={c.valor || "—"} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div class="text-2xs text-fg-muted mt-3">
        Os mesmos dados ficam na ficha do lead, em Campos personalizados.
      </div>
    </Card>
  )
}

function RegistrationCard({ review }: { review: RegistrationReview }) {
  const sp = review.processRegistration?.selectionProcess
  const offering = review.processRegistration?.offering
  const portal = review.portal

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Inscrição</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Field label="Portal" value={portal?.nome ?? '—'} />
        <Field label="Slug" value={portal?.slug ? <code class="text-xs">{portal.slug}</code> : '—'} />
        <Field label="Processo seletivo" value={sp?.nome ?? '—'} />
        <Field
          label="Modo de ingresso"
          value={sp?.entryMode ? `${sp.entryMode.icon ?? ''} ${sp.entryMode.name}`.trim() : '—'}
        />
        <Field label="Curso" value={offering?.course?.nome ?? '—'} />
        {variacaoDaOferta(offering) && <Field label="Versão" value={<strong>{variacaoDaOferta(offering)}</strong>} />}
        <Field label="Oferta" value={offering?.nome ?? '—'} />
        <Field label="Turno" value={offering?.turno ?? '—'} />
        <Field
          label="Campus"
          value={
            offering?.campuses && offering.campuses.length > 0
              ? offering.campuses.map((c) => `${c.campus.nome}${c.campus.cidade ? ` (${c.campus.cidade})` : ''}`).join(', ')
              : '—'
          }
        />
      </div>
    </Card>
  )
}

function AutoAdvanceCard({ review }: { review: RegistrationReview }) {
  if (!review.autoAdvance.enabled) return null
  const aa = review.autoAdvance
  return (
    <Card>
      <div class="flex items-start gap-2">
        <Bot size={16} class="text-accent mt-0.5 shrink-0" />
        <div class="text-xs text-fg-muted">
          Auto-avanço configurado: ao aprovar todos os documentos obrigatórios, o lead será movido para
          a etapa <strong class="text-fg">{aa.stageName}</strong>
          {aa.funnelName ? ` no funil ${aa.funnelName}` : ''}.
        </div>
      </div>
    </Card>
  )
}

function SlotsCard({ review, podeOperar }: { review: RegistrationReview; podeOperar?: boolean }) {
  if (review.slots.length === 0) {
    return (
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Documentos esperados</div>
        <div class="text-sm text-fg-muted text-center py-4">
          Nenhum documento foi configurado para este modo de ingresso.
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">
        Documentos esperados ({review.slots.length})
      </div>
      <ul class="space-y-2">
        {review.slots.map((s, idx) => (
          <SlotRow key={idx} slot={s} registrationId={review.registration.id} podeOperar={!!podeOperar} />
        ))}
      </ul>
    </Card>
  )
}

function SlotRow({ slot, registrationId, podeOperar }: { slot: DocumentSlot; registrationId: number; podeOperar: boolean }) {
  const dt = slot.documentType
  const doc = slot.latestDoc
  const reqLabel = slot.required ? 'Obrigatório' : 'Opcional'

  return (
    <li class="rounded-md border border-border p-3 bg-surface">
      <div class="flex items-start gap-3">
        <span class="size-8 rounded-md bg-surface-3 grid place-items-center text-fg-muted shrink-0">
          <FileCheck2 size={14} />
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{dt?.name ?? '—'}</span>
            {dt?.code && <code class="text-3xs text-fg-muted">{dt.code}</code>}
            <span class={`text-3xs uppercase ${slot.required ? 'text-warning' : 'text-fg-muted'}`}>
              {reqLabel}
            </span>
            {slot.frenteVerso && <span class="text-3xs uppercase text-accent">frente e verso</span>}
          </div>
          {slot.helpText && (
            <div class="text-xs text-fg-muted mt-0.5">{slot.helpText}</div>
          )}
        </div>
        {slot.dispensa ? <Badge tone="neutral">Dispensado</Badge> : <DocStatusBadge doc={doc} />}
      </div>
      {slot.dispensa && <div class="ml-11 mt-1"><SeloDispensa dispensa={slot.dispensa} /></div>}
      {doc && <DocBody doc={doc} registrationId={registrationId} />}
      {!doc && !slot.dispensa && (
        <div class="ml-11 mt-2 text-2xs text-fg-muted">
          Ainda não enviado. A equipe pode anexar aqui, e o aluno, pela tela dele.
        </div>
      )}
      {podeOperar && dt?.code && (
        <div class="ml-11 mt-2 flex flex-wrap items-center gap-1.5">
          {!slot.dispensa && (!doc || doc.status !== 'approved') && <AnexarDocumento registrationId={registrationId} typeCode={dt.code} rotulo={dt.name} frenteVerso={!!slot.frenteVerso} />}
          {doc && doc.status !== 'approved' && <RemoverDocumento registrationId={registrationId} docId={doc.id} />}
          {(!doc || doc.status !== 'approved') && <BotaoDispensa registrationId={registrationId} tipo="documento" chave={dt.code} nome={dt.name} dispensa={slot.dispensa} />}
        </div>
      )}
    </li>
  )
}

function ExtrasCard({
  extras, registrationId, podeOperar,
}: { extras: EnrollmentDocument[]; registrationId: number; podeOperar?: boolean }) {
  return (
    <Card>
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted">Outros documentos ({extras.length})</div>
        {podeOperar && <AnexarDocumento registrationId={registrationId} typeCode="other" rotulo="Outro documento" />}
      </div>
      <div class="text-2xs text-fg-muted mb-2">
        Documentos que não correspondem a nenhum requisito esperado.
      </div>
      <ul class="space-y-2">
        {extras.map((d) => (
          <li key={d.id} class="rounded-md border border-border p-3 bg-surface">
            <div class="flex items-start gap-3">
              <span class="size-8 rounded-md bg-surface-3 grid place-items-center text-fg-muted shrink-0">
                <AlertCircle size={14} />
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">
                    {d.label ?? d.type?.name ?? d.fileName ?? `Doc #${d.id}`}
                  </span>
                  {d.typeCode && <code class="text-3xs text-fg-muted">{d.typeCode}</code>}
                </div>
              </div>
              <DocStatusBadge doc={d} />
            </div>
            <DocBody doc={d} registrationId={registrationId} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DocStatusBadge({ doc }: { doc: EnrollmentDocument | null }) {
  if (!doc) {
    return (
      <span class="text-3xs uppercase tracking-wider text-fg-muted shrink-0">
        Não enviado
      </span>
    )
  }
  const cfg = {
    pending:  { label: 'Pendente',  color: 'text-warning' },
    approved: { label: 'Aprovado',  color: 'text-success' },
    rejected: { label: 'Rejeitado', color: 'text-danger' },
  }[doc.status]
  return (
    <span class={`text-3xs uppercase tracking-wider font-medium shrink-0 ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

function DocBody({ doc, registrationId }: { doc: EnrollmentDocument; registrationId: number }) {
  const review = useReviewDocument(registrationId)
  const renotify = useRenotifyDocument(registrationId)
  const reanalyze = useReanalyzeDocument(registrationId)
  const [rejecting, setRejecting] = useState(false)

  const sizeKb = doc.sizeBytes ? Math.round(doc.sizeBytes / 1024) : null

  return (
    <div class="ml-11 mt-2 space-y-2">
      <div class="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
        {doc.fileName && <span class="truncate max-w-48" title={doc.fileName}>{doc.fileName}</span>}
        {sizeKb != null && <span class="tabular-nums">{sizeKb} KB</span>}
        <span>· enviado {formatRelative(doc.uploadedAt)}</span>
      </div>

      {doc.aiSuggestion && <AiSummary doc={doc} />}

      {doc.status === 'rejected' && doc.reviewNote && (
        <div class="text-2xs text-danger">
          <strong>Motivo da rejeição:</strong> {doc.reviewNote}
        </div>
      )}
      {doc.reviewedAt && (
        <div class="text-2xs text-fg-muted">
          {STATUS_LABELS[doc.status]} por {doc.reviewerName ?? `User #${doc.reviewedBy}`} em {formatRelative(doc.reviewedAt)}
        </div>
      )}

      <div class="flex flex-wrap gap-1.5">
        {/* Abrir o arquivo é o primeiro passo da análise: botão em destaque
            (laranja enquanto aguarda análise), não um link miúdo no meio das
            informações do arquivo — o time bate o olho e sabe o que falta ver. */}
        {doc.fileUrl && (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            class={doc.status === 'pending'
              ? 'inline-flex items-center justify-center h-8 px-3 gap-1.5 rounded-md text-xs font-semibold border border-warning bg-warning/10 text-warning hover:bg-warning/20 btn-motion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              : 'inline-flex items-center justify-center h-8 px-3 gap-1.5 rounded-md text-xs font-semibold bg-surface-2 text-fg border border-border hover:bg-surface-3 surface-raised btn-motion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'}
          >
            <Eye size={12} /> {doc.status === 'pending' ? 'Analisar' : 'Ver'} {doc.versoFileUrl ? 'frente' : 'documento'} <ExternalLink size={10} />
          </a>
        )}
        {doc.versoFileUrl && (
          <a
            href={doc.versoFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            class={doc.status === 'pending'
              ? 'inline-flex items-center justify-center h-8 px-3 gap-1.5 rounded-md text-xs font-semibold border border-warning bg-warning/10 text-warning hover:bg-warning/20 btn-motion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              : 'inline-flex items-center justify-center h-8 px-3 gap-1.5 rounded-md text-xs font-semibold bg-surface-2 text-fg border border-border hover:bg-surface-3 surface-raised btn-motion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'}
          >
            <Eye size={12} /> {doc.status === 'pending' ? 'Analisar' : 'Ver'} verso <ExternalLink size={10} />
          </a>
        )}
        {doc.status !== 'approved' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              review.mutate({ docId: doc.id, status: 'approved' }, {
                onSuccess: () => toast('Documento aprovado', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={review.isPending}
          >
            <CheckCircle size={11} /> Aprovar
          </Button>
        )}
        {doc.status !== 'rejected' && (
          <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
            <XCircle size={11} /> Rejeitar
          </Button>
        )}
        {doc.type?.aiAnalysisTemplate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              reanalyze.mutate(doc.id, {
                onSuccess: () => toast('Re-análise IA enfileirada', 'info'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={reanalyze.isPending}
            title="Re-disparar análise IA"
          >
            <RefreshCw size={11} /> IA
          </Button>
        )}
        {(doc.status === 'approved' || doc.status === 'rejected') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              renotify.mutate(doc.id, {
                onSuccess: () => toast('Notificação reenviada', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={renotify.isPending}
            title="Reenviar notificação ao candidato"
          >
            <Bell size={11} /> Notificar
          </Button>
        )}
      </div>

      {rejecting && (
        <RejectModal
          onClose={() => setRejecting(false)}
          onSubmit={(note) => {
            review.mutate({ docId: doc.id, status: 'rejected', reviewNote: note }, {
              onSuccess: () => { toast('Documento rejeitado', 'success'); setRejecting(false) },
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })
          }}
          submitting={review.isPending}
        />
      )}
    </div>
  )
}

function AiSummary({ doc }: { doc: EnrollmentDocument }) {
  const sug = doc.aiSuggestion
  const conf = doc.aiConfidence
  const cfg = sug === 'approve'
    ? { color: 'text-success', label: 'IA sugere aprovar' }
    : sug === 'reject'
      ? { color: 'text-danger',  label: 'IA sugere rejeitar' }
      : { color: 'text-warning', label: 'IA sugere revisão humana' }
  return (
    <div class="flex items-center gap-2 text-2xs">
      <Bot size={11} class={cfg.color} />
      <span class={cfg.color}>{cfg.label}</span>
      {conf != null && (
        <span class="text-fg-muted">· confiança {Math.round(conf * 100)}%</span>
      )}
      {doc.aiStatus === 'analyzing' && <span class="text-info">· analisando…</span>}
      {doc.aiStatus === 'failed' && <span class="text-danger">· falhou</span>}
    </div>
  )
}

function RejectModal({
  onClose, onSubmit, submitting,
}: { onClose: () => void; onSubmit: (note: string) => void; submitting: boolean }) {
  const [note, setNote] = useState('')

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Rejeitar documento"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!note.trim()) {
                toast('Informe o motivo da rejeição', 'danger')
                return
              }
              onSubmit(note.trim())
            }}
            disabled={submitting}
          >
            {submitting ? 'Rejeitando…' : 'Rejeitar'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Motivo (será enviado ao candidato)"
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={4}
        placeholder="Ex.: Documento ilegível. Por favor, envie uma foto mais nítida."
      />
    </Modal>
  )
}

function BulkActionsCard({ registrationId }: { registrationId: number }) {
  const bulk = useBulkApproveAi(registrationId)

  function handleBulk() {
    bulk.mutate({ minConfidence: 0.85 }, {
      onSuccess: (r) => toast(
        r.approved > 0
          ? `${r.approved} documento(s) aprovado(s) automaticamente`
          : 'Nenhum documento atendia aos critérios',
        r.approved > 0 ? 'success' : 'info',
      ),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <div class="text-sm font-medium text-fg">Aprovação em lote por IA</div>
          <div class="text-xs text-fg-muted mt-0.5">
            Aprova todos os documentos pendentes com IA sugerindo "aprovar" e confiança ≥ 85%.
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={handleBulk} disabled={bulk.isPending}>
          <Bot size={12} /> {bulk.isPending ? 'Processando…' : 'Aprovar com IA'}
        </Button>
      </div>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: preact.ComponentChildren }) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-fg-muted text-xs w-32 shrink-0">{label}</span>
      <span class="text-fg truncate">{value}</span>
    </div>
  )
}

// Portal da inscrição com o ícone/cor/empresa da "Identidade no painel"
// (a lista de portais já está em cache; sem ela, mostra só o nome).
function usePortalDaLista(id: number | null | undefined) {
  const { data } = useEnrollmentPortals()
  return data?.portals.find((p) => p.id === id) ?? null
}
function FaixaDaInscricao({ portalId, polo }: { portalId: number | null | undefined; polo: string | null }) {
  const p = usePortalDaLista(portalId)
  if (!p?.identidadePainel) return null
  return <FaixaDoPortal portal={p} rotulo="Portal" polos={polo ? [polo] : []} />
}
