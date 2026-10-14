// O laudo de integridade da redação, para o avaliador: percentual de IA na
// régua do limite, motivos, trechos, métricas, comportamento de escrita,
// similaridade e a decisão humana (auditada). Nada disto vai ao candidato.
import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Pode } from '@/components/auth/Pode'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import {
  useDecisaoIntegridade, useReanalisarIntegridade,
  type EssayDetail, type ResultadoIntegridade, type StatusIntegridade,
} from '@/hooks/useEducationalReview'
import { ReguaIa } from './IntegridadeConfig'

const ROTULO: Record<StatusIntegridade, { texto: string; classe: string }> = {
  ok: { texto: 'Sem indícios', classe: 'bg-success/15 text-success border-success/30' },
  atencao: { texto: 'Atenção', classe: 'bg-warning/15 text-warning border-warning/30' },
  suspeita: { texto: 'Suspeita', classe: 'bg-danger/15 text-danger border-danger/30' },
  indisponivel: { texto: 'Indisponível', classe: 'bg-surface-3 text-fg-muted border-border' },
}

/** Selo curto para listas: "IA 78%" colorido pelo status. */
export function SeloIntegridade({ pct, status, decisao }: { pct: number | null; status: StatusIntegridade | null; decisao?: 'confirmada' | 'descartada' | null }) {
  if (!status) return null
  const r = ROTULO[status]
  return (
    <span class={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-3xs font-semibold tabular-nums', r.classe)}
      title={`Integridade: ${r.texto}${decisao ? ` · suspeita ${decisao} pelo avaliador` : ''}`}>
      🛡 {pct != null ? `IA ${Math.round(pct)}%` : r.texto}
      {decisao === 'descartada' && <span class="font-normal">· descartada</span>}
      {decisao === 'confirmada' && <span class="font-normal">· confirmada</span>}
    </span>
  )
}

/** Texto da redação com os trechos apontados pelo detector destacados. */
export function TextoComDestaques({ texto, trechos }: { texto: string; trechos: Array<{ texto: string; motivo: string }> }) {
  if (!trechos.length) return <>{texto}</>
  const marcas: Array<{ ini: number; fim: number; motivo: string }> = []
  for (const t of trechos) {
    const i = texto.indexOf(t.texto)
    if (i >= 0 && !marcas.some((m) => i < m.fim && i + t.texto.length > m.ini)) marcas.push({ ini: i, fim: i + t.texto.length, motivo: t.motivo })
  }
  marcas.sort((a, b) => a.ini - b.ini)
  const partes: ComponentChildren[] = []
  let pos = 0
  marcas.forEach((m, k) => {
    if (m.ini > pos) partes.push(texto.slice(pos, m.ini))
    partes.push(<mark key={k} class="bg-danger/20 text-fg rounded px-0.5 underline decoration-danger/60 decoration-dotted" title={m.motivo}>{texto.slice(m.ini, m.fim)}</mark>)
    pos = m.fim
  })
  if (pos < texto.length) partes.push(texto.slice(pos))
  return <>{partes}</>
}

/** Linha do tempo da escrita: caracteres × minutos. Texto que aparece de uma
 *  vez vira um degrau — é o que o avaliador precisa ver. */
function LinhaDoTempo({ pontos }: { pontos: Array<{ s: number; n: number }> }) {
  if (pontos.length < 2) return <div class="text-2xs text-fg-muted">Sem pontos suficientes da escrita.</div>
  const ord = [...pontos].sort((a, b) => a.s - b.s)
  const maxS = Math.max(1, ord[ord.length - 1]!.s), maxN = Math.max(1, ...ord.map((p) => p.n))
  const W = 320, H = 70
  const d = ord.map((p, i) => `${i ? 'L' : 'M'}${((p.s / maxS) * W).toFixed(1)},${(H - (p.n / maxN) * H).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-20" role="img" aria-label="Linha do tempo da escrita">
      <path d={`${d} L${W},${H} L0,${H} Z`} class="fill-accent/10" />
      <path d={d} class="stroke-accent fill-none" stroke-width="2" vector-effect="non-scaling-stroke" />
      <text x="2" y="10" class="fill-fg-muted" font-size="9">{maxN} car.</text>
      <text x={W - 2} y={H - 2} text-anchor="end" class="fill-fg-muted" font-size="9">{Math.round(maxS / 60)} min</text>
    </svg>
  )
}

function Metrica({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div class={cn('rounded border px-2 py-1.5', alerta ? 'border-warning/40 bg-warning/5' : 'border-border bg-surface')}>
      <div class="text-3xs uppercase tracking-wider text-fg-muted">{rotulo}</div>
      <div class={cn('text-sm font-semibold tabular-nums', alerta ? 'text-warning' : 'text-fg')}>{valor}</div>
    </div>
  )
}

export function IntegridadePainel({ item }: { item: EssayDetail }) {
  const r: ResultadoIntegridade | null = item.integrity
  const decidir = useDecisaoIntegridade()
  const reanalisar = useReanalisarIntegridade()
  const [nota, setNota] = useState('')

  function registrar(decisao: 'confirmada' | 'descartada' | null) {
    decidir.mutate({ id: item.id, decisao, nota }, {
      onSuccess: () => { toast(decisao ? `Suspeita ${decisao}` : 'Decisão desfeita', 'success'); setNota('') },
      onError: (e) => toast((e as Error).message, 'danger'),
    })
  }

  const cabecalho = (
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <span class="text-3xs uppercase tracking-wider font-semibold text-fg-muted">🛡 Integridade da redação</span>
      <Pode tela="edu_avaliacoes" acao="edit">
        <Button size="sm" variant="ghost" disabled={reanalisar.isPending}
          onClick={() => reanalisar.mutate(item.id, { onSuccess: () => toast('Integridade reanalisada', 'success'), onError: (e) => toast((e as Error).message, 'danger') })}>
          {reanalisar.isPending ? 'Analisando…' : 'Reanalisar'}
        </Button>
      </Pode>
    </div>
  )

  if (!r) {
    return (
      <div class="rounded-md border border-border bg-surface p-3 space-y-1">
        {cabecalho}
        <div class="text-xs text-fg-muted">
          {item.status === 'ai_reviewing' ? 'Análise em andamento — sai junto com a nota.' : 'Esta redação não tem análise de integridade (enviada antes do recurso existir ou com a correção por IA desligada). Use "Reanalisar".'}
        </div>
      </div>
    )
  }

  const st = ROTULO[r.status]
  const comp = r.comportamento
  const sim = r.similaridade
  const pol = r.politica
  const sinaisIa = r.deteccao?.sinais.filter((s) => s.tipo !== 'humano') ?? []
  const sinaisHumanos = r.deteccao?.sinais.filter((s) => s.tipo === 'humano') ?? []

  return (
    <div class={cn('rounded-md border p-3 space-y-3', r.status === 'suspeita' ? 'border-danger/40 bg-danger/5' : r.status === 'atencao' ? 'border-warning/40 bg-warning/5' : 'border-border bg-surface')}>
      {cabecalho}

      {/* Percentual + régua */}
      {pol.detectarIa && (
        <div class="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 items-center">
          <div>
            <div class="text-3xl font-bold tabular-nums text-fg leading-none">{r.percentualIa != null ? `${Math.round(r.percentualIa)}%` : '—'}</div>
            <div class="text-2xs text-fg-muted mt-1">autoria estimada por IA</div>
          </div>
          <div>
            <ReguaIa limite={pol.limiteIa} margem={pol.margemAtencao} valor={r.percentualIa} />
            <div class="flex items-center gap-2 flex-wrap mt-2 text-2xs">
              <span class={cn('rounded border px-1.5 py-0.5 font-semibold', st.classe)}>{st.texto}</span>
              <span class="text-fg-muted">Limite de tolerância: <strong class="text-fg">{pol.limiteIa}%</strong></span>
              {r.confianca != null && <span class="text-fg-muted">Confiança do detector: <strong class="text-fg">{Math.round(r.confianca * 100)}%</strong></span>}
              {r.composicao.minimoPorArtefato ? <span class="text-danger">Piso de {r.composicao.minimoPorArtefato}% por marca de chatbot no texto</span> : null}
            </div>
            {r.percentualIa != null && r.percentualIa < 20 && (
              <div class="text-3xs text-fg-muted mt-1">Abaixo de 20% a estimativa é pouco conclusiva — trate como ausência de indício.</div>
            )}
          </div>
        </div>
      )}
      {!pol.detectarIa && <div class="flex items-center gap-2 text-xs"><span class={cn('rounded border px-1.5 py-0.5 font-semibold', st.classe)}>{st.texto}</span><span class="text-fg-muted">Detecção de IA desligada neste processo.</span></div>}
      {r.erro && <div class="text-2xs text-warning">Detector: {r.erro}</div>}

      {/* Motivos */}
      {r.motivos.length > 0 && (
        <ul class="space-y-1">
          {r.motivos.map((m, i) => (
            <li key={i} class={cn('text-xs flex gap-2', m.nivel === 'suspeita' ? 'text-danger' : 'text-warning')}>
              <span>{m.nivel === 'suspeita' ? '●' : '○'}</span>
              <span>{m.texto}{m.nivel === 'suspeita' && <span class="text-fg-muted"> — política: {m.acao === 'reprovar' ? 'reprovar' : m.acao === 'revisao' ? 'revisão humana' : 'sinalizar'}</span>}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Detector */}
      {r.deteccao && (
        <div class="space-y-2">
          {r.deteccao.resumo && <div class="text-xs text-fg">{r.deteccao.resumo}</div>}
          {(sinaisIa.length > 0 || sinaisHumanos.length > 0) && (
            <div class="flex flex-wrap gap-1.5">
              {sinaisIa.map((s, i) => <span key={`i${i}`} class="text-2xs rounded border border-danger/30 bg-danger/5 text-fg px-1.5 py-0.5" title={s.tipo}>{s.descricao}</span>)}
              {sinaisHumanos.map((s, i) => <span key={`h${i}`} class="text-2xs rounded border border-success/30 bg-success/5 text-fg px-1.5 py-0.5" title="sinal de escrita humana">✓ {s.descricao}</span>)}
            </div>
          )}
          {r.deteccao.trechos.length > 0 && (
            <div class="text-2xs text-fg-muted">{r.deteccao.trechos.length} trecho(s) destacado(s) no texto da redação — passe o mouse para ver o motivo.</div>
          )}
        </div>
      )}

      {/* Texto: métricas e marcas */}
      <div>
        <div class="text-3xs uppercase tracking-wider text-fg-muted mb-1">Texto</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <Metrica rotulo="Variação das frases" valor={r.metricas.variacaoFrases.toFixed(2)} alerta={r.metricas.frases >= 8 && r.metricas.variacaoFrases > 0 && r.metricas.variacaoFrases < 0.3} />
          <Metrica rotulo="Diversidade lexical" valor={r.metricas.diversidadeLexical.toFixed(2)} />
          <Metrica rotulo="Frases · média" valor={`${r.metricas.frases} · ${r.metricas.mediaPalavrasPorFrase}`} />
          <Metrica rotulo="Parágrafos" valor={String(r.metricas.paragrafos)} />
        </div>
        <div class="text-3xs text-fg-muted mt-1">Variação abaixo de 0,30 indica ritmo uniforme demais (comum em texto gerado); escrita humana costuma passar de 0,45.</div>
        {r.metricas.artefatos.length > 0 && (
          <ul class="mt-2 space-y-0.5">
            {r.metricas.artefatos.map((a, i) => <li key={i} class="text-xs text-danger">⚑ {a.descricao}</li>)}
          </ul>
        )}
      </div>

      {/* Comportamento */}
      {comp && (
        <div>
          <div class="text-3xs uppercase tracking-wider text-fg-muted mb-1">Como foi escrita</div>
          {comp.disponivel ? (
            <>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <Metrica rotulo="Tempo digitando" valor={`${comp.minutosAtivos} min`} />
                <Metrica rotulo="Ritmo" valor={`${comp.caracteresPorMinuto} car/min`} alerta={comp.caracteresPorMinuto > 450} />
                <Metrica rotulo="Inserido de uma vez" valor={`${comp.textoInseridoPct}%`} alerta={comp.textoInseridoPct >= r.politica.limiteTextoInserido} />
                <Metrica rotulo="Maior salto" valor={`${comp.maiorSaltoCaracteres} car.`} alerta={comp.maiorSaltoCaracteres >= 400} />
                <Metrica rotulo="Colagens" valor={String(comp.colagens)} alerta={comp.colagens > 0} />
                <Metrica rotulo="Saídas da aba" valor={String(comp.saidasAba)} alerta={comp.saidasAba > r.politica.maxSaidasAba} />
                <Metrica rotulo="Tempo fora da aba" valor={`${comp.minutosFora} min`} />
                <Metrica rotulo="Correções / 100 car." valor={String(comp.apagamentosPorCem)} />
              </div>
              <div class="mt-2 rounded border border-border bg-surface p-2">
                <LinhaDoTempo pontos={item.typingTelemetry?.linhaDoTempo ?? []} />
              </div>
            </>
          ) : (
            <div class="text-2xs text-fg-muted">
              Sem telemetria de digitação (redação escrita antes do recurso). Colagens: {comp.colagens} · saídas da aba: {comp.saidasAba}.
            </div>
          )}
        </div>
      )}

      {/* Similaridade */}
      {sim && (
        <div>
          <div class="text-3xs uppercase tracking-wider text-fg-muted mb-1">Similaridade</div>
          <div class="grid grid-cols-2 gap-1.5">
            <Metrica rotulo={`Com outro candidato${sim.candidato ? ` (${sim.candidato})` : ''}`} valor={`${sim.maiorComCandidato}%`} alerta={sim.maiorComCandidato >= 15} />
            <Metrica rotulo="Com os textos motivadores" valor={`${sim.comTextosMotivadores}%`} alerta={sim.comTextosMotivadores >= 15} />
          </div>
          <div class="text-3xs text-fg-muted mt-1">Comparada com {sim.comparadas} redação(ões) do mesmo processo, por sequências de 5 palavras.</div>
        </div>
      )}

      {/* Decisão humana */}
      <div class="rounded-md border border-border bg-surface p-2.5 space-y-2">
        <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted">Decisão do avaliador sobre a integridade</div>
        {item.integrityDecision ? (
          <div class="text-xs">
            <span class={cn('font-semibold', item.integrityDecision === 'confirmada' ? 'text-danger' : 'text-success')}>
              Suspeita {item.integrityDecision}
            </span>
            {item.integrityReviewedAt && <span class="text-fg-muted"> em {formatDateTime(item.integrityReviewedAt)}</span>}
            {item.integrityNote && <div class="text-fg-muted mt-0.5 whitespace-pre-wrap">{item.integrityNote}</div>}
            <Pode tela="edu_avaliacoes" acao="edit">
              <button type="button" class="text-2xs text-accent hover:underline mt-1" disabled={decidir.isPending} onClick={() => registrar(null)}>Desfazer decisão</button>
            </Pode>
          </div>
        ) : (
          <Pode tela="edu_avaliacoes" acao="edit" senao={<div class="text-2xs text-fg-muted">Nenhuma decisão registrada.</div>}>
            <Textarea value={nota} onInput={(e) => setNota((e.target as HTMLTextAreaElement).value)} rows={2}
              label="Justificativa (obrigatória)" placeholder="Ex.: candidato demonstrou autoria em entrevista / texto idêntico ao de outro candidato…" />
            <div class="flex gap-2 justify-end">
              <Button size="sm" variant="secondary" disabled={decidir.isPending} onClick={() => registrar('descartada')}>Descartar suspeita</Button>
              <Button size="sm" variant="primary" disabled={decidir.isPending} onClick={() => registrar('confirmada')} class="bg-danger hover:bg-danger/90">Confirmar suspeita</Button>
            </div>
          </Pode>
        )}
      </div>

      <div class="text-3xs text-fg-muted">
        Detecção de texto gerado por IA é probabilística e pode errar, sobretudo em textos curtos, muito revisados ou de quem escreve no modelo ENEM.
        Use como indício para a decisão humana, nunca como prova isolada. Analisado em {formatDateTime(r.analisadoEm)}.
      </div>
    </div>
  )
}
