// Inscrição/matrícula INTERNA feita pelo agente (backend: services/inscricaoAssistida.ts).
//
// "Nova inscrição" abre, DENTRO do painel, o próprio portal do candidato em
// modo atendimento: o agente faz as etapas que são dele (curso, forma de
// ingresso, polo, cadastro, documentos, Pix/boleto) e o sistema gera tudo
// igual ao portal (lead, inscrição, conta, cobrança, jornada). As etapas do
// candidato (redação, contrato, cartão, senha) vão por link — "Passar para o
// candidato". Não existe mais cadastro com status/pagamento escolhidos à mão:
// pagamento fora do gateway é "Registrar pagamento manual", com comprovante.

import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { ChevronLeft, ExternalLink, UserPlus } from '@/components/ui/icon-set'

interface LeadDaBusca { id: number; nome: string | null; email: string | null; whatsapp: string | null; inscricaoNoPortal: string | null }
interface RespostaAtendimento {
  url: string
  expiraEm: string
  portal: { id: number; nome: string; slug: string }
  inscricaoExistente: { candidateCode: string; status: string } | null
}

/** Endereço da tela interna de atendimento. */
export const rotaDoAtendimento = (portalId: number, leadId?: number | null) =>
  `/enrollment-portals/${portalId}/atendimento${leadId ? `?lead=${leadId}` : ''}`

