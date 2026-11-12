// Transferência de curso (09/11/2026): o aluno pagou e quer outro curso. O que foi pago
// vira crédito na nova inscrição, os documentos iguais vão junto e o contrato do curso
// novo fica para assinar. A tela mostra tudo antes; nada é enviado ao aluno.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { ArrowRightLeft } from '@/components/ui/icon-set'
import { rotuloDaOferta, useCatalogo } from './NovaMatricula'
import { invalidarInscricao } from './Dispensa'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const SIT: Record<string, string> = { approved: 'Aprovado', pending: 'Em análise', reviewing: 'Em análise', rejected: 'Reprovado' }

interface Distribuicao {
  caso: 'sem_credito' | 'reduz_entrada' | 'cobre_entrada'
  creditoCentavos: number; entradaTabelaCentavos: number; entradaAPagarCentavos: number; creditoNaEntradaCentavos: number
  parcelasQuitadas: number; parcelasRestantes: number; novaParcelaCentavos: number; sobraCentavos: number
  totalCursoCentavos: number; totalAPagarCentavos: number
}
interface Doc { codigo: string; nome: string; status?: string; obrigatorio?: boolean }
interface Previa {
  ok: true; bloqueios: string[]; avisos: string[]; assinatura: string
  de: { codigo: string; curso: string | null; portal: string | null; pago: boolean }
  para: {
    portal: string; curso: string; ingresso: string | null; polo: { nome: string } | null; escopo: 'curso' | 'taxa'; taxaCentavos: number
    plano: { id: number; nome: string; matricula: number; parcela: number; numParcelas: number; dia: number } | null
    planos: Array<{ id: number; nome: string }>
    precos?: Array<{ chave: string; rotulo: string; totalCentavos: number }>
    precoPor?: string
    precoPadrao?: string
  }
  financeiro: { recebido: { totalCentavos: number; itens: Array<{ rotulo: string; centavos: number }> }; distribuicao: Distribuicao | null; primeiraSeguinte: string | null; pontualidadeCentavos?: number }
  documentos: { levados: Doc[]; faltam: Doc[]; ficam: Doc[]; reprovados: Doc[] }
  contrato: { antigo: 'assinado' | 'aceito' | 'pendente' | 'nenhum'; pendentesParaCancelar: number }
}
interface Historico {
  id: number; em: string; por: string | null; motivo: string; sentido: 'saiu' | 'veio'
  de: { id: number; candidateCode: string; portalId: number }; para: { id: number; candidateCode: string; portalId: number }
  creditoCentavos: number; parcelasQuitadas: number; sobraCentavos: number
}

