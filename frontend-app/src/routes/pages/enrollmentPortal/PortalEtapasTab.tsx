import { useEffect, useMemo, useState } from 'preact/hooks'
import { Save, ArrowUp, ArrowDown, ListOrdered, CreditCard, FileText, Pencil, Award, ClipboardList, Sparkles, Lock, GraduationCap, Workflow } from '@/components/ui/icon-set'
import { DadosEtapasEditor } from '@/components/educational/DadosEtapasEditor'
import { useDadosEtapas, type DadosConfig } from '@/hooks/useDadosEtapas'
import { useUpdateEnrollmentPortal, type EnrollmentPortal } from '@/hooks/useEnrollmentPortals'
import { useEntryModes, useSelectionProcesses, useDocumentTypes } from '@/hooks/useEducational'
import { Card } from '@/components/ui/Card'
import { useFunnel } from '@/hooks/useFunnels'
import { api, ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

type Chave = 'cadastro' | 'analise' | 'pagamento' | 'documentos' | 'contrato' | 'prova'
interface Etapa {
  chave: Chave; ativo: boolean; obrigatoria: boolean; trava?: boolean
  /** Formas de ingresso em que a trava vale (vazio = todas). */
  travaIngressos?: number[]
  /** Análise acadêmica: formas de ingresso em que aparece (vazio = todas). */
  ingressos?: number[]
  /** Análise acadêmica: documentos analisados antes de liberar o resto. */
  documentos?: string[]
  /** Documentos: conclui com os obrigatórios enviados (não espera aprovação). */
  liberaNoEnvio?: boolean
}
interface Ingresso { id: number; name: string }
interface TipoDoc { code: string; name: string }

const CHAVES: Chave[] = ['cadastro', 'analise', 'pagamento', 'documentos', 'contrato', 'prova']
// O que "concluída" quer dizer para a trava (igual ao backend, CONCLUIR).
const CONCLUIR: Record<Chave, string> = {
  cadastro: 'todos os dados preenchidos',
  analise: 'o parecer emitido e aceito pelo candidato',
  pagamento: 'pagamento confirmado',
  documentos: 'todos os documentos obrigatórios aprovados pela secretaria',
  contrato: 'contrato assinado',
  prova: 'redação aprovada',
}
const INFO: Record<Chave, { nome: string; quando: string; Icone: typeof CreditCard }> = {
  cadastro: { nome: 'Completar cadastro', quando: 'Aparece quando há dados marcados para "Completar cadastro" (seção Dados, abaixo). Os dados vão direto para a ficha do aluno.', Icone: ClipboardList },
  analise: { nome: 'Análise acadêmica', quando: 'Ex.: transferência, ENEM, segunda graduação. O candidato envia, dos documentos marcados abaixo, os que a forma de ingresso dele exige (ENEM → boletim; transferência → histórico), a secretaria emite o parecer (período de ingresso, aproveitamento) no detalhe da inscrição e o candidato aceita ou desiste. Trava sempre as etapas seguintes.', Icone: GraduationCap },
  pagamento: { nome: 'Pagamento', quando: 'Aparece quando o portal cobra (aba Pagamento): taxa de inscrição ou matrícula/1ª mensalidade.', Icone: CreditCard },
  documentos: { nome: 'Envio de documentos', quando: 'Aparece quando o processo seletivo ou o modo de ingresso exige documentos.', Icone: FileText },
  contrato: { nome: 'Assinatura do contrato', quando: 'Gerado com o plano de pagamento da oferta. Assinado aqui, a matrícula já nasce com o contrato aceito. Texto em Acadêmico › Financeiro.', Icone: Pencil },
  prova: { nome: 'Prova (redação online)', quando: 'Aparece só em processos com modo de ingresso "Redação online".', Icone: Award },
}
// Mesmo padrão do backend (services/portalJornada.ts): portal sem configuração
// continua como era — só pagamento na inscrição; documentos, contrato e
// pagamento no portal logado.
const PADRAO_INSCRICAO: Etapa[] = [
  { chave: 'cadastro', ativo: true, obrigatoria: false },
  { chave: 'analise', ativo: false, obrigatoria: false },
  { chave: 'pagamento', ativo: true, obrigatoria: false },
  { chave: 'documentos', ativo: false, obrigatoria: false },
  { chave: 'contrato', ativo: false, obrigatoria: false },
  { chave: 'prova', ativo: false, obrigatoria: false },
]
const PADRAO_PAINEL: Etapa[] = [
  { chave: 'cadastro', ativo: true, obrigatoria: false },
  { chave: 'analise', ativo: false, obrigatoria: false },
  { chave: 'documentos', ativo: true, obrigatoria: false },
  { chave: 'contrato', ativo: true, obrigatoria: false },
  { chave: 'pagamento', ativo: true, obrigatoria: false },
  { chave: 'prova', ativo: true, obrigatoria: false },
]

function normalizar(bruto: unknown, padrao: Etapa[]): Etapa[] {
  if (!Array.isArray(bruto)) return padrao.map((e) => ({ ...e }))
  const out: Etapa[] = []
  for (const x of bruto as any[]) {
    if (CHAVES.includes(x?.chave) && !out.some((e) => e.chave === x.chave)) out.push({
      chave: x.chave, ativo: x.ativo !== false, obrigatoria: !!x.obrigatoria, trava: !!x.trava,
      ...(Array.isArray(x.travaIngressos) && x.travaIngressos.length ? { travaIngressos: x.travaIngressos.map(Number) } : {}),
      ...(Array.isArray(x.ingressos) && x.ingressos.length ? { ingressos: x.ingressos.map(Number) } : {}),
      ...(Array.isArray(x.documentos) && x.documentos.length ? { documentos: x.documentos.map(String) } : {}),
      ...(x.liberaNoEnvio ? { liberaNoEnvio: true } : {}),
    })
  }
  // Mesma regra do backend: "Completar cadastro" veio depois e entra ligada, na
  // frente; a análise acadêmica (mais nova) entra desligada logo depois dele.
  for (const c of CHAVES) {
    if (out.some((e) => e.chave === c)) continue
    if (c === 'cadastro') out.unshift({ chave: c, ativo: true, obrigatoria: false })
    else if (c === 'analise') out.splice(out.findIndex((e) => e.chave === 'cadastro') + 1, 0, { chave: c, ativo: false, obrigatoria: false })
    else out.push({ chave: c, ativo: false, obrigatoria: false })
  }
  return out
}

/** Lista de caixas de marcar (formas de ingresso, documentos) — vazia = nenhuma marcada. */
function Marcar<T extends string | number>(p: { opcoes: Array<{ id: T; nome: string }>; marcados: T[]; onChange: (v: T[]) => void }) {
  return (
    <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1">
      {p.opcoes.map((o) => (
        <label key={String(o.id)} class="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={p.marcados.includes(o.id)} onChange={(ev) => {
            const on = (ev.target as HTMLInputElement).checked
            p.onChange(on ? [...p.marcados, o.id] : p.marcados.filter((x) => x !== o.id))
          }} />
          {o.nome}
        </label>
      ))}
    </div>
  )
}

