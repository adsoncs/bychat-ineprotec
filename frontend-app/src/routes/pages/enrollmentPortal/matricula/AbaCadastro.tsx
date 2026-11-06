// Aba Cadastro da matrícula interna: tudo editável de uma vez e troca de curso.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import type { RegistrationReview } from '@/hooks/useEnrollmentPortals'
import { chamarComoAgente, rotaInscricao } from './sessao'
import { invalidarInscricao } from './Dispensa'
import { rotuloDaOferta, useCatalogo } from './NovaMatricula'

interface CampoEd { chave: string; rotulo: string; grupo: string; tipo?: string; opcoes?: string[]; obrigatorio?: boolean }
interface DadosEtapa { campos: Array<{ name: string; label: string; required?: boolean; type?: string; options?: string[] }>; valores: Record<string, string> }

export function AbaCadastro({ review, podeEditar }: { review: RegistrationReview; podeEditar: boolean }) {
  const qc = useQueryClient()
  const id = review.registration.id
  const form = (review.registration.formData ?? {}) as Record<string, unknown>
  const dados = useQuery({
    queryKey: ['mi-dados', id],
    queryFn: async () => {
      const pedir = (etapa: string) => chamarComoAgente<DadosEtapa>(id, (s) => `${rotaInscricao(s)}/dados?etapa=${etapa}`)
      const [cad, ctr] = await Promise.all([pedir('cadastro'), pedir('contrato')])
      return [...cad.campos, ...ctr.campos].map((c) => ({ ...c, valor: cad.valores[c.name] ?? ctr.valores[c.name] ?? '' }))
    },
    enabled: podeEditar,
  })

  // O que o aluno já respondeu + o que as etapas ainda vão pedir: um formulário só.
  const { grupos, iniciais } = useMemo(() => {
    const out = new Map<string, CampoEd[]>()
    const vistos = new Set<string>()
    const iniciais: Record<string, string> = {}
    const pôr = (c: CampoEd, valor: string) => {
      if (vistos.has(c.chave)) return
      vistos.add(c.chave); iniciais[c.chave] = valor
      if (!out.has(c.grupo)) out.set(c.grupo, [])
      out.get(c.grupo)!.push(c)
    }
    for (const [chave, rotulo] of [['nome', 'Nome completo'], ['cpf', 'CPF'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp']] as const) {
      pôr({ chave, rotulo, grupo: 'Identificação' }, String(form[chave] ?? ''))
    }
    for (const g of review.cadastro ?? []) for (const c of g.campos) if (c.chave !== 'campusNome') pôr({ chave: c.chave, rotulo: c.rotulo, grupo: g.grupo, tipo: c.tipo, ...(c.opcoes ? { opcoes: c.opcoes } : {}) }, c.valor)
    for (const c of dados.data ?? []) pôr({ chave: c.name, rotulo: c.label, grupo: 'Pedido nas etapas', ...(c.type ? { tipo: c.type } : {}), ...(c.options ? { opcoes: c.options } : {}), ...(c.required ? { obrigatorio: true } : {}) }, c.valor)
    return { grupos: [...out.entries()], iniciais }
  }, [review, dados.data])

  const [valores, setValores] = useState<Record<string, string>>(iniciais)
  useEffect(() => { setValores(iniciais) }, [iniciais])
  const alterados = Object.keys(valores).filter((k) => (valores[k] ?? '') !== (iniciais[k] ?? ''))
  const salvar = useMutation({
    mutationFn: () => api.put<{ mudou: string[] }>(`/admin/matricula-interna/${id}/cadastro`, { valores: Object.fromEntries(alterados.map((k) => [k, valores[k]])) }),
    onSuccess: () => { toast('Cadastro salvo', 'success'); invalidarInscricao(qc, id) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  return (
    <div class="grid gap-3">
      <CursoCard review={review} podeEditar={podeEditar} />
      <Card>
        <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div class="text-xs uppercase tracking-wider text-fg-muted">Dados do cadastro</div>
          {podeEditar && (
            <div class="flex items-center gap-2">
              {alterados.length > 0 && <span class="text-2xs text-warning">{alterados.length} alteração(ões) sem salvar</span>}
              <Button size="sm" variant="primary" disabled={!alterados.length || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar cadastro'}</Button>
            </div>
          )}
        </div>
        <div class="grid gap-4">
          {grupos.map(([grupo, campos]) => (
            <div key={grupo}>
              <div class="text-2xs uppercase tracking-wider text-accent font-medium mb-1.5">{grupo}</div>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {campos.map((c) => c.opcoes?.length ? (
                  <Select key={c.chave} label={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} disabled={!podeEditar} value={valores[c.chave] ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setValores((x) => ({ ...x, [c.chave]: v })) }}>
                    <option value="">Escolha…</option>
                    {(valores[c.chave] && !c.opcoes.includes(valores[c.chave]!)) && <option value={valores[c.chave]}>{valores[c.chave]}</option>}
                    {c.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input key={c.chave} label={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} disabled={!podeEditar} value={valores[c.chave] ?? ''} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setValores((x) => ({ ...x, [c.chave]: v })) }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="text-2xs text-fg-muted mt-3">Nome e e-mail acompanham a ficha do lead. O WhatsApp da ficha só muda por lá, porque ele identifica a conversa. Campos * são cobrados na tela do aluno enquanto estiverem vazios.</div>
      </Card>
    </div>
  )
}

function CursoCard({ review, podeEditar }: { review: RegistrationReview; podeEditar: boolean }) {
  const [trocar, setTrocar] = useState(false)
  const oferta = review.processRegistration?.offering
  const sp = review.processRegistration?.selectionProcess
  const form = (review.registration.formData ?? {}) as Record<string, unknown>
  const pago = review.registration.paymentStatus === 'paid'
  const Item = ({ r, v }: { r: string; v: unknown }) => <div><div class="text-2xs text-fg-subtle">{r}</div><div class="text-sm text-fg">{String(v || '—')}</div></div>
  return (
    <Card>
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted">Curso</div>
        {podeEditar && <Button size="sm" variant="secondary" disabled={pago} title={pago ? 'Pagamento feito: o curso não muda por aqui' : undefined} onClick={() => setTrocar(true)}>Trocar curso</Button>}
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Item r="Curso" v={oferta?.course?.nome ?? oferta?.nome} />
        <Item r="Forma de ingresso" v={sp?.entryMode?.name ?? sp?.nome} />
        <Item r="Turno" v={oferta?.turno} />
        <Item r="Polo" v={form.campusNome} />
      </div>
      {trocar && <TrocarCursoModal review={review} onClose={() => setTrocar(false)} />}
    </Card>
  )
}

function TrocarCursoModal({ review, onClose }: { review: RegistrationReview; onClose: () => void }) {
  const qc = useQueryClient()
  const id = review.registration.id
  const cat = useCatalogo(review.portal?.id ?? null)
  const [offeringId, setOfferingId] = useState('')
  const [campusId, setCampusId] = useState('')
  const [motivo, setMotivo] = useState('')
  const oferta = cat.data?.ofertas.find((o) => String(o.id) === offeringId)
  const salvar = useMutation({
    mutationFn: () => api.put<{ avisos?: string[] }>(`/admin/matricula-interna/${id}/curso`, { offeringId: Number(offeringId), campusId: campusId ? Number(campusId) : null, motivo }),
    onSuccess: (r) => { toast('Curso alterado', 'success'); for (const a of r.avisos ?? []) toast(a, 'warning'); invalidarInscricao(qc, id); onClose() },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const pronto = oferta && motivo.trim().length >= 5 && (oferta.polos.length <= 1 || campusId)
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Trocar curso" size="md"
      description="O preço muda com o curso: a cobrança aberta é cancelada e a condição combinada volta à tabela."
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="primary" disabled={!pronto || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Trocar curso'}</Button>
      </>}>
      <div class="grid gap-3">
        <Select label="Curso e forma de ingresso" value={offeringId} onChange={(e) => { setOfferingId((e.target as HTMLSelectElement).value); setCampusId('') }}>
          <option value="">Escolha…</option>
          {cat.data?.ofertas.map((o) => <option key={o.id} value={o.id}>{rotuloDaOferta(o)}</option>)}
        </Select>
        {oferta && oferta.polos.length > 1 && (
          <Select label="Polo" value={campusId} onChange={(e) => setCampusId((e.target as HTMLSelectElement).value)}>
            <option value="">Escolha…</option>
            {oferta.polos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        )}
        <Textarea label="Motivo" value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
      </div>
    </Modal>
  )
}
