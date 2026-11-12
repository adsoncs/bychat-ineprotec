// Aba Cadastro da matrícula interna: tudo editável de uma vez e troca de curso.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { CHAVES_DE_CPF, erroDoCpf, mascararCpf } from '@/lib/cpf'
import { CHAVES_DE_CEP, CHAVES_DO_ENDERECO, consultarCep, digitosDoCep, mascararCep } from '@/lib/cep'
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
    // Ficha interna: só a equipe preenche; o aluno não vê.
    for (const c of review.fichaInterna ?? []) pôr({ chave: c.chave, rotulo: c.rotulo, grupo: 'Ficha do aluno', tipo: c.tipo, ...(c.opcoes ? { opcoes: c.opcoes } : {}), ...(c.obrigatorio ? { obrigatorio: true } : {}) }, c.valor)
    for (const g of review.cadastro ?? []) for (const c of g.campos) if (c.chave !== 'campusNome') pôr({ chave: c.chave, rotulo: c.rotulo, grupo: g.grupo, tipo: c.tipo, ...(c.opcoes ? { opcoes: c.opcoes } : {}) }, c.valor)
    for (const c of dados.data ?? []) pôr({ chave: c.name, rotulo: c.label, grupo: 'Pedido nas etapas', ...(c.type ? { tipo: c.type } : {}), ...(c.options ? { opcoes: c.options } : {}), ...(c.required ? { obrigatorio: true } : {}) }, c.valor)
    return { grupos: [...out.entries()], iniciais }
  }, [review, dados.data])

  const [valores, setValores] = useState<Record<string, string>>(iniciais)
  useEffect(() => { setValores(iniciais) }, [iniciais])
  const alterados = Object.keys(valores).filter((k) => (valores[k] ?? '') !== (iniciais[k] ?? ''))
  // ── CEP: ao completar 8 dígitos, busca e preenche rua, bairro, cidade e UF ──
  const [cepAviso, setCepAviso] = useState<{ erro: boolean; texto: string } | null>(null)
  const [cepBuscando, setCepBuscando] = useState(false)
  const ultimoCep = useRef('')
  const chavesNaTela = useMemo(() => new Set(grupos.flatMap(([, cs]) => cs.map((c) => c.chave))), [grupos])
  const focar = (chave: string) => setTimeout(() => (document.querySelector(`[data-chave="${chave}"]`) as HTMLElement | null)?.focus(), 50)
  const aoDigitarCep = (chave: string, bruto: string) => {
    const v = mascararCep(bruto)
    setValores((x) => ({ ...x, [chave]: v }))
    const d = digitosDoCep(v)
    if (d.length !== 8) { ultimoCep.current = ''; setCepAviso(null); return }
    if (d === ultimoCep.current) return
    ultimoCep.current = d
    setCepBuscando(true); setCepAviso(null)
    consultarCep(d).then((r) => {
      if (ultimoCep.current !== d) return // digitou outro CEP enquanto buscava
      if (r.situacao === 'nao_encontrado') { setCepAviso({ erro: true, texto: 'CEP não encontrado. Confira o número ou preencha o endereço à mão.' }); return }
      if (r.situacao === 'indisponivel') { setCepAviso({ erro: false, texto: 'Busca de CEP indisponível agora. Preencha o endereço à mão.' }); return }
      const e = r.endereco
      setValores((x) => {
        const n = { ...x }
        for (const [parte, chaves] of Object.entries(CHAVES_DO_ENDERECO) as [keyof typeof CHAVES_DO_ENDERECO, readonly string[]][]) {
          const valor = e[parte]
          const alvo = chaves.find((k) => chavesNaTela.has(k))
          // Só o que o CEP traz: CEP de cidade inteira vem sem rua e bairro, e aí
          // o que já estava digitado fica.
          if (alvo && valor) n[alvo] = valor
        }
        return n
      })
      if (e.logradouro) { setCepAviso({ erro: false, texto: `${e.logradouro}, ${e.bairro ? e.bairro + ', ' : ''}${e.municipio}/${e.uf}. Confira e informe o número.` }); focar('numero') }
      else { setCepAviso({ erro: false, texto: `CEP geral de ${e.municipio}/${e.uf}: informe rua e bairro.` }); focar('logradouro') }
    }).catch(() => { if (ultimoCep.current === d) setCepAviso({ erro: true, texto: 'Não foi possível buscar o CEP. Preencha o endereço à mão.' }) })
      .finally(() => { if (ultimoCep.current === d) setCepBuscando(false) })
  }

  // CPF: máscara e conferência na hora; com CPF que não confere não dá para salvar.
  const ehCpf = (c: { chave: string; tipo?: string }) => c.tipo === 'cpf' || CHAVES_DE_CPF.includes(c.chave)
  const cpfsComErro = grupos.flatMap(([, cs]) => cs).filter((c) => ehCpf(c) && alterados.includes(c.chave) && erroDoCpf(valores[c.chave] ?? ''))

  const fichaFaltando = (review.fichaInterna ?? []).filter((c) => c.obrigatorio && !String(valores[c.chave] ?? '').trim())
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
              <Button size="sm" variant="primary" disabled={!alterados.length || cpfsComErro.length > 0 || salvar.isPending} title={cpfsComErro.length ? 'Corrija o CPF antes de salvar' : undefined} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar cadastro'}</Button>
            </div>
          )}
        </div>
        {fichaFaltando.length > 0 && (
          <div class="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Falta preencher na ficha do aluno: {fichaFaltando.map((c) => c.rotulo).join(', ')}.
          </div>
        )}
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
                ) : ehCpf(c) ? (
                  <Input key={c.chave} data-chave={c.chave} label={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} disabled={!podeEditar} inputMode="numeric" maxLength={14} placeholder="000.000.000-00"
                    value={valores[c.chave] ?? ''} onInput={(e) => { const v = mascararCpf((e.target as HTMLInputElement).value); setValores((x) => ({ ...x, [c.chave]: v })) }}
                    error={erroDoCpf(valores[c.chave] ?? '') ?? undefined} />
                ) : (c.tipo === 'cep' || CHAVES_DE_CEP.includes(c.chave)) ? (
                  <Input key={c.chave} data-chave={c.chave} label={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} disabled={!podeEditar} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000"
                    value={valores[c.chave] ?? ''} onInput={(e) => aoDigitarCep(c.chave, (e.target as HTMLInputElement).value)}
                    hint={cepBuscando ? 'Buscando endereço…' : (cepAviso && !cepAviso.erro ? cepAviso.texto : (podeEditar ? 'Digite o CEP para preencher o endereço' : undefined))}
                    error={!cepBuscando && cepAviso?.erro ? cepAviso.texto : undefined} />
                ) : (
                  <Input key={c.chave} data-chave={c.chave} label={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} disabled={!podeEditar} value={valores[c.chave] ?? ''} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setValores((x) => ({ ...x, [c.chave]: v })) }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="text-2xs text-fg-muted mt-3">Nome e e-mail acompanham a ficha do lead. O WhatsApp da ficha só muda por lá, porque ele identifica a conversa. Campos * da ficha do aluno são obrigatórios para a equipe e o aluno não os vê; os demais campos * são cobrados na tela do aluno enquanto estiverem vazios.</div>
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
