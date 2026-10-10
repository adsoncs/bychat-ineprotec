// Volumetria — painel do DONO do produto (o superadmin do cliente não entra:
// a API responde 404). Mostra quanto cada canal e integração movimentou no mês
// e, onde existe, o custo real. O preço cobrado do cliente (plano, franquia,
// excedente) é definido na loja central, que empurra a cobrança calculada para
// cá — cada aba mostra o valor cobrado do seu item.
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { api } from '@/lib/apiClient'

interface PorNumero { numero: string; enviadas: number; recebidas: number; leadsUnicos?: number }
interface Midias { canal: string; quantidade: number; bytes: number; externas: number; porTipo: Array<{ tipo: string; quantidade: number; bytes: number }> }

interface LinhaDoPlano {
  codigo: string; nome: string; unidade: string; origem: 'cliente' | 'padrao'
  cobrar: boolean; modo: string; franquia: number | null; precoUnitario: number | null; margemPct: number | null
}
interface ItemCobrado { codigo: string; descricao: string; quantidade: number; unidade: string; custoRealCentavos: number; valorCentavos: number }
interface Cobranca {
  competencia: string; situacao: string | null; parcial: boolean; calculadoEm: string | null; recebidoEm?: string
  impostoPct: number | null; subtotalCentavos: number; impostosCentavos: number; totalCentavos: number
  vencimento: string | null; linkPagamento: string | null
  plano: LinhaDoPlano[]; itens: ItemCobrado[]
}

interface Volumetria {
  competencia: string
  ia: {
    medindoDesde: string | null; chamadas: number; custoUsd: number
    porModelo: Array<{ provedor: string; modelo: string; chamadas: number; entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number; custoUsd: number; semPreco: boolean }>
    porFuncionalidade: Array<{ funcionalidade: string; chamadas: number; tokens: number; custoUsd: number }>
    porDia: Array<{ dia: string; chamadas: number; custoUsd: number }>
  }
  whatsappCloud: {
    enviadas: number; recebidas: number; leadsUnicos?: number; pagoPor: 'cliente'; custoEstimadoUsd: number
    porCategoria: Array<{ categoria: string; enviadas: number; cobraveis: number; custoEstimadoUsd: number }>
    porNumero: PorNumero[]
  }
  evolution: { enviadas: number; recebidas: number; leadsUnicos?: number; porNumero: PorNumero[] }
  outrosCanais: Array<{ canal: string; enviadas: number; recebidas: number; leadsUnicos?: number }>
  sms: { pelaFila: number; falhas: number; porAtividade: number }
  email: { pelaFila: number; falhas: number; atividadesEnviadas: number; atividadesRecebidas: number }
  voz: Array<{ provedor: string; direcao: string; chamadas: number; minutos: number }>
  assinaturas: Array<{ provedor: string; envelopes: number }>
  reunioes: { gravacoes: number }
  sei: { chamadas: number; falhas: number }
  armazenamento: { bytes: number | null }
  midias?: { doMes: Midias[]; acumulado: Midias[] }
  leads?: { total: number; novos: number; unicos: number; unicosPorCanal: Array<{ canal: string; leads: number }> }
  base: { usuariosAtivos: number; leadsNovos: number; leadsTotal?: number }
  cobranca: Cobranca | null
}

