// Volumetria — painel do DONO do produto (o superadmin do cliente não entra:
// a API responde 404). Mostra quanto cada canal e integração movimentou no mês
// e, onde existe, o custo real. O preço cobrado do cliente (repasse) é
// definido na loja central — aqui não aparece margem.
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { api } from '@/lib/apiClient'

interface Volumetria {
  competencia: string
  ia: {
    medindoDesde: string | null; chamadas: number; custoUsd: number
    porModelo: Array<{ provedor: string; modelo: string; chamadas: number; entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number; custoUsd: number; semPreco: boolean }>
    porFuncionalidade: Array<{ funcionalidade: string; chamadas: number; tokens: number; custoUsd: number }>
    porDia: Array<{ dia: string; chamadas: number; custoUsd: number }>
  }
  whatsappCloud: {
    enviadas: number; recebidas: number; pagoPor: 'cliente'; custoEstimadoUsd: number
    porCategoria: Array<{ categoria: string; enviadas: number; cobraveis: number; custoEstimadoUsd: number }>
    porNumero: Array<{ numero: string; enviadas: number; recebidas: number }>
  }
  evolution: { enviadas: number; recebidas: number; porNumero: Array<{ numero: string; enviadas: number; recebidas: number }> }
  outrosCanais: Array<{ canal: string; enviadas: number; recebidas: number }>
  sms: { pelaFila: number; falhas: number; porAtividade: number }
  email: { pelaFila: number; falhas: number; atividadesEnviadas: number; atividadesRecebidas: number }
  voz: Array<{ provedor: string; direcao: string; chamadas: number; minutos: number }>
  assinaturas: Array<{ provedor: string; envelopes: number }>
  reunioes: { gravacoes: number }
  sei: { chamadas: number; falhas: number }
  armazenamento: { bytes: number | null }
  base: { usuariosAtivos: number; leadsNovos: number }
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
const CANAIS: Record<string, string> = { instagram: 'Instagram', messenger: 'Messenger', telegram: 'Telegram', portal_chat: 'Chat do portal' }

const n = (v: number) => v.toLocaleString('pt-BR')
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAtual = () => { const d = new Date(Date.now() - 3 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
function bytes(b: number | null) {
  if (b == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${u[i]}`
}

const CHAVE_CAMBIO = 'volumetria:cambio'
function cambioSalvo(): number {
  try { const v = Number(localStorage.getItem(CHAVE_CAMBIO)); if (v > 0) return v } catch {}
  return 5.5
}

function Resumo({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <Card class="p-4">
      <div class="text-xs text-fg-muted">{titulo}</div>
      <div class="mt-1 text-xl font-semibold tabular-nums">{valor}</div>
      {sub && <div class="mt-0.5 text-xs text-fg-muted">{sub}</div>}
    </Card>
  )
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

export function VolumetriaPage() {
  const [competencia, setCompetencia] = useState(mesAtual())
  const [cambio, setCambio] = useState(cambioSalvo())
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dono', 'volumetria', competencia],
    queryFn: () => api.get<Volumetria>(`/dono/volumetria?competencia=${competencia}`),
  })
  function mudarCambio(v: number) {
    setCambio(v)
    try { localStorage.setItem(CHAVE_CAMBIO, String(v)) } catch {}
  }

  const acoes = (
    <div class="flex flex-wrap items-end gap-2">
      <label class="text-xs text-fg-muted">Competência
        <input type="month" value={competencia} max={mesAtual()} class="mt-0.5 block rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg" onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) setCompetencia(v) }} />
      </label>
      <label class="text-xs text-fg-muted" title="Só para ver em reais aqui. O câmbio da cobrança é definido na loja central.">US$ 1 =
        <input type="number" step="0.01" min="0.01" value={cambio} class="mt-0.5 block w-24 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg" onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) mudarCambio(v) }} />
      </label>
    </div>
  )

  if (isLoading) return <Page title="Volumetria" actions={acoes}><div class="text-sm text-fg-muted">Carregando…</div></Page>
  if (isError || !data) return <Page title="Volumetria" actions={acoes}><div class="text-sm text-danger">Não foi possível carregar.</div></Page>

  const d = data
  const minutos = d.voz.reduce((s, v) => s + v.minutos, 0)
  const maxDia = Math.max(0.000001, ...d.ia.porDia.map((x) => x.custoUsd))

  return (
    <Page title="Volumetria" description="Volumes de cada canal e integração no mês e o custo real. O valor cobrado do cliente é definido na loja central." actions={acoes}>
      <div class="space-y-4">
        <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Resumo titulo="IA — custo real" valor={brl(d.ia.custoUsd * cambio)} sub={`${usd(d.ia.custoUsd)} · ${n(d.ia.chamadas)} chamadas`} />
          <Resumo titulo="WhatsApp Cloud" valor={n(d.whatsappCloud.enviadas + d.whatsappCloud.recebidas)} sub={`${n(d.whatsappCloud.enviadas)} enviadas · ${n(d.whatsappCloud.recebidas)} recebidas`} />
          <Resumo titulo="WhatsApp Evolution" valor={n(d.evolution.enviadas + d.evolution.recebidas)} sub={`${n(d.evolution.enviadas)} enviadas · ${n(d.evolution.recebidas)} recebidas`} />
          <Resumo titulo="Armazenamento" valor={bytes(d.armazenamento.bytes)} sub="arquivos enviados (hoje)" />
          <Resumo titulo="SMS" valor={n(d.sms.pelaFila + d.sms.porAtividade)} sub={d.sms.falhas ? `${n(d.sms.falhas)} falhas` : 'enviados'} />
          <Resumo titulo="E-mail" valor={n(d.email.pelaFila + d.email.atividadesEnviadas)} sub={`${n(d.email.atividadesRecebidas)} recebidos pelo Gmail`} />
          <Resumo titulo="Voz" valor={`${n(minutos)} min`} sub={`${n(d.voz.reduce((s, v) => s + v.chamadas, 0))} chamadas`} />
          <Resumo titulo="Assinaturas eletrônicas" valor={n(d.assinaturas.reduce((s, a) => s + a.envelopes, 0))} sub="documentos enviados" />
        </section>

        <Secao titulo="Inteligência artificial" nota={d.ia.medindoDesde
          ? `Custo real pelo preço de tabela dos provedores (a chave é nossa). Medindo desde ${new Date(d.ia.medindoDesde).toLocaleDateString('pt-BR')}.`
          : 'A medição de IA começou agora — os números aparecem conforme as IAs forem usadas.'}>
          {d.ia.porDia.length > 0 && (
            <div class="flex items-end gap-0.5 h-20" aria-label="Custo de IA por dia">
              {d.ia.porDia.map((x) => (
                <div key={x.dia} class="flex-1 min-w-[3px] rounded-t bg-accent/70" style={{ height: `${Math.max(3, (x.custoUsd / maxDia) * 100)}%` }}
                  title={`${new Date(`${x.dia}T12:00:00`).toLocaleDateString('pt-BR')}: ${usd(x.custoUsd)} · ${n(x.chamadas)} chamadas`} />
              ))}
            </div>
          )}
          <div class="grid gap-4 xl:grid-cols-2">
            <Tabela cab={['Funcionalidade', 'Chamadas', 'Tokens', 'Custo']} vazio="Nenhum uso de IA no mês."
              linhas={d.ia.porFuncionalidade.map((f) => [FUNCIONALIDADES[f.funcionalidade] ?? f.funcionalidade, n(f.chamadas), n(f.tokens), `${usd(f.custoUsd)} · ${brl(f.custoUsd * cambio)}`])} />
            <Tabela cab={['Modelo', 'Entrada', 'Saída', 'Cache (escr./leit.)', 'Custo']} vazio="Nenhum modelo usado no mês."
              linhas={d.ia.porModelo.map((m) => [
                <span key={m.modelo}>{m.modelo} <span class="text-xs text-fg-muted">({m.provedor})</span>{m.semPreco && <> <Badge tone="warning" title="Modelo sem preço na tabela: o custo dele não entra no total. Cadastre o preço na Setting consumo.precos_ia.">sem preço</Badge></>}</span>,
                n(m.entrada), n(m.saida), `${n(m.cacheEscrita)} / ${n(m.cacheLeitura)}`, usd(m.custoUsd),
              ])} />
          </div>
        </Secao>

        <Secao titulo="WhatsApp Cloud API (Meta)" nota={`A Meta cobra o cliente direto. Custo estimado da Meta no mês: ${usd(d.whatsappCloud.custoEstimadoUsd)} (${brl(d.whatsappCloud.custoEstimadoUsd * cambio)}) — informativo.`}>
          <div class="grid gap-4 xl:grid-cols-2">
            <Tabela cab={['Categoria', 'Enviadas', 'Cobráveis', 'Custo Meta (est.)']} vazio="Nenhum envio pela Cloud API no mês."
              linhas={d.whatsappCloud.porCategoria.map((c) => [CATEGORIAS[c.categoria] ?? c.categoria, n(c.enviadas), n(c.cobraveis), usd(c.custoEstimadoUsd)])} />
            <Tabela cab={['Número', 'Enviadas', 'Recebidas']} vazio="Sem mensagens no mês."
              linhas={d.whatsappCloud.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas)])} />
          </div>
        </Secao>

        <Secao titulo="WhatsApp Evolution" nota="Sem custo por mensagem — o custo é a nossa infraestrutura. Volume por número.">
          <Tabela cab={['Número (instância)', 'Enviadas', 'Recebidas']} vazio="Sem mensagens no mês."
            linhas={d.evolution.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas)])} />
        </Secao>

        <div class="grid gap-4 xl:grid-cols-2">
          <Secao titulo="Outros canais">
            <Tabela cab={['Canal', 'Enviadas', 'Recebidas']} vazio="—"
              linhas={d.outrosCanais.map((c) => [CANAIS[c.canal] ?? c.canal, n(c.enviadas), n(c.recebidas)])} />
          </Secao>
          <Secao titulo="SMS, e-mail e voz">
            <Tabela cab={['Item', 'Quantidade']} vazio="—" linhas={[
              ['SMS pela fila (workflow/cadência)', n(d.sms.pelaFila)],
              ['SMS por atividade', n(d.sms.porAtividade)],
              ['E-mails pela fila', n(d.email.pelaFila)],
              ['E-mails enviados (atividade/Gmail)', n(d.email.atividadesEnviadas)],
              ['E-mails recebidos (Gmail)', n(d.email.atividadesRecebidas)],
              ...d.voz.map((v) => [`Voz — ${v.provedor} (${v.direcao === 'inbound' ? 'recebidas' : 'feitas'})`, `${n(v.chamadas)} · ${n(v.minutos)} min`]),
            ]} />
          </Secao>
          <Secao titulo="Integrações">
            <Tabela cab={['Item', 'Quantidade']} vazio="—" linhas={[
              ...d.assinaturas.map((a) => [`Assinatura eletrônica — ${a.provedor}`, n(a.envelopes)]),
              ['Reuniões gravadas', n(d.reunioes.gravacoes)],
              ['Chamadas ao SEI', `${n(d.sei.chamadas)}${d.sei.falhas ? ` (${n(d.sei.falhas)} falhas)` : ''}`],
            ]} />
          </Secao>
          <Secao titulo="Base">
            <Tabela cab={['Item', 'Quantidade']} vazio="—" linhas={[
              ['Usuários ativos', n(d.base.usuariosAtivos)],
              ['Leads novos no mês', n(d.base.leadsNovos)],
            ]} />
          </Secao>
        </div>
      </div>
    </Page>
  )
}
