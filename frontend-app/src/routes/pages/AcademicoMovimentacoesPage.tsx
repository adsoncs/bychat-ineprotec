import { useMemo, useState } from 'preact/hooks'
import { Repeat, History, UserMinus, ArrowRightLeft, Ban, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMatriculas } from '@/hooks/useAcaMatricula'
import { useMovimentacoes, useSemRematricula, useTurmasDestino, useMovimentacaoMut } from '@/hooks/useAcaMovimentacao'

const STATUS_LABEL: Record<string, string> = {
  INSCRITO: 'Inscrito', PRE_MATRICULA: 'Pré-matrícula', MATRICULADO: 'Matriculado',
  TRANCADO: 'Trancado', TRANSFERIDO: 'Transferido', CONCLUIDO: 'Concluído', EVADIDO: 'Evadido', CANCELADO: 'Cancelado',
}
const STATUS_TONE: Record<string, any> = {
  MATRICULADO: 'success', TRANCADO: 'warning', INSCRITO: 'info', PRE_MATRICULA: 'warning',
  TRANSFERIDO: 'neutral', CONCLUIDO: 'accent', EVADIDO: 'danger', CANCELADO: 'neutral',
}
const TIPO_LABEL: Record<string, string> = {
  TRANCAMENTO: 'Trancamento', REINGRESSO: 'Reingresso', AFASTAMENTO: 'Afastamento',
  TRANSFERENCIA_INTERNA: 'Transf. interna', TRANSFERENCIA_EXTERNA: 'Transf. externa',
  REMANEJAMENTO: 'Remanejamento', RECLASSIFICACAO: 'Reclassificação', CANCELAMENTO: 'Cancelamento', EVASAO: 'Evasão',
}

type Acao = 'trancamento' | 'reingresso' | 'afastamento' | 'transferencia-interna' | 'transferencia-externa' | 'cancelamento' | 'evasao'

const ACAO_TITULO: Record<Acao, string> = {
  trancamento: 'Trancar matrícula', reingresso: 'Reingresso', afastamento: 'Registrar afastamento',
  'transferencia-interna': 'Transferência interna', 'transferencia-externa': 'Transferência externa',
  cancelamento: 'Cancelar matrícula', evasao: 'Registrar evasão',
}

// quais ações ficam disponíveis por status atual da matrícula
function acoesPara(status: string): Acao[] {
  switch (status) {
    case 'MATRICULADO': return ['trancamento', 'afastamento', 'transferencia-interna', 'transferencia-externa', 'evasao', 'cancelamento']
    case 'TRANCADO': return ['reingresso', 'transferencia-externa', 'evasao', 'cancelamento']
    case 'INSCRITO': case 'PRE_MATRICULA': return ['transferencia-interna', 'cancelamento']
    default: return []
  }
}

