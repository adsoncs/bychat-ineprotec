import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Fragment, type ComponentChildren } from 'preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { PeriodPicker, PeriodIncompleteHint, usePeriod, previousRange } from '@/components/ui/PeriodPicker'
import {
  useWhatsappTrafego,
  type TipoConversa,
  type TrafegoReport,
} from '@/hooks/useWhatsappTrafego'
import { Activity, Clock, MessageSquare, Users, UserPlus, Send } from '@/components/ui/icon-set'

/**
 * Tráfego do WhatsApp (Evolution) — volumetria para decisão: quanto entra,
 * quanto sai, quando os clientes falam, quem responde, em quanto tempo e quem
 * está esperando agora. Par da tela "Disparos & Custos" (API oficial).
 *
 * Cores: recebidas = azul, enviadas = laranja — par validado para daltonismo
 * nos dois temas (skill dataviz). Texto nunca usa a cor da série.
 */

const VIZ_CSS = `
.viz-trafego { --viz-recebidas: #3987e5; --viz-enviadas: #d95926; }
:root[data-theme='light'] .viz-trafego { --viz-recebidas: #2a78d6; --viz-enviadas: #eb6834; }
`

const nf = new Intl.NumberFormat('pt-BR')
const fmt = (v: number) => nf.format(Math.round(v))
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

