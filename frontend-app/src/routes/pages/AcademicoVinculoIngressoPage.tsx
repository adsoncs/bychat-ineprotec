import { useState, useMemo } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Landmark, AlertTriangle, Save, Info } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { useVinculo, useFormasIngresso, useSalvarIngresso } from '@/hooks/useAcaFundacao'
import { useCourses } from '@/hooks/useEducational'
import { toast } from '@/lib/toast'

// Dados de ingresso do vínculo — o que a instituição declara ao Censo.
//
// Existe como tela própria, e não como campo solto no prontuário, porque são
// quatro decisões acopladas: a forma oficial, o critério de classificação, o
// curso de origem (obrigatório em transferência) e o documento que ampara o
// ingresso quando não houve disputa por vaga.
//
// A lista de formas NÃO é editável: o Censo aceita 10, e declarar outra
// inviabiliza a importação do módulo Aluno. Cursos de especialização também são
// registrados no Censo da Educação Superior (Res. CNE/CES 1/2018, art. 6º), por
// isso a régua vale para pós e não só para graduação.

export function AcademicoVinculoIngressoPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading } = useVinculo(id)
  const { data: catalogo } = useFormasIngresso()
  const { data: cursosData } = useCourses()
  const salvar = useSalvarIngresso()

  const [forma, setForma] = useState<string | null>(null)
  const [criterio, setCriterio] = useState<string | null>(null)
  const [cursoOrigem, setCursoOrigem] = useState<string | null>(null)
  const [amparo, setAmparo] = useState<string | null>(null)

  const v = data?.vinculo
  // Estado só assume o valor salvo enquanto o campo não foi tocado — assim o
  // formulário não reverte a digitação a cada refetch da query.
  const formaAtual = forma ?? v?.formaIngresso ?? ''
  const criterioAtual = criterio ?? v?.criterioClassificacao ?? ''
  const cursoOrigemAtual = cursoOrigem ?? (v?.cursoOrigemId ? String(v.cursoOrigemId) : '')
  const amparoAtual = amparo ?? v?.amparoUrl ?? ''

  const formaSel = catalogo?.formas.find((f) => f.codigo === formaAtual)
  const criterioSel = catalogo?.criterios.find((c) => c.codigo === criterioAtual)

  const criteriosVisiveis = useMemo(() => {
    const todos = catalogo?.criterios ?? []
    if (!formaSel?.criteriosSugeridos.length) return todos
    return todos.filter((c) => formaSel.criteriosSugeridos.includes(c.codigo))
  }, [catalogo, formaSel])

  // Avisos calculados aqui espelham os do backend, para o usuário ver antes de
  // salvar. O backend recalcula na resposta — ele é a autoridade.
  const avisos = useMemo(() => {
    const out: string[] = []
    if (!formaSel) return out
    if (formaSel.exigeCursoOrigem && !cursoOrigemAtual) out.push(`${formaSel.rotulo} exige informar o curso de origem.`)
    if (formaSel.exigeAmparo && !amparoAtual) out.push(`${formaSel.rotulo} exige o documento que ampara o ingresso.`)
    if (formaSel.restricao) out.push(formaSel.restricao)
    if (criterioSel && formaSel.criteriosSugeridos.length && !formaSel.criteriosSugeridos.includes(criterioSel.codigo)) {
      out.push(`Critério "${criterioSel.rotulo}" é incomum para ${formaSel.rotulo}.`)
    }
    return out
  }, [formaSel, criterioSel, cursoOrigemAtual, amparoAtual])

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!v) {
    return (
      <Page title="Vínculo não encontrado">
        <EmptyState title="Vínculo não encontrado" description="O registro pode ter sido removido." />
      </Page>
    )
  }

  const nome = v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`
  const cursos = (cursosData?.courses ?? []).filter((c) => c.id !== v.courseId)

  function handleSalvar() {
    salvar.mutate(
      {
        id,
        formaIngresso: formaAtual || null,
        criterioClassificacao: criterioAtual || null,
        cursoOrigemId: cursoOrigemAtual ? Number(cursoOrigemAtual) : null,
        amparoUrl: amparoAtual || null,
      },
      {
        onSuccess: (r) => {
          toast(
            r.avisos.length
              ? `Ingresso salvo com ${r.avisos.length} aviso(s) de conformidade`
              : 'Dados de ingresso salvos',
            r.avisos.length ? 'danger' : 'success',
          )
          navigate(`/aca/vinculos/${id}`)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title="Dados de ingresso"
      description={`${nome} · vínculo #${v.id}`}
      actions={
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
            onClick={() => navigate(`/aca/vinculos/${id}`)}
          >
            <ChevronLeft size={15} /> Voltar
          </button>
          <Button variant="primary" size="sm" onClick={handleSalvar} disabled={salvar.isPending}>
            <Save size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="lg:col-span-2 space-y-3">
          <Card class="space-y-3">
            <div class="flex items-center gap-2 text-sm font-semibold text-fg">
              <Landmark size={15} class="text-accent" />
              Forma de ingresso
            </div>

            <Select
              label="Forma declarada ao Censo *"
              value={formaAtual}
              onChange={(e) => {
                const nova = (e.target as HTMLSelectElement).value
                setForma(nova)
                const f = catalogo?.formas.find((x) => x.codigo === nova)
                // Critério que não pertence à forma nova viraria incoerência.
                if (f?.criteriosSugeridos.length && criterioAtual && !f.criteriosSugeridos.includes(criterioAtual)) {
                  setCriterio('')
                }
              }}
            >
              <option value="">— não informada —</option>
              {(catalogo?.formas ?? []).map((f) => (
                <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>
              ))}
            </Select>

            {formaSel && (
              <div class="rounded-md bg-surface-2 border border-border p-2.5 text-xs text-fg-muted leading-relaxed flex items-start gap-2">
                <Info size={13} class="text-accent mt-0.5 shrink-0" />
                <span>{formaSel.descricao}</span>
              </div>
            )}

            <Select
              label="Critério de classificação"
              value={criterioAtual}
              onChange={(e) => setCriterio((e.target as HTMLSelectElement).value)}
            >
              <option value="">— não informado —</option>
              {criteriosVisiveis.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.rotulo}{c.classifica ? '' : ' (sem ranking)'}
                </option>
              ))}
            </Select>
            {criterioSel && (
              <p class="text-[0.6875rem] text-fg-muted leading-relaxed">{criterioSel.descricao}</p>
            )}
          </Card>

          <Card class="space-y-3">
            <div class="text-sm font-semibold text-fg">Origem e amparo</div>

            <Select
              label="Curso de origem"
              value={cursoOrigemAtual}
              onChange={(e) => setCursoOrigem((e.target as HTMLSelectElement).value)}
              hint="Obrigatório em transferência (interna ou ex-officio). O Censo pede a informação no curso de destino."
            >
              <option value="">— não se aplica —</option>
              {cursos.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.nome}</option>
              ))}
            </Select>

            <Input
              label="Documento que ampara o ingresso (URL)"
              value={amparoAtual}
              onInput={(e) => setAmparo((e.target as HTMLInputElement).value)}
              placeholder="https://… ofício de remoção, decisão judicial"
              hint="Necessário quando não houve disputa por vaga: transferência ex-officio ou decisão judicial."
            />
          </Card>
        </div>

        <div class="space-y-3">
          {avisos.length > 0 && (
            <Card class="border-warning/40 bg-warning/5">
              <div class="flex items-center gap-2 text-xs font-semibold text-fg mb-2">
                <AlertTriangle size={14} class="text-warning" />
                {avisos.length} aviso(s) de conformidade
              </div>
              <ul class="space-y-1.5">
                {avisos.map((a) => (
                  <li key={a} class="text-[0.6875rem] text-fg-muted leading-relaxed pl-3 relative">
                    <span class="absolute left-0 text-warning">·</span>{a}
                  </li>
                ))}
              </ul>
              <p class="text-[0.625rem] text-fg-subtle mt-2 leading-relaxed">
                Avisos não impedem salvar — a secretaria pode completar depois. Mas eles aparecem no
                painel de conformidade até serem resolvidos.
              </p>
            </Card>
          )}

          <Card>
            <div class="text-xs font-semibold text-fg mb-2">O que o Censo aceita</div>
            <p class="text-[0.6875rem] text-fg-muted leading-relaxed">
              São 10 formas, e só elas. Três armadilhas comuns:
            </p>
            <ul class="mt-2 space-y-2 text-[0.6875rem] text-fg-muted leading-relaxed">
              <li>
                <strong class="text-fg">Transferência interna</strong> não é forma de ingresso. É
                movimentação do vínculo de origem mais o curso de origem aqui.
              </li>
              <li>
                <strong class="text-fg">Portador de diploma</strong> é seleção simplificada com
                critério "análise de diploma".
              </li>
              <li>
                <strong class="text-fg">Reingresso</strong> é vaga remanescente.
              </li>
            </ul>
            <p class="text-[0.625rem] text-fg-subtle mt-2.5 leading-relaxed">
              Cursos de especialização também são registrados no Censo da Educação Superior
              (Res. CNE/CES 1/2018, art. 6º) — a régua não é só de graduação.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  )
}
