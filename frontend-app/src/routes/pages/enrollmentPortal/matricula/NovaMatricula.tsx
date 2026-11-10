// Nova matrícula pelo painel: um formulário só, sem as etapas do portal. O que falta
// no cadastro se completa depois, nas abas da inscrição.
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

export interface OfertaDoCatalogo { id: number; nome: string; complemento?: string | null; turno: string | null; curso: string | null; ingresso: string | null; polos: Array<{ id: number; nome: string }> }
// A oferta tem nome próprio quando o curso tem variações (ex.: Tradicional × Certificação por Competência).
export const rotuloDaOferta = (o: OfertaDoCatalogo) =>
  [o.curso && o.nome !== o.curso ? o.nome : (o.curso ?? o.nome), o.complemento, o.ingresso, o.turno].filter(Boolean).join(' · ')
export const useCatalogo = (portalId: number | null) => useQuery({
  queryKey: ['mi-catalogo', portalId],
  queryFn: () => api.get<{ ofertas: OfertaDoCatalogo[] }>(`/admin/matricula-interna/catalogo?portalId=${portalId}`),
  enabled: !!portalId,
  staleTime: 60_000,
})

export interface LeadInicial { id: number; nome: string | null; email: string | null; whatsapp: string | null; cpf?: string | null }
interface LeadDaBusca { id: number; nome: string | null; email: string | null; whatsapp: string | null; inscricaoNoPortal: string | null }
/** Em qual ficha a matrícula vai cair quando ninguém escolheu (GET /matricula-interna/ficha). */
type FichaDaMatricula =
  | { tipo: 'ficha'; lead: { id: number; nome: string | null; whatsapp: string | null }; por: 'whatsapp' | 'cpf' | 'email' }
  | { tipo: 'outra_pessoa'; lead: { id: number; nome: string | null }; motivo: string }
  | { tipo: 'varias'; leads: Array<{ id: number; nome: string | null }> }
  | { tipo: 'nenhuma' }
const POR: Record<'whatsapp' | 'cpf' | 'email', string> = { whatsapp: 'mesmo WhatsApp', cpf: 'mesmo CPF', email: 'mesmo e-mail' }

