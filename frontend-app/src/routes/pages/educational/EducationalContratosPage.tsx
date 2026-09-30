// Educacional › Contratos — o contrato do Portal de Matrículas.
//
// Mora aqui (e não no ERP) porque quem tem só Educacional + Portal também
// contrata e assina na inscrição: modelos em Word, assinatura eletrônica
// (Autentique) e os contratos das inscrições. Com o ERP instalado, a tela
// Assinatura de Contratos dele mostra e edita estes mesmos dados.
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter-preact'
import { FileSignature, FileStack, Settings, FileText, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { BASE_CONTRATOS_PORTAL } from '../contratos/ContratoWord'
import { ListaDeModelos, ConfigAssinaturaModal, useConfigAssinatura } from '../contratos/Modelos'

interface ContratoDaInscricao {
  registrationId: number; candidateCode: string; portalId: number; portalNome: string | null
  nome: string | null; curso: string | null
  envelopeId: number | null; titulo: string; status: string; provedor: string
  assinados: number; total: number; enviadoEm: string | null; assinadoEm: string | null
}

export const STATUS_CONTRATO: Record<string, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  ASSINADO: { rotulo: 'Assinado', tom: 'success' },
  PARCIAL: { rotulo: 'Assinado em parte', tom: 'info' },
  ENVIADO: { rotulo: 'Aguardando assinatura', tom: 'warning' },
  RASCUNHO: { rotulo: 'Rascunho', tom: 'neutral' },
  REJEITADO: { rotulo: 'Recusado', tom: 'danger' },
}
const PROVEDOR: Record<string, string> = { AUTENTIQUE: 'Autentique', PORTAL: 'Aceite no portal', TERMO: 'Termo de aceite', SIMULADO: 'Simulado' }

/** Abre o PDF do contrato (rota autenticada: vem como blob). */
export async function abrirPdfDoEnvelope(envelopeId: number) {
  const janela = window.open('', '_blank')
  try {
    const t = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
    const res = await fetch(`${env.apiBase}${BASE_CONTRATOS_PORTAL}/envelope/${envelopeId}/pdf`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
    if (!res.ok) throw new Error('PDF indisponível')
    const url = URL.createObjectURL(await res.blob())
    if (janela) janela.location.href = url; else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) { janela?.close(); toast(e?.message || 'Falha ao abrir o PDF', 'danger') }
}

type Aba = 'contratos' | 'modelos'

export function EducationalContratosPage() {
  const [aba, setAba] = useState<Aba>('contratos')
  const [cfg, setCfg] = useState(false)
  const config = useConfigAssinatura(BASE_CONTRATOS_PORTAL)
  const c = config.data
  return (
    <Page title="Contratos" description="Modelos de contrato do Portal de Matrículas, assinatura eletrônica e os contratos assinados nas inscrições."
      actions={<>
        {c && <Badge tone={c.modo === 'AUTENTIQUE' && !c.sandbox ? 'success' : 'warning'}>{c.modo === 'AUTENTIQUE' ? (c.sandbox ? 'Autentique · sandbox' : 'Autentique') : 'Aceite no portal (sem Autentique)'}</Badge>}
        <Button variant="secondary" size="sm" onClick={() => setCfg(true)}><Settings size={14} /> Assinatura eletrônica</Button>
      </>}>
      {c && (c.modo !== 'AUTENTIQUE' || c.sandbox) && (
        <div class="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-fg">
          <AlertTriangle size={16} class="text-warning shrink-0 mt-0.5" />
          <span>
            {c.modo !== 'AUTENTIQUE'
              ? 'A Autentique não está configurada: o aluno lê o contrato e aceita no próprio portal digitando o nome. Para assinatura eletrônica com validade jurídica, configure o token em "Assinatura eletrônica".'
              : 'A Autentique está em modo sandbox (teste): as assinaturas não têm validade jurídica. Desmarque "Sandbox" em "Assinatura eletrônica" para valer de verdade.'}
          </span>
        </div>
      )}
      <div class="flex gap-1 border-b border-border">
        {([['contratos', 'Contratos das inscrições', FileSignature], ['modelos', 'Modelos', FileStack]] as [Aba, string, any][]).map(([k, l, Ico]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 flex items-center gap-1 ${aba === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setAba(k)}><Ico size={14} /> {l}</button>
        ))}
      </div>
      {aba === 'contratos' && <ContratosDasInscricoes />}
      {aba === 'modelos' && <ListaDeModelos base={BASE_CONTRATOS_PORTAL} erp={false} />}
      {cfg && <ConfigAssinaturaModal base={BASE_CONTRATOS_PORTAL} onClose={() => setCfg(false)} />}
    </Page>
  )
}

function ContratosDasInscricoes() {
  const [portalId, setPortalId] = useState('')
  const [, navigate] = useLocation()
  const portais = useEnrollmentPortals()
  const q = useQuery({
    queryKey: ['ct-inscricoes', portalId],
    queryFn: () => api.get<{ contratos: ContratoDaInscricao[] }>(`${BASE_CONTRATOS_PORTAL}/inscricoes${portalId ? `?portalId=${portalId}` : ''}`),
    staleTime: 10_000,
  })
  const itens = q.data?.contratos ?? []
  return (
    <div class="space-y-3">
      <div class="flex items-end gap-2">
        <div class="w-72">
          <Select label="Portal" value={portalId} onChange={(e: any) => setPortalId(e.currentTarget.value)}>
            <option value="">Todos os portais</option>
            {(portais.data?.portals ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        </div>
      </div>
      {q.isLoading ? <Skeleton class="h-24 w-full" /> : itens.length === 0 ? (
        <EmptyState icon={<FileSignature size={28} />} title="Nenhum contrato ainda" description="Quando um candidato assinar (ou começar a assinar) o contrato na inscrição, ele aparece aqui." />
      ) : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {itens.map((i) => {
            const st = STATUS_CONTRATO[i.status] ?? { rotulo: i.status, tom: 'neutral' as const }
            const data = i.assinadoEm ?? i.enviadoEm
            return (
              <div key={`${i.registrationId}-${i.envelopeId ?? 't'}`} class="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <button class="flex-1 min-w-[14rem] text-left" onClick={() => navigate(`/enrollment-portals/${i.portalId}/registrations/${i.registrationId}`)}>
                  <span class="block truncate text-fg hover:underline">{i.nome ?? 'Sem nome'} <span class="text-fg-muted font-mono text-xs">{i.candidateCode}</span></span>
                  <span class="block text-xs text-fg-muted truncate">{[i.curso, i.portalNome, i.titulo].filter(Boolean).join(' · ')}</span>
                </button>
                <span class="text-xs text-fg-muted">{PROVEDOR[i.provedor] ?? i.provedor}{i.total > 1 ? ` · ${i.assinados}/${i.total} assinaram` : ''}{data ? ` · ${new Date(data).toLocaleDateString('pt-BR')}` : ''}</span>
                <Badge tone={st.tom}>{st.rotulo}</Badge>
                {i.envelopeId && <Button size="sm" variant="ghost" onClick={() => abrirPdfDoEnvelope(i.envelopeId!)}><FileText size={14} /> PDF</Button>}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
