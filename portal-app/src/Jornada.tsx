// As etapas depois da inscrição, na ordem que o portal escolheu (aba Etapas
// do editor): pagamento, documentos, contrato e redação online.
//
//   · inscricao: uma etapa por vez, logo depois do envio do formulário. Etapa
//     não obrigatória pode ficar para depois; a pessoa segue para a próxima.
//   · painel: no portal logado, a mesma lista em cartões; o que falta abre ali.
import { useEffect, useState } from 'preact/hooks'
import { carregarJornada, type EtapaDaJornada } from './api'
import { Pagamento } from './Pagamento'
import { Documentos } from './Documentos'
import { ContratoInscricao } from './ContratoInscricao'
import { Redacao } from './Redacao'
import { DadosEtapa } from './DadosEtapa'
import { t as tx } from './textos'

// Textos: Configurações Gerais › Textos › Etapas (lidos na hora de desenhar).
const SITUACAO = {
  get feito() { return tx('etapas.feito', 'Concluída') },
  get aguardando() { return tx('etapas.aguardando', 'Em análise') },
  get pendente() { return tx('etapas.pendente', 'Pendente') },
  get travada() { return tx('etapas.travada', 'Aguardando etapa anterior') },
}
/** Etapa pendente por recusa (ex.: documento recusado): pede correção, não início. */
const temRecusa = (e: EtapaDaJornada) => e.situacao === 'pendente' && /recusad|reenvi/i.test(e.detalhe)
/** Cadeado: travada por uma etapa anterior que ainda não foi concluída. */
const Cadeado = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="currentColor" stroke-width="2" /></svg>
)
/** Relógio: "em análise" — já fez a parte dela, agora é com a instituição. */
const Relogio = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
)