export function AcademicoMovimentacoesPage() {
  const matriculas = useMatriculas('')
  const [alvoId, setAlvoId] = useState<number | null>(null)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [tipoFiltro, setTipoFiltro] = useState('')
  const hist = useMovimentacoes(tipoFiltro)

  const rows = matriculas.data?.matriculas ?? []
  const alvo = rows.find((m) => m.id === alvoId) || null
  const acoes = alvo ? acoesPara(alvo.status) : []

  return (
    <Page title="Movimentações Acadêmicas" description="Trancamento, transferência, remanejamento, cancelamento, reingresso e o processo de atualização de situações.">
      <div class="grid gap-4 lg:grid-cols-3">
        {/* ── Coluna 1: selecionar matrícula + ações ── */}
        <Card class="lg:col-span-1 space-y-3">
          <h3 class="text-sm font-semibold text-fg flex items-center gap-2"><Repeat size={16} /> Nova movimentação</h3>
          {matriculas.isLoading ? <Skeleton class="h-9 w-full" /> : (
            <Select label="Matrícula" value={alvoId ?? ''} onChange={(e: any) => { setAlvoId(e.currentTarget.value ? Number(e.currentTarget.value) : null); setAcao(null) }}>
              <option value="">Selecione um aluno/turma…</option>
              {rows.filter((m) => acoesPara(m.status).length > 0).map((m) => (
                <option key={m.id} value={m.id}>RA {m.aluno.ra} · {m.aluno.lead.nome} — {m.turma.nome} ({STATUS_LABEL[m.status]})</option>
              ))}
            </Select>
          )}
          {alvo && (
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-xs text-fg-muted">
                Situação atual: <Badge tone={STATUS_TONE[alvo.status]} solid>{STATUS_LABEL[alvo.status]}</Badge>
              </div>
              <div class="flex flex-wrap gap-2">
                {acoes.map((a) => (
                  <Button key={a} size="sm" variant={a === 'cancelamento' || a === 'evasao' ? 'danger' : 'secondary'} onClick={() => setAcao(a)}>
                    {ACAO_TITULO[a]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ── Coluna 2: histórico ── */}
        <Card class="lg:col-span-2 space-y-3 p-0">
          <div class="px-4 pt-4 flex items-center justify-between gap-2 flex-wrap">
            <h3 class="text-sm font-semibold text-fg flex items-center gap-2"><History size={16} /> Histórico de movimentações</h3>
            <div class="flex flex-wrap gap-1">
              <button class={`text-xs px-2 py-1 rounded border ${tipoFiltro === '' ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setTipoFiltro('')}>Todas</button>
              {Object.entries(hist.data?.counters ?? {}).map(([t, n]) => (
                <button key={t} class={`text-xs px-2 py-1 rounded border ${tipoFiltro === t ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setTipoFiltro(t)}>{TIPO_LABEL[t] || t} ({n})</button>
              ))}
            </div>
          </div>
          {hist.isLoading ? (
            <div class="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-12 w-full" />)}</div>
          ) : (hist.data?.movimentacoes ?? []).length === 0 ? (
            <div class="p-4"><EmptyState icon={<History size={26} />} title="Sem movimentações" description="As movimentações registradas aparecerão aqui." /></div>
          ) : (
            <div class="divide-y divide-border max-h-[28rem] overflow-auto">
              {(hist.data?.movimentacoes ?? []).map((mv) => (
                <div key={mv.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <Badge tone="neutral">{mv.tipoLabel || TIPO_LABEL[mv.tipo] || mv.tipo}</Badge>
                  <span class="flex-1 min-w-0">
                    <span class="block truncate text-fg">{mv.aluno?.lead?.nome ?? `Aluno #${mv.alunoId}`}{mv.aluno?.ra ? ` · RA ${mv.aluno.ra}` : ''}</span>
                    <span class="block truncate text-xs text-fg-muted">
                      {mv.statusDe} → {mv.statusPara}
                      {mv.turmaDestino ? ` · destino: ${mv.turmaDestino.nome}` : ''}
                      {mv.instituicaoDestino ? ` · ${mv.instituicaoDestino}` : ''}
                      {mv.motivo ? ` · ${mv.motivo}` : ''}
                    </span>
                  </span>
                  <span class="text-xs text-fg-muted shrink-0">{new Date(mv.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <SemRematriculaCard />

      {alvo && acao && (
        <MovimentacaoModal
          acao={acao}
          matriculaId={alvo.id}
          alunoNome={alvo.aluno.lead.nome}
          turmaOrigemId={alvo.turma.id}
          onClose={() => setAcao(null)}
        />
      )}
    </Page>
  )
}

function MovimentacaoModal({ acao, matriculaId, alunoNome, turmaOrigemId, onClose }: { acao: Acao; matriculaId: number; alunoNome: string; turmaOrigemId: number; onClose: () => void }) {
  const mut = useMovimentacaoMut()
  const turmas = useTurmasDestino(acao === 'transferencia-interna')
  const [motivo, setMotivo] = useState('')
  const [dataRetorno, setDataRetorno] = useState('')
  const [instituicao, setInstituicao] = useState('')
  const [turmaDestino, setTurmaDestino] = useState('')
  const [remanejamento, setRemanejamento] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const m = (() => {
    switch (acao) {
      case 'trancamento': return mut.trancamento
      case 'reingresso': return mut.reingresso
      case 'afastamento': return mut.afastamento
      case 'cancelamento': return mut.cancelamento
      case 'evasao': return mut.evasao
      case 'transferencia-externa': return mut.transferenciaExterna
      case 'transferencia-interna': return mut.transferenciaInterna
    }
  })()

  async function submit() {
    setErro(null)
    try {
      if (acao === 'transferencia-interna') {
        if (!turmaDestino) { setErro('Selecione a turma de destino.'); return }
        await mut.transferenciaInterna.mutateAsync({ matriculaId, turmaDestinoId: Number(turmaDestino), motivo, remanejamento })
      } else if (acao === 'transferencia-externa') {
        if (!instituicao.trim()) { setErro('Informe a instituição de destino.'); return }
        await mut.transferenciaExterna.mutateAsync({ matriculaId, instituicaoDestino: instituicao, motivo })
      } else if (acao === 'trancamento' || acao === 'afastamento') {
        await (m as any).mutateAsync({ matriculaId, motivo, dataRetornoPrevista: dataRetorno || undefined })
      } else {
        await (m as any).mutateAsync({ matriculaId, motivo })
      }
      onClose()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao registrar movimentação.')
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={ACAO_TITULO[acao]} description={alunoNome}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant={acao === 'cancelamento' || acao === 'evasao' ? 'danger' : 'primary'} loading={(m as any).isPending} onClick={submit}>Confirmar</Button>
      </>}>
      <div class="space-y-3">
        {acao === 'transferencia-interna' && (
          <>
            <Select label="Turma de destino" value={turmaDestino} onChange={(e: any) => setTurmaDestino(e.currentTarget.value)}>
              <option value="">Selecione…</option>
              {(turmas.data?.turmas ?? []).filter((t) => t.id !== turmaOrigemId).map((t) => (
                <option key={t.id} value={t.id}>{t.nome} · {t.periodoLetivo.codigo}</option>
              ))}
            </Select>
            <label class="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" checked={remanejamento} onChange={(e: any) => setRemanejamento(e.currentTarget.checked)} />
              Registrar como remanejamento (mesmo período)
            </label>
            <p class="text-xs text-fg-muted">A matrícula de origem é encerrada (Transferido) e uma nova matrícula é criada na turma de destino.</p>
          </>
        )}
        {acao === 'transferencia-externa' && (
          <Input label="Instituição de destino" value={instituicao} onInput={(e: any) => setInstituicao(e.currentTarget.value)} placeholder="Nome da instituição" />
        )}
        {(acao === 'trancamento' || acao === 'afastamento') && (
          <Input label="Retorno previsto (opcional)" type="date" value={dataRetorno} onInput={(e: any) => setDataRetorno(e.currentTarget.value)} />
        )}
        <Textarea label="Motivo / observação" value={motivo} onInput={(e: any) => setMotivo(e.currentTarget.value)} rows={3} placeholder="Descreva o motivo (registro auditável)" />
        {erro && <p class="text-sm text-danger flex items-center gap-1"><AlertTriangle size={14} /> {erro}</p>}
      </div>
    </Modal>
  )
}

function SemRematriculaCard() {
  const [aberto, setAberto] = useState(false)
  const sem = useSemRematricula(aberto)
  const mut = useMovimentacaoMut()
  const [confirmar, setConfirmar] = useState(false)
  const total = sem.data?.total ?? 0

  return (
    <Card class="space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h3 class="text-sm font-semibold text-fg flex items-center gap-2"><UserMinus size={16} /> Alunos sem rematrícula</h3>
        {!aberto ? (
          <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>Verificar</Button>
        ) : (
          <div class="flex items-center gap-2">
            <span class="text-xs text-fg-muted">{total} candidato(s) à evasão</span>
            <Button size="sm" variant="danger" disabled={total === 0} onClick={() => setConfirmar(true)}>Atualizar situações (evadir)</Button>
          </div>
        )}
      </div>
      {aberto && (
        sem.isLoading ? <Skeleton class="h-10 w-full" /> :
        total === 0 ? <p class="text-sm text-fg-muted">Nenhum aluno matriculado em período encerrado sem rematrícula no período vigente.</p> : (
          <div class="divide-y divide-border max-h-72 overflow-auto">
            {(sem.data?.alunos ?? []).map((a) => (
              <div key={a.id} class="py-2 flex items-center gap-3 text-sm">
                <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                <span class="flex-1 min-w-0">
                  <span class="block truncate text-fg">{a.aluno.lead.nome}{a.aluno.ra ? ` · RA ${a.aluno.ra}` : ''}</span>
                  <span class="block truncate text-xs text-fg-muted">{a.turma.nome} · {a.turma.periodoLetivo.codigo} (encerrado)</span>
                </span>
              </div>
            ))}
          </div>
        )
      )}

      <Modal open={confirmar} onOpenChange={setConfirmar} title="Atualizar situações acadêmicas"
        description={`${total} aluno(s) serão marcados como EVADIDO (sem rematrícula no período vigente).`}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmar(false)}>Cancelar</Button>
          <Button variant="danger" loading={mut.atualizaSituacoes.isPending} onClick={async () => { await mut.atualizaSituacoes.mutateAsync({ dryRun: false }); setConfirmar(false) }}>Confirmar evasão</Button>
        </>}>
        <p class="text-sm text-fg-muted">Esta ação registra uma movimentação de evasão (auditável) para cada aluno e é irreversível pela tela (reverta manualmente pela matrícula, se necessário).</p>
      </Modal>
    </Card>
  )
}
