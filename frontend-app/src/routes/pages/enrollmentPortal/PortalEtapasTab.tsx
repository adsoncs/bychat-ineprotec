import { useEffect, useMemo, useState } from 'preact/hooks'
import { Save, ArrowUp, ArrowDown, ListOrdered, CreditCard, FileText, Pencil, Award, ClipboardList, Sparkles, Lock } from '@/components/ui/icon-set'
import { DadosEtapasEditor } from '@/components/educational/DadosEtapasEditor'
import { useDadosEtapas, type DadosConfig } from '@/hooks/useDadosEtapas'
import { useUpdateEnrollmentPortal, type EnrollmentPortal } from '@/hooks/useEnrollmentPortals'
import { useEntryModes, useSelectionProcesses } from '@/hooks/useEducational'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

type Chave = 'cadastro' | 'pagamento' | 'documentos' | 'contrato' | 'prova'
interface Etapa {
  chave: Chave; ativo: boolean; obrigatoria: boolean; trava?: boolean
  /** Formas de ingresso em que a trava vale (vazio = todas). */
  travaIngressos?: number[]
}
interface Ingresso { id: number; name: string }

const CHAVES: Chave[] = ['cadastro', 'pagamento', 'documentos', 'contrato', 'prova']
// O que "concluída" quer dizer para a trava (igual ao backend, CONCLUIR).
const CONCLUIR: Record<Chave, string> = {
  cadastro: 'todos os dados preenchidos',
  pagamento: 'pagamento confirmado',
  documentos: 'todos os documentos obrigatórios aprovados pela secretaria',
  contrato: 'contrato assinado',
  prova: 'redação aprovada',
}
const INFO: Record<Chave, { nome: string; quando: string; Icone: typeof CreditCard }> = {
  cadastro: { nome: 'Completar cadastro', quando: 'Aparece quando há dados marcados para "Completar cadastro" (seção Dados, abaixo). Os dados vão direto para a ficha do aluno.', Icone: ClipboardList },
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
  { chave: 'pagamento', ativo: true, obrigatoria: false },
  { chave: 'documentos', ativo: false, obrigatoria: false },
  { chave: 'contrato', ativo: false, obrigatoria: false },
  { chave: 'prova', ativo: false, obrigatoria: false },
]
const PADRAO_PAINEL: Etapa[] = [
  { chave: 'cadastro', ativo: true, obrigatoria: false },
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
    })
  }
  // Mesma regra do backend: "Completar cadastro" veio depois e entra ligada, na frente.
  for (const c of CHAVES) {
    if (out.some((e) => e.chave === c)) continue
    if (c === 'cadastro') out.unshift({ chave: c, ativo: true, obrigatoria: false })
    else out.push({ chave: c, ativo: false, obrigatoria: false })
  }
  return out
}

function ListaDeEtapas(p: { titulo: string; descricao: string; etapas: Etapa[]; onChange: (e: Etapa[]) => void; ingressos: Ingresso[]; desabilitada?: boolean }) {
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
                  {e.ativo && (
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer" title="As etapas seguintes desta lista ficam bloqueadas até esta ser concluída">
                      <input type="checkbox" checked={!!e.trava} onChange={(ev) => muda(i, { trava: (ev.target as HTMLInputElement).checked })} /> <Lock size={12} /> Travar até concluir
                    </label>
                  )}
                </div>
                {e.ativo && e.trava && (
                  <div class="mt-2 space-y-1.5">
                    <div class="text-2xs text-warning">
                      As etapas seguintes só liberam com {CONCLUIR[e.chave]}. "Em análise" ainda segura a fila.
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
        Ordem final: {ativas.length ? ativas.map((e) => INFO[e.chave].nome + (e.trava ? (e.travaIngressos?.length
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
  const catalogo = useDadosEtapas()
  const update = useUpdateEnrollmentPortal()
  // Formas de ingresso que a trava pode escolher: as dos processos deste
  // portal (todas as ativas, se o portal não restringe processos) e as que já
  // estão marcadas, mesmo que o processo tenha saído do portal.
  const modos = useEntryModes(true)
  const processos = useSelectionProcesses()
  const ingressos = useMemo<Ingresso[]>(() => {
    const todos = modos.data?.modes ?? []
    const ids = new Set<number>((portal.selectionProcessIds ?? []).map(Number))
    const doPortal = ids.size
      ? new Set((processos.data?.processes ?? []).filter((sp) => ids.has(sp.id)).map((sp) => sp.entryModeId))
      : null
    const marcados = new Set([...inscricao, ...painel].flatMap((e) => e.travaIngressos ?? []))
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
    setDirty(false)
  }, [portal.id])

  const marca = <T,>(f: (v: T) => void) => (v: T) => { f(v); setDirty(true) }

  function salvar() {
    update.mutate({ id: portal.id, jornadaEtapas: { inscricao, painel: mesma ? null : painel, dados } } as any, {
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
          etapas={inscricao} onChange={marca(setInscricao)} ingressos={ingressos}
        />
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={mesma} onChange={(e) => { setMesma((e.target as HTMLInputElement).checked); setDirty(true) }} />
            Usar a mesma ordem no portal logado
          </label>
          <ListaDeEtapas
            titulo="No portal do candidato logado"
            descricao={mesma ? 'Seguindo a ordem e as travas da tela de inscrição.' : 'A lista "O que falta" do portal, depois de entrar com a senha. A trava marcada aqui vale só no portal logado.'}
            etapas={mesma ? inscricao : painel} onChange={marca(setPainel)} ingressos={ingressos} desabilitada={mesma}
          />
        </div>
      </div>
      <SecaoDados
        dados={dados}
        onChange={(v) => { setDados(v); setDirty(true) }}
        catalogo={catalogo.data}
        cobraNaInscricao={!!portal.requirePayment && inscricao.some((e) => e.chave === 'pagamento' && e.ativo)}
      />

      <div class="flex justify-end">
        <Button onClick={salvar} disabled={update.isPending}><Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar etapas'}</Button>
      </div>
    </div>
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