export function NovaMatriculaModal({ portalId, portalNome, lead: leadInicial, de, onClose }: {
  portalId: number
  portalNome: string
  lead?: LeadInicial | null | undefined
  /** Para onde o Voltar da inscrição leva (ficha, conversa). */
  de?: string | undefined
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const cat = useCatalogo(portalId)
  const [lead, setLead] = useState<LeadInicial | null>(leadInicial ?? null)
  const [busca, setBusca] = useState('')
  const [nome, setNome] = useState(leadInicial?.nome ?? '')
  const [whatsapp, setWhatsapp] = useState(leadInicial?.whatsapp ?? '')
  const [email, setEmail] = useState(leadInicial?.email ?? '')
  const [cpf, setCpf] = useState(leadInicial?.cpf ?? '')
  const [offeringId, setOfferingId] = useState('')
  const [campusId, setCampusId] = useState('')
  const [lgpd, setLgpd] = useState(false)
  const [fichaSeparada, setFichaSeparada] = useState(false)
  // Dados digitados sem ficha escolhida: confere (com uma pausa) se a pessoa já tem ficha.
  const [conferir, setConferir] = useState({ nome: '', whatsapp: '', email: '', cpf: '' })
  useEffect(() => {
    const t = window.setTimeout(() => setConferir({ nome: nome.trim(), whatsapp: whatsapp.trim(), email: email.trim(), cpf: cpf.trim() }), 500)
    return () => window.clearTimeout(t)
  }, [nome, whatsapp, email, cpf])
  const temDado = conferir.whatsapp.replace(/\D/g, '').length >= 10 || conferir.cpf.replace(/\D/g, '').length === 11 || conferir.email.includes('@')
  const ficha = useQuery({
    queryKey: ['mi-ficha', portalId, conferir],
    queryFn: () => api.get<FichaDaMatricula>(`/admin/matricula-interna/ficha?portalId=${portalId}&${new URLSearchParams(conferir).toString()}`),
    enabled: !lead && temDado,
    staleTime: 10_000,
  })
  const fichaAchada = !lead && temDado ? ficha.data : undefined
  const termo = busca.trim()
  const leads = useQuery({
    queryKey: ['mi-leads', portalId, termo],
    queryFn: () => api.get<{ leads: LeadDaBusca[] }>(`/admin/inscricao-assistida/leads?portalId=${portalId}&q=${encodeURIComponent(termo)}`),
    enabled: termo.length >= 2 && !lead,
    staleTime: 5_000,
  })
  const oferta = cat.data?.ofertas.find((o) => String(o.id) === offeringId)
  const escolher = (l: LeadDaBusca) => { setLead(l); setNome(l.nome ?? ''); setWhatsapp(l.whatsapp ?? ''); setEmail(l.email ?? ''); setBusca('') }
  const criar = useMutation({
    mutationFn: () => api.post<{ id: number; existente: boolean; candidateCode: string }>('/admin/matricula-interna', {
      portalId, leadId: lead?.id ?? null, nome, whatsapp, email, cpf, offeringId: Number(offeringId), campusId: campusId ? Number(campusId) : null, lgpdConsent: lgpd,
      ...(!lead && fichaSeparada ? { fichaSeparada: true } : {}),
    }),
    onSuccess: (r) => {
      toast(r.existente ? `Já existe a inscrição ${r.candidateCode}: abrindo` : `Inscrição ${r.candidateCode} criada`, 'success')
      void qc.invalidateQueries({ queryKey: ['portal-registrations'] })
      onClose()
      navigate(`/enrollment-portals/${portalId}/registrations/${r.id}${de ? `?de=${encodeURIComponent(de)}` : ''}`)
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const pronto = nome.trim() && (whatsapp.trim() || email.trim()) && oferta && (oferta.polos.length <= 1 || campusId) && lgpd

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Nova matrícula" size="lg"
      description={`${portalNome}. Preencha o básico: documentos, valores e cobrança ficam nas abas da inscrição.`}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="primary" disabled={!pronto || criar.isPending} onClick={() => criar.mutate()}>{criar.isPending ? 'Criando…' : 'Criar matrícula'}</Button>
      </>}>
      <div class="grid gap-4">
        {!leadInicial && (
          lead ? (
            <div class="flex items-center gap-2 rounded-md bg-surface-3 px-3 py-2">
              <div class="min-w-0 flex-1 text-xs text-fg">Na ficha de <strong>{lead.nome || 'Sem nome'}</strong> <span class="text-fg-subtle">#{lead.id}</span></div>
              <Button size="sm" variant="ghost" onClick={() => setLead(null)}>Trocar</Button>
            </div>
          ) : (
            <div class="grid gap-1.5">
              <Input label="Lead já existente (opcional)" placeholder="Nome, e-mail ou WhatsApp" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
              {termo.length >= 2 && (
                <div class="max-h-44 overflow-auto rounded-md border border-border divide-y divide-border">
                  {leads.isLoading && <div class="px-3 py-2 text-xs text-fg-muted">Buscando…</div>}
                  {!leads.isLoading && (leads.data?.leads ?? []).length === 0 && <div class="px-3 py-2 text-xs text-fg-muted">Nenhum lead entre os que você atende. Sem escolher, cria uma ficha nova.</div>}
                  {(leads.data?.leads ?? []).map((l) => (
                    <button key={l.id} type="button" class="w-full text-left px-3 py-2 hover:bg-surface-3" onClick={() => escolher(l)}>
                      <div class="text-sm text-fg truncate">{l.nome || 'Sem nome'} <span class="text-fg-subtle text-xs">#{l.id}</span></div>
                      <div class="text-xs text-fg-muted truncate">{[l.whatsapp, l.email].filter(Boolean).join(' · ')}{l.inscricaoNoPortal && <span class="text-info"> · já tem a inscrição {l.inscricaoNoPortal}</span>}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        <div class="grid sm:grid-cols-2 gap-3">
          <Input label="Nome completo" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
          <Input label="CPF" value={cpf} onInput={(e) => setCpf((e.target as HTMLInputElement).value)} />
          <Input label="WhatsApp" value={whatsapp} onInput={(e) => setWhatsapp((e.target as HTMLInputElement).value)} />
          <Input label="E-mail" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </div>
        {fichaAchada?.tipo === 'ficha' && (
          <div class="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg grid gap-1.5">
            {fichaSeparada
              ? <span>Vai ser criada uma <strong>ficha nova</strong>, separada de <strong>{fichaAchada.lead.nome || 'Sem nome'}</strong> #{fichaAchada.lead.id}.</span>
              : <span>Esta pessoa já tem ficha: <strong>{fichaAchada.lead.nome || 'Sem nome'}</strong> <span class="text-fg-subtle">#{fichaAchada.lead.id}</span> ({POR[fichaAchada.por]}). A matrícula vai para ela, sem criar outra ficha.</span>}
            <label class="flex items-center gap-2">
              <input type="checkbox" checked={fichaSeparada} onChange={(e) => setFichaSeparada((e.target as HTMLInputElement).checked)} />
              <span>É outra pessoa (ex.: familiar no mesmo número): criar ficha separada</span>
            </label>
          </div>
        )}
        {fichaAchada?.tipo === 'varias' && (
          <div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg grid gap-1.5">
            <span>Há {fichaAchada.leads.length} fichas com esses dados. Escolha em qual fazer a matrícula:</span>
            <div class="flex flex-wrap gap-1.5">
              {fichaAchada.leads.map((l) => (
                <Button key={l.id} size="sm" variant="secondary" onClick={() => setLead({ id: l.id, nome: l.nome, email: email || null, whatsapp: whatsapp || null })}>{l.nome || 'Sem nome'} #{l.id}</Button>
              ))}
            </div>
            <span class="text-fg-muted">Sem escolher, cria uma ficha nova.</span>
          </div>
        )}
        {fichaAchada?.tipo === 'outra_pessoa' && (
          <div class="rounded-md bg-surface-3 px-3 py-2 text-xs text-fg-muted">
            Existe a ficha de {fichaAchada.lead.nome || 'Sem nome'} #{fichaAchada.lead.id} com esses dados, mas com {fichaAchada.motivo}: vai ser criada uma ficha separada.
          </div>
        )}
        <div class="grid sm:grid-cols-2 gap-3">
          <Select label="Curso e forma de ingresso" value={offeringId} onChange={(e) => { setOfferingId((e.target as HTMLSelectElement).value); setCampusId('') }}>
            <option value="">{cat.isLoading ? 'Carregando…' : 'Escolha…'}</option>
            {cat.data?.ofertas.map((o) => <option key={o.id} value={o.id}>{rotuloDaOferta(o)}</option>)}
          </Select>
          {oferta && oferta.polos.length > 1 ? (
            <Select label="Polo" value={campusId} onChange={(e) => setCampusId((e.target as HTMLSelectElement).value)}>
              <option value="">Escolha…</option>
              {oferta.polos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          ) : <div />}
        </div>
        <label class="flex items-start gap-2 text-xs text-fg">
          <input type="checkbox" class="mt-0.5" checked={lgpd} onChange={(e) => setLgpd((e.target as HTMLInputElement).checked)} />
          <span>O candidato autorizou o uso dos dados (Política de Privacidade). Fica registrado em seu nome.</span>
        </label>
      </div>
    </Modal>
  )
}