const FUNCIONALIDADES: Record<string, string> = {
  chatbot: 'Chatbot (IA)', chatbot_extracao: 'Chatbot — extração de dados', chatbot_pos_jornada: 'Chatbot — após o roteiro',
  jornada_ia: 'Atendimento IA (jornada)', jornada_interpretacao: 'Jornada — interpretação de resposta',
  chat_site: 'Chat do site', helpdesk: 'Helpdesk', diagnostico: 'Diagnóstico', analise_sentimento: 'Análise de sentimento',
  deteccao_venda: 'Detecção de venda', cadencia_classificacao: 'Cadência — classificação de resposta',
  cadencia_gerador: 'Cadência — gerador', sugestao_abordagem: 'Sugestões de abordagem', lead_score: 'Lead score',
  correcao_redacao: 'Correção de redação', tema_redacao: 'Tema de redação', revisao_documento: 'Revisão de documento',
  auditoria_conversa: 'Auditoria de conversa', sugestao_etapa: 'Sugestão de etapa do funil',
  analise_reuniao: 'Análise de reunião', relatorio_reunioes: 'Relatório de reuniões',
}
const CATEGORIAS: Record<string, string> = {
  marketing: 'Marketing', utility: 'Utilidade', authentication: 'Autenticação', service: 'Serviço (resposta)',
  referral_conversion: 'Conversão de anúncio', sem_categoria: 'Sem categoria (ainda sem retorno da Meta)',
}
const CANAIS: Record<string, string> = {
  evolution: 'WhatsApp Evolution', cloud_api: 'WhatsApp Cloud', instagram: 'Instagram', messenger: 'Messenger',
  telegram: 'Telegram', portal_chat: 'Chat do portal',
}
const TIPOS_MIDIA: Record<string, string> = {
  image: 'Imagens', audio: 'Áudios', video: 'Vídeos', document: 'Documentos', sticker: 'Figurinhas', gif: 'GIFs', contact: 'Contatos',
}
const SITUACOES: Record<string, [string, 'neutral' | 'info' | 'warning' | 'success' | 'danger']> = {
  rascunho: ['prévia', 'info'], aprovado: ['aprovado', 'warning'], cobrado: ['cobrado', 'warning'], pago: ['pago', 'success'], cancelado: ['cancelado', 'neutral'],
}