function ListaDeEtapas(p: { titulo: string; descricao: string; etapas: Etapa[]; onChange: (e: Etapa[]) => void; ingressos: Ingresso[]; tiposDoc: TipoDoc[]; desabilitada?: boolean }) {
  const mover = (i: number, d: -1 | 1) => {
    const n = [...p.etapas]; const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j]!, n[i]!]
    p.onChange(n)
  }
  const muda = (i: number, patch: Partial<Etapa>) => p.onChange(p.etapas.map((e, k) => (k === i ? { ...e, ...patch } : e)))
  const ativas = p.etapas.filter((e) => e.ativo)
  return (
    <Card class={`p-4 ${p.desabilitada ? 'opacity-60 pointer-events-none' : ''}`}>
      <div class="text-sm font-semibold mb-1">{p.titulo}</div>
      <div class="text-xs text-fg-muted mb-3">{p.descricao}</div>
      <ol class="space-y-2">
        {p.etapas.map((e, i) => {
          const { nome, quando, Icone } = INFO[e.chave]
          const pos = ativas.indexOf(e)
          return (
            <li key={e.chave} class={`flex items-start gap-3 rounded-md border p-3 ${e.ativo ? 'border-accent/40 bg-accent/5' : 'border-border opacity-70'}`}>
              <span class={`size-7 shrink-0 rounded-full grid place-items-center text-xs font-bold ${e.ativo ? 'bg-accent text-fg-on-brand' : 'bg-surface-3 text-fg-muted'}`}>{e.ativo ? pos + 1 : '–'}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-sm font-medium"><Icone size={14} />{nome}</div>
                <div class="text-2xs text-fg-muted mt-0.5">{quando}</div>
                <div class="flex flex-wrap gap-4 mt-2">
                  <label class="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={e.ativo} onChange={(ev) => muda(i, { ativo: (ev.target as HTMLInputElement).checked })} /> Usar esta etapa
                  </label>
                  {e.ativo && e.chave === 'documentos' && (
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer" title="A etapa conclui (e libera a trava) quando os obrigatórios forem enviados, sem esperar a conferência">
                      <input type="checkbox" checked={!!e.liberaNoEnvio} onChange={(ev) => muda(i, { liberaNoEnvio: (ev.target as HTMLInputElement).checked })} /> Libera ao enviar (não espera aprovação)
                    </label>
                  )}
                  {e.ativo && e.chave !== 'analise' && (
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer" title="As etapas seguintes desta lista ficam bloqueadas até esta ser concluída">
                      <input type="checkbox" checked={!!e.trava} onChange={(ev) => muda(i, { trava: (ev.target as HTMLInputElement).checked })} /> <Lock size={12} /> Travar até concluir
                    </label>
                  )}
                </div>
                {e.ativo && e.chave === 'analise' && (
                  <div class="mt-2 space-y-2 text-xs">
                    <div class="text-2xs text-warning">
                      <Lock size={11} class="inline" /> Trava sempre: as etapas seguintes só liberam com {CONCLUIR.analise}.
                    </div>
                    <div>
                      <div class="text-fg-muted">Aparece para{!e.ingressos?.length && <span class="text-warning"> — marque ao menos uma forma de ingresso (sem marcar, vale para todas)</span>}</div>
                      <Marcar opcoes={p.ingressos.map((g) => ({ id: g.id, nome: g.name }))} marcados={e.ingressos ?? []} onChange={(v) => muda(i, { ingressos: v })} />
                    </div>
                    <div>
                      <div class="text-fg-muted">Documentos analisados{!e.documentos?.length && <span class="text-danger"> — escolha ao menos um (sem documento, a etapa não aparece)</span>}</div>
                      <Marcar opcoes={p.tiposDoc.map((t) => ({ id: t.code, nome: t.name }))} marcados={e.documentos ?? []} onChange={(v) => muda(i, { documentos: v })} />
                    </div>
                  </div>
                )}
                {e.ativo && e.trava && e.chave !== 'analise' && (
                  <div class="mt-2 space-y-1.5">
                    <div class="text-2xs text-warning">
                      As etapas seguintes só liberam com {e.chave === 'documentos' && e.liberaNoEnvio ? 'todos os documentos obrigatórios enviados' : CONCLUIR[e.chave]}.{e.chave === 'documentos' && e.liberaNoEnvio ? '' : ' "Em análise" ainda segura a fila.'}
                    </div>
                    <div class="text-xs">
                      <div class="text-fg-muted mb-1">Vale para</div>
                      <div class="flex flex-wrap gap-x-4 gap-y-1">
                        <label class="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name={`trava-${p.titulo}-${e.chave}`} checked={!e.travaIngressos?.length} onChange={() => muda(i, { travaIngressos: [] })} />
                          Todas as formas de ingresso
                        </label>
                        <label class="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name={`trava-${p.titulo}-${e.chave}`} checked={!!e.travaIngressos?.length}
                            onChange={() => { if (!e.travaIngressos?.length && p.ingressos[0]) muda(i, { travaIngressos: [p.ingressos[0].id] }) }} />
                          Só para as escolhidas
                        </label>
                      </div>
                      {!!e.travaIngressos?.length && (
                        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 pl-5">
                          {p.ingressos.map((g) => {
                            const marcado = e.travaIngressos!.includes(g.id)
                            return (
                              <label key={g.id} class="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={marcado} onChange={(ev) => {
                                  const on = (ev.target as HTMLInputElement).checked
                                  const n = on ? [...e.travaIngressos!, g.id] : e.travaIngressos!.filter((x) => x !== g.id)
                                  // Desmarcar a última volta para "todas" — lista vazia é isso.
                                  muda(i, { travaIngressos: n })
                                }} />
                                {g.name}
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div class="flex flex-col gap-1">
                <button type="button" class="size-7 grid place-items-center rounded hover:bg-surface-3 disabled:opacity-30" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${nome}`}><ArrowUp size={13} /></button>
                <button type="button" class="size-7 grid place-items-center rounded hover:bg-surface-3 disabled:opacity-30" disabled={i === p.etapas.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer ${nome}`}><ArrowDown size={13} /></button>
              </div>
            </li>
          )
        })}
      </ol>
      <div class="text-2xs text-fg-muted mt-3">
        Ordem final: {ativas.length ? ativas.map((e) => INFO[e.chave].nome + (e.chave === 'analise' ? ` (trava${e.ingressos?.length ? `: ${e.ingressos.map((id) => p.ingressos.find((g) => g.id === id)?.name ?? `#${id}`).join(', ')}` : ''})` : e.trava ? (e.travaIngressos?.length
          ? ` (trava: ${e.travaIngressos.map((id) => p.ingressos.find((g) => g.id === id)?.name ?? `#${id}`).join(', ')})`
          : ' (trava)') : '')).join(' → ') : 'nenhuma etapa'}
        {' · '}etapas que não se aplicam a uma inscrição somem sozinhas.
      </div>
    </Card>
  )
}

export function PortalEtapasTab({ portal }: { portal: EnrollmentPortal }) {
  const bruto = (portal as any).jornadaEtapas ?? null
  const [inscricao, setInscricao] = useState<Etapa[]>(() => normalizar(bruto?.inscricao, PADRAO_INSCRICAO))
  const [mesma, setMesma] = useState<boolean>(() => !!bruto && (bruto.painel === null || bruto.painel === undefined))
  const [painel, setPainel] = useState<Etapa[]>(() => normalizar(bruto?.painel, PADRAO_PAINEL))
  const [dirty, setDirty] = useState(false)
  const [dados, setDados] = useState<DadosConfig | null>(() => bruto?.dados ?? null)
  const [matricula, setMatricula] = useState<Matricula>(() => lerMatricula(bruto?.matricula))
  const catalogo = useDadosEtapas()
  const update = useUpdateEnrollmentPortal()
  // Formas de ingresso que a trava pode escolher: as dos processos deste
  // portal (todas as ativas, se o portal não restringe processos) e as que já
  // estão marcadas, mesmo que o processo tenha saído do portal.
  const modos = useEntryModes(true)
  const processos = useSelectionProcesses()
  const tiposDocQ = useDocumentTypes()
  const tiposDoc = useMemo<TipoDoc[]>(() => (tiposDocQ.data?.types ?? [])
    .filter((t: any) => t.active !== false)
    .map((t) => ({ code: t.code, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [tiposDocQ.data])
  const ingressos = useMemo<Ingresso[]>(() => {
    const todos = modos.data?.modes ?? []
    const ids = new Set<number>((portal.selectionProcessIds ?? []).map(Number))
    const doPortal = ids.size
      ? new Set((processos.data?.processes ?? []).filter((sp) => ids.has(sp.id)).map((sp) => sp.entryModeId))
      : null
    const marcados = new Set([...inscricao, ...painel].flatMap((e) => [...(e.travaIngressos ?? []), ...(e.ingressos ?? [])]))
    return todos
      .filter((m) => marcados.has(m.id) || (doPortal ? doPortal.has(m.id) : (m as any).active !== false))
      .map((m) => ({ id: m.id, name: m.name }))
  }, [modos.data, processos.data, portal.selectionProcessIds, inscricao, painel])

  useEffect(() => {
    const b = (portal as any).jornadaEtapas ?? null
    setInscricao(normalizar(b?.inscricao, PADRAO_INSCRICAO))
    setMesma(!!b && (b.painel === null || b.painel === undefined))
    setPainel(normalizar(b?.painel, PADRAO_PAINEL))
    setDados(b?.dados ?? null)
    setMatricula(lerMatricula(b?.matricula))
    setDirty(false)
  }, [portal.id])

  const marca = <T,>(f: (v: T) => void) => (v: T) => { f(v); setDirty(true) }

  function salvar() {
    update.mutate({ id: portal.id, jornadaEtapas: { inscricao, painel: mesma ? null : painel, dados, matricula, funil: (portal as any).jornadaEtapas?.funil ?? {} } } as any, {
      onSuccess: () => { toast('Etapas salvas', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <div class="flex items-start gap-3 text-sm">
        <ListOrdered size={18} class="text-accent mt-0.5" />
        <div>
          <div class="font-semibold">O que acontece depois da inscrição, e em que ordem</div>
          <div class="text-xs text-fg-muted">Escolha as etapas deste portal e a sequência — na tela de inscrição (logo depois do envio) e no portal do candidato logado. Portal de pós sem prova, por exemplo: desligue a redação e ordene documentos, contrato e pagamento.</div>
        </div>
      </div>
      {dirty && <div class="text-xs text-warning">Alterações não salvas.</div>}
      <div class="grid gap-4 lg:grid-cols-2">
        <ListaDeEtapas
          titulo="Na tela de inscrição"
          descricao="Uma etapa por vez, logo depois de enviar o formulário. A trava marcada aqui vale nesta tela e no chatbot de matrícula."
          etapas={inscricao} onChange={marca(setInscricao)} ingressos={ingressos} tiposDoc={tiposDoc}
        />
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={mesma} onChange={(e) => { setMesma((e.target as HTMLInputElement).checked); setDirty(true) }} />
            Usar a mesma ordem no portal logado
          </label>
          <ListaDeEtapas
            titulo="No portal do candidato logado"
            descricao={mesma ? 'Seguindo a ordem e as travas da tela de inscrição.' : 'A lista "O que falta" do portal, depois de entrar com a senha. A trava marcada aqui vale só no portal logado.'}
            etapas={mesma ? inscricao : painel} onChange={marca(setPainel)} ingressos={ingressos} tiposDoc={tiposDoc} desabilitada={mesma}
          />
        </div>
      </div>
      <SecaoDados
        dados={dados}
        onChange={(v) => { setDados(v); setDirty(true) }}
        catalogo={catalogo.data}
        cobraNaInscricao={!!portal.requirePayment && inscricao.some((e) => e.chave === 'pagamento' && e.ativo)}
      />
      <SecaoMatricula valor={matricula} onChange={(v) => { setMatricula(v); setDirty(true) }} />
      <div class="text-xs text-fg-muted">
        Em que etapa do funil o lead fica em cada etapa da matrícula: aba <b>Configuração</b> › Funil destino.
      </div>

      <div class="flex justify-end">
        <Button onClick={salvar} disabled={update.isPending}><Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar etapas'}</Button>
      </div>
    </div>
  )
}

/** Regras da matrícula deste portal (backend: MatriculaConfig em services/portalJornada). */
interface Matricula { exigeContrato: boolean; enviarSei: boolean }

function lerMatricula(b: any): Matricula {
  return { exigeContrato: b?.exigeContrato !== false, enviarSei: b?.enviarSei !== false }
}

function SecaoMatricula(p: { valor: Matricula; onChange: (v: Matricula) => void }) {
  return (
    <Card class="p-4 space-y-3">
      <div class="flex items-start gap-3">
        <GraduationCap size={18} class="text-accent mt-0.5" />
        <div>
          <div class="font-semibold text-sm">Matrícula</div>
          <div class="text-xs text-fg-muted">Depois da inscrição: o que a matrícula exige no ERP e se ela vai para o SEI.</div>
        </div>
      </div>
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="mt-0.5" checked={p.valor.exigeContrato}
          onChange={(e) => p.onChange({ ...p.valor, exigeContrato: (e.target as HTMLInputElement).checked })} />
        <span>
          Exigir contrato para efetivar a matrícula
          <span class="block text-xs text-fg-muted">Desligado: efetivar a inscrição já matricula o aluno, sem contrato e sem disparar o gatilho de contrato (ex.: extensão).</span>
        </span>
      </label>
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="mt-0.5" checked={p.valor.enviarSei}
          onChange={(e) => p.onChange({ ...p.valor, enviarSei: (e.target as HTMLInputElement).checked })} />
        <span>
          Enviar as inscrições deste portal ao SEI
          <span class="block text-xs text-fg-muted">Desligado: as inscrições deste portal não aparecem no envio ao SEI e não vão nem pelo envio manual.</span>
        </span>
      </label>
    </Card>
  )
}

/** Dados pedidos em cada etapa: o padrão da instituição ou o ajuste deste portal. */
function SecaoDados(p: {
  dados: DadosConfig | null
  onChange: (v: DadosConfig | null) => void
  catalogo: ReturnType<typeof useDadosEtapas>['data']
  cobraNaInscricao: boolean
}) {
  const c = p.catalogo
  const proprio = !!p.dados
  return (
    <Card class="p-4 space-y-3">
      <div class="flex items-start gap-3">
        <ClipboardList size={18} class="text-accent mt-0.5" />
        <div class="flex-1">
          <div class="text-sm font-semibold">Dados pedidos em cada etapa</div>
          <div class="text-xs text-fg-muted">
            Que dados da pessoa este portal pede na inscrição e em cada etapa da matrícula, e o que é exigido para matricular.
            O padrão vem de Educacional › <a class="text-accent hover:underline" href="/app/educational/dados-etapas">Dados por etapa</a>.
          </div>
        </div>
      </div>
      {!c ? <div class="text-xs text-fg-muted">Carregando…</div> : (
        <>
          <div class="flex flex-wrap gap-4 text-sm">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="dados-origem" checked={!proprio} onChange={() => p.onChange(null)} />
              Usar o padrão da instituição
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="dados-origem" checked={proprio}
                onChange={() => p.onChange(JSON.parse(JSON.stringify(c.padrao ?? c.sugestao)))} />
              Personalizar para este portal
            </label>
          </div>
          {proprio ? (
            <DadosEtapasEditor valor={p.dados!} catalogo={c.catalogo} etapas={c.etapas} onChange={(v) => p.onChange(v)} cobraNaInscricao={p.cobraNaInscricao} />
          ) : c.padrao ? (
            <DadosEtapasEditor valor={c.padrao} catalogo={c.catalogo} etapas={c.etapas} onChange={() => {}} somenteLeitura cobraNaInscricao={p.cobraNaInscricao} />
          ) : (
            <div class="rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted flex items-center justify-between gap-3">
              <span>A instituição ainda não definiu um padrão — este portal segue pedindo os dados do próprio formulário (aba Formulário).</span>
              <Button size="sm" onClick={() => p.onChange(JSON.parse(JSON.stringify(c.sugestao)))}><Sparkles size={13} /> Personalizar</Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/**
 * De-para com o funil do portal: em que etapa do funil o lead fica enquanto o
 * candidato está em cada etapa da jornada (uma linha por etapa ativa, na ordem
 * da tela de inscrição) e quando todas terminam. O lead só anda para a frente e
 * só se estiver no funil do portal (backend: services/funilDaJornada).
 */
export function SecaoFunil(p: {
  portalId: number
  funnelId: number | null
  etapas: Etapa[]
  valor: Record<string, string>
  onChange: (v: Record<string, string>) => void
  sujo: boolean
}) {
  const { data } = useFunnel(p.funnelId)
  const stages = (data?.stages ?? []).filter((st: any) => st.active !== false)
  const [aplicando, setAplicando] = useState(false)
  const linhas: Array<{ chave: string; nome: string }> = [
    ...p.etapas.map((e) => ({ chave: e.chave, nome: INFO[e.chave].nome })),
    { chave: 'concluido', nome: 'Todas as etapas concluídas' },
  ]
  async function aplicar() {
    setAplicando(true)
    try {
      const r = await api.post<{ total: number; movidos: number }>(`/admin/enrollment-portals/${p.portalId}/sincronizar-funil`)
      toast(`${r.movidos} de ${r.total} inscrição(ões) movida(s) no funil`, 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao aplicar', 'danger')
    } finally {
      setAplicando(false)
    }
  }
  return (
    <Card class="p-4 space-y-3">
      <div class="flex items-start gap-3">
        <Workflow size={18} class="text-accent mt-0.5" />
        <div>
          <div class="font-semibold text-sm">No funil</div>
          <div class="text-xs text-fg-muted">
            Em que etapa do funil do portal o lead fica enquanto o candidato está em cada etapa da matrícula — uma linha
            por etapa ativa do portal (aba Etapas). Só mexe em lead que está no funil do portal; lead que a equipe moveu à
            mão para fora destas etapas só anda para a frente, e da etapa de concluído ele não volta. Em branco = não
            mexe no funil nessa etapa.
          </div>
        </div>
      </div>
      {!p.funnelId ? (
        <div class="text-xs text-warning">Este portal não tem funil destino (aba Configuração). Escolha um funil para usar o de-para.</div>
      ) : (
        <div class="divide-y divide-border rounded-md border border-border">
          {linhas.map((l, i) => (
            <div key={l.chave} class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span class="w-6 text-2xs text-fg-muted tabular-nums">{l.chave === 'concluido' ? '✓' : `${i + 1}.`}</span>
              <span class="min-w-0 flex-1 basis-48">{l.nome}</span>
              <select
                class="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                value={p.valor[l.chave] ?? ''}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  const novo = { ...p.valor }
                  if (v) novo[l.chave] = v
                  else delete novo[l.chave]
                  p.onChange(novo)
                }}
              >
                <option value="">— não mexe no funil —</option>
                {stages.map((st: any) => <option key={st.key} value={st.key}>{st.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {p.funnelId && (
        <div class="flex items-center justify-between gap-3">
          <span class="text-2xs text-fg-muted">
            A mudança vale a cada passo do candidato. Para posicionar quem já se inscreveu, salve e aplique.
          </span>
          <Button variant="secondary" size="sm" onClick={aplicar} disabled={aplicando || p.sujo}>
            {aplicando ? 'Aplicando…' : 'Aplicar às inscrições existentes'}
          </Button>
        </div>
      )}
    </Card>
  )
}

/** Etapas ativas da tela de inscrição do portal, na ordem (para o de-para com o funil). */
export function etapasAtivasDoPortal(jornadaEtapas: any): Etapa[] {
  return normalizar(jornadaEtapas?.inscricao, PADRAO_INSCRICAO).filter((e) => e.ativo)
}
