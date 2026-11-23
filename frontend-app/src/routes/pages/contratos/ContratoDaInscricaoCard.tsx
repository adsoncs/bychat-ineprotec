// Contrato no detalhe da inscrição (Portal de Matrículas, sem depender do ERP):
// qual modelo vale, quem já assinou, link para quem falta e o PDF.
import { useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSignature, FileText, RefreshCw, Copy, RotateCcw } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { BASE_CONTRATOS_PORTAL } from './ContratoWord'
import { STATUS_CONTRATO, abrirPdfDoEnvelope } from '../educational/EducationalContratosPage'

interface Estado {
  modelo: { id: number; nome: string } | null
  eletronica: boolean
  assinatura: {
    envelopeId: number; status: string; provedor: string; assinadoEm: string | null
    signatarios: Array<{ id: number; papel: string; nome: string; status: string; link: string | null; porEmail: boolean }>
  } | null
  aceite: { em: string; nome: string | null; via: string; ip: string | null } | null
  novoAceite?: {
    pendente: { pedidoEm: string; motivo: string; porNome: string } | null
    historico: Array<{ pedidoEm: string; motivo: string; porNome: string; atendidoEm?: string; canceladoEm?: string; canceladoPor?: string }>
  }
}
const PAPEL: Record<string, string> = { ALUNO: 'Aluno', RESPONSAVEL: 'Responsável financeiro' }
const SIG: Record<string, string> = { PENDENTE: 'aguardando', VISUALIZADO: 'abriu', ASSINADO: 'assinou', REJEITADO: 'recusou' }

