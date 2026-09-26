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

const SITUACAO = { feito: 'Concluído', aguardando: 'Em análise', pendente: 'Pendente' } as const

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
  const [adiadas, setAdiadas] = useState<string[]>([])
  const [aberta, setAberta] = useState<string | null>(null)

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
  // Na inscrição, a etapa da vez é a primeira que falta e não foi adiada.
  const daVez = props.contexto === 'inscricao'
    ? etapas.find((e) => !resolvida(e) && !adiadas.includes(e.chave)) ?? null
    : null
  const tudoFeito = tudoPronto
  const concluidas = etapas.filter(resolvida).length

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
        <h2>{props.contexto === 'inscricao' ? 'Próximos passos' : 'O que falta na sua inscrição'}</h2>
        <span class="sub">{concluidas} de {etapas.length} concluído(s)</span>
      </div>
      <ol class="jornada-lista">
        {etapas.map((e, i) => {
          const expandida = props.contexto === 'inscricao' ? daVez?.chave === e.chave : aberta === e.chave
          return (
            <li key={e.chave} class={`etapa-jornada ${e.situacao} ${expandida ? 'aberta' : ''}`}>
              <div class="etapa-cabeca">
                <span class="etapa-num" aria-hidden="true">{resolvida(e) ? '✓' : i + 1}</span>
                <div class="etapa-txt">
                  <b>{e.titulo}</b>
                  <span class="sub">{e.detalhe}</span>
                </div>
                <span class={`etapa-status ${e.situacao}`}>{SITUACAO[e.situacao]}</span>
                {!expandida && (props.contexto === 'painel' || adiadas.includes(e.chave)) && e.situacao !== 'feito' && (
                  <button class="link" type="button" onClick={() => {
                    if (props.contexto === 'inscricao') setAdiadas((a) => a.filter((x) => x !== e.chave))
                    else setAberta(e.chave)
                  }}>{e.situacao === 'aguardando' ? 'Ver' : 'Fazer agora'}</button>
                )}
                {expandida && props.contexto === 'painel' && (
                  <button class="link" type="button" onClick={() => setAberta(null)}>Fechar</button>
                )}
              </div>
              {expandida && (
                <div class="etapa-corpo">
                  {conteudo(e)}
                  {props.contexto === 'inscricao' && !e.obrigatoria && !resolvida(e) && (
                    <button class="link adiar" type="button" onClick={() => setAdiadas((a) => [...a, e.chave])}>
                      Deixar para depois
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {props.contexto === 'inscricao' && !daVez && !tudoFeito && (
        <div class="aviso info">Você pode concluir o que ficou para depois quando quiser, entrando no seu portal.</div>
      )}
      {tudoFeito && <div class="aviso info" style="color:var(--ok);border-color:var(--ok)"><b>Tudo certo por aqui.</b> Acompanhe o andamento pelo seu portal.</div>}
    </div>
  )
}