/** Aviso no topo das duas inscrições: de onde veio e para onde foi. */
export function AvisoDeTransferencia({ registrationId }: { registrationId: number }) {
  const pode = useCan('edu_transferir_curso', 'view')
  const q = useQuery({
    queryKey: ['mi-transferencia', registrationId],
    queryFn: () => api.get<{ historico: Historico[] }>(`/admin/matricula-interna/${registrationId}/transferencia`),
    enabled: pode, staleTime: 30_000,
  })
  const lista = q.data?.historico ?? []
  if (!lista.length) return null
  return (
    <div class="grid gap-2">
      {lista.map((t) => {
        const outra = t.sentido === 'saiu' ? t.para : t.de
        const link = `/enrollment-portals/${outra.portalId}/registrations/${outra.id}`
        return (
          <div key={t.id} role="status" class={`rounded-md border px-3 py-2 text-sm ${t.sentido === 'saiu' ? 'border-warning/40 bg-warning/5' : 'border-accent/40 bg-accent/5'}`}>
            <div class="flex flex-wrap items-center gap-2">
              <ArrowRightLeft size={14} />
              {t.sentido === 'saiu'
                ? <span>Transferida para <a class="text-accent hover:underline font-medium" href={link}>{outra.candidateCode}</a> em {dia(t.em)}{t.por ? ` por ${t.por}` : ''}. Esta inscrição ficou só como histórico.</span>
                : <span>Veio da transferência de <a class="text-accent hover:underline font-medium" href={link}>{outra.candidateCode}</a> em {dia(t.em)}{t.creditoCentavos > 0 ? `, com crédito de ${brl(t.creditoCentavos)}` : ''}{t.parcelasQuitadas ? ` (${t.parcelasQuitadas} parcela(s) quitada(s))` : ''}.</span>}
            </div>
            <div class="text-xs text-fg-muted mt-0.5">Motivo: {t.motivo}{t.sobraCentavos > 0 ? ` · Sobra de ${brl(t.sobraCentavos)} para devolver.` : ''}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Botão do cabeçalho + modal com a prévia e a confirmação. */
export function BotaoTransferirCurso({ registrationId, portalIdAtual, aberta }: { registrationId: number; portalIdAtual: number; aberta: boolean }) {
  const pode = useCan('edu_transferir_curso', 'edit')
  const [abrir, setAbrir] = useState(false)
  if (!pode || !aberta) return null
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setAbrir(true)} title="Leva a inscrição para outro curso, com o que foi pago virando crédito">
        <ArrowRightLeft size={12} /> Transferir de curso
      </Button>
      {abrir && <ModalTransferir registrationId={registrationId} portalIdAtual={portalIdAtual} onClose={() => setAbrir(false)} />}
    </>
  )
}

function ModalTransferir({ registrationId, portalIdAtual, onClose }: { registrationId: number; portalIdAtual: number; onClose: () => void }) {
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const portais = useEnrollmentPortals()
  const [portalId, setPortalId] = useState(String(portalIdAtual))
  const [offeringId, setOfferingId] = useState('')
  const [campusId, setCampusId] = useState('')
  const [planoId, setPlanoId] = useState('')
  const [precoPor, setPrecoPor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [conferido, setConferido] = useState(false)
  const cat = useCatalogo(portalId ? Number(portalId) : null)
  const oferta = cat.data?.ofertas.find((o) => String(o.id) === offeringId)
  const pronto = !!oferta && (oferta.polos.length <= 1 || !!campusId)
  const alvo = { portalId: Number(portalId), offeringId: Number(offeringId), campusId: campusId ? Number(campusId) : null, planoId: planoId ? Number(planoId) : null, precoPor: precoPor || null }
  const previa = useQuery({
    queryKey: ['mi-transferencia-previa', registrationId, alvo],
    queryFn: () => api.post<Previa>(`/admin/matricula-interna/${registrationId}/transferencia/previa`, alvo),
    enabled: pronto, staleTime: 0, retry: false,
  })
  const p = previa.data
  const transferir = useMutation({
    mutationFn: () => api.post<{ paraId: number; paraCodigo: string; portalId: number; avisos: string[] }>(`/admin/matricula-interna/${registrationId}/transferencia`, { ...alvo, motivo, assinatura: p?.assinatura }),
    onSuccess: (r) => {
      invalidarInscricao(qc, registrationId)
      void qc.invalidateQueries({ queryKey: ['mi-transferencia'] })
      void qc.invalidateQueries({ queryKey: ['portal-registrations'] })
      toast(`Transferida para ${r.paraCodigo}`, 'success')
      if (r.avisos.length) toast(`Atenção: ${r.avisos.join(' · ')}`, 'warning')
      onClose()
      navigate(`/enrollment-portals/${r.portalId}/registrations/${r.paraId}`)
    },
    onError: (e: unknown) => { void previa.refetch(); toast((e as Error).message, 'danger') },
  })
  const lista = (portais.data?.portals ?? []).filter((x: any) => x.active !== false && x.formMode !== 'interest')
  const d = p?.financeiro.distribuicao ?? null
  const entrada = p?.para.escopo === 'taxa' ? 'taxa de inscrição' : 'entrada'
  const podeConfirmar = !!p && !p.bloqueios.length && motivo.trim().length >= 5 && conferido && !transferir.isPending

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Transferir para outro curso" size="lg"
      description="Esta inscrição é encerrada e uma nova nasce no curso escolhido. Nada é enviado ao aluno."
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="primary" disabled={!podeConfirmar} onClick={() => transferir.mutate()}>{transferir.isPending ? 'Transferindo…' : 'Transferir'}</Button>
      </>}>
      <div class="grid gap-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <Select label="Portal" value={portalId} onChange={(e) => { setPortalId((e.target as HTMLSelectElement).value); setOfferingId(''); setCampusId(''); setPlanoId(''); setPrecoPor('') }}>
            {lista.map((x: any) => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}
          </Select>
          <Select label="Novo curso" value={offeringId} onChange={(e) => { setOfferingId((e.target as HTMLSelectElement).value); setCampusId(''); setPlanoId('') }}>
            <option value="">{cat.isLoading ? 'Carregando…' : 'Escolha o curso'}</option>
            {(cat.data?.ofertas ?? []).map((o) => <option key={o.id} value={String(o.id)}>{rotuloDaOferta(o)}</option>)}
          </Select>
          {oferta && oferta.polos.length > 1 && (
            <Select label="Polo" value={campusId} onChange={(e) => setCampusId((e.target as HTMLSelectElement).value)}>
              <option value="">Escolha o polo</option>
              {oferta.polos.map((x) => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}
            </Select>
          )}
          {p && p.para.planos.length > 1 && (
            <Select label="Plano de pagamento" value={planoId || String(p.para.plano?.id ?? '')} onChange={(e) => { setPlanoId((e.target as HTMLSelectElement).value); setPrecoPor('') }}>
              {p.para.planos.map((x) => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}
            </Select>
          )}
          {/* Preço do curso novo: o plano tem um por forma de pagamento (12/11/2026). */}
          {p && (p.para.precos?.length ?? 0) > 1 && (
            <Select label="Calcular o curso novo pelo preço de" value={precoPor || p.para.precoPor || 'tabela'} onChange={(e) => setPrecoPor((e.target as HTMLSelectElement).value)}
              hint={p.para.precoPadrao && p.para.precoPadrao !== 'tabela' ? `Padrão: a forma da inscrição antiga (${p.para.precos!.find((x) => x.chave === p.para.precoPadrao)?.rotulo ?? ''}).` : 'Padrão: a tabela do plano.'}>
              {p.para.precos!.map((x) => <option key={x.chave} value={x.chave}>{x.rotulo} · {brl(x.totalCentavos)}{x.chave === p.para.precoPadrao ? ' (forma da inscrição antiga)' : ''}</option>)}
            </Select>
          )}
        </div>

        {previa.isFetching && <div class="text-xs text-fg-muted">Calculando…</div>}
        {previa.error && <div class="text-sm text-danger" role="alert">{(previa.error as Error).message}</div>}

        {p && (
          <>
            <Secao titulo="Financeiro">
              <div class="text-sm text-fg">
                Recebido em {p.de.codigo}: <strong class="tabular-nums">{brl(p.financeiro.recebido.totalCentavos)}</strong>
                {p.financeiro.recebido.totalCentavos > 0 && <span class="text-fg-muted"> (vira crédito)</span>}
              </div>
              {p.financeiro.recebido.itens.length > 0 && (
                <ul class="text-xs text-fg-muted mt-1">{p.financeiro.recebido.itens.map((i, n) => <li key={n}>{i.rotulo}: <span class="tabular-nums">{brl(i.centavos)}</span></li>)}</ul>
              )}
              {!!p.financeiro.pontualidadeCentavos && (
                <div class="text-xs text-fg-muted mt-1">+ desconto de pontualidade já concedido na 1ª: <span class="tabular-nums">{brl(p.financeiro.pontualidadeCentavos)}</span> (mantendo a mesma forma de pagamento, a 1ª conta como parcela inteira)</div>
              )}
              {p.para.plano && (
                <div class="text-xs text-fg-muted mt-2">
                  Curso novo pela tabela ({p.para.plano.nome}): {p.para.plano.matricula > 0 ? `matrícula ${brl(p.para.plano.matricula)} + ` : ''}{p.para.plano.numParcelas}x de {brl(p.para.plano.parcela)}, todo dia {p.para.plano.dia}
                </div>
              )}
              {p.para.escopo === 'taxa' && <div class="text-xs text-fg-muted mt-2">O portal novo cobra a taxa de inscrição: {brl(p.para.taxaCentavos)}.</div>}
              {d && d.caso === 'sem_credito' && <div class="text-sm text-fg mt-2">Sem crédito: a nova inscrição segue a cobrança normal.</div>}
              {d && d.caso === 'reduz_entrada' && (
                <div class="text-sm text-fg mt-2">
                  O crédito abate a {entrada}: o aluno paga <strong class="tabular-nums">{brl(d.entradaAPagarCentavos)}</strong> no portal (em vez de {brl(d.entradaTabelaCentavos)}){d.parcelasRestantes > 0 ? ` e depois ${d.parcelasRestantes}x de ${brl(d.novaParcelaCentavos)}` : ''}.
                </div>
              )}
              {d && d.caso === 'cobre_entrada' && (
                <div class="text-sm text-fg mt-2 grid gap-1">
                  <div>A {entrada} ({brl(d.entradaTabelaCentavos)}) fica <strong>paga pelo crédito</strong>.</div>
                  {d.parcelasQuitadas > 0 && <div>Mais {d.parcelasQuitadas} parcela(s) quitada(s) pelo crédito.</div>}
                  {d.parcelasRestantes > 0
                    ? <div>Restam <strong class="tabular-nums">{d.parcelasRestantes}x de {brl(d.novaParcelaCentavos)}</strong>{p.financeiro.primeiraSeguinte ? `, a 1ª em ${dia(p.financeiro.primeiraSeguinte)}` : ''}.</div>
                    : p.para.escopo === 'curso' ? <div>O curso novo fica todo pago pelo crédito.</div> : null}
                </div>
              )}
              {d && <div class="text-xs text-fg-muted mt-1">Total que o aluno ainda paga: <span class="tabular-nums">{brl(d.totalAPagarCentavos)}</span> de {brl(d.totalCursoCentavos)}.</div>}
            </Secao>

            <Secao titulo="Documentos">
              {p.documentos.levados.length > 0
                ? <Lista titulo={`Vão junto (${p.documentos.levados.length})`} itens={p.documentos.levados.map((x) => `${x.nome} — ${SIT[x.status ?? ''] ?? x.status}`)} />
                : <div class="text-xs text-fg-muted">Nenhum documento a levar.</div>}
              {p.documentos.faltam.length > 0 && <Lista titulo="Ficam pendentes na nova inscrição" itens={p.documentos.faltam.map((x) => `${x.nome}${x.obrigatorio ? '' : ' (opcional)'}`)} />}
              {p.documentos.reprovados.length > 0 && <Lista titulo="Reprovados: o aluno manda de novo" itens={p.documentos.reprovados.map((x) => x.nome)} />}
              {p.documentos.ficam.length > 0 && <Lista titulo="Não são pedidos no curso novo (ficam na antiga)" itens={p.documentos.ficam.map((x) => x.nome)} />}
            </Secao>

            <Secao titulo="Contrato">
              <div class="text-sm text-fg">
                {p.contrato.antigo === 'assinado' ? 'O contrato antigo está assinado e fica guardado na inscrição antiga.'
                  : p.contrato.antigo === 'aceito' ? 'O contrato antigo foi aceito e fica guardado na inscrição antiga.'
                  : p.contrato.antigo === 'pendente' ? 'O contrato antigo não foi assinado: a assinatura pendente será cancelada.'
                  : 'Não havia contrato na inscrição antiga.'}
              </div>
              <div class="text-xs text-fg-muted mt-1">O contrato do curso novo, com o crédito descrito, fica disponível para assinatura ou aceite na nova inscrição.</div>
            </Secao>

            {p.avisos.length > 0 && <div class="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-fg grid gap-1">{p.avisos.map((a, n) => <div key={n}>⚠ {a}</div>)}</div>}
            {p.bloqueios.length > 0 && <div class="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger grid gap-1" role="alert">{p.bloqueios.map((a, n) => <div key={n}>{a}</div>)}</div>}

            {!p.bloqueios.length && (
              <>
                <Textarea label="Motivo da transferência (fica no histórico)" rows={2} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
                <label class="flex items-start gap-2 text-xs text-fg">
                  <input type="checkbox" checked={conferido} onChange={(e) => setConferido((e.target as HTMLInputElement).checked)} />
                  <span>Conferi os valores com o aluno. A inscrição {p.de.codigo} será encerrada e as cobranças abertas dela serão canceladas.</span>
                </label>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Secao({ titulo, children }: { titulo: string; children: preact.ComponentChildren }) {
  return (
    <div class="rounded-md border border-border p-3">
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-1.5"><Badge tone="neutral">{titulo}</Badge></div>
      {children}
    </div>
  )
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <div class="mt-1.5">
      <div class="text-xs font-medium text-fg">{titulo}</div>
      <ul class="text-xs text-fg-muted list-disc pl-4">{itens.map((t, n) => <li key={n}>{t}</li>)}</ul>
    </div>
  )
}
