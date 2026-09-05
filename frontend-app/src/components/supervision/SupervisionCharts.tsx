// Gráficos da Supervisão.
//
// Três leituras que a tela não tinha: como o ritmo variou DIA A DIA (o agregado
// de sete dias engolia o dia ruim), em que HORA o cliente fala e em que hora a
// gente responde, e carga contra desempenho POR OPERADOR — que é o que separa
// "lento" de "sobrecarregado".
//
// Sem biblioteca: são três formas simples, e um SVG de trinta linhas custa
// menos que um pacote de gráficos no bundle.
//
// As duas séries usam `--color-accent` e `--color-orange` do próprio design
// system. O par foi verificado para daltonismo e contraste (ΔE 26 em protan,
// 30 em visão normal, ambos acima de 3:1 sobre a superfície) — e mesmo assim
// nada depende só da cor: legenda sempre presente e valor no `title` de cada
// marca.

import { useMemo } from 'preact/hooks'
import { Card } from '@/components/ui/Card'

/**
 * Duração em minutos ÚTEIS — os do expediente, não os do calendário.
 *
 * Escrever 7.043 minutos úteis como "4d 21h" faria o leitor entender quatro
 * dias de calendário quando são doze dias de expediente. Até um dia de
 * trabalho a escala é a de sempre; acima disso, dias de expediente.
 */
