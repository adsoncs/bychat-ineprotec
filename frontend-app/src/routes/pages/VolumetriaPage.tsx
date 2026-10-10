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

type Aba = 'geral' | 'ia' | 'cloud' | 'evolution' | 'outros' | 'sms' | 'email' | 'voz' | 'assinaturas' | 'integracoes' | 'base'
const ABAS: Array<[Aba, string]> = [
  ['geral', 'Visão geral'], ['ia', 'IA'], ['cloud', 'WhatsApp Cloud'], ['evolution', 'WhatsApp Evolution'],
  ['outros', 'Instagram e outros'], ['sms', 'SMS'], ['email', 'E-mail'], ['voz', 'Voz'],
  ['assinaturas', 'Assinaturas eletrônicas'], ['integracoes', 'Integrações'], ['base', 'Base e armazenamento'],
]
const CHAVE_ABA = 'volumetria:aba'
function abaSalva(): Aba {
  try { const v = localStorage.getItem(CHAVE_ABA); if (ABAS.some(([id]) => id === v)) return v as Aba } catch {}
  return 'geral'
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
      <label class="text-xs text-fg-muted" title="Só para ver em reais aqui. O câmbio da cobrança é definido na loja central.">US$ 1 =
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

  const descricao = 'Volumes de cada canal e integração no mês e o custo real. O valor cobrado do cliente é definido na loja central.'
  if (isLoading) return <Page title="Volumetria" description={descricao} actions={acoes}><div class="space-y-4">{abas}<div class="text-sm text-fg-muted">Carregando…</div></div></Page>
  if (isError || !data) return <Page title="Volumetria" description={descricao} actions={acoes}><div class="space-y-4">{abas}<div class="text-sm text-danger">Não foi possível carregar.</div></div></Page>

  const d = data
  const minutos = d.voz.reduce((s, v) => s + v.minutos, 0)
  const chamadasVoz = d.voz.reduce((s, v) => s + v.chamadas, 0)
  const envelopes = d.assinaturas.reduce((s, a) => s + a.envelopes, 0)
  const outrosTotal = d.outrosCanais.reduce((s, c) => s + c.enviadas + c.recebidas, 0)
  const maxDia = Math.max(0.000001, ...d.ia.porDia.map((x) => x.custoUsd))
  const cloudCobraveis = d.whatsappCloud.porCategoria.reduce((s, c) => s + c.cobraveis, 0)

  return (
    <Page title="Volumetria" description={descricao} actions={acoes}>
      <div class="space-y-4">
        {abas}

        {aba === 'geral' && (
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Resumo onClick={() => irPara('ia')} titulo="IA — custo real" valor={brl(d.ia.custoUsd * cambio)} sub={`${usd(d.ia.custoUsd)} · ${n(d.ia.chamadas)} chamadas`} />
            <Resumo onClick={() => irPara('cloud')} titulo="WhatsApp Cloud" valor={n(d.whatsappCloud.enviadas + d.whatsappCloud.recebidas)} sub={`${n(d.whatsappCloud.enviadas)} enviadas · ${n(d.whatsappCloud.recebidas)} recebidas`} />
            <Resumo onClick={() => irPara('evolution')} titulo="WhatsApp Evolution" valor={n(d.evolution.enviadas + d.evolution.recebidas)} sub={`${n(d.evolution.enviadas)} enviadas · ${n(d.evolution.recebidas)} recebidas`} />
            <Resumo onClick={() => irPara('outros')} titulo="Instagram e outros" valor={n(outrosTotal)} sub="mensagens no mês" />
            <Resumo onClick={() => irPara('sms')} titulo="SMS" valor={n(d.sms.pelaFila + d.sms.porAtividade)} sub={d.sms.falhas ? `${n(d.sms.falhas)} falhas` : 'enviados'} />
            <Resumo onClick={() => irPara('email')} titulo="E-mail" valor={n(d.email.pelaFila + d.email.atividadesEnviadas)} sub={`${n(d.email.atividadesRecebidas)} recebidos pelo Gmail`} />
            <Resumo onClick={() => irPara('voz')} titulo="Voz" valor={`${n(minutos)} min`} sub={`${n(chamadasVoz)} chamadas`} />
            <Resumo onClick={() => irPara('assinaturas')} titulo="Assinaturas eletrônicas" valor={n(envelopes)} sub="documentos enviados" />
            <Resumo onClick={() => irPara('integracoes')} titulo="Integrações" valor={n(d.sei.chamadas + d.reunioes.gravacoes)} sub={`${n(d.reunioes.gravacoes)} reuniões · ${n(d.sei.chamadas)} chamadas ao SEI`} />
            <Resumo onClick={() => irPara('base')} titulo="Armazenamento" valor={bytes(d.armazenamento.bytes)} sub="arquivos enviados (hoje)" />
            <Resumo onClick={() => irPara('base')} titulo="Base" valor={n(d.base.usuariosAtivos)} sub={`usuários ativos · ${n(d.base.leadsNovos)} leads novos`} />
          </section>
        )}

        {aba === 'ia' && (
          <>
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Custo real (R$)" valor={brl(d.ia.custoUsd * cambio)} sub={`câmbio ${cambio.toLocaleString('pt-BR')}`} />
              <Resumo titulo="Custo real (US$)" valor={usd(d.ia.custoUsd)} />
              <Resumo titulo="Chamadas" valor={n(d.ia.chamadas)} />
              <Resumo titulo="Tokens" valor={n(d.ia.porFuncionalidade.reduce((s, f) => s + f.tokens, 0))} sub={`${n(d.ia.porModelo.length)} modelos`} />
            </section>
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
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Enviadas" valor={n(d.whatsappCloud.enviadas)} />
              <Resumo titulo="Recebidas" valor={n(d.whatsappCloud.recebidas)} />
              <Resumo titulo="Cobráveis pela Meta" valor={n(cloudCobraveis)} />
              <Resumo titulo="Custo Meta (estimado)" valor={brl(d.whatsappCloud.custoEstimadoUsd * cambio)} sub={`${usd(d.whatsappCloud.custoEstimadoUsd)} · pago pelo cliente`} />
            </section>
            <Secao titulo="Por categoria" nota="A Meta cobra o cliente direto — o custo aqui é só informativo.">
              <Tabela cab={['Categoria', 'Enviadas', 'Cobráveis', 'Custo Meta (est.)']} vazio="Nenhum envio pela Cloud API no mês."
                linhas={d.whatsappCloud.porCategoria.map((c) => [CATEGORIAS[c.categoria] ?? c.categoria, n(c.enviadas), n(c.cobraveis), usd(c.custoEstimadoUsd)])} />
            </Secao>
            <Secao titulo="Por número">
              <Tabela cab={['Número', 'Enviadas', 'Recebidas']} vazio="Sem mensagens no mês."
                linhas={d.whatsappCloud.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas)])} />
            </Secao>
          </>
        )}

        {aba === 'evolution' && (
          <>
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Enviadas" valor={n(d.evolution.enviadas)} />
              <Resumo titulo="Recebidas" valor={n(d.evolution.recebidas)} />
              <Resumo titulo="Números" valor={n(d.evolution.porNumero.length)} sub="com mensagens no mês" />
            </section>
            <Secao titulo="Por número" nota="Sem custo por mensagem — o custo é a nossa infraestrutura.">
              <Tabela cab={['Número (instância)', 'Enviadas', 'Recebidas']} vazio="Sem mensagens no mês."
                linhas={d.evolution.porNumero.map((x) => [x.numero, n(x.enviadas), n(x.recebidas)])} />
            </Secao>
          </>
        )}

        {aba === 'outros' && (
          <Secao titulo="Instagram, Messenger, Telegram e chat do portal">
            <Tabela cab={['Canal', 'Enviadas', 'Recebidas']} vazio="—"
              linhas={d.outrosCanais.map((c) => [CANAIS[c.canal] ?? c.canal, n(c.enviadas), n(c.recebidas)])} />
          </Secao>
        )}

        {aba === 'sms' && (
          <>
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Total enviado" valor={n(d.sms.pelaFila + d.sms.porAtividade)} />
              <Resumo titulo="Pela fila" valor={n(d.sms.pelaFila)} sub="workflow e cadência" />
              <Resumo titulo="Por atividade" valor={n(d.sms.porAtividade)} sub="enviados no lead" />
              <Resumo titulo="Falhas" valor={n(d.sms.falhas)} />
            </section>
          </>
        )}

        {aba === 'email' && (
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Resumo titulo="Pela fila" valor={n(d.email.pelaFila)} sub="workflow e cadência" />
            <Resumo titulo="Enviados (atividade/Gmail)" valor={n(d.email.atividadesEnviadas)} />
            <Resumo titulo="Recebidos (Gmail)" valor={n(d.email.atividadesRecebidas)} />
            <Resumo titulo="Falhas" valor={n(d.email.falhas)} />
          </section>
        )}

        {aba === 'voz' && (
          <>
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Minutos" valor={n(minutos)} />
              <Resumo titulo="Chamadas" valor={n(chamadasVoz)} />
            </section>
            <Secao titulo="Por provedor e direção">
              <Tabela cab={['Provedor', 'Direção', 'Chamadas', 'Minutos']} vazio="Nenhuma chamada no mês."
                linhas={d.voz.map((v) => [v.provedor, v.direcao === 'inbound' ? 'Recebidas' : 'Feitas', n(v.chamadas), n(v.minutos)])} />
            </Secao>
          </>
        )}

        {aba === 'assinaturas' && (
          <>
            <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Resumo titulo="Documentos enviados" valor={n(envelopes)} />
            </section>
            <Secao titulo="Por provedor">
              <Tabela cab={['Provedor', 'Documentos']} vazio="Nenhum documento enviado para assinatura no mês."
                linhas={d.assinaturas.map((a) => [a.provedor, n(a.envelopes)])} />
            </Secao>
          </>
        )}

        {aba === 'integracoes' && (
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Resumo titulo="Reuniões gravadas" valor={n(d.reunioes.gravacoes)} />
            <Resumo titulo="Chamadas ao SEI" valor={n(d.sei.chamadas)} sub={d.sei.falhas ? `${n(d.sei.falhas)} falhas` : 'sem falhas'} />
          </section>
        )}

        {aba === 'base' && (
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Resumo titulo="Armazenamento" valor={bytes(d.armazenamento.bytes)} sub="arquivos enviados (hoje)" />
            <Resumo titulo="Usuários ativos" valor={n(d.base.usuariosAtivos)} />
            <Resumo titulo="Leads novos no mês" valor={n(d.base.leadsNovos)} />
          </section>
        )}
      </div>
    </Page>
  )
}
