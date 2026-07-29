import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Save, Scale, Search } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useAlunos } from '@/hooks/useAcaAluno'
import {
  useRegimesEspeciais, useRegimeMut, useTiposRegime, REGIME_STATUS,
} from '@/hooks/useAcaRegimeEspecial'

// Tela dedicada de solicitação/edição do regime. O amparo legal vem preenchido
// pelo tipo: é ele que sustenta a decisão numa auditoria do MEC, e depender de
// a secretaria lembrar a norma de cabeça é como perder essa defesa.

const paraInput = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '')

export function AcademicoRegimeEspecialFormPage({ params }: { params: { id?: string } }) {
  const [, navigate] = useLocation()
  const edicaoId = params.id && params.id !== 'novo' ? Number(params.id) : null
  const tipos = useTiposRegime()
  const mut = useRegimeMut()
  const lista = useRegimesEspeciais()
  const existente = edicaoId ? lista.data?.regimes.find((r) => r.id === edicaoId) : null

  const [q, setQ] = useState('')
  const alunos = useAlunos(q)
  const [alunoId, setAlunoId] = useState<number | null>(null)
  const [alunoNome, setAlunoNome] = useState('')
  const [tocado, setTocado] = useState(false)

  const [f, setF] = useState({
    tipo: 'SAUDE', dataInicio: '', dataFim: '',
    amparoLegal: '', atestadoUrl: '', planoAtividades: '', observacao: '',
  })

  // Ao carregar um regime existente, preenche uma única vez — depois o estado
  // do formulário é do operador.
  if (existente && !tocado && !f.dataInicio) {
    setF({
      tipo: existente.tipo,
      dataInicio: paraInput(existente.dataInicio),
      dataFim: paraInput(existente.dataFim),
      amparoLegal: existente.amparoLegal ?? '',
      atestadoUrl: existente.atestadoUrl ?? '',
      planoAtividades: existente.planoAtividades ?? '',
      observacao: existente.observacao ?? '',
    })
  }

  const tipoAtual = tipos.data?.tipos.find((t) => t.id === f.tipo)
  const set = (k: keyof typeof f, v: string) => { setTocado(true); setF((p) => ({ ...p, [k]: v })) }

  const trocarTipo = (id: string) => {
    const t = tipos.data?.tipos.find((x) => x.id === id)
    setTocado(true)
    // Sugere o amparo do novo tipo, mas não sobrescreve texto que o operador escreveu.
    setF((p) => ({ ...p, tipo: id, amparoLegal: p.amparoLegal && p.amparoLegal !== tipoAtual?.amparo ? p.amparoLegal : (t?.amparo ?? '') }))
  }

  const datasInvertidas = !!f.dataInicio && !!f.dataFim && f.dataInicio > f.dataFim
  const podeSalvar = (edicaoId || alunoId) && f.dataInicio && f.dataFim && !datasInvertidas && !mut.criar.isPending && !mut.editar.isPending

  const salvar = () => {
    const corpo = {
      tipo: f.tipo, dataInicio: f.dataInicio, dataFim: f.dataFim,
      amparoLegal: f.amparoLegal || null, atestadoUrl: f.atestadoUrl || null,
      planoAtividades: f.planoAtividades || null, observacao: f.observacao || null,
    }
    const ok = () => { toast(edicaoId ? 'Regime atualizado.' : 'Regime registrado — aguardando análise.', 'success'); navigate('/aca/regime-especial') }
    const erro = (e: any) => toast(e?.message ?? 'Não foi possível salvar.', 'danger')
    if (edicaoId) mut.editar.mutate({ id: edicaoId, ...corpo }, { onSuccess: ok, onError: erro })
    else mut.criar.mutate({ alunoId, ...corpo }, { onSuccess: ok, onError: erro })
  }

  if (edicaoId && lista.isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <Page
      title={edicaoId ? `Regime especial #${edicaoId}` : 'Novo regime especial'}
      {...(edicaoId
        ? (existente?.aluno?.lead?.nome ? { description: existente.aluno.lead.nome } : {})
        : { description: 'Registre o amparo antes que as faltas do período reprovem o aluno.' })}
      actions={
        <Button variant="ghost" onClick={() => navigate('/aca/regime-especial')}>
          <ChevronLeft size={16} /> Voltar
        </Button>
      }
    >
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          {!edicaoId && (
            <Card class="space-y-3">
              <h2 class="text-sm font-semibold text-fg">Aluno</h2>
              {alunoId ? (
                <div class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span class="text-sm text-fg">{alunoNome}</span>
                  <Button size="sm" variant="ghost" onClick={() => { setAlunoId(null); setAlunoNome('') }}>Trocar</Button>
                </div>
              ) : (
                <>
                  <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno por nome ou RA…" />
                  {alunos.isLoading ? (
                    <Skeleton class="h-16 w-full" />
                  ) : (alunos.data?.alunos ?? []).length === 0 ? (
                    <p class="text-xs text-fg-subtle flex items-center gap-1.5"><Search size={13} /> Digite para localizar o aluno.</p>
                  ) : (
                    <div class="max-h-56 overflow-auto divide-y divide-border rounded-lg border border-border">
                      {(alunos.data?.alunos ?? []).map((a) => (
                        <button
                          key={a.id} type="button"
                          class="w-full px-3 py-2 flex items-center gap-3 hover:bg-surface-2 text-left text-sm"
                          onClick={() => { setAlunoId(a.id); setAlunoNome(a.lead?.nome ?? `Aluno #${a.id}`) }}
                        >
                          <span class="text-fg-muted text-xs font-mono w-20">RA {a.ra ?? '—'}</span>
                          <span class="flex-1 text-fg">{a.lead?.nome ?? '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          )}

          <Card class="space-y-3">
            <h2 class="text-sm font-semibold text-fg">Amparo</h2>
            <Select label="Tipo" value={f.tipo} onChange={(e) => trocarTipo((e.target as HTMLSelectElement).value)}>
              {(tipos.data?.tipos ?? []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
            {tipoAtual?.ajuda && <p class="text-xs text-fg-subtle -mt-1">{tipoAtual.ajuda}</p>}
            <Input
              label="Amparo legal" value={f.amparoLegal}
              placeholder="Norma que fundamenta o afastamento"
              hint="Preenchido pelo tipo; ajuste se o caso exigir outra norma."
              onInput={(e) => set('amparoLegal', (e.target as HTMLInputElement).value)}
            />
            <div class="grid grid-cols-2 gap-3">
              <Input label="Início" type="date" value={f.dataInicio} onInput={(e) => set('dataInicio', (e.target as HTMLInputElement).value)} />
              <Input
                label="Fim" type="date" value={f.dataFim}
                {...(datasInvertidas ? { error: 'O fim não pode ser antes do início.' } : {})}
                onInput={(e) => set('dataFim', (e.target as HTMLInputElement).value)}
              />
            </div>
            <Input
              label="Atestado (link)" value={f.atestadoUrl} placeholder="https://…"
              hint="O documento que comprova o afastamento."
              onInput={(e) => set('atestadoUrl', (e.target as HTMLInputElement).value)}
            />
          </Card>

          <Card class="space-y-3">
            <h2 class="text-sm font-semibold text-fg">Plano de atividades domiciliares</h2>
            <Textarea
              rows={5} value={f.planoAtividades}
              placeholder="Trabalhos, leituras e avaliações que substituem as aulas do período…"
              hint="O regime não dispensa o conteúdo — substitui a presença por atividades. Sem plano, o aluno volta sem ter cumprido nada."
              onInput={(e) => set('planoAtividades', (e.target as HTMLTextAreaElement).value)}
            />
            <Textarea
              label="Observação" rows={3} value={f.observacao}
              onInput={(e) => set('observacao', (e.target as HTMLTextAreaElement).value)}
            />
          </Card>

          <div class="flex items-center gap-2">
            <Button onClick={salvar} disabled={!podeSalvar}>
              <Save size={16} /> {edicaoId ? 'Salvar alterações' : 'Registrar solicitação'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/aca/regime-especial')}>Cancelar</Button>
          </div>
        </div>

        <div class="space-y-4">
          {existente && (
            <Card class="space-y-2">
              <h2 class="text-sm font-semibold text-fg">Situação</h2>
              <Badge tone={REGIME_STATUS[existente.status]?.tone ?? 'neutral'}>
                {REGIME_STATUS[existente.status]?.label ?? existente.status}
              </Badge>
              {existente.deferidoEm && (
                <p class="text-xs text-fg-subtle">Deferido em {new Date(existente.deferidoEm).toLocaleString('pt-BR')}</p>
              )}
            </Card>
          )}
          <Card class="!p-4 text-xs text-fg-muted space-y-2">
            <div class="flex items-center gap-2 text-fg font-medium"><Scale size={15} /> Como isso afeta a frequência</div>
            <p>
              Enquanto o regime está <strong class="text-fg">Solicitado</strong>, nada muda: o aluno segue acumulando
              faltas normalmente.
            </p>
            <p>
              Ao <strong class="text-fg">deferir</strong>, as faltas dentro do período saem da base de cálculo. As
              presenças continuam contando — o aluno que assistiu aula no meio do afastamento não é prejudicado.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  )
}