export function fmtUteis(min: number | null | undefined, minPorDia: number): string {
  if (min === null || min === undefined) return '—'
  if (min < 1) return 'na hora'
  if (min < 60) return `${min}min`
  const dia = minPorDia > 0 ? minPorDia : 600
  if (min < dia) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h}h ${m}min` : `${h}h`
  }
  const dias = min / dia
  return `${dias.toFixed(dias < 10 ? 1 : 0).replace('.', ',')}d úteis`
}

function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// ── Série diária ──────────────────────────────────────────────────────────

export interface PontoDoDia {
  dia: string
  mediana: number | null
  p90: number | null
  amostra: number
  insuficiente: boolean
}

/**
 * Mediana e p90 por dia.
 *
 * O teto da escala é o p90 típico, não o maior de todos: um único dia de 36h
 * achataria todo o resto contra o eixo e o gráfico não mostraria nada. O dia
 * que passa do teto é desenhado no topo, com o valor escrito ao lado — fica
 * visível como exceção, que é o que ele é.
 */
export function SerieDeResposta({ pontos, minPorDia }: { pontos: PontoDoDia[]; minPorDia: number }) {
  const validos = pontos.filter((p) => !p.insuficiente && p.p90 !== null)

  const { teto, pts } = useMemo(() => {
    const p90s = validos.map((p) => p.p90 as number).sort((a, b) => a - b)
    if (!p90s.length) return { teto: 60, pts: [] as PontoDoDia[] }
    // Percentil 80 dos p90 como teto, com piso de 1h para não exagerar a escala
    // num período tranquilo.
    const p80 = p90s[Math.min(p90s.length - 1, Math.floor(p90s.length * 0.8))] ?? 60
    return { teto: Math.max(60, p80), pts: validos }
  }, [pontos])

  if (pts.length < 2) {
    return (
      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Ritmo dia a dia</div>
        <p class="text-xs text-fg-muted">
          Ainda não há dias suficientes com amostra publicável neste período.
        </p>
      </Card>
    )
  }

  const W = 720, H = 200, L = 52, R = 16, T = 18, B = 34
  const larg = W - L - R
  const alt = H - T - B
  const x = (i: number) => L + (pts.length === 1 ? larg / 2 : (i * larg) / (pts.length - 1))
  const y = (v: number) => T + alt - Math.min(1, v / teto) * alt

  const linha = (campo: 'mediana' | 'p90') =>
    pts.map((p, i) => `${x(i)},${y(Math.min(p[campo] ?? 0, teto))}`).join(' ')

  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, v: Math.round(teto * f) }))
  const passo = Math.ceil(pts.length / 8)

  return (
    <Card>
      <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <div class="text-sm font-semibold text-fg">Ritmo dia a dia</div>
        <div class="flex items-center gap-3 text-2xs text-fg-muted">
          <span class="inline-flex items-center gap-1.5">
            <i class="size-2.5 rounded-sm" style={{ background: 'var(--color-accent)' }} /> Mediana
          </span>
          <span class="inline-flex items-center gap-1.5">
            <i class="size-2.5 rounded-sm" style={{ background: 'var(--color-orange)' }} /> p90
          </span>
        </div>
      </div>
      <p class="text-2xs text-fg-muted mb-2">
        Tempo de 1ª resposta em minutos úteis · dias com menos de 5 atendimentos ficam de fora
      </p>
      <div class="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: '520px' }} role="img"
          aria-label="Mediana e p90 do tempo de resposta, por dia">
          {marcas.map((m) => (
            <g key={m.f}>
              <line x1={L} y1={y(m.v)} x2={W - R} y2={y(m.v)}
                stroke={m.f === 0 ? 'var(--color-border-strong, var(--color-border))' : 'var(--color-border)'} stroke-width="1" />
              <text x={L - 8} y={y(m.v) + 4} text-anchor="end" fill="var(--color-fg-muted)"
                style={{ fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>
                {fmtUteis(m.v, minPorDia)}
              </text>
            </g>
          ))}

          <polyline points={linha('p90')} fill="none" stroke="var(--color-orange)" stroke-width="2" stroke-linejoin="round" />
          <polyline points={linha('mediana')} fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linejoin="round" />

          {pts.map((p, i) => {
            const acima = (p.p90 ?? 0) > teto
            return (
              <g key={p.dia}>
                <circle cx={x(i)} cy={y(Math.min(p.p90 ?? 0, teto))} r={acima ? 4 : 3}
                  fill="var(--color-orange)" stroke="var(--color-surface)" stroke-width="1.5">
                  <title>{`${diaCurto(p.dia)} · p90 ${fmtUteis(p.p90, minPorDia)} · ${p.amostra} atendimentos`}</title>
                </circle>
                {acima && (
                  <text x={x(i)} y={y(teto) - 7} text-anchor="middle" fill="var(--color-orange)"
                    style={{ fontSize: '10px', fontWeight: 600 }}>
                    {fmtUteis(p.p90, minPorDia)} ↑
                  </text>
                )}
                <circle cx={x(i)} cy={y(Math.min(p.mediana ?? 0, teto))} r="3"
                  fill="var(--color-accent)" stroke="var(--color-surface)" stroke-width="1.5">
                  <title>{`${diaCurto(p.dia)} · mediana ${fmtUteis(p.mediana, minPorDia)} · ${p.amostra} atendimentos`}</title>
                </circle>
              </g>
            )
          })}

          {pts.map((p, i) => (i % passo === 0 ? (
            <text key={p.dia} x={x(i)} y={H - 12} text-anchor="middle" fill="var(--color-fg-muted)"
              style={{ fontSize: '10px' }}>{diaCurto(p.dia)}</text>
          ) : null))}
        </svg>
      </div>
    </Card>
  )
}

// ── Cobertura por hora ────────────────────────────────────────────────────

export interface HoraDoDia { hora: number; entrada: number; saida: number }

/**
 * Quando o cliente fala e quando a operação responde.
 *
 * A pergunta que ele responde não é "quanta gente" e sim "que horas": no
 * beyond o pico do cliente é às 15h e é justamente ali que a proporção de
 * respostas despenca. A faixa de expediente aparece atrás das barras, então dá
 * para ver quanto do movimento cai fora dela.
 */
export function CoberturaPorHora({
  horas, expediente,
}: {
  horas: HoraDoDia[]
  expediente: Array<{ weekday: number; inicio: number; fim: number }>
}) {
  const comDado = horas.filter((h) => h.entrada > 0 || h.saida > 0)
  if (comDado.length < 3) {
    return (
      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Cobertura por hora</div>
        <p class="text-xs text-fg-muted">Sem mensagens suficientes no período.</p>
      </Card>
    )
  }

  const primeira = Math.max(0, Math.min(...comDado.map((h) => h.hora)) - 1)
  const ultima = Math.min(23, Math.max(...comDado.map((h) => h.hora)) + 1)
  const faixa = horas.filter((h) => h.hora >= primeira && h.hora <= ultima)
  const max = Math.max(...faixa.map((h) => Math.max(h.entrada, h.saida)), 1)

  // A janela de expediente mais comum entre os dias — é a régua que o gráfico
  // desenha atrás das barras.
  const abre = expediente.length ? Math.min(...expediente.map((f) => f.inicio)) / 60 : null
  const fecha = expediente.length ? Math.max(...expediente.map((f) => f.fim)) / 60 : null

  const W = 720, H = 200, L = 44, R = 14, T = 16, B = 34
  const larg = W - L - R
  const alt = H - T - B
  const passo = larg / faixa.length
  const bw = Math.max(4, Math.min(14, passo / 2 - 2))
  const y = (v: number) => T + alt - (v / max) * alt

  return (
    <Card>
      <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <div class="text-sm font-semibold text-fg">Cobertura por hora</div>
        <div class="flex items-center gap-3 text-2xs text-fg-muted">
          <span class="inline-flex items-center gap-1.5">
            <i class="size-2.5 rounded-sm" style={{ background: 'var(--color-accent)' }} /> Chegam do cliente
          </span>
          <span class="inline-flex items-center gap-1.5">
            <i class="size-2.5 rounded-sm" style={{ background: 'var(--color-orange)' }} /> Saem da operação
          </span>
        </div>
      </div>
      <p class="text-2xs text-fg-muted mb-2">
        Mensagens por hora do dia, no fuso da empresa
        {abre !== null && fecha !== null ? ` · expediente das ${abre}h às ${fecha}h em cinza` : ''}
      </p>
      <div class="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: '520px' }} role="img"
          aria-label="Mensagens recebidas e enviadas por hora do dia">
          {abre !== null && fecha !== null && (
            <rect
              x={L + Math.max(0, (abre - primeira)) * passo}
              y={T}
              width={Math.max(0, (Math.min(fecha, ultima + 1) - Math.max(abre, primeira))) * passo}
              height={alt}
              fill="var(--color-surface-3)"
            />
          )}
          <line x1={L} y1={T + alt} x2={W - R} y2={T + alt} stroke="var(--color-border)" />
          <line x1={L} y1={y(max)} x2={W - R} y2={y(max)} stroke="var(--color-border)" />
          <line x1={L} y1={y(max / 2)} x2={W - R} y2={y(max / 2)} stroke="var(--color-border)" />
          <text x={L - 8} y={y(max) + 4} text-anchor="end" fill="var(--color-fg-muted)" style={{ fontSize: '10px' }}>{max}</text>
          <text x={L - 8} y={y(max / 2) + 4} text-anchor="end" fill="var(--color-fg-muted)" style={{ fontSize: '10px' }}>{Math.round(max / 2)}</text>
          <text x={L - 8} y={T + alt + 4} text-anchor="end" fill="var(--color-fg-muted)" style={{ fontSize: '10px' }}>0</text>

          {faixa.map((h, i) => {
            const x0 = L + i * passo + (passo / 2 - bw - 1)
            return (
              <g key={h.hora}>
                <rect x={x0} y={y(h.entrada)} width={bw} height={T + alt - y(h.entrada)} rx="2" fill="var(--color-accent)">
                  <title>{`${h.hora}h — ${h.entrada} chegam do cliente`}</title>
                </rect>
                <rect x={x0 + bw + 2} y={y(h.saida)} width={bw} height={T + alt - y(h.saida)} rx="2" fill="var(--color-orange)">
                  <title>{`${h.hora}h — ${h.saida} saem da operação`}</title>
                </rect>
                {h.hora % 2 === 0 && (
                  <text x={L + i * passo + passo / 2} y={H - 12} text-anchor="middle"
                    fill="var(--color-fg-muted)" style={{ fontSize: '10px' }}>{h.hora}h</text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </Card>
  )
}

// ── Comparativo por operador ──────────────────────────────────────────────

export interface LinhaDeOperador {
  id: number | null
  nome: string
  fila: number
  mediana: number | null
  p90: number | null
  metaPct: number | null
  semResposta: number
  amostra: number
  insuficiente: boolean
}

/**
 * Carga contra desempenho, um por linha.
 *
 * A barra de distribuição antiga dizia só quantas conversas cada um tem — e
 * quem tem a maior fila pode ser justamente quem responde mais rápido. Aqui as
 * duas coisas ficam na mesma linha, e o piso de amostra vale por pessoa: cinco
 * atendimentos não sustentam uma mediana com o nome de alguém em cima.
 */
export function TabelaDeOperadores({
  linhas, minPorDia, metaMin, onSelecionar,
}: {
  linhas: LinhaDeOperador[]
  minPorDia: number
  metaMin: number
  onSelecionar?: ((id: number | null) => void) | undefined
}) {
  if (!linhas.length) return null
  const maxFila = Math.max(...linhas.map((l) => l.fila), 1)

  return (
    <Card>
      <div class="text-sm font-semibold text-fg mb-1">Operadores</div>
      <p class="text-2xs text-fg-muted mb-3">
        Fila de agora e tempo de resposta no período · meta de {metaMin}min úteis
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-2xs uppercase tracking-wider text-fg-muted">
              <th class="text-left font-medium pb-2 pr-3">Operador</th>
              <th class="text-left font-medium pb-2 pr-3 w-[26%]">Fila agora</th>
              <th class="text-right font-medium pb-2 pr-3">Mediana</th>
              <th class="text-right font-medium pb-2 pr-3">p90</th>
              <th class="text-right font-medium pb-2 pr-3">Na meta</th>
              <th class="text-right font-medium pb-2">Sem resp.</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={String(l.id)} class="border-t border-border">
                <td class="py-2 pr-3">
                  {onSelecionar ? (
                    <button
                      type="button"
                      class="font-medium text-fg hover:text-accent hover:underline text-left"
                      onClick={() => onSelecionar(l.id)}
                      title="Filtrar a tela por este operador"
                    >
                      {l.nome}
                    </button>
                  ) : <span class="font-medium text-fg">{l.nome}</span>}
                </td>
                <td class="py-2 pr-3">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-2 rounded-sm bg-surface-3 overflow-hidden min-w-[48px]">
                      <div class="h-full bg-accent" style={{ width: `${Math.round((l.fila / maxFila) * 100)}%` }} />
                    </div>
                    <span class="tabular-nums text-fg-muted w-8 text-right">{l.fila}</span>
                  </div>
                </td>
                {l.insuficiente ? (
                  <td colSpan={4} class="py-2 text-right text-fg-muted italic">
                    amostra insuficiente ({l.amostra} no período)
                  </td>
                ) : (
                  <>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{fmtUteis(l.mediana, minPorDia)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{fmtUteis(l.p90, minPorDia)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums font-medium"
                      style={{ color: (l.metaPct ?? 0) >= 80 ? 'var(--color-success)' : 'var(--color-fg)' }}>
                      {l.metaPct === null ? '—' : `${l.metaPct}%`}
                    </td>
                    <td class="py-2 text-right tabular-nums"
                      style={{ color: l.semResposta > 0 ? 'var(--color-danger)' : 'var(--color-fg-muted)' }}>
                      {l.semResposta}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