export function NovaInscricaoModal({ portalId, portalNome, onClose }: {
  portalId: number
  portalNome: string
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<LeadDaBusca | null>(null)
  const termo = busca.trim()
  const leads = useQuery({
    queryKey: ['inscricao-assistida-leads', portalId, termo],
    queryFn: () => api.get<{ leads: LeadDaBusca[] }>(`/admin/inscricao-assistida/leads?portalId=${portalId}&q=${encodeURIComponent(termo)}`),
    enabled: termo.length >= 2 && !escolhido,
    staleTime: 5_000,
  })

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Nova inscrição"
      description={`${portalNome}: a inscrição/matrícula é feita aqui no painel, nas mesmas etapas do portal do candidato, e fica registrada em seu nome.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => { onClose(); navigate(rotaDoAtendimento(portalId, escolhido?.id)) }}>
            <UserPlus size={12} /> {escolhido ? 'Iniciar para este lead' : 'Iniciar sem lead'}
          </Button>
        </>
      }
    >
      <div class="grid gap-3">
        <p class="text-xs text-fg-muted">
          Escolha o lead para a inscrição ficar na ficha dele (e continuar a que ele já tiver neste portal). Sem lead, o cadastro começa em branco e cria a ficha.
        </p>
        {escolhido ? (
          <div class="flex items-center gap-2 rounded-md bg-surface-3 px-3 py-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm text-fg truncate">{escolhido.nome || 'Sem nome'}</div>
              <div class="text-xs text-fg-muted truncate">{[escolhido.whatsapp, escolhido.email].filter(Boolean).join(' · ')}</div>
              {escolhido.inscricaoNoPortal && (
                <div class="text-2xs text-info mt-0.5">Já tem a inscrição {escolhido.inscricaoNoPortal} neste portal — o atendimento continua nela.</div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEscolhido(null)}>Trocar</Button>
          </div>
        ) : (
          <div class="grid gap-1.5">
            <Input
              label="Buscar lead"
              value={busca}
              onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
              placeholder="Nome, e-mail ou WhatsApp"
            />
            {termo.length >= 2 && (
              <div class="max-h-56 overflow-auto rounded-md border border-border divide-y divide-border">
                {leads.isLoading && <div class="px-3 py-2 text-xs text-fg-muted">Buscando…</div>}
                {!leads.isLoading && (leads.data?.leads ?? []).length === 0 && (
                  <div class="px-3 py-2 text-xs text-fg-muted">Nenhum lead encontrado entre os que você atende.</div>
                )}
                {(leads.data?.leads ?? []).map((l) => (
                  <button key={l.id} type="button" class="w-full text-left px-3 py-2 hover:bg-surface-3" onClick={() => setEscolhido(l)}>
                    <div class="text-sm text-fg truncate">{l.nome || 'Sem nome'} <span class="text-fg-subtle text-xs">#{l.id}</span></div>
                    <div class="text-xs text-fg-muted truncate">
                      {[l.whatsapp, l.email].filter(Boolean).join(' · ')}
                      {l.inscricaoNoPortal && <span class="text-info"> · inscrição {l.inscricaoNoPortal}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <ul class="text-2xs text-fg-subtle list-disc pl-4 grid gap-0.5">
          <li><strong>Você faz:</strong> curso, forma de ingresso, polo, cadastro, documentos e cobrança por Pix/boleto.</li>
          <li><strong>O candidato faz</strong> (pelo portal dele, com o link de “Passar para o candidato”): redação, assinatura do contrato, cartão de crédito e senha.</li>
          <li>Pagamento recebido fora do gateway: “Registrar pagamento manual” na página da inscrição.</li>
        </ul>
      </div>
    </Modal>
  )
}

// ── Tela interna: o portal do candidato dentro do painel ─────────────────────

export function AtendimentoPortalPage({ params }: { params: { id: string } }) {
  const portalId = parseInt(params.id)
  const leadId = (() => { const v = new URLSearchParams(window.location.search).get('lead'); return v && /^\d+$/.test(v) ? Number(v) : null })()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const abrir = useMutation({
    mutationFn: () => api.post<RespostaAtendimento>('/admin/inscricao-assistida', { portalId, leadId }),
  })
  // Uma sessão por entrada na tela; "Recomeçar" pede outra (a de 2h venceu).
  useEffect(() => { if (Number.isFinite(portalId)) abrir.mutate() }, [portalId, leadId])
  const r = abrir.data
  const voltar = () => {
    void qc.invalidateQueries({ queryKey: ['portal-registrations'] })
    navigate(`/enrollment-portals/${portalId}`)
  }

  return (
    <Page
      title={r?.inscricaoExistente ? `Continuar inscrição ${r.inscricaoExistente.candidateCode}` : 'Nova inscrição pelo painel'}
      description={r ? `${r.portal.nome} · as mesmas etapas do portal do candidato, registradas em seu nome` : 'Abrindo o portal em atendimento…'}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={voltar}><ChevronLeft size={14} /> Voltar às inscrições</Button>
          {r && (
            <Button variant="secondary" size="sm" onClick={() => abrir.mutate()} disabled={abrir.isPending}
              title="Abre uma sessão nova (a anterior vale 2 horas)">Recomeçar sessão</Button>
          )}
          {r && (
            <Button variant="secondary" size="sm" onClick={() => window.open(r.url, '_blank', 'noopener')}>
              <ExternalLink size={12} /> Abrir em nova aba
            </Button>
          )}
        </>
      }
    >
      {abrir.error && (
        <Card><div class="text-sm text-danger">{(abrir.error as Error).message}</div></Card>
      )}
      {!r && !abrir.error && <Card><div class="text-sm text-fg-muted">Abrindo o portal…</div></Card>}
      {r && (
        <div class="rounded-lg border border-border overflow-hidden bg-surface">
          <iframe
            key={r.url}
            src={r.url}
            title={`Portal ${r.portal.nome} em atendimento`}
            class="w-full block"
            style={{ height: 'calc(100vh - 190px)', minHeight: '640px', border: '0' }}
            allow="clipboard-write"
          />
        </div>
      )}
    </Page>
  )
}

// ── Pagamento manual (página da inscrição) ───────────────────────────────────

const FORMAS: Array<[string, string]> = [
  ['dinheiro', 'Dinheiro'],
  ['pix_direto', 'Pix direto na conta'],
  ['transferencia', 'Transferência / depósito'],
  ['cartao_maquininha', 'Cartão na maquininha'],
  ['boleto_externo', 'Boleto de outro banco'],
  ['outro', 'Outro'],
]

/** Um caminho só para pagamento fora do gateway: página da inscrição e
 *  Financeiro do portal usam este modal (services/pagamentoManual). */
export function PagamentoManualModal({ registrationId, candidateCode, onClose, endpoint, valorInicial }: {
  registrationId: number
  candidateCode: string
  onClose: () => void
  /** Financeiro do portal usa a rota dele (mesmo serviço, permissão do Financeiro). */
  endpoint?: string | undefined
  valorInicial?: number | null | undefined
}) {
  const qc = useQueryClient()
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [valor, setValor] = useState(valorInicial ? valorInicial.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')
  const [pagoEm, setPagoEm] = useState(hoje)
  const [forma, setForma] = useState('')
  const [motivo, setMotivo] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const enviar = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      // Campos ANTES do arquivo (o servidor lê os campos depois de drenar o arquivo, mas assim é garantido).
      fd.append('valor', valor); fd.append('pagoEm', pagoEm); fd.append('forma', forma); fd.append('motivo', motivo)
      fd.append('comprovante', arquivo as File)
      return api.post<{ ok: true }>(endpoint ?? `/admin/enrollment-registrations/${registrationId}/pagamento-manual`, fd)
    },
  })
  const pronto = valor.trim() && pagoEm && forma && motivo.trim().length >= 10 && arquivo

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Registrar pagamento manual — ${candidateCode}`}
      description="Para pagamento recebido fora do gateway. A inscrição passa a contar como paga (etapa, receita e comissão) e as cobranças abertas são canceladas. Fica registrado em seu nome, com o comprovante."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={enviar.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" disabled={!pronto || enviar.isPending} onClick={() => enviar.mutate(undefined, {
            onSuccess: () => {
              toast('Pagamento registrado', 'success')
              void qc.invalidateQueries()
              onClose()
            },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}>{enviar.isPending ? 'Registrando…' : 'Registrar pagamento'}</Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input label="Valor recebido (R$)" value={valor} inputMode="decimal" placeholder="0,00"
          onInput={(e) => setValor((e.target as HTMLInputElement).value)} />
        <Input label="Data do pagamento" type="date" value={pagoEm} max={hoje}
          onInput={(e) => setPagoEm((e.target as HTMLInputElement).value)} />
        <Select label="Forma" value={forma} onChange={(e) => setForma((e.target as HTMLSelectElement).value)}>
          <option value="">Escolha…</option>
          {FORMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label class="grid gap-1 text-xs">
          <span class="font-medium text-fg">Comprovante (PDF ou imagem)</span>
          <input type="file" accept=".pdf,image/*" class="text-xs"
            onChange={(e) => setArquivo((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        <label class="grid gap-1 text-xs sm:col-span-2">
          <span class="font-medium text-fg">Motivo</span>
          <textarea class="w-full text-sm px-2 py-1.5 rounded-md bg-surface border border-border text-fg min-h-16" value={motivo}
            placeholder='Ex.: "pagou em dinheiro na secretaria do polo Centro, recibo 123"'
            onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
        </label>
        <p class="text-2xs text-fg-subtle sm:col-span-2">Isenção não é pagamento manual: use um cupom de 100% na inscrição.</p>
      </div>
    </Modal>
  )
}

// ── Contrato assinado no papel (página da inscrição) ─────────────────────────

/** A via assinada à mão vira o contrato da inscrição: a etapa Contrato fecha,
 *  e o arquivo segue para a matrícula e o GED como as assinaturas eletrônicas. */
export function ContratoPresencialModal({ registrationId, candidateCode, nomeCandidato, onClose }: {
  registrationId: number; candidateCode: string; nomeCandidato: string | null | undefined; onClose: () => void
}) {
  const qc = useQueryClient()
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [assinadoPor, setAssinadoPor] = useState(nomeCandidato ?? '')
  const [assinadoEm, setAssinadoEm] = useState(hoje)
  const [observacao, setObservacao] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const enviar = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('assinadoPor', assinadoPor); fd.append('assinadoEm', assinadoEm); fd.append('observacao', observacao)
      fd.append('contrato', arquivo as File)
      return api.post<{ ok: true }>(`/admin/enrollment-registrations/${registrationId}/contrato-presencial`, fd)
    },
  })
  const pronto = assinadoPor.trim().includes(' ') && assinadoEm && arquivo
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Contrato assinado no papel — ${candidateCode}`}
      description="Para quando o candidato assinou a via impressa (secretaria, polo, evento). Anexe a via assinada digitalizada: a etapa Contrato fica concluída e o documento vai para a matrícula e o GED. Fica registrado em seu nome."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={enviar.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" disabled={!pronto || enviar.isPending} onClick={() => enviar.mutate(undefined, {
            onSuccess: () => { toast('Contrato registrado', 'success'); void qc.invalidateQueries(); onClose() },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}>{enviar.isPending ? 'Registrando…' : 'Registrar contrato'}</Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input label="Assinado por (nome completo)" value={assinadoPor} onInput={(e) => setAssinadoPor((e.target as HTMLInputElement).value)} />
        <Input label="Data da assinatura" type="date" value={assinadoEm} max={hoje} onInput={(e) => setAssinadoEm((e.target as HTMLInputElement).value)} />
        <label class="grid gap-1 text-xs sm:col-span-2">
          <span class="font-medium text-fg">Via assinada (PDF, ou foto JPG/PNG)</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" class="text-xs" onChange={(e) => setArquivo((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        <label class="grid gap-1 text-xs sm:col-span-2">
          <span class="font-medium text-fg">Observação (opcional)</span>
          <textarea class="w-full text-sm px-2 py-1.5 rounded-md bg-surface border border-border text-fg min-h-14" value={observacao}
            placeholder='Ex.: "assinado na secretaria do polo Centro, via original arquivada na pasta 12"'
            onInput={(e) => setObservacao((e.target as HTMLTextAreaElement).value)} />
        </label>
        <p class="text-2xs text-fg-subtle sm:col-span-2">Se havia uma assinatura eletrônica em andamento (Autentique/Clicksign), ela é cancelada — o candidato não assina duas vezes.</p>
      </div>
    </Modal>
  )
}

// ── Histórico da inscrição (página da inscrição) ─────────────────────────────

interface EventoDaInscricao {
  id: number; etapa: string; acao: string; rotulo: string; ator: 'candidato' | 'atendente' | 'sistema'
  userId: number | null; userName: string | null; ip: string | null; dados: Record<string, unknown> | null; createdAt: string
}
interface Historico {
  origem: string | null
  criadoPor: { id: number; nome: string } | null
  atendidoPor: { id: number; nome: string } | null
  vendedor: { id: number; nome: string } | null
  eventos: EventoDaInscricao[]
  pagamentoManual: {
    forma: string; valor: number; pagoEm: string; motivo: string; em: string
    por: { id: number; nome: string }; comprovante: { url: string; nome: string }
  } | null
}

export const ROTULO_ORIGEM: Record<string, string> = {
  portal: 'Candidato pelo portal',
  assistida: 'Equipe pelo painel (com o candidato)',
  formulario: 'Formulário do site → portal',
  link: 'Link enviado pela equipe',
  administrativa: 'Cadastro administrativo (antigo)',
}

/** Selo curto para a lista de inscrições. */
export function SeloDaOrigem({ origem, nome }: { origem?: string | null | undefined; nome?: string | null | undefined }) {
  if (origem !== 'assistida' && origem !== 'administrativa') return null
  return (
    <div class="mt-0.5 text-2xs font-medium text-info" title={ROTULO_ORIGEM[origem]}>
      {origem === 'assistida' ? 'Equipe' : 'Administrativa'}{nome ? ` · ${nome}` : ''}
    </div>
  )
}

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const ROTULO_FORMA = Object.fromEntries(FORMAS)

export function HistoricoDaInscricao({ registrationId }: { registrationId: number }) {
  const q = useQuery({
    queryKey: ['inscricao-historico', registrationId],
    queryFn: () => api.get<Historico>(`/admin/enrollment-registrations/${registrationId}/historico`),
    staleTime: 15_000,
  })
  if (q.isLoading) return <div class="text-xs text-fg-muted">Carregando histórico…</div>
  if (q.error) return <div class="text-xs text-danger">{(q.error as Error).message}</div>
  const h = q.data!
  const pm = h.pagamentoManual
  return (
    <div class="grid gap-3">
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div><dt class="text-fg-subtle">Origem</dt><dd class="text-fg">{h.origem ? (ROTULO_ORIGEM[h.origem] ?? h.origem) : 'Não registrada (anterior a 03/11/2026)'}</dd></div>
        <div><dt class="text-fg-subtle">Atendida por</dt><dd class="text-fg">{h.atendidoPor?.nome ?? '—'}</dd></div>
        <div><dt class="text-fg-subtle">Criada por</dt><dd class="text-fg">{h.criadoPor?.nome ?? (h.origem === 'portal' ? 'O próprio candidato' : '—')}</dd></div>
        <div><dt class="text-fg-subtle">Venda de</dt><dd class="text-fg">{h.vendedor?.nome ?? '—'}</dd></div>
      </dl>
      {pm && (
        <div class="rounded-md border border-border bg-surface-3 px-3 py-2 text-xs grid gap-0.5">
          <div class="font-semibold text-fg">
            Pagamento manual: {pm.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {ROTULO_FORMA[pm.forma] ?? pm.forma} · {new Date(pm.pagoEm).toLocaleDateString('pt-BR')}
          </div>
          <div class="text-fg-muted">Registrado por {pm.por.nome} em {quando(pm.em)} — {pm.motivo}</div>
          <a class="text-accent underline w-fit" href={pm.comprovante.url} target="_blank" rel="noopener">Ver comprovante ({pm.comprovante.nome})</a>
        </div>
      )}
      {h.eventos.length === 0 ? (
        <div class="text-xs text-fg-muted">Sem passos registrados ainda.</div>
      ) : (
        <ol class="grid gap-1.5">
          {h.eventos.map((e) => (
            <li key={e.id} class="flex items-start gap-2 text-xs">
              <span class={`mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${e.ator === 'atendente' ? 'bg-info' : e.ator === 'candidato' ? 'bg-success' : 'bg-fg-subtle'}`} />
              <div class="min-w-0 flex-1">
                <span class="text-fg">{e.rotulo}</span>
                {e.dados?.meio ? <span class="text-fg-muted"> ({String(e.dados.meio)})</span> : null}
                {Array.isArray(e.dados?.campos) ? <span class="text-fg-muted"> ({(e.dados!.campos as string[]).join(', ')})</span> : null}
                {e.dados?.cupom ? <span class="text-fg-muted"> · cupom {String(e.dados.cupom)}</span> : null}
                {e.dados?.assinadoPor ? <span class="text-fg-muted"> (assinado por {String(e.dados.assinadoPor)})</span> : null}
                <span class="text-fg-muted"> · {e.ator === 'atendente' ? (e.userName || 'Atendente') : e.ator === 'candidato' ? 'Candidato' : 'Sistema'}</span>
              </div>
              <time class="text-fg-subtle tabular-nums whitespace-nowrap">{quando(e.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