/** Segundos → "45 s", "12 min", "3 h 20", "2 d 4 h". */
function dur(seg: number | null | undefined): string {
  if (seg == null) return '—'
  if (seg < 60) return `${Math.round(seg)} s`
  const min = seg / 60
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  if (h < 24) { const m = Math.round(min - h * 60); return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h` }
  const d = Math.floor(h / 24)
  const rh = h - d * 24
  return rh ? `${d} d ${rh} h` : `${d} d`
}

/** Variação % contra o período anterior; sem base, não há variação a mostrar. */
function variacao(atual: number, antes: number): { value: number } | undefined {
  if (!antes) return undefined
  return { value: Math.round(((atual - antes) / antes) * 100) }
}

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

/** 5562981893454 → +55 (62) 98189-3454. Outros formatos passam como vieram. */
function telefone(t: string): string {
  const d = t.replace(/\D/g, '')
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : t
}
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function WhatsappTrafegoPage() {
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod('whatsapp-trafego')
  const ant = previousRange(range)
  const [instancia, setInstancia] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoConversa>('individual')
  const q = useWhatsappTrafego(
    { de: range.dateFrom, ate: range.dateTo, antDe: ant.dateFrom, antAte: ant.dateTo, instancia, tipo },
    !range.incomplete,
  )
  const d = q.data

  return (
    <Page
      title="Tráfego WhatsApp"
      description="Volume de mensagens enviadas e recebidas pelos números conectados (Evolution): quem fala, quando, quem responde e em quanto tempo."
      actions={
        <PeriodPicker preset={preset} customFrom={customFrom} customTo={customTo} onPreset={setPreset} onCustom={setCustom} />
      }
    >
      <style>{VIZ_CSS}</style>
      <div class="viz-trafego space-y-4">
        <PeriodIncompleteHint show={range.incomplete} />

        {/* Filtros — uma linha, acima de tudo */}
        <div class="flex flex-wrap items-center gap-2">
          <Segmento
            rotulo="Tipo de conversa"
            valor={tipo}
            opcoes={[['individual', 'Conversas individuais'], ['grupo', 'Grupos'], ['todos', 'Tudo']]}
            onChange={(v) => setTipo(v as TipoConversa)}
          />
          {d && (
            <span class="text-2xs text-fg-muted">
              Comparando com {dataCurta(d.periodo.anteriorDe)} a {dataCurta(d.periodo.anteriorAte)}
            </span>
          )}
        </div>

        {/* Números: sempre à vista — cada número tem o seu público e o seu ritmo,
            e é preciso ver juntos e cada um separado. */}
        {d && d.instancias.length > 0 && (
          <SeletorNumeros
            numeros={d.instancias}
            selecionado={instancia}
            onChange={setInstancia}
          />
        )}
        {d && instancia && (() => {
          const n = d.instancias.find((i) => i.instanceName === instancia)
          return (
            <div class="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
              <span class="text-fg-muted">Mostrando só</span>
              <strong class="text-fg">{n?.nome ?? instancia}</strong>
              {n?.telefone && <span class="text-fg-muted">{telefone(n.telefone)}</span>}
              {n && !n.cadastrado && <Badge tone="neutral">Sem cadastro</Badge>}
              {n && n.cadastrado && !n.ativo && <Badge tone="neutral">Desativado</Badge>}
              <button type="button" class="ml-auto text-xs text-accent hover:underline" onClick={() => setInstancia(null)}>Ver todos os números</button>
            </div>
          )
        })()}

        {q.isError && <Card class="text-sm text-danger">Não foi possível carregar o tráfego. {(q.error as Error)?.message}</Card>}

        <Indicadores d={d} carregando={q.isLoading || range.incomplete} tipo={tipo} />

        {d && (
          <>
            {/* Comparativo: todos os números lado a lado (só faz sentido com 2+). */}
            {!instancia && d.porInstancia.length > 1 && (
              <Comparativo linhas={d.porInstancia} dias={d.serie.map((x) => x.dia)} onAbrir={setInstancia} />
            )}

            <EsperandoAgora e={d.esperaAgora} />

            <Card>
              <Titulo dica="Mensagens por dia no período. Passe o mouse para ver o dia.">Volume diário</Titulo>
              <GraficoDiario serie={d.serie} />
            </Card>

            <div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <Titulo dica="Mensagens recebidas por dia da semana e hora (horário de Brasília). Mostra quando a equipe precisa estar disponível.">
                  Quando os clientes escrevem
                </Titulo>
                <MapaCalor celulas={d.mapaCalor} />
              </Card>
              <Card>
                <Titulo dica="Tempo entre a mensagem do cliente e a primeira resposta de uma pessoa (atendente ou celular). Horas corridas — não desconta o fora do expediente.">
                  Em quanto tempo respondemos
                </Titulo>
                <TempoResposta r={d.resposta} />
              </Card>
            </div>

            <div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <Titulo dica="Quem mandou as mensagens enviadas no período.">Quem envia</Titulo>
                <QuemEnvia c={d.composicao} />
              </Card>
              <Card>
                <Titulo dica="Situação das mensagens enviadas segundo o WhatsApp. Mensagens mandadas pelo celular podem não ter confirmação de leitura.">
                  Entrega das enviadas
                </Titulo>
                <Entrega e={d.entrega} />
              </Card>
            </div>

            {d.atendentes.length > 0 && (
              <Card class="p-0 overflow-hidden">
                <div class="p-4 pb-2"><Titulo dica="Mensagens enviadas pelo painel, por atendente. Tempo mediano até a primeira resposta nas esperas que cada um encerrou.">Por atendente</Titulo></div>
                <Tabela
                  cabecalho={['Atendente', 'Enviadas', 'Conversas', 'Esperas respondidas', 'Tempo mediano de resposta']}
                  linhas={d.atendentes.map((a) => [a.nome, fmt(a.enviadas), fmt(a.conversas), fmt(a.respondidas), dur(a.medianaSeg)])}
                />
              </Card>
            )}


            <Card class="p-0 overflow-hidden">
              <div class="p-4 pb-2"><Titulo dica="Tipo de conteúdo das mensagens.">Tipos de mensagem</Titulo></div>
              <Tabela
                cabecalho={['Tipo', 'Recebidas', 'Enviadas']}
                linhas={d.midia.map((m) => [TIPO_MIDIA[m.tipo] ?? m.tipo, fmt(m.recebidas), fmt(m.enviadas)])}
              />
            </Card>

            <p class="text-2xs text-fg-muted">
              Horário de Brasília. Notas internas não contam. Números reservados que você não acompanha ficam fora dos totais.
              Tempo de resposta em horas corridas, só em conversas individuais.
            </p>
          </>
        )}
      </div>
    </Page>
  )
}

const TIPO_MIDIA: Record<string, string> = {
  text: 'Texto', audio: 'Áudio', ptt: 'Áudio', image: 'Imagem', video: 'Vídeo', document: 'Documento',
  sticker: 'Figurinha', location: 'Localização', contact: 'Contato', reaction: 'Reação', template: 'Modelo',
}

// ── Números: seletor e comparativo ─────────────────────────────────────

function SeletorNumeros({ numeros, selecionado, onChange }: {
  numeros: TrafegoReport['instancias']
  selecionado: string | null
  onChange: (v: string | null) => void
}) {
  const chip = (ativo: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
      ativo ? 'border-accent/50 bg-accent/15 text-fg' : 'border-border text-fg-muted hover:bg-surface-3 hover:text-fg'
    }`
  return (
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Número">
      <span class="mr-1 text-2xs uppercase tracking-wider text-fg-muted">Números</span>
      <button type="button" aria-pressed={selecionado === null} class={chip(selecionado === null)} onClick={() => onChange(null)}>
        Todos os números
      </button>
      {numeros.map((n) => (
        <button
          key={n.instanceName}
          type="button"
          aria-pressed={selecionado === n.instanceName}
          class={chip(selecionado === n.instanceName)}
          onClick={() => onChange(n.instanceName)}
          title={[n.nome, n.telefone ? telefone(n.telefone) : '', !n.cadastrado ? 'sem cadastro (só histórico)' : !n.ativo ? 'desativado' : ''].filter(Boolean).join(' · ')}
        >
          <span class={`h-1.5 w-1.5 rounded-full ${n.cadastrado && n.ativo ? 'bg-success' : 'bg-fg-muted'}`} aria-hidden="true" />
          {n.nome}
          {n.telefone && <span class="text-fg-muted">{telefone(n.telefone)}</span>}
          {!n.cadastrado && <span class="text-fg-muted">(histórico)</span>}
        </button>
      ))}
    </div>
  )
}

function Comparativo({ linhas, dias, onAbrir }: {
  linhas: TrafegoReport['porInstancia']
  dias: string[]
  onAbrir: (inst: string) => void
}) {
  const total = linhas.reduce((a, l) => a + l.recebidas + l.enviadas, 0)
  const maxDia = Math.max(1, ...linhas.flatMap((l) => l.serie.map((s) => Math.max(s.recebidas, s.enviadas))))
  return (
    <Card class="p-0 overflow-hidden">
      <div class="flex flex-wrap items-end justify-between gap-2 p-4 pb-2">
        <Titulo dica="Cada número no período. Clique numa linha para ver só aquele número. Os minigráficos usam a mesma escala para dar para comparar.">
          Comparativo por número
        </Titulo>
        <Legenda itens={[['Recebidas', 'var(--viz-recebidas)'], ['Enviadas', 'var(--viz-enviadas)']]} />
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-3 text-2xs uppercase tracking-wider text-fg-muted">
            <tr>
              <th class="px-4 py-2 text-left font-medium">Número</th>
              <th class="px-3 py-2 text-left font-medium">Por dia</th>
              <th class="px-3 py-2 text-right font-medium">Recebidas</th>
              <th class="px-3 py-2 text-right font-medium">Enviadas</th>
              <th class="px-3 py-2 text-right font-medium">Do tráfego</th>
              <th class="px-3 py-2 text-right font-medium">Conversas</th>
              <th class="px-3 py-2 text-right font-medium">Contatos novos</th>
              <th class="px-3 py-2 text-right font-medium">Respondidas por pessoa</th>
              <th class="px-3 py-2 text-right font-medium">Tempo mediano</th>
              <th class="px-4 py-2 text-right font-medium">Esperando agora</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {linhas.map((l) => {
              const abrir = l.instanceName ? () => onAbrir(l.instanceName!) : undefined
              return (
                <tr
                  key={l.instanceName ?? '—'}
                  class={abrir ? 'cursor-pointer hover:bg-surface-3' : ''}
                  onClick={abrir}
                  tabIndex={abrir ? 0 : undefined}
                  onKeyDown={(e) => { if (abrir && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir() } }}
                >
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap items-center gap-1.5 text-fg">
                      {l.nome}
                      {!l.cadastrado && l.instanceName && <Badge tone="neutral">Sem cadastro</Badge>}
                      {l.cadastrado && l.ativo === false && <Badge tone="neutral">Desativado</Badge>}
                    </div>
                    {l.telefone && <div class="text-2xs text-fg-muted">{telefone(l.telefone)}</div>}
                  </td>
                  <td class="px-3 py-2"><MiniSerie serie={l.serie} max={maxDia} dias={dias} /></td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{fmt(l.recebidas)}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{fmt(l.enviadas)}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{pct(l.recebidas + l.enviadas, total)}%</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{fmt(l.conversas)}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{fmt(l.novos)}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{l.esperas ? `${pct(l.respondidas, l.esperas)}%` : '—'}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{dur(l.medianaSeg)}</td>
                  <td class={`px-4 py-2 text-right tabular-nums ${l.esperandoAgora ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                    {l.esperandoAgora ? `⚠ ${fmt(l.esperandoAgora)}` : '0'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Minigráfico de um número: recebidas e enviadas por dia, na escala comum a todos. */
function MiniSerie({ serie, max, dias }: { serie: Array<{ recebidas: number; enviadas: number }>; max: number; dias: string[] }) {
  const W = 120, H = 28
  if (!serie.length) return null
  const x = (i: number) => (serie.length <= 1 ? W / 2 : (i / (serie.length - 1)) * W)
  const y = (v: number) => H - 2 - (v / max) * (H - 4)
  const linha = (k: 'recebidas' | 'enviadas') => serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ')
  const pico = serie.reduce((a, s, i) => (s.recebidas + s.enviadas > a.v ? { v: s.recebidas + s.enviadas, i } : a), { v: -1, i: 0 })
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} class="block" role="img"
      aria-label={`Pico em ${dias[pico.i] ? dataCurta(dias[pico.i]!) : '—'} com ${fmt(pico.v)} mensagens`}>
      <title>{`Pico em ${dias[pico.i] ? dataCurta(dias[pico.i]!) : '—'}: ${fmt(pico.v)} mensagens`}</title>
      <path d={linha('recebidas')} fill="none" stroke="var(--viz-recebidas)" stroke-width="1.5" stroke-linejoin="round" />
      <path d={linha('enviadas')} fill="none" stroke="var(--viz-enviadas)" stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  )
}

// ── Indicadores ────────────────────────────────────────────────────────

function Indicadores({ d, carregando, tipo }: { d: TrafegoReport | undefined; carregando: boolean; tipo: TipoConversa }) {
  const t = d?.totais
  const a = d?.anterior
  const r = d?.resposta
  const serie = d?.serie ?? []
  const taxa = r && r.esperas ? pct(r.respondidasPorPessoa, r.esperas) : null
  return (
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="Recebidas" icon={<MessageSquare size={16} />} tone="info" loading={carregando}
        value={t ? fmt(t.recebidas) : '—'} trend={t && a ? variacao(t.recebidas, a.recebidas) : undefined}
        sparkline={serie.map((s) => s.recebidas)} sparklineColor="var(--viz-recebidas)"
      />
      <KpiCard
        label="Enviadas" icon={<Send size={16} />} tone="orange" loading={carregando}
        value={t ? fmt(t.enviadas) : '—'} trend={t && a ? variacao(t.enviadas, a.enviadas) : undefined}
        sparkline={serie.map((s) => s.enviadas)} sparklineColor="var(--viz-enviadas)"
      />
      <KpiCard
        label="Conversas ativas" icon={<Users size={16} />} tone="accent" loading={carregando}
        value={t ? fmt(t.conversas) : '—'} trend={t && a ? variacao(t.conversas, a.conversas) : undefined}
        hint="Contatos ou grupos com ao menos uma mensagem"
      />
      <KpiCard
        label="Contatos novos" icon={<UserPlus size={16} />} tone="success" loading={carregando}
        value={d ? fmt(d.novos.total) : '—'} trend={d ? variacao(d.novos.total, d.novos.anterior) : undefined}
        hint={d ? `${fmt(d.novos.chegaram)} chegaram · ${fmt(d.novos.abordados)} abordados por nós` : undefined}
      />
      <KpiCard
        label="Respondidas por pessoa" icon={<Activity size={16} />} tone="violet" loading={carregando}
        value={tipo === 'grupo' ? '—' : taxa == null ? '—' : `${taxa}%`}
        hint={tipo === 'grupo' ? 'Não se aplica a grupos' : r ? `${fmt(r.respondidasPorPessoa)} de ${fmt(r.esperas)} esperas` : undefined}
      />
      <KpiCard
        label="Tempo mediano de resposta" icon={<Clock size={16} />} tone="warning" loading={carregando}
        value={tipo === 'grupo' ? '—' : dur(r?.medianaSeg)}
        hint={tipo === 'grupo' ? 'Não se aplica a grupos' : r?.p90Seg != null ? `9 em cada 10 em até ${dur(r.p90Seg)}` : undefined}
      />
    </div>
  )
}

function EsperandoAgora({ e }: { e: TrafegoReport['esperaAgora'] }) {
  const faixas: Array<[string, number]> = [['até 1 h', e.ate1h], ['1 a 4 h', e.ate4h], ['4 a 24 h', e.ate24h], ['mais de 24 h', e.mais24h]]
  return (
    <Card class={e.total ? 'border border-warning/40' : ''}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-2xs uppercase tracking-wider text-fg-muted">Esperando resposta agora</div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-2xl font-semibold text-fg tabular-nums">{fmt(e.total)}</span>
            <span class="text-sm text-fg-muted">
              {e.total ? `conversas com a última mensagem do cliente · a mais antiga há ${dur(e.maisAntigaMin * 60)}` : 'nenhum cliente esperando'}
            </span>
          </div>
        </div>
        {e.total > 0 && (
          <div class="flex flex-wrap gap-2">
            {faixas.map(([rotulo, v]) => (
              <span key={rotulo} class="rounded-md bg-surface-3 px-2.5 py-1 text-xs text-fg">
                <strong class="tabular-nums">{fmt(v)}</strong> <span class="text-fg-muted">{rotulo}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <p class="mt-2 text-2xs text-fg-muted">Conversas individuais com mensagem nos últimos 7 dias e não encerradas. Não depende do período escolhido.</p>
    </Card>
  )
}

// ── Gráfico diário: duas linhas, uma escala, cruz + dica ────────────────

function GraficoDiario({ serie }: { serie: TrafegoReport['serie'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [tabela, setTabela] = useState(false)
  // Uma unidade do desenho = 1 px na tela: altura fixa e texto sempre do mesmo
  // tamanho, do celular ao monitor largo (escalar o viewBox achatava o gráfico
  // no celular e o esticava no monitor).
  const caixa = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const medir = () => setW(Math.max(280, Math.round(el.clientWidth)))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 240, pl = 40, pr = 76, pt = 14, pb = 28
  const geo = useMemo(() => {
    const max = Math.max(1, ...serie.map((s) => Math.max(s.recebidas, s.enviadas)))
    const passo = Math.pow(10, Math.floor(Math.log10(max)))
    const topo = Math.ceil(max / passo) * passo
    const w = W - pl - pr, h = H - pt - pb
    const x = (i: number) => pl + (serie.length <= 1 ? w / 2 : (i / (serie.length - 1)) * w)
    const y = (v: number) => pt + h - (v / topo) * h
    const linha = (k: 'recebidas' | 'enviadas') => serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ')
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(topo * f))
    return { x, y, linha, ticks, w, h }
  }, [serie, W])
  const total = serie.reduce((a, s) => a + s.recebidas + s.enviadas, 0)
  if (!total) return <div class="py-10 text-center text-sm text-fg-muted">Sem mensagens no período.</div>
  // Quantos rótulos de data cabem sem encostar (~56 px cada).
  const cabem = Math.max(2, Math.min(serie.length, Math.floor((W - pl - pr) / 56)))
  const rotulosX = serie.length <= cabem
    ? serie.map((_, i) => i)
    : Array.from({ length: cabem }, (_, k) => Math.round((k / (cabem - 1)) * (serie.length - 1)))
  const ult = serie.length - 1
  const sel = hover != null ? serie[hover] : null
  // Rótulos no fim das linhas: quando os pontos finais estão próximos, abre
  // espaço entre eles (o maior em cima) sem sair da área do gráfico.
  const rotulosFim = (() => {
    const yR = geo.y(serie[ult]!.recebidas), yE = geo.y(serie[ult]!.enviadas)
    const itens = [{ texto: 'Recebidas', y: yR }, { texto: 'Enviadas', y: yE }].sort((a, b) => a.y - b.y)
    if (itens[1]!.y - itens[0]!.y < 14) {
      const meio = Math.min(H - pb - 9, Math.max(pt + 7, (itens[0]!.y + itens[1]!.y) / 2))
      itens[0]!.y = meio - 7; itens[1]!.y = meio + 7
    }
    return itens
  })()

  return (
    <div>
      <div class="mb-2 flex items-center justify-between gap-2">
        <Legenda itens={[['Recebidas', 'var(--viz-recebidas)'], ['Enviadas', 'var(--viz-enviadas)']]} />
        <button type="button" class="text-2xs text-accent hover:underline" onClick={() => setTabela(!tabela)}>
          {tabela ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>
      {tabela ? (
        <div class="max-h-80 overflow-auto rounded-md border border-border">
          <Tabela
            cabecalho={['Dia', 'Recebidas', 'Enviadas', 'Conversas', 'Contatos novos']}
            linhas={serie.map((s) => [dataCurta(s.dia), fmt(s.recebidas), fmt(s.enviadas), fmt(s.conversas), fmt(s.novos)])}
          />
        </div>
      ) : (
        <div class="relative" ref={caixa}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            class="block max-w-full"
            role="img"
            aria-label="Mensagens recebidas e enviadas por dia"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const px = ((e.clientX - box.left) / box.width) * W
              const i = serie.length <= 1 ? 0 : Math.round(((px - pl) / geo.w) * (serie.length - 1))
              setHover(Math.max(0, Math.min(ult, i)))
            }}
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={pl} x2={W - pr} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--color-border)" stroke-width="1" />
                <text x={pl - 6} y={geo.y(t) + 4} text-anchor="end" font-size="11" fill="var(--color-fg-muted)">{fmt(t)}</text>
              </g>
            ))}
            {rotulosX.map((i) => (
              <text key={i} x={geo.x(i)} y={H - 8} text-anchor={i === ult && serie.length > 1 ? 'end' : i === 0 && serie.length > 1 ? 'start' : 'middle'} font-size="11" fill="var(--color-fg-muted)">{dataCurta(serie[i]!.dia)}</text>
            ))}
            <path d={geo.linha('recebidas')} fill="none" stroke="var(--viz-recebidas)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            <path d={geo.linha('enviadas')} fill="none" stroke="var(--viz-enviadas)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            {/* Rótulo direto no fim de cada linha */}
            {rotulosFim.map((r) => (
              <text key={r.texto} x={geo.x(ult) + 8} y={r.y + 4} font-size="11" fill="var(--color-fg)">{r.texto}</text>
            ))}
            {hover != null && (
              <g>
                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pt} y2={H - pb} stroke="var(--color-border-strong)" stroke-width="1" />
                <circle cx={geo.x(hover)} cy={geo.y(serie[hover]!.recebidas)} r="4" fill="var(--viz-recebidas)" stroke="var(--color-surface-2)" stroke-width="2" />
                <circle cx={geo.x(hover)} cy={geo.y(serie[hover]!.enviadas)} r="4" fill="var(--viz-enviadas)" stroke="var(--color-surface-2)" stroke-width="2" />
              </g>
            )}
          </svg>
          {sel && hover != null && (
            <div
              class="pointer-events-none absolute top-2 z-10 whitespace-nowrap rounded-md border border-border bg-surface-3 px-3 py-2 text-xs shadow-lg"
              // Ao lado do cursor, para não cobrir os pontos; vira para a
              // esquerda na metade direita do gráfico.
              style={geo.x(hover) > W / 2
                ? { right: `${W - geo.x(hover) + 12}px` }
                : { left: `${geo.x(hover) + 12}px` }}
            >
              <div class="mb-1 font-medium text-fg">{dataCurta(sel.dia)} · {DIAS[(new Date(`${sel.dia}T12:00:00Z`).getUTCDay() + 6) % 7]}</div>
              <LinhaDica cor="var(--viz-recebidas)" rotulo="Recebidas" valor={sel.recebidas} />
              <LinhaDica cor="var(--viz-enviadas)" rotulo="Enviadas" valor={sel.enviadas} />
              <div class="mt-1 text-fg-muted">{fmt(sel.conversas)} conversas · {fmt(sel.novos)} novos</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinhaDica({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: number }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <span class="flex items-center gap-1.5 text-fg-muted"><span class="inline-block h-2 w-2 rounded-full" style={{ background: cor }} />{rotulo}</span>
      <span class="tabular-nums text-fg">{fmt(valor)}</span>
    </div>
  )
}

function Legenda({ itens }: { itens: Array<[string, string]> }) {
  return (
    <div class="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
      {itens.map(([r, c]) => (
        <span key={r} class="flex items-center gap-1.5"><span class="inline-block h-0.5 w-4 rounded" style={{ background: c }} />{r}</span>
      ))}
    </div>
  )
}

// ── Mapa de calor: dia da semana × hora ────────────────────────────────

function MapaCalor({ celulas }: { celulas: TrafegoReport['mapaCalor'] }) {
  const [hover, setHover] = useState<{ dow: number; hora: number; qtd: number } | null>(null)
  const grade = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
    for (const c of celulas) g[c.dow]![c.hora] = c.qtd
    return g
  }, [celulas])
  const max = Math.max(0, ...celulas.map((c) => c.qtd))
  if (!max) return <div class="py-10 text-center text-sm text-fg-muted">Nenhuma mensagem recebida no período.</div>
  // Pico: o que o dono quer saber de cara.
  const pico = celulas.reduce((a, c) => (c.qtd > a.qtd ? c : a), celulas[0]!)
  const porHora = Array.from({ length: 24 }, (_, h) => grade.reduce((a, l) => a + l[h]!, 0))
  const total = porHora.reduce((a, b) => a + b, 0)
  const comercial = porHora.slice(8, 18).reduce((a, b) => a + b, 0)

  return (
    <div>
      <div class="overflow-x-auto">
        <div class="min-w-[520px]">
          <div class="grid gap-[2px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} class="text-center text-[10px] text-fg-muted">{h % 3 === 0 ? h : ''}</span>
            ))}
            {grade.map((linha, dow) => (
              <Fragment key={dow}>
                <span class="pr-1 text-right text-[11px] leading-[18px] text-fg-muted">{DIAS[dow]}</span>
                {linha.map((qtd, hora) => (
                  <span
                    key={`${dow}-${hora}`}
                    class="h-[18px] rounded-[3px]"
                    style={{
                      background: qtd ? 'var(--viz-recebidas)' : 'var(--color-surface-3)',
                      opacity: qtd ? 0.15 + 0.85 * (qtd / max) : 1,
                      outline: hover && hover.dow === dow && hover.hora === hora ? '2px solid var(--color-fg)' : 'none',
                    }}
                    onMouseEnter={() => setHover({ dow, hora, qtd })}
                    onMouseLeave={() => setHover(null)}
                    aria-label={`${DIAS[dow]} ${hora}h: ${qtd} mensagens`}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          {hover
            ? <><strong class="text-fg">{DIAS[hover.dow]} {hover.hora}h–{hover.hora + 1}h</strong>: {fmt(hover.qtd)} mensagens</>
            : <>Pico: <strong class="text-fg">{DIAS[pico.dow]} {pico.hora}h–{pico.hora + 1}h</strong> ({fmt(pico.qtd)})</>}
        </span>
        <span>{pct(total - comercial, total)}% chegam fora das 8h–18h</span>
      </div>
      <div class="mt-2 flex items-center gap-2 text-[10px] text-fg-muted">
        menos
        <span class="h-2 w-24 rounded" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--viz-recebidas) 15%, transparent), var(--viz-recebidas))' }} />
        mais
      </div>
    </div>
  )
}

// ── Tempo de resposta ──────────────────────────────────────────────────

function TempoResposta({ r }: { r: TrafegoReport['resposta'] }) {
  if (!r.aplica) return <div class="py-10 text-center text-sm text-fg-muted">Tempo de resposta não se aplica a grupos.</div>
  if (!r.esperas) return <div class="py-10 text-center text-sm text-fg-muted">Nenhum cliente escreveu no período.</div>
  const linhas: Array<[string, number]> = [
    ['até 5 min', r.faixas.ate5min],
    ['5 a 15 min', r.faixas.ate15min],
    ['15 min a 1 h', r.faixas.ate1h],
    ['1 a 4 h', r.faixas.ate4h],
    ['4 a 24 h', r.faixas.ate24h],
    ['mais de 24 h', r.faixas.mais24h],
    ['só robô respondeu', r.soRobo],
    ['sem resposta', r.semResposta],
  ]
  return (
    <div>
      <div class="mb-3 grid grid-cols-3 gap-2 text-center">
        <Mini rotulo="Mediana" valor={dur(r.medianaSeg)} />
        <Mini rotulo="9 em cada 10 até" valor={dur(r.p90Seg)} />
        <Mini rotulo="Em até 15 min" valor={`${pct(r.faixas.ate5min + r.faixas.ate15min, r.esperas)}%`} />
      </div>
      <Barras linhas={linhas} total={r.esperas} cor="var(--viz-recebidas)" unidade="esperas" />
    </div>
  )
}

function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div class="rounded-md bg-surface-3 px-2 py-2">
      <div class="text-base font-semibold tabular-nums text-fg">{valor}</div>
      <div class="text-2xs text-fg-muted">{rotulo}</div>
    </div>
  )
}

function QuemEnvia({ c }: { c: TrafegoReport['composicao'] }) {
  const linhas: Array<[string, number]> = [
    ['Atendentes (painel)', c.atendente],
    ['Equipe pelo celular', c.celular],
    ['Robôs e IA', c.robo],
    ['Automações (fluxos, avisos)', c.automacao],
    ['Sem identificação', c.nao_identificado],
  ]
  const total = linhas.reduce((a, [, v]) => a + v, 0)
  if (!total) return <div class="py-10 text-center text-sm text-fg-muted">Nada enviado no período.</div>
  const humano = c.atendente + c.celular
  return (
    <div>
      <p class="mb-3 text-sm text-fg">
        <strong class="tabular-nums">{pct(humano, total)}%</strong> <span class="text-fg-muted">das mensagens enviadas foram escritas por pessoas.</span>
      </p>
      <Barras linhas={linhas} total={total} cor="var(--viz-enviadas)" unidade="mensagens" />
    </div>
  )
}

function Entrega({ e }: { e: TrafegoReport['entrega'] }) {
  const linhas: Array<[string, number]> = [
    ['Lidas', e.lida ?? 0],
    ['Entregues (não lidas)', e.entregue ?? 0],
    ['Enviadas ao servidor', e.enviada ?? 0],
    ['Pendentes', e.pendente ?? 0],
    ['Falharam', e.falha ?? 0],
  ]
  const total = linhas.reduce((a, [, v]) => a + v, 0)
  if (!total) return <div class="py-10 text-center text-sm text-fg-muted">Nada enviado no período.</div>
  return (
    <div>
      <div class="mb-3 grid grid-cols-3 gap-2 text-center">
        <Mini rotulo="Lidas" valor={`${pct(e.lida ?? 0, total)}%`} />
        <Mini rotulo="Chegaram ao cliente" valor={`${pct((e.lida ?? 0) + (e.entregue ?? 0), total)}%`} />
        <Mini rotulo="Falharam" valor={fmt(e.falha ?? 0)} />
      </div>
      <Barras linhas={linhas} total={total} cor="var(--viz-enviadas)" unidade="mensagens" />
      {(e.falha ?? 0) > 0 && (
        <p class="mt-2 flex items-center gap-1.5 text-xs text-danger">⚠ {fmt(e.falha ?? 0)} mensagens não chegaram — confira a conexão dos números.</p>
      )}
    </div>
  )
}

/** Barras horizontais com rótulo e valor à direita (texto em tinta de texto, não na cor da barra). */
function Barras({ linhas, total, cor, unidade }: { linhas: Array<[string, number]>; total: number; cor: string; unidade: string }) {
  const max = Math.max(1, ...linhas.map(([, v]) => v))
  return (
    <div class="space-y-1.5">
      {linhas.map(([rotulo, v]) => (
        <div key={rotulo} class="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs" title={`${rotulo}: ${fmt(v)} ${unidade}`}>
          <span class="truncate text-fg-muted">{rotulo}</span>
          <span class="h-2.5 rounded-sm bg-surface-3">
            <span class="block h-2.5 rounded-sm" style={{ width: `${v ? Math.max(1.5, (v / max) * 100) : 0}%`, background: cor }} />
          </span>
          <span class="w-24 text-right tabular-nums text-fg">{fmt(v)} <span class="text-fg-muted">· {pct(v, total)}%</span></span>
        </div>
      ))}
    </div>
  )
}

// ── Peças de layout ────────────────────────────────────────────────────

function Titulo({ children, dica }: { children: ComponentChildren; dica?: string }) {
  return (
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-fg">{children}</h3>
      {dica && <p class="text-2xs text-fg-muted">{dica}</p>}
    </div>
  )
}

function Segmento({ rotulo, valor, opcoes, onChange }: { rotulo: string; valor: string; opcoes: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div class="flex items-center gap-1 rounded-md bg-surface-3 p-0.5" role="group" aria-label={rotulo}>
      {opcoes.map(([v, r]) => (
        <button
          key={v}
          type="button"
          aria-pressed={valor === v}
          class={`rounded px-2.5 py-1 text-xs transition-colors ${valor === v ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => onChange(v)}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: Array<Array<ComponentChildren>> }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-2xs uppercase tracking-wider text-fg-muted">
          <tr>{cabecalho.map((c, i) => <th key={i} class={`px-4 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr>
        </thead>
        <tbody class="divide-y divide-border">
          {linhas.map((l, i) => (
            <tr key={i} class="hover:bg-surface-3">
              {l.map((c, j) => <td key={j} class={`px-4 py-2 ${j ? 'text-right tabular-nums text-fg' : 'text-left text-fg'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
