import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ClipboardList, Plus, Send, Library, PenLine, Clock } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { useProvas, useQuestoes, useProvaMut, useFilaCorrecao } from '@/hooks/useAcaProva'

// Prova online do processo seletivo: banco de questões, montagem e publicação.
// A correção fica em tela própria (/aca/provas/correcao) porque é trabalho de
// outra pessoa, em outro momento.

const ABAS = [
  { id: 'provas', label: 'Provas' },
  { id: 'questoes', label: 'Banco de questões' },
  { id: 'nova-questao', label: 'Nova questão' },
] as const

type Aba = (typeof ABAS)[number]['id']

const LETRAS = 'abcdefghij'.split('')

export function AcademicoProvasPage() {
  const [, navigate] = useLocation()
  const [aba, setAba] = useState<Aba>('provas')
  const provas = useProvas()
  const questoes = useQuestoes()
  const fila = useFilaCorrecao()
  const mut = useProvaMut()

  // Montagem da prova
  const [nova, setNova] = useState({ titulo: '', instrucoes: '', duracaoMinutos: '120', notaMaxima: '100' })
  const [selecionadas, setSelecionadas] = useState<number[]>([])
  const [montando, setMontando] = useState(false)

  // Nova questão
  const [nq, setNq] = useState({ area: '', enunciado: '', tipo: 'OBJETIVA', peso: '1' })
  const [alts, setAlts] = useState([{ id: 'a', texto: '' }, { id: 'b', texto: '' }])
  const [gabarito, setGabarito] = useState('a')

  const criarProva = () => {
    mut.criarProva.mutate(
      {
        titulo: nova.titulo, instrucoes: nova.instrucoes || null,
        duracaoMinutos: Number(nova.duracaoMinutos) || 120,
        notaMaxima: Number(nova.notaMaxima) || 100,
        questaoIds: selecionadas,
      },
      {
        onSuccess: (r) => {
          toast('Prova criada. Publique quando estiver pronta.', 'success')
          setNova({ titulo: '', instrucoes: '', duracaoMinutos: '120', notaMaxima: '100' })
          setSelecionadas([]); setMontando(false)
          navigate(`/aca/provas/${r.prova.id}`)
        },
        onError: (e: any) => toast(e?.message ?? 'Não foi possível criar a prova.', 'danger'),
      },
    )
  }

  const criarQuestao = () => {
    const corpo: Record<string, unknown> = {
      area: nq.area || 'Geral', enunciado: nq.enunciado, tipo: nq.tipo, peso: Number(nq.peso) || 1,
    }
    if (nq.tipo === 'OBJETIVA') {
      corpo.alternativas = alts.filter((a) => a.texto.trim())
      corpo.gabarito = gabarito
    }
    mut.criarQuestao.mutate(corpo, {
      onSuccess: () => {
        toast('Questão adicionada ao banco.', 'success')
        setNq({ area: nq.area, enunciado: '', tipo: nq.tipo, peso: '1' })
        setAlts([{ id: 'a', texto: '' }, { id: 'b', texto: '' }]); setGabarito('a')
        setAba('questoes')
      },
      onError: (e: any) => toast(e?.message ?? 'Não foi possível salvar a questão.', 'danger'),
    })
  }

  const publicar = (id: number) => {
    mut.publicar.mutate(id, {
      onSuccess: () => toast('Prova publicada — os links dos candidatos já funcionam.', 'success'),
      onError: (e: any) => toast(e?.message ?? 'Não foi possível publicar.', 'danger'),
    })
  }

  const alternar = (id: number) => setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const objetivaValida = nq.tipo !== 'OBJETIVA' || (alts.filter((a) => a.texto.trim()).length >= 2 && alts.some((a) => a.id === gabarito && a.texto.trim()))

  return (
    <Page
      title="Prova online"
      description="Banco de questões, montagem da prova e acesso por candidato."
      actions={
        <div class="flex items-center gap-2">
          {(fila.data?.total ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => navigate('/aca/provas/correcao')}>
              <PenLine size={16} /> Corrigir ({fila.data?.total})
            </Button>
          )}
          {aba === 'provas' && (
            <Button onClick={() => setMontando((m) => !m)}>
              <Plus size={16} /> Nova prova
            </Button>
          )}
        </div>
      }
    >
      <div class="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {ABAS.map((t) => (
          <button
            key={t.id}
            class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
            onClick={() => setAba(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'provas' && (
        <div class="space-y-4">
          {montando && (
            <Card class="space-y-3">
              <h2 class="text-sm font-semibold text-fg">Montar prova</h2>
              <Input label="Título" value={nova.titulo} placeholder="Ex.: Vestibular 2027/1" onInput={(e) => setNova((p) => ({ ...p, titulo: (e.target as HTMLInputElement).value }))} />
              <div class="grid grid-cols-2 gap-3">
                <Input
                  label="Duração (minutos)" type="number" value={nova.duracaoMinutos}
                  hint="O relógio começa quando o candidato inicia, não quando a janela abre."
                  onInput={(e) => setNova((p) => ({ ...p, duracaoMinutos: (e.target as HTMLInputElement).value }))}
                />
                <Input label="Nota máxima" type="number" value={nova.notaMaxima} onInput={(e) => setNova((p) => ({ ...p, notaMaxima: (e.target as HTMLInputElement).value }))} />
              </div>
              <Textarea label="Instruções ao candidato" rows={3} value={nova.instrucoes} onInput={(e) => setNova((p) => ({ ...p, instrucoes: (e.target as HTMLTextAreaElement).value }))} />

              <div>
                <div class="text-sm text-fg-muted mb-1.5">
                  Questões {selecionadas.length > 0 && <span class="text-fg">· {selecionadas.length} selecionada(s)</span>}
                </div>
                {questoes.isLoading ? (
                  <Skeleton class="h-32 w-full" />
                ) : (questoes.data?.questoes ?? []).length === 0 ? (
                  <p class="text-xs text-fg-subtle">O banco está vazio. Cadastre questões antes de montar a prova.</p>
                ) : (
                  <div class="max-h-64 overflow-auto divide-y divide-border rounded-lg border border-border">
                    {(questoes.data?.questoes ?? []).map((q) => (
                      <label key={q.id} class="px-3 py-2 flex items-start gap-3 hover:bg-surface-2 cursor-pointer">
                        <input type="checkbox" class="mt-1" checked={selecionadas.includes(q.id)} onChange={() => alternar(q.id)} />
                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-fg line-clamp-2">{q.enunciado}</div>
                          <div class="text-[11px] text-fg-subtle">
                            {q.area} · {q.tipo === 'OBJETIVA' ? 'objetiva' : 'dissertativa'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div class="flex items-center gap-2">
                <Button onClick={criarProva} disabled={!nova.titulo.trim() || mut.criarProva.isPending}>
                  <Plus size={16} /> Criar prova
                </Button>
                <Button variant="ghost" onClick={() => setMontando(false)}>Cancelar</Button>
              </div>
            </Card>
          )}

          {provas.isLoading ? (
            <Skeleton class="h-48 w-full" />
          ) : (provas.data?.provas ?? []).length === 0 ? (
            <Card>
              <EmptyState
                icon={<ClipboardList size={24} />}
                title="Nenhuma prova criada"
                description="Monte a prova a partir do banco de questões e gere um link por candidato."
                action={<Button onClick={() => setMontando(true)}><Plus size={16} /> Nova prova</Button>}
              />
            </Card>
          ) : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {(provas.data?.provas ?? []).map((p) => (
                <div key={p.id} class="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <button class="flex-1 min-w-0 text-left" onClick={() => navigate(`/aca/provas/${p.id}`)}>
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-fg">{p.titulo}</span>
                      <Badge tone={p.publicada ? 'success' : 'neutral'}>{p.publicada ? 'Publicada' : 'Rascunho'}</Badge>
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5 flex items-center gap-3">
                      <span class="flex items-center gap-1"><Library size={12} /> {p._count?.itens ?? 0} questão(ões)</span>
                      <span class="flex items-center gap-1"><Clock size={12} /> {p.duracaoMinutos} min</span>
                      <span>{p._count?.aplicacoes ?? 0} candidato(s)</span>
                    </div>
                  </button>
                  <div class="flex items-center gap-1.5 shrink-0">
                    {!p.publicada && (
                      <Button size="sm" onClick={() => publicar(p.id)} disabled={mut.publicar.isPending}>
                        <Send size={14} /> Publicar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/provas/${p.id}`)}>Abrir</Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {aba === 'questoes' && (
        questoes.isLoading ? <Skeleton class="h-64 w-full" /> : (questoes.data?.questoes ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon={<Library size={24} />}
              title="Banco de questões vazio"
              description="Cadastre questões objetivas e dissertativas para montar provas."
              action={<Button onClick={() => setAba('nova-questao')}><Plus size={16} /> Nova questão</Button>}
            />
          </Card>
        ) : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {(questoes.data?.questoes ?? []).map((q) => (
              <div key={q.id} class="px-4 py-3">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <Badge tone="neutral">{q.area}</Badge>
                  <Badge tone={q.tipo === 'OBJETIVA' ? 'info' : 'accent'}>
                    {q.tipo === 'OBJETIVA' ? 'Objetiva' : 'Dissertativa'}
                  </Badge>
                  <span class="text-[11px] text-fg-subtle">peso {q.peso}</span>
                </div>
                <div class="text-sm text-fg">{q.enunciado}</div>
                {q.alternativas && (
                  <div class="mt-1.5 space-y-0.5">
                    {q.alternativas.map((a) => (
                      <div key={a.id} class={`text-xs flex gap-2 ${a.id === q.gabarito ? 'text-success font-medium' : 'text-fg-muted'}`}>
                        <span class="uppercase w-4">{a.id})</span>
                        <span>{a.texto}</span>
                        {a.id === q.gabarito && <span class="text-[10px]">✓ gabarito</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        )
      )}

      {aba === 'nova-questao' && (
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card class="lg:col-span-2 space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <Input label="Área" value={nq.area} placeholder="Matemática" onInput={(e) => setNq((p) => ({ ...p, area: (e.target as HTMLInputElement).value }))} />
              <Select label="Tipo" value={nq.tipo} onChange={(e) => setNq((p) => ({ ...p, tipo: (e.target as HTMLSelectElement).value }))}>
                <option value="OBJETIVA">Objetiva</option>
                <option value="DISSERTATIVA">Dissertativa</option>
              </Select>
              <Input label="Peso" type="number" value={nq.peso} onInput={(e) => setNq((p) => ({ ...p, peso: (e.target as HTMLInputElement).value }))} />
            </div>
            <Textarea label="Enunciado" rows={4} value={nq.enunciado} onInput={(e) => setNq((p) => ({ ...p, enunciado: (e.target as HTMLTextAreaElement).value }))} />

            {nq.tipo === 'OBJETIVA' && (
              <div class="space-y-2">
                <div class="text-sm text-fg-muted">Alternativas <span class="text-fg-subtle text-xs">— marque a correta</span></div>
                {alts.map((a, i) => (
                  <div key={a.id} class="flex items-center gap-2">
                    <input type="radio" name="gab" checked={gabarito === a.id} onChange={() => setGabarito(a.id)} />
                    <span class="w-5 text-sm text-fg-muted uppercase">{a.id})</span>
                    <div class="flex-1">
                      <Input
                        value={a.texto} placeholder={`Alternativa ${a.id.toUpperCase()}`}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value
                          setAlts((p) => p.map((x, j) => (j === i ? { ...x, texto: v } : x)))
                        }}
                      />
                    </div>
                    {alts.length > 2 && (
                      <button
                        class="text-xs text-fg-subtle hover:text-danger px-1"
                        onClick={() => {
                          setAlts((p) => p.filter((_, j) => j !== i))
                          if (gabarito === a.id) setGabarito(alts[0]!.id === a.id ? alts[1]!.id : alts[0]!.id)
                        }}
                      >remover</button>
                    )}
                  </div>
                ))}
                {alts.length < LETRAS.length && (
                  <button
                    class="text-xs text-accent hover:underline"
                    onClick={() => setAlts((p) => [...p, { id: LETRAS[p.length]!, texto: '' }])}
                  >+ alternativa</button>
                )}
              </div>
            )}

            <Button onClick={criarQuestao} disabled={!nq.enunciado.trim() || !objetivaValida || mut.criarQuestao.isPending}>
              <Plus size={16} /> Adicionar ao banco
            </Button>
            {!objetivaValida && nq.enunciado.trim() && (
              <p class="text-xs text-danger">Preencha ao menos duas alternativas e marque a correta.</p>
            )}
          </Card>

          <Card class="!p-4 text-xs text-fg-muted space-y-1.5 h-fit">
            <div class="flex items-center gap-2 text-fg font-medium"><ClipboardList size={15} /> Como a correção funciona</div>
            <p>
              As <strong class="text-fg">objetivas</strong> são corrigidas no servidor no momento da entrega — o
              gabarito nunca chega ao navegador do candidato.
            </p>
            <p>
              As <strong class="text-fg">dissertativas</strong> vão para a fila de correção. Enquanto houver uma sem
              nota, a prova fica como <em>entregue</em>; a nota final só fecha quando todas forem corrigidas.
            </p>
          </Card>
        </div>
      )}
    </Page>
  )
}