export function ContratoDaInscricaoCard({ registrationId }: { registrationId: number }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ct-inscricao', registrationId], queryFn: () => api.get<Estado>(`${BASE_CONTRATOS_PORTAL}/inscricao/${registrationId}`), staleTime: 10_000 })
  const sinc = useMutation({
    mutationFn: () => api.post(`${BASE_CONTRATOS_PORTAL}/inscricao/${registrationId}/sincronizar`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ct-inscricao', registrationId] }); toast('Situação atualizada', 'success') },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const [pedindo, setPedindo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const recarregar = () => { void qc.invalidateQueries({ queryKey: ['ct-inscricao', registrationId] }); void qc.invalidateQueries({ queryKey: ['novo-aceite'] }) }
  const pedir = useMutation({
    mutationFn: () => api.post(`${BASE_CONTRATOS_PORTAL}/inscricao/${registrationId}/novo-aceite`, { motivo }),
    onSuccess: () => { setPedindo(false); setMotivo(''); recarregar(); toast('Novo aceite pedido — o aluno vê o aviso no Meu Portal', 'success') },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const cancelar = useMutation({
    mutationFn: () => api.delete(`${BASE_CONTRATOS_PORTAL}/inscricao/${registrationId}/novo-aceite`),
    onSuccess: () => { recarregar(); toast('Pedido de novo aceite cancelado', 'success') },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const d = q.data
  if (!d) return null
  const na = d.novoAceite
  const pendente = na?.pendente ?? null
  // Só o aceite no portal se refaz por aqui (Autentique/Clicksign: pelo provedor).
  const podePedir = !pendente && d.assinatura?.status === 'ASSINADO' && d.assinatura.provedor === 'PORTAL' && !d.eletronica
  const ultimoAtendido = [...(na?.historico ?? [])].reverse().find((h) => h.atendidoEm)
  const a = d.assinatura
  const st = a ? STATUS_CONTRATO[a.status] ?? { rotulo: a.status, tom: 'neutral' as const } : null
  const copiar = (l: string) => { void navigator.clipboard?.writeText(l); toast('Link copiado', 'success') }
  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted flex items-center gap-1.5 flex-1"><FileSignature size={12} /> Contrato</div>
        {st && <Badge tone={st.tom}>{st.rotulo}</Badge>}
        {!a && d.aceite && <Badge tone="success">Aceito</Badge>}
        {!a && !d.aceite && <Badge tone="neutral">Não assinado</Badge>}
        {pendente && <Badge tone="warning">Novo aceite pendente</Badge>}
      </div>
      <div class="space-y-2 text-sm">
        <div class="text-fg-muted">
          Modelo: {d.modelo ? <span class="text-fg">{d.modelo.nome}</span> : 'nenhum modelo em Word para este portal/curso — vale o termo de aceite simples'}
        </div>
        {a && (
          <ul class="space-y-1">
            {a.signatarios.map((s) => (
              <li key={s.id} class="flex flex-wrap items-center gap-2">
                <span class="text-fg">{PAPEL[s.papel] ?? s.papel}: {s.nome}</span>
                <Badge tone={s.status === 'ASSINADO' ? 'success' : s.status === 'REJEITADO' ? 'danger' : 'warning'}>{SIG[s.status] ?? s.status}</Badge>
                {s.status !== 'ASSINADO' && s.link && <Button size="sm" variant="ghost" onClick={() => copiar(s.link!)}><Copy size={12} /> Copiar link de assinatura</Button>}
                {s.status !== 'ASSINADO' && s.porEmail && <span class="text-xs text-fg-muted">convite por e-mail</span>}
              </li>
            ))}
          </ul>
        )}
        {!a && d.aceite && (
          <div class="text-xs text-fg-muted">Aceito por {d.aceite.nome ?? '—'} em {new Date(d.aceite.em).toLocaleString('pt-BR')}{d.aceite.ip ? ` · IP ${d.aceite.ip}` : ''}</div>
        )}
        {a?.assinadoEm && <div class="text-xs text-fg-muted">Concluído em {new Date(a.assinadoEm).toLocaleString('pt-BR')} ({a.provedor === 'AUTENTIQUE' ? 'Autentique' : a.provedor === 'CLICKSIGN' ? 'Clicksign' : 'aceite no portal'})</div>}
        <div class="flex flex-wrap gap-2 pt-1">
          {a && <Button size="sm" variant="secondary" onClick={() => abrirPdfDoEnvelope(a.envelopeId)}><FileText size={14} /> {a.status === 'ASSINADO' ? 'PDF assinado' : 'PDF do contrato'}</Button>}
          {a && (a.provedor === 'AUTENTIQUE' || a.provedor === 'CLICKSIGN') && a.status !== 'ASSINADO' && <Button size="sm" variant="ghost" loading={sinc.isPending} onClick={() => sinc.mutate()}><RefreshCw size={14} /> Atualizar situação</Button>}
          {podePedir && !pedindo && <Button size="sm" variant="ghost" onClick={() => setPedindo(true)}><RotateCcw size={14} /> Pedir novo aceite</Button>}
        </div>
        {pendente && (
          <div class="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs space-y-1">
            <div>Pedido em {new Date(pendente.pedidoEm).toLocaleString('pt-BR')} por {pendente.porNome || '—'}. O aluno vê o aviso no Meu Portal e aceita o texto atual; o acesso ao curso não muda.</div>
            <div class="text-fg-muted">Motivo: {pendente.motivo}</div>
            <Button size="sm" variant="ghost" loading={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar pedido</Button>
          </div>
        )}
        {!pendente && ultimoAtendido && (
          <div class="text-xs text-fg-muted">Novo aceite feito em {new Date(ultimoAtendido.atendidoEm!).toLocaleString('pt-BR')} (pedido por {ultimoAtendido.porNome || '—'}). A versão anterior fica no histórico.</div>
        )}
        {pedindo && (
          <div class="space-y-2 pt-1">
            <Textarea rows={2} label="Motivo (fica no histórico; o aluno não vê)" value={motivo}
              onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} placeholder="Ex.: termo atualizado — saiu a referência a um contrato que não existia" />
            <div class="text-xs text-fg-muted">O aluno lê o termo atual, com os dados dele, e aceita de novo. Se houver fluxo com o gatilho "Novo aceite do contrato pedido", ele avisa o aluno.</div>
            <div class="flex gap-2">
              <Button size="sm" loading={pedir.isPending} disabled={motivo.trim().length < 5} onClick={() => pedir.mutate()}>Pedir novo aceite</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPedindo(false); setMotivo('') }}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