const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const centavos = (c: number) => brl(c / 100)
const preco = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
const mesAtual = () => { const d = new Date(Date.now() - 3 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
function bytes(b: number | null | undefined) {
  if (b == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${u[i]}`
}
const somaMidias = (l: Midias[] | undefined, canal?: string) => (l ?? []).filter((m) => !canal || m.canal === canal)
  .reduce((s, m) => ({ quantidade: s.quantidade + m.quantidade, bytes: s.bytes + m.bytes }), { quantidade: 0, bytes: 0 })

const CHAVE_CAMBIO = 'volumetria:cambio'
function cambioSalvo(): number {
  try { const v = Number(localStorage.getItem(CHAVE_CAMBIO)); if (v > 0) return v } catch {}
  return 5.5
}

type Aba = 'geral' | 'ia' | 'cloud' | 'evolution' | 'outros' | 'sms' | 'email' | 'voz' | 'assinaturas' | 'integracoes' | 'leads' | 'armazenamento' | 'base'
const ABAS: Array<[Aba, string]> = [
  ['geral', 'Visão geral'], ['ia', 'IA'], ['cloud', 'WhatsApp Cloud'], ['evolution', 'WhatsApp Evolution'],
  ['outros', 'Instagram e outros'], ['sms', 'SMS'], ['email', 'E-mail'], ['voz', 'Voz'],
  ['assinaturas', 'Assinaturas eletrônicas'], ['integracoes', 'Integrações'], ['leads', 'Leads'],
  ['armazenamento', 'Armazenamento'], ['base', 'Usuários'],
]
/** Que itens da cobrança (catálogo da loja) cada aba mostra. */
const ITENS_DA_ABA: Partial<Record<Aba, string[]>> = {
  ia: ['ia'],
  cloud: ['wa_cloud_marketing', 'wa_cloud_utility', 'wa_cloud_authentication', 'wa_cloud_mensagens'],
  evolution: ['wa_evolution_numeros', 'wa_evolution_mensagens'],
  outros: ['canais_meta'], sms: ['sms'], email: ['email'], voz: ['voz_minutos'],
  assinaturas: ['assinaturas'], integracoes: ['reunioes'],
  leads: ['leads_total', 'leads_unicos'], armazenamento: ['armazenamento_gb'], base: ['usuarios_ativos'],
}
const CHAVE_ABA = 'volumetria:aba'
function abaSalva(): Aba {
  try { const v = localStorage.getItem(CHAVE_ABA); if (ABAS.some(([id]) => id === v)) return v as Aba } catch {}
  return 'geral'
}

function Resumo({ titulo, valor, sub, onClick }: { titulo: string; valor: string; sub?: string; onClick?: () => void }) {
  const corpo = (
    <>
      <div class="text-xs text-fg-muted">{titulo}</div>
      <div class="mt-1 text-xl font-semibold tabular-nums">{valor}</div>
      {sub && <div class="mt-0.5 text-xs text-fg-muted">{sub}</div>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} class="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Card class="p-4 h-full hover:border-accent/60 transition-colors">{corpo}</Card>
      </button>
    )
  }
  return <Card class="p-4">{corpo}</Card>
}

function Tabela({ cab, linhas, vazio }: { cab: string[]; linhas: Array<Array<string | number | preact.JSX.Element>>; vazio: string }) {
  if (!linhas.length) return <div class="text-sm text-fg-muted py-2">{vazio}</div>
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-fg-muted border-b border-border">{cab.map((c, i) => <th key={c} class={i ? 'py-2 pl-3 text-right font-medium' : 'py-2 font-medium'}>{c}</th>)}</tr></thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} class="border-b border-border/50">
              {l.map((c, j) => <td key={j} class={j ? 'py-2 pl-3 text-right tabular-nums whitespace-nowrap' : 'py-2'}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Secao({ titulo, nota, children }: { titulo: string; nota?: string; children: preact.ComponentChildren }) {
  return (
    <Card class="p-4 space-y-3">
      <div>
        <h2 class="text-sm font-semibold">{titulo}</h2>
        {nota && <p class="text-xs text-fg-muted mt-0.5">{nota}</p>}
      </div>
      {children}
    </Card>
  )
}

function Grade({ children }: { children: preact.ComponentChildren }) {
  return <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">{children}</section>
}

function quandoCalculou(c: Cobranca) {
  const em = c.calculadoEm ? new Date(c.calculadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null
  return em ? `Calculado pela loja em ${em}${c.parcial ? ' — mês em andamento, o valor ainda muda' : ''}.` : 'A loja ainda não calculou este mês.'
}

/** Como o plano cobra o item, em uma frase. */
function regraEmTexto(p: LinhaDoPlano): string {
  if (!p.cobrar) return 'Não cobrado'
  if (p.modo === 'margem') return `Custo real + ${n(p.margemPct ?? 0)}% de adicional`
  if (p.modo === 'repasse') return 'Custo real (sem adicional)'
  if (p.modo === 'franquia') return `${n(p.franquia ?? 0)} ${p.unidade} incluídos · excedente ${preco(p.precoUnitario ?? 0)} por ${p.unidade}`
  if (p.modo === 'preco_fixo') return `${preco(p.precoUnitario ?? 0)} por ${p.unidade}`
  if (p.modo === 'faixas') return 'Faixas de volume'
  if (p.modo === 'pacote') return 'Pacote mensal fixo'
  return p.modo
}

/** O "valor cobrado" de uma aba: plano de cada item, uso, excedente e valor. */
function ValorCobrado({ cobranca, codigos }: { cobranca: Cobranca | null; codigos: string[] }) {
  if (!cobranca) {
    return (
      <Secao titulo="Valor cobrado" nota="A loja central ainda não enviou o plano e a cobrança deste mês para esta instalação.">
        <div class="text-sm text-fg-muted">Configure o plano em Preços de consumo, na loja. O mês é recalculado a cada 6 horas.</div>
      </Secao>
    )
  }
  const linhas = codigos.map((c) => ({ plano: cobranca.plano.find((p) => p.codigo === c), item: cobranca.itens.find((i) => i.codigo === c) }))
    .filter((l) => l.plano)
  const total = linhas.reduce((s, l) => s + (l.item?.valorCentavos ?? 0), 0)
  return (
    <Secao titulo="Valor cobrado" nota={quandoCalculou(cobranca)}>
      <Tabela cab={['Item', 'Plano', 'Usado', 'Excedente', 'Valor']} vazio="—"
        linhas={linhas.map(({ plano: p, item: i }) => {
          const usado = i?.quantidade ?? 0
          const excedente = p!.cobrar && p!.modo === 'franquia' ? Math.max(0, usado - (p!.franquia ?? 0)) : null
          return [
            <span key={p!.codigo}>{p!.nome}{p!.origem === 'cliente' && <> <Badge tone="info" title="Regra só deste cliente (exceção ao padrão)">deste cliente</Badge></>}</span>,
            <span key="r" class="text-xs">{regraEmTexto(p!)}</span>,
            `${n(usado)} ${p!.unidade}`,
            excedente == null ? '—' : <span key="e" class={excedente > 0 ? 'text-warning font-medium' : ''}>{n(excedente)}</span>,
            p!.cobrar ? <span key="v" class="font-medium">{centavos(i?.valorCentavos ?? 0)}{p!.codigo === 'ia' && i ? <span class="block text-xs text-fg-muted font-normal">custo real {centavos(i.custoRealCentavos)}</span> : null}</span> : <span key="v" class="text-fg-muted">—</span>,
          ]
        })} />
      {linhas.length > 1 && <div class="text-right text-sm">Total desta aba: <strong class="tabular-nums">{centavos(total)}</strong> <span class="text-xs text-fg-muted">(sem impostos)</span></div>}
    </Secao>
  )
}

/** Fatura de consumo do mês — o que o cliente recebe (só quantidade e valor). */
function Fatura({ cobranca }: { cobranca: Cobranca | null }) {
  if (!cobranca) return <ValorCobrado cobranca={null} codigos={[]} />
  const [rot, tom] = SITUACOES[cobranca.situacao ?? ''] ?? ['sem cálculo', 'neutral']
  const itens = cobranca.itens.filter((i) => i.valorCentavos > 0)
  return (
    <Card class="p-4 space-y-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold">Fatura de consumo do mês</h2>
          <p class="text-xs text-fg-muted mt-0.5">{quandoCalculou(cobranca)} Cobrada separada da mensalidade; o cliente vê só a fatura final.</p>
        </div>
        <Badge tone={tom}>{rot}</Badge>
      </div>
      <Tabela cab={['Item', 'Quantidade', 'Valor']} vazio="Nada a cobrar até agora — tudo dentro do plano ou sem cobrança."
        linhas={itens.map((i) => [i.descricao, `${n(i.quantidade)} ${i.unidade}`, centavos(i.valorCentavos)])} />
      <div class="flex flex-col items-end gap-0.5 text-sm tabular-nums">
        <div>Subtotal {centavos(cobranca.subtotalCentavos)}</div>
        {cobranca.impostosCentavos > 0 && <div class="text-fg-muted">Impostos ({n(cobranca.impostoPct ?? 0)}%) {centavos(cobranca.impostosCentavos)}</div>}
        <div class="text-base font-semibold">Total {centavos(cobranca.totalCentavos)}</div>
        {cobranca.linkPagamento && <a class="text-xs text-accent hover:underline" href={cobranca.linkPagamento} target="_blank" rel="noopener noreferrer">Ver cobrança</a>}
      </div>
    </Card>
  )
}

function TabelaMidias({ lista, vazio }: { lista: Midias[] | undefined; vazio: string }) {
  return (
    <Tabela cab={['Canal / tipo', 'Arquivos', 'Tamanho']} vazio={vazio}
      linhas={(lista ?? []).flatMap((m) => [
        [<strong key={m.canal}>{CANAIS[m.canal] ?? m.canal}</strong>, `${n(m.quantidade)}${m.externas ? ` (${n(m.externas)} fora do servidor)` : ''}`, <strong key="b">{bytes(m.bytes)}</strong>],
        ...m.porTipo.map((t) => [<span key={t.tipo} class="pl-3 text-fg-muted">{TIPOS_MIDIA[t.tipo] ?? t.tipo}</span>, n(t.quantidade), bytes(t.bytes)]),
      ])} />
  )
}

export function VolumetriaPage() {
  const [competencia, setCompetencia] = useState(mesAtual())
  const [cambio, setCambio] = useState(cambioSalvo())
  const [aba, setAba] = useState<Aba>(abaSalva())
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dono', 'volumetria', competencia],
    queryFn: () => api.get<Volumetria>(`/dono/volumetria?competencia=${competencia}`),
  })
  function mudarCambio(v: number) {
    setCambio(v)
    try { localStorage.setItem(CHAVE_CAMBIO, String(v)) } catch {}
  }
  function irPara(a: Aba) {
    setAba(a)
    try { localStorage.setItem(CHAVE_ABA, a) } catch {}
  }

  const acoes = (
    <div class="flex flex-wrap items-end gap-2">
      <label class="text-xs text-fg-muted">Competência
        <input type="month" value={competencia} max={mesAtual()} class="mt-0.5 block rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg" onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) setCompetencia(v) }} />
      </label>
      <label class="text-xs text-fg-muted" title="Só para ver o custo de IA em reais aqui. O câmbio da cobrança é definido na loja central.">US$ 1 =
        <input type="number" step="0.01" min="0.01" value={cambio} class="mt-0.5 block w-24 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg" onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) mudarCambio(v) }} />
      </label>
    </div>
  )

  const abas = (
    <div class="overflow-x-auto -mx-1 px-1">
      <div class="flex gap-1 rounded-lg bg-surface-2 p-1 w-max sm:w-fit sm:flex-wrap" role="tablist">
        {ABAS.map(([id, rot]) => (
          <button
            key={id} type="button" role="tab" aria-selected={aba === id}
            class={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${aba === id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
            onClick={() => irPara(id)}
          >{rot}</button>
        ))}
      </div>
    </div>
  )

  const descricao = 'Volumes de cada canal e integração no mês, o custo real e o valor cobrado pelo plano. O plano é definido na loja central.'
  if (isLoading) return <Page title="Volumetria" description={descricao} actions={acoes}><div class="space-y-4">{abas}<div class="text-sm text-fg-muted">Carregando…</div></div></Page>
  if (isError || !data) return <Page title="Volumetria" description={descricao} actions={acoes}><div class="space-y-4">{abas}<div class="text-sm text-danger">Não foi possível carregar.</div></div></Page>

  const d = data
  const minutos = d.voz.reduce((s, v) => s + v.minutos, 0)
  const chamadasVoz = d.voz.reduce((s, v) => s + v.chamadas, 0)
  const envelopes = d.assinaturas.reduce((s, a) => s + a.envelopes, 0)
  const outrosTotal = d.outrosCanais.reduce((s, c) => s + c.enviadas + c.recebidas, 0)
  const maxDia = Math.max(0.000001, ...d.ia.porDia.map((x) => x.custoUsd))
  const cloudCobraveis = d.whatsappCloud.porCategoria.reduce((s, c) => s + c.cobraveis, 0)
  const leads = d.leads ?? { total: d.base.leadsTotal ?? 0, novos: d.base.leadsNovos, unicos: 0, unicosPorCanal: [] }
  const midiasAcum = somaMidias(d.midias?.acumulado)
  const midiasMes = somaMidias(d.midias?.doMes)
  const valorDaAba = (a: Aba) => {
    const cods = ITENS_DA_ABA[a] ?? []
    const v = (d.cobranca?.itens ?? []).filter((i) => cods.includes(i.codigo)).reduce((s, i) => s + i.valorCentavos, 0)
    return d.cobranca && v > 0 ? ` · cobrado ${centavos(v)}` : ''
  }
  const cobrado = (a: Aba) => ITENS_DA_ABA[a] && <ValorCobrado cobranca={d.cobranca} codigos={ITENS_DA_ABA[a]!} />

  /** Volume, leads únicos e mídias de um canal de conversa. */
  const canalDeConversa = (canal: 'cloud_api' | 'evolution', x: { enviadas: number; recebidas: number; leadsUnicos?: number }) => {
    const mes = somaMidias(d.midias?.doMes, canal); const acum = somaMidias(d.midias?.acumulado, canal)
    return (
      <Grade>
        <Resumo titulo="Mensagens" valor={n(x.enviadas + x.recebidas)} sub={`${n(x.enviadas)} enviadas · ${n(x.recebidas)} recebidas`} />
        <Resumo titulo="Leads únicos" valor={n(x.leadsUnicos ?? 0)} sub="leads diferentes com conversa no mês" />
        <Resumo titulo="Mídias no mês" valor={n(mes.quantidade)} sub={bytes(mes.bytes)} />
        <Resumo titulo="Armazenamento das mídias" valor={bytes(acum.bytes)} sub={`${n(acum.quantidade)} arquivos guardados (total)`} />
      </Grade>
    )
  }

  return (
    <Page title="Volumetria" description={descricao} actions={acoes}>
      <div class="space-y-4">
        {abas}

        {aba === 'geral' && (
          <>
            <Grade>
              <Resumo onClick={() => irPara('ia')} titulo="IA — custo real" valor={brl(d.ia.custoUsd * cambio)} sub={`${usd(d.ia.custoUsd)} · ${n(d.ia.chamadas)} chamadas${valorDaAba('ia')}`} />
              <Resumo onClick={() => irPara('cloud')} titulo="WhatsApp Cloud" valor={n(d.whatsappCloud.enviadas + d.whatsappCloud.recebidas)} sub={`${n(d.whatsappCloud.leadsUnicos ?? 0)} leads únicos${valorDaAba('cloud')}`} />
              <Resumo onClick={() => irPara('evolution')} titulo="WhatsApp Evolution" valor={n(d.evolution.enviadas + d.evolution.recebidas)} sub={`${n(d.evolution.leadsUnicos ?? 0)} leads únicos${valorDaAba('evolution')}`} />
              <Resumo onClick={() => irPara('outros')} titulo="Instagram e outros" valor={n(outrosTotal)} sub={`mensagens no mês${valorDaAba('outros')}`} />
              <Resumo onClick={() => irPara('sms')} titulo="SMS" valor={n(d.sms.pelaFila + d.sms.porAtividade)} sub={`${d.sms.falhas ? `${n(d.sms.falhas)} falhas` : 'enviados'}${valorDaAba('sms')}`} />
              <Resumo onClick={() => irPara('email')} titulo="E-mail" valor={n(d.email.pelaFila + d.email.atividadesEnviadas)} sub={`enviados${valorDaAba('email')}`} />
              <Resumo onClick={() => irPara('voz')} titulo="Voz" valor={`${n(minutos)} min`} sub={`${n(chamadasVoz)} chamadas${valorDaAba('voz')}`} />
              <Resumo onClick={() => irPara('assinaturas')} titulo="Assinaturas eletrônicas" valor={n(envelopes)} sub={`documentos enviados${valorDaAba('assinaturas')}`} />
              <Resumo onClick={() => irPara('integracoes')} titulo="Integrações" valor={n(d.sei.chamadas + d.reunioes.gravacoes)} sub={`${n(d.reunioes.gravacoes)} reuniões · ${n(d.sei.chamadas)} SEI${valorDaAba('integracoes')}`} />
              <Resumo onClick={() => irPara('leads')} titulo="Leads" valor={n(leads.total)} sub={`na base · ${n(leads.unicos)} atendidos no mês${valorDaAba('leads')}`} />
              <Resumo onClick={() => irPara('armazenamento')} titulo="Armazenamento" valor={bytes(d.armazenamento.bytes)} sub={`${bytes(midiasAcum.bytes)} em mídias de conversa${valorDaAba('armazenamento')}`} />
              <Resumo onClick={() => irPara('base')} titulo="Usuários ativos" valor={n(d.base.usuariosAtivos)} sub={`no sistema${valorDaAba('base')}`} />
            </Grade>
            <Fatura cobranca={d.cobranca} />
          </>
        )}

        {aba === 'ia' && (
          <>
            <Grade>
              <Resumo titulo="Custo real (R$)" valor={brl(d.ia.custoUsd * cambio)} sub={`câmbio ${cambio.toLocaleString('pt-BR')}`} />
              <Resumo titulo="Custo real (US$)" valor={usd(d.ia.custoUsd)} />
              <Resumo titulo="Chamadas" valor={n(d.ia.chamadas)} />
              <Resumo titulo="Tokens" valor={n(d.ia.porFuncionalidade.reduce((s, f) => s + f.tokens, 0))} sub={`${n(d.ia.porModelo.length)} modelos`} />
            </Grade>
            {cobrado('ia')}
            <Secao titulo="Custo por dia" nota={d.ia.medindoDesde
              ? `Custo real pelo preço de tabela dos provedores (a chave é nossa). Medindo desde ${new Date(d.ia.medindoDesde).toLocaleDateString('pt-BR')}.`
              : 'A medição de IA começou agora — os números aparecem conforme as IAs forem usadas.'}>
              {d.ia.porDia.length > 0 ? (
                <div class="flex items-end gap-0.5 h-24" aria-label="Custo de IA por dia">
                  {d.ia.porDia.map((x) => (
                    <div key={x.dia} class="flex-1 min-w-[3px] rounded-t bg-accent/70" style={{ height: `${Math.max(3, (x.custoUsd / maxDia) * 100)}%` }}
                      title={`${new Date(`${x.dia}T12:00:00`).toLocaleDateString('pt-BR')}: ${usd(x.custoUsd)} · ${n(x.chamadas)} chamadas`} />
                  ))}
                </div>
              ) : <div class="text-sm text-fg-muted">Nenhum uso de IA no mês.</div>}
            </Secao>
            <Secao titulo="Por funcionalidade">
              <Tabela cab={['Funcionalidade', 'Chamadas', 'Tokens', 'Custo']} vazio="Nenhum uso de IA no mês."
                linhas={d.ia.porFuncionalidade.map((f) => [FUNCIONALIDADES[f.funcionalidade] ?? f.funcionalidade, n(f.chamadas), n(f.tokens), `${usd(f.custoUsd)} · ${brl(f.custoUsd * cambio)}`])} />
            </Secao>
            <Secao titulo="Por modelo">
              <Tabela cab={['Modelo', 'Chamadas', 'Entrada', 'Saída', 'Cache (escr./leit.)', 'Custo']} vazio="Nenhum modelo usado no mês."
                linhas={d.ia.porModelo.map((m) => [
                  <span key={m.modelo}>{m.modelo} <span class="text-xs text-fg-muted">({m.provedor})</span>{m.semPreco && <> <Badge tone="warning" title="Modelo sem preço na tabela: o custo dele não entra no total. Cadastre o preço na Setting consumo.precos_ia.">sem preço</Badge></>}</span>,
                  n(m.chamadas), n(m.entrada), n(m.saida), `${n(m.cacheEscrita)} / ${n(m.cacheLeitura)}`, usd(m.custoUsd),
                ])} />
            </Secao>
          </>
        )}

        {aba === 'cloud' && (
          <>
            {canalDeConversa('cloud_api', d.whatsappCloud)}
            <Grade>
              <Resumo titulo="Cobráveis pela Meta" valor={n(cloudCobraveis)} />
              <Resumo titulo="Custo Meta (estimado)" valor={brl(d.whatsappCloud.custoEstimadoUsd * cambio)} sub={`${usd(d.whatsappCloud.custoEstimadoUsd)} · pago pelo cliente à Meta`} />
            </Grade>
            {cobrado('cloud')}
            <Secao titulo="Por categoria" nota="A Meta cobra o cliente direto — o custo aqui é só informativo.">
              <Tabela cab={['Categoria', 'Enviadas', 'Cobráveis', 'Custo Meta (est.)']} vazio="Nenhum envio pela Cloud API no mês."
                linhas={d.whatsappCloud.porCategoria.map((c) => [CATEGORIAS[c.categoria] ?? c.categoria, n(c.enviadas), n(c.cobraveis), usd(c.custoEstimadoUsd)])} />
            </Secao>
            <Secao titulo="Por número">
              <Tabela cab={['Número', 'Enviadas', 'Recebidas', 'Leads únicos']} vazio="Sem mensagens no mês."
                linhas={d.whatsappCloud.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas), n(x.leadsUnicos ?? 0)])} />
            </Secao>
            <Secao titulo="Mídias guardadas (total)" nota="Arquivos recebidos e enviados pela Cloud API que estão no nosso servidor.">
              <TabelaMidias lista={d.midias?.acumulado.filter((m) => m.canal === 'cloud_api')} vazio="Nenhuma mídia guardada." />
            </Secao>
          </>
        )}

        {aba === 'evolution' && (
          <>
            {canalDeConversa('evolution', d.evolution)}
            {cobrado('evolution')}
            <Secao titulo="Por número" nota="Sem custo por mensagem — o custo é a nossa infraestrutura.">
              <Tabela cab={['Número (instância)', 'Enviadas', 'Recebidas', 'Leads únicos']} vazio="Sem mensagens no mês."
                linhas={d.evolution.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas), n(x.leadsUnicos ?? 0)])} />
            </Secao>
            <Secao titulo="Mídias guardadas (total)" nota="Arquivos recebidos e enviados pela Evolution que estão no nosso servidor.">
              <TabelaMidias lista={d.midias?.acumulado.filter((m) => m.canal === 'evolution')} vazio="Nenhuma mídia guardada." />
            </Secao>
          </>
        )}

        {aba === 'outros' && (
          <>
            {cobrado('outros')}
            <Secao titulo="Instagram, Messenger, Telegram e chat do portal">
              <Tabela cab={['Canal', 'Enviadas', 'Recebidas', 'Leads únicos']} vazio="—"
                linhas={d.outrosCanais.map((c) => [CANAIS[c.canal] ?? c.canal, n(c.enviadas), n(c.recebidas), n(c.leadsUnicos ?? 0)])} />
            </Secao>
          </>
        )}

        {aba === 'sms' && (
          <>
            <Grade>
              <Resumo titulo="Total enviado" valor={n(d.sms.pelaFila + d.sms.porAtividade)} />
              <Resumo titulo="Pela fila" valor={n(d.sms.pelaFila)} sub="workflow e cadência" />
              <Resumo titulo="Por atividade" valor={n(d.sms.porAtividade)} sub="enviados no lead" />
              <Resumo titulo="Falhas" valor={n(d.sms.falhas)} />
            </Grade>
            {cobrado('sms')}
          </>
        )}

        {aba === 'email' && (
          <>
            <Grade>
              <Resumo titulo="Pela fila" valor={n(d.email.pelaFila)} sub="workflow e cadência" />
              <Resumo titulo="Enviados (atividade/Gmail)" valor={n(d.email.atividadesEnviadas)} />
              <Resumo titulo="Recebidos (Gmail)" valor={n(d.email.atividadesRecebidas)} />
              <Resumo titulo="Falhas" valor={n(d.email.falhas)} />
            </Grade>
            {cobrado('email')}
          </>
        )}

        {aba === 'voz' && (
          <>
            <Grade>
              <Resumo titulo="Minutos" valor={n(minutos)} />
              <Resumo titulo="Chamadas" valor={n(chamadasVoz)} />
            </Grade>
            {cobrado('voz')}
            <Secao titulo="Por provedor e direção">
              <Tabela cab={['Provedor', 'Direção', 'Chamadas', 'Minutos']} vazio="Nenhuma chamada no mês."
                linhas={d.voz.map((v) => [v.provedor, v.direcao === 'inbound' ? 'Recebidas' : 'Feitas', n(v.chamadas), n(v.minutos)])} />
            </Secao>
          </>
        )}

        {aba === 'assinaturas' && (
          <>
            <Grade><Resumo titulo="Documentos enviados" valor={n(envelopes)} /></Grade>
            {cobrado('assinaturas')}
            <Secao titulo="Por provedor">
              <Tabela cab={['Provedor', 'Documentos']} vazio="Nenhum documento enviado para assinatura no mês."
                linhas={d.assinaturas.map((a) => [a.provedor, n(a.envelopes)])} />
            </Secao>
          </>
        )}

        {aba === 'integracoes' && (
          <>
            <Grade>
              <Resumo titulo="Reuniões gravadas" valor={n(d.reunioes.gravacoes)} />
              <Resumo titulo="Chamadas ao SEI" valor={n(d.sei.chamadas)} sub={d.sei.falhas ? `${n(d.sei.falhas)} falhas` : 'sem falhas'} />
            </Grade>
            {cobrado('integracoes')}
          </>
        )}

        {aba === 'leads' && (
          <>
            <Grade>
              <Resumo titulo="Leads na base" valor={n(leads.total)} sub="total guardado" />
              <Resumo titulo="Leads novos no mês" valor={n(leads.novos)} />
              <Resumo titulo="Leads únicos atendidos" valor={n(leads.unicos)} sub="com conversa no mês, em qualquer canal" />
            </Grade>
            {cobrado('leads')}
            <Secao titulo="Leads únicos por canal" nota="Um lead que conversou por dois canais conta em cada um — por isso a soma pode passar do total.">
              <Tabela cab={['Canal', 'Leads únicos']} vazio="Nenhuma conversa no mês."
                linhas={leads.unicosPorCanal.map((c) => [CANAIS[c.canal] ?? c.canal, n(c.leads)])} />
            </Secao>
          </>
        )}

        {aba === 'armazenamento' && (
          <>
            <Grade>
              <Resumo titulo="Arquivos no servidor" valor={bytes(d.armazenamento.bytes)} sub="toda a pasta de arquivos (hoje)" />
              <Resumo titulo="Mídias de conversa" valor={bytes(midiasAcum.bytes)} sub={`${n(midiasAcum.quantidade)} arquivos guardados`} />
              <Resumo titulo="Mídias do mês" valor={bytes(midiasMes.bytes)} sub={`${n(midiasMes.quantidade)} arquivos`} />
            </Grade>
            {cobrado('armazenamento')}
            <Secao titulo="Mídias guardadas por canal (total)" nota="Arquivos de conversa no nosso servidor. Mídia que ficou só no provedor aparece como “fora do servidor” e não ocupa espaço nosso.">
              <TabelaMidias lista={d.midias?.acumulado} vazio="Nenhuma mídia guardada." />
            </Secao>
            <Secao titulo="Mídias do mês por canal">
              <TabelaMidias lista={d.midias?.doMes} vazio="Nenhuma mídia no mês." />
            </Secao>
          </>
        )}

        {aba === 'base' && (
          <>
            <Grade><Resumo titulo="Usuários ativos" valor={n(d.base.usuariosAtivos)} /></Grade>
            {cobrado('base')}
          </>
        )}
      </div>
    </Page>
  )
}