export function Jornada(props: {
  codigo: string
  token: string
  contexto: 'inscricao' | 'painel'
  /** No painel, as etapas já vêm carregadas junto com o token. */
  etapas?: EtapaDaJornada[]
  aoConcluirTudo?: () => void
}) {
  const [etapas, setEtapas] = useState<EtapaDaJornada[] | null>(props.etapas ?? null)
  const [falha, setFalha] = useState<string | null>(null)
  // Painel: o link "#etapa-contrato" (início do portal, passos do aluno) abre
  // a etapa direto, em vez de deixar a pessoa procurando onde clicar.
  const daAncora = () => (/^#etapa-(\w+)/.exec(location.hash)?.[1] ?? null)
  const [aberta, setAberta] = useState<string | null>(props.contexto === 'painel' ? daAncora() : null)
  useEffect(() => {
    if (props.contexto !== 'painel') return
    const aoMudar = () => { const c = daAncora(); if (c) setAberta(c) }
    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [])
  useEffect(() => {
    if (aberta && props.contexto === 'painel') document.getElementById(`etapa-${aberta}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [aberta, !!etapas])

  async function recarregar() {
    try {
      const j = await carregarJornada(props.codigo, props.token, props.contexto)
      setEtapas(j.etapas)
    } catch (e: any) { setFalha(e.message) }
  }
  useEffect(() => { if (!props.etapas) void recarregar() }, [props.codigo, props.token])
  const tudoPronto = !!etapas?.length && etapas.every((e) => e.situacao !== 'pendente')
  useEffect(() => { if (tudoPronto) props.aoConcluirTudo?.() }, [tudoPronto])

  if (falha) return <div class="aviso erro">{falha}</div>
  if (!etapas) return <div class="esqueleto" style="height:160px" />
  if (!etapas.length) return null

  const resolvida = (e: EtapaDaJornada) => e.situacao !== 'pendente'
  // Na inscrição, a etapa da vez (aberta de início) é a primeira que falta. A
  // pessoa pode abrir qualquer outra pelo "Fazer agora" — não há mais o "Deixar
  // para depois" (era o único jeito de chegar à etapa seguinte).
  // Etapa travada (aguarda uma anterior com trava) não é "da vez".
  const daVez = props.contexto === 'inscricao'
    ? etapas.find((e) => !resolvida(e) && !e.bloqueada) ?? null
    : null
  const tudoFeito = tudoPronto
  // "Concluída" é só o que terminou; em análise ainda não conta.
  const concluidas = etapas.filter((e) => e.situacao === 'feito').length

  const conteudo = (e: EtapaDaJornada) => {
    if (e.chave === 'cadastro') return <DadosEtapa codigo={props.codigo} token={props.token} etapa="cadastro" aoSalvar={recarregar} />
    // Etapa que pede dados antes da ação (ex.: responsável antes do contrato):
    // primeiro os dados; salvos, a etapa recarrega e mostra a ação.
    if ((e.dadosFaltando ?? 0) > 0) {
      return <DadosEtapa codigo={props.codigo} token={props.token} etapa={e.chave} rotuloBotao="Continuar" aoSalvar={recarregar} />
    }
    if (e.chave === 'pagamento') return <Pagamento codigo={props.codigo} token={props.token} aoConfirmar={recarregar} />
    if (e.chave === 'documentos') return <Documentos token={props.token} embutido aoMudar={recarregar} />
    if (e.chave === 'contrato') return <ContratoInscricao codigo={props.codigo} token={props.token} aoAssinar={recarregar} />
    return <Redacao token={props.token} aoMudar={recarregar} />
  }

  return (
    <div class={`jornada jornada-${props.contexto}`} id="jornada">
      <div class="jornada-topo">
        <h2>{props.contexto === 'inscricao' ? tx('etapas.tituloInscricao', 'Próximos passos') : tx('etapas.tituloPainel', 'O que falta na sua inscrição')}</h2>
        <span class="sub">{concluidas} de {etapas.length} concluída(s)</span>
      </div>
      <div class="jornada-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={etapas.length} aria-valuenow={etapas.filter((e) => e.situacao === 'feito').length}>
        {etapas.map((e) => <span key={e.chave} class={e.situacao} />)}
      </div>
      <ol class="jornada-lista">
        {etapas.map((e, i) => {
          // Inscrição: a da vez abre sozinha até a pessoa escolher outra (ou fechar).
          // Travada: não abre — o servidor recusaria a ação de qualquer jeito.
          const travada = !!e.bloqueada
          const expandida = !travada && (props.contexto === 'inscricao' && aberta === null ? daVez?.chave === e.chave : aberta === e.chave)
          return (
            <li key={e.chave} id={`etapa-${e.chave}`} class={`etapa-jornada ${travada ? 'travada' : e.situacao} ${!travada && temRecusa(e) ? 'alerta' : ''} ${expandida ? 'aberta' : ''}`}>
              <div class="etapa-cabeca">
                <span class="etapa-num" aria-hidden="true">{travada ? <Cadeado /> : e.situacao === 'feito' ? '✓' : e.situacao === 'aguardando' ? <Relogio /> : temRecusa(e) ? '!' : i + 1}</span>
                <div class="etapa-txt">
                  <b class="etapa-titulo"><IconeDaEtapa chave={e.chave} />{tx(`etapas.nome.${e.chave}`, e.titulo)}</b>
                  <span class="sub">{travada ? e.bloqueada!.motivo : e.detalhe}</span>
                </div>
                <span class={`etapa-status ${travada ? 'travada' : e.situacao} ${!travada && temRecusa(e) ? 'alerta' : ''}`}>{travada ? SITUACAO.travada : temRecusa(e) ? tx('etapas.corrigir', 'Corrigir') : SITUACAO[e.situacao]}</span>
                {/* Concluída também abre quando há o que consultar: contrato assinado
                    (PDF) e documentos enviados — como o boleto mostra a cobrança. */}
                {!expandida && !travada
                  && (e.situacao !== 'feito' || (props.contexto === 'painel' && (e.chave === 'contrato' || e.chave === 'documentos'))) && (
                  <button class="link etapa-acao" type="button" onClick={() => setAberta(e.chave)}>
                    {e.situacao === 'pendente' ? tx('etapas.fazerAgora', 'Fazer agora') : tx('etapas.ver', 'Ver')}
                  </button>
                )}
                {expandida && (
                  // Na inscrição, '' = nenhuma aberta (null volta a abrir a da vez).
                  <button class="link etapa-acao" type="button" onClick={() => setAberta(props.contexto === 'inscricao' ? '' : null)}>Fechar</button>
                )}
              </div>
              {expandida && (
                <div class="etapa-corpo">
                  {conteudo(e)}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {props.contexto === 'inscricao' && !tudoFeito && (
        <div class="aviso info">{tx('etapas.avisoDepois', 'Você pode fazer as etapas agora ou depois, quando quiser, entrando no seu portal.')}</div>
      )}
      {tudoFeito && <div class="aviso info" style="color:var(--ok);border-color:var(--ok)"><b>{tx('etapas.tudoCerto', 'Tudo certo por aqui.')}</b> {tx('etapas.tudoCertoTexto', 'Acompanhe o andamento pelo seu portal.')}</div>}
    </div>
  )
}

/**
 * Ícone de cada etapa, ao lado do título — reconhecimento rápido do que é a
 * etapa antes de ler. Traço fino na cor da marca (desenhos do conjunto Lucide,
 * licença ISC). Etapa sem ícone próprio fica só com o título.
 */
const DESENHOS: Record<string, string> = {
  cadastro: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  pagamento: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  documentos: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/>',
  contrato: '<path d="M20 19.5v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.5L18 5.5"/><path d="M8 18h1"/><path d="M18.42 9.61a2.1 2.1 0 1 1 2.97 2.97L16.95 17 13 18l.99-3.95 4.43-4.44Z"/>',
  prova: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
}
function IconeDaEtapa({ chave }: { chave: string }) {
  const d = DESENHOS[chave]
  if (!d) return null
  return (
    <svg class="etapa-icone" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
  )
}
