import { useEffect, useRef, useState } from 'preact/hooks'
import {
  consultarPagamento, iniciarPagamento, opcoesDePagamento, removerValorPersonalizado, salvarValorPersonalizado, simularPagamento,
  type EditorDoPlanoNaTela, type EscolhaDePlano, type MetodoPagamento, type NegociacaoNaTela, type OpcoesDePagamento,
} from './api'
import {
  bandeira, errosDoCartao, mascaraCartao, mascaraValidade, type DadosDoCartao,
} from './validacao'
import { tokenizarNaIugu } from './iugu'

const dinheiro = (v: number | null | undefined) =>
  typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'

const dia = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('pt-BR') : null

/** Cobrança que não dá mais para pagar — a pessoa precisa de uma nova. */
const ENCERRADAS = ['overdue', 'expired', 'canceled', 'cancelled', 'failed', 'refunded']

type Meio = 'pix' | 'boleto' | 'credit_card'

/**
 * A cobrança que ainda dá para pagar: a mais recente de Pix ou boleto, não
 * encerrada, com o QR/linha em mãos e dentro do vencimento (vale o dia todo
 * do vencimento — o status do provedor é quem diz se venceu de fato).
 * Cartão não entra: cada tentativa de cartão é uma transação nova.
 */
function ultimaCobrancaValida(lista: MetodoPagamento[]): MetodoPagamento | null {
  const agora = Date.now()
  return lista.find((m) =>
    (m.method === 'pix' || m.method === 'boleto')
    && !ENCERRADAS.includes(m.status) && m.status !== 'paid'
    && temComoPagar(m, m.method as Meio)
    && (!m.expiresAt || new Date(m.expiresAt).getTime() + 86_400_000 > agora),
  ) ?? null
}

/** O que a pessoa precisa ter em mãos para pagar, por método. */
function temComoPagar(m: MetodoPagamento | null, metodo: Meio) {
  if (!m) return false
  if (metodo === 'pix') return !!m.qrCode
  if (metodo === 'boleto') return !!(m.boletoLine || m.boletoPdfUrl)
  return true // cartão: quem resolve é a página do provedor
}

export function Pagamento(props: {
  codigo: string
  token: string
  /** Fecha o passo quando o pagamento é confirmado. */
  aoConfirmar: () => void
}) {
  const [opcoes, setOpcoes] = useState<OpcoesDePagamento | null>(null)
  // Plano de pagamento da oferta e a opção (entrada ou curso completo). null =
  // o que o servidor escolher primeiro; a oferta sem plano nem usa isto.
  const [plano, setPlano] = useState<EscolhaDePlano | null>(null)
  const [metodo, setMetodo] = useState<Meio | null>(null)
  const [parcelas, setParcelas] = useState(1)
  const [cobranca, setCobranca] = useState<MetodoPagamento | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [simulando, setSimulando] = useState(false)
  const [verificando, setVerificando] = useState(false)
  // O cartão vive só neste componente e só até o envio. Não entra no rascunho
  // (que é gravado em localStorage e no servidor) nem em lugar nenhum.
  const [cartao, setCartao] = useState<Partial<DadosDoCartao>>({})
  const [errosCartao, setErrosCartao] = useState<Record<string, string>>({})
  // O cupom aplicado vale para todos os meios: por isso mora aqui, e não dentro
  // de cada forma de pagamento.
  const [cupomDigitado, setCupomDigitado] = useState('')
  const [cupomAtivo, setCupomAtivo] = useState('')
  const [validandoCupom, setValidandoCupom] = useState(false)
  // Valor personalizado salvo pelo agente: recarrega as opções com o novo preço.
  const [recarga, setRecarga] = useState(0)
  const confirmado = useRef(false)
  // Abrindo a etapa de novo: procura a cobrança já gerada antes de oferecer a
  // escolha do meio. Sem isto, cada "Fazer agora" recomeçava do zero e a pessoa
  // gerava outro Pix/boleto — o anterior, ainda válido, ficava perdido.
  const [restaurando, setRestaurando] = useState(true)

  const pronto = temComoPagar(cobranca, metodo ?? 'pix')
  const encerrada = !!cobranca && ENCERRADAS.includes(cobranca.status)

  // Quais meios este portal aceita e quanto fica cada opção. A conta do
  // parcelamento é do servidor: juros e piso de parcela são regra de negócio, e
  // o número que a pessoa vê tem de ser o que vai ser cobrado.
  useEffect(() => {
    let vivo = true
    opcoesDePagamento(props.codigo, props.token, cupomAtivo || undefined, plano ?? undefined)
      .then((o) => { if (vivo) setOpcoes(o) })
      .catch(() => {
        // Sem resposta, cai nos dois meios que sempre existiram em vez de
        // deixar o esqueleto para sempre.
        if (vivo) {
          setOpcoes({
            escopo: 'taxa',
            valor: 0,
            meios: { pix: { ativo: true }, boleto: { ativo: true }, cartao: { ativo: false } },
          })
        }
      })
    return () => { vivo = false }
  }, [props.codigo, props.token, cupomAtivo, plano?.planoId, plano?.opcao, recarga])

  useEffect(() => {
    let vivo = true
    consultarPagamento(props.codigo, props.token)
      .then((r) => {
        if (!vivo || !r) return
        if (r.paymentStatus === 'paid' || r.paymentPaidAt) {
          if (!confirmado.current) { confirmado.current = true; props.aoConfirmar() }
          return
        }
        const valida = ultimaCobrancaValida(r.methods ?? [])
        if (valida) { setMetodo(valida.method as Meio); setCobranca(valida) }
      })
      .catch(() => {})
      .finally(() => { if (vivo) setRestaurando(false) })
    return () => { vivo = false }
  }, [props.codigo, props.token])

  async function sincronizar(): Promise<boolean> {
    const r = await consultarPagamento(props.codigo, props.token).catch(() => null)
    if (!r) return false
    if (r.paymentStatus === 'paid' || r.paymentPaidAt) {
      if (!confirmado.current) {
        confirmado.current = true
        props.aoConfirmar()
      }
      return true
    }
    if (r.checkoutUrl) setCheckoutUrl(r.checkoutUrl)
    const atual = r.methods?.find((m) => m.id === cobranca?.id) ?? r.methods?.[0]
    if (atual) setCobranca(atual)
    return false
  }

  useEffect(() => {
    if (!cobranca || encerrada) return
    // Cartão aprovado na hora já volta pago: confirma de uma vez em vez de
    // parar de consultar — sem isto a tela ficava em "aguardando" para
    // sempre, até a pessoa clicar em "Já paguei".
    if (cobranca.status === 'paid') { void sincronizar(); return }
    const intervalo = pronto ? 5000 : 2000
    const t = setInterval(() => { sincronizar() }, intervalo)
    return () => clearInterval(t)
  }, [cobranca, pronto, encerrada, props.codigo, props.token])

  async function escolher(m: Meio, vezes = 1, dadosDoCartao?: DadosDoCartao) {
    setMetodo(m)
    setParcelas(vezes)
    setCarregando(true)
    setErro(null)
    try {
      // iugu: o cartão vira token aqui, no navegador; o servidor recebe só o token.
      const tokenizacao = m === 'credit_card' ? opcoes?.meios.cartao.tokenizacao : undefined
      const cardToken = tokenizacao && dadosDoCartao
        ? await tokenizarNaIugu(tokenizacao, dadosDoCartao)
        : undefined
      const r = await iniciarPagamento(
        props.codigo, m, props.token, vezes,
        cardToken ? undefined : dadosDoCartao,
        cupomAtivo || undefined,
        cardToken,
        // O que o servidor confirmou nas opções — é o preço que a tela mostrou.
        opcoes?.escolha,
      )
      // Some da memória assim que a chamada volta, dê certo ou errado.
      setCartao({})
      setCobranca(r.method)
      if (r.checkoutUrl) {
        setCheckoutUrl(r.checkoutUrl)
        // Cartão pela página do provedor: a nova aba é aberta pelo clique da
        // pessoa, então o navegador não bloqueia como bloquearia um pop-up.
        window.open(r.checkoutUrl, '_blank', 'noopener')
      }
    } catch (e: any) {
      setErro(e.message)
      // Cartão recusado: fica onde está, com o formulário aberto, para tentar
      // outro. Voltar para a escolha de meio faria a pessoa recomeçar — e
      // recusa é o desfecho mais comum de um checkout, não uma exceção.
      if (!e?.recusado) setMetodo(null)
    } finally {
      setCarregando(false)
    }
  }

  async function aplicarCupom() {
    const code = cupomDigitado.trim()
    if (!code) return
    setValidandoCupom(true)
    // Quem recalcula é o servidor: a tela só pede de novo as opções com o
    // código, e todos os meios já voltam com o preço certo.
    setCupomAtivo(code)
    setTimeout(() => setValidandoCupom(false), 600)
  }

  function removerCupom() {
    setCupomDigitado('')
    setCupomAtivo('')
  }

  async function pagarComCartao(hospedado: boolean) {
    if (hospedado) {
      await escolher('credit_card', 1)
      return
    }
    // Confere aqui antes de mandar: cada recusa por número errado conta como
    // transação negada na conta da instituição.
    const problemas = errosDoCartao(cartao)
    if (Object.keys(problemas).length) {
      setErrosCartao(problemas)
      return
    }
    await escolher('credit_card', parcelas, cartao as DadosDoCartao)
  }

  async function verificarAgora() {
    setVerificando(true)
    setErro(null)
    try {
      const pago = await sincronizar()
      if (!pago) {
        setErro('Ainda não identificamos o pagamento. Se você acabou de pagar, '
          + 'pode levar alguns instantes — esta tela avança sozinha quando cair.')
      }
    } finally {
      setVerificando(false)
    }
  }

  function novaCobranca() {
    setCobranca(null)
    setMetodo(null)
    setCheckoutUrl(null)
    setErro(null)
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch { /* alguns navegadores bloqueiam: o código fica visível para copiar à mão */ }
  }

  async function confirmarSimulado() {
    setSimulando(true)
    try {
      await simularPagamento(props.codigo, props.token)
      props.aoConfirmar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSimulando(false)
    }
  }

  // ── escolha do meio ──
  if (!metodo && restaurando) {
    return (
      <div class="cartao">
        <h2>Pagamento</h2>
        <p class="sub">Conferindo se já existe uma cobrança para você…</p>
        <div class="esqueleto" style="height:150px" />
      </div>
    )
  }
  if (!metodo) {
    // Enquanto as opções não chegam, esqueleto. Desenhar dois botões e depois
    // acrescentar um terceiro faz a lista pular embaixo do dedo de quem já ia
    // clicar — e o meio que falta é justamente o que a pessoa procurava.
    if (!opcoes) {
      return (
        <div class="cartao">
          <h2>Como você quer pagar?</h2>
          <p class="sub">A inscrição só é confirmada depois do pagamento.</p>
          <div class="esqueleto" style="height:150px" />
        </div>
      )
    }
    const m = opcoes.meios
    const mostraPix = m.pix.ativo
    const mostraBoleto = m.boleto.ativo
    const mostraCartao = !!m.cartao.ativo
    const opcoesCartao = m?.cartao.opcoes ?? []
    const opcoesBoleto = m?.boleto.parcelado ? (m?.boleto.opcoes ?? []) : []
    // Com tabela de preços, cada botão diz o preço do seu meio — é a
    // comparação que o site faz ("à vista no Pix" × "12x no cartão").
    const tabela = opcoes.tabela ?? null
    const ultimaCartao = opcoesCartao.length ? opcoesCartao[opcoesCartao.length - 1] : null
    const ultimaBoleto = opcoesBoleto.length > 1 ? opcoesBoleto[opcoesBoleto.length - 1] : null
    // Cupom que zera o valor (ex.: 100% para ex-aluno): não há o que pagar.
    // Um botão só — escolher PIX/boleto/cartão de R$ 0,00 não faz sentido, e o
    // cartão ainda pediria os dados à toa. O servidor conclui por isenção.
    const zerado = !!opcoes.cupom?.aplicado
      && (m.pix.ativo ? m.pix.valor === 0 : opcoes.valor === 0)
    const meioDaIsencao: Meio | null = mostraPix ? 'pix' : mostraBoleto ? 'boleto' : mostraCartao ? 'credit_card' : null

    return (
      <div class="cartao">
        <h2>Como você quer pagar?</h2>
        <p class="sub">
          {opcoes.valor > 0 ? (
            <>
              {/* Preço cheio riscado ao lado do novo: é assim que a pessoa vê
                  que o desconto entrou de verdade. */}
              {opcoes.valorTabela && opcoes.valorTabela > opcoes.valor && (
                <s class="riscado">{dinheiro(opcoes.valorTabela)}</s>
              )}
              {opcoes.rotulo && <span>{opcoes.rotulo}: </span>}
              <b>{dinheiro(opcoes.valor)}</b> — a inscrição só é confirmada depois do pagamento.
            </>
          ) : 'A inscrição só é confirmada depois do pagamento.'}
        </p>
        {erro && <div class="aviso erro" role="alert">{erro}</div>}
        {opcoes.semPlano && <div class="aviso info" role="status">{opcoes.aviso}</div>}

        {/* Plano de pagamento da oferta: primeiro o plano (quando há mais de
            um), depois o que pagar agora — só a entrada ou o curso completo.
            Trocar recalcula os meios abaixo. */}
        {!!opcoes.planos?.length && (
          <EscolhaDoPlano
            opcoes={opcoes}
            aoEscolher={(e) => { setOpcoes(null); setPlano(e) }}
          />
        )}

        {/* Só no atendimento pelo painel (o servidor manda `negociacao` só ao agente). */}
        {opcoes.negociacao && (
          <ValorPersonalizado
            codigo={props.codigo}
            token={props.token}
            negociacao={opcoes.negociacao}
            aoMudar={(avisos) => {
              // Cobrança aberta com o valor antigo foi cancelada no servidor.
              setCobranca(null); setMetodo(null); setErro(avisos.length ? avisos.join(' ') : null)
              setOpcoes(null); setRecarga((n) => n + 1)
            }}
          />
        )}

        {/* O cupom fica aqui, antes da escolha do meio: ele muda o preço de
            todos, e descobrir isso depois de escolher faria a pessoa voltar. */}
        <div class="cupom">
          {opcoes.cupom?.aplicado ? (
            <div class="cupom-ok">
              <div>
                <b>{opcoes.cupom.code}</b> aplicado
                {opcoes.cupom.desconto ? ` · −${dinheiro(opcoes.cupom.desconto)}` : ''}
                {/* Quando o desconto à vista era maior, o candidato precisa
                    saber que não perdeu nada por isso. */}
                {opcoes.cupom.origem === 'a_vista' && (
                  <span class="ajuda"> — mantivemos o desconto à vista, que é maior</span>
                )}
                {opcoes.cupom.descricao && <span class="ajuda"> · {opcoes.cupom.descricao}</span>}
                {/* Cupom que vale só em alguns meios ou com teto de parcelas:
                    dizer antes da escolha evita a surpresa no valor. */}
                {!!opcoes.cupom.metodos?.length && (
                  <span class="ajuda"> · vale no {opcoes.cupom.metodos.map((x) => (x === 'pix' ? 'PIX' : x === 'boleto' ? 'boleto' : 'cartão')).join(' ou ')}</span>
                )}
                {!!opcoes.cupom.maxParcelas && <span class="ajuda"> · até {opcoes.cupom.maxParcelas}x</span>}
              </div>
              <button class="link" onClick={removerCupom}>remover</button>
            </div>
          ) : (
            <>
              <label for="cupom">Tem um cupom de desconto?</label>
              <div class="cupom-linha">
                <input
                  id="cupom"
                  value={cupomDigitado}
                  placeholder="Digite o código"
                  autocomplete="off"
                  onInput={(e) => setCupomDigitado((e.target as HTMLInputElement).value.toUpperCase())}
                  onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') void aplicarCupom() }}
                />
                <button class="secundario" onClick={aplicarCupom} disabled={validandoCupom || !cupomDigitado.trim()}>
                  {validandoCupom ? 'Conferindo…' : 'Aplicar'}
                </button>
              </div>
              {opcoes.cupom && !opcoes.cupom.aplicado && opcoes.cupom.motivo && (
                <span class="erro">{opcoes.cupom.motivo}</span>
              )}
            </>
          )}
        </div>

        {zerado && meioDaIsencao ? (
          <div class="aviso info" role="status">
            <p style="margin:0 0 10px">
              Com o cupom <b>{opcoes.cupom?.code}</b>, você está <b>isento</b> deste pagamento. Não há nada a pagar — é só confirmar para seguir com a inscrição.
            </p>
            <button class="principal" onClick={() => escolher(meioDaIsencao)} disabled={carregando}>
              {carregando ? 'Confirmando…' : 'Confirmar isenção'}
            </button>
          </div>
        ) : (
        <div class="pagamento-opcoes">
          {mostraPix && (
            <button class="opcao-pagamento" onClick={() => escolher('pix')} disabled={carregando}>
              <b>PIX</b>
              <span>
                {tabela
                  ? `${dinheiro(m.pix.valor)} à vista`
                  : m?.pix.descontoPct
                    ? `${dinheiro(m.pix.valor)} · ${m.pix.descontoPct}% de desconto`
                    : 'Confirmação em segundos'}
              </span>
            </button>
          )}
          {mostraBoleto && (
            <button
              class="opcao-pagamento"
              // Com parcelamento ligado, primeiro a pessoa escolhe em quantas
              // vezes; sem ele, vai direto para o boleto.
              onClick={() => (opcoesBoleto.length > 1 ? setMetodo('boleto') : escolher('boleto', opcoesBoleto[0]?.parcelas ?? 1))}
              disabled={carregando}
            >
              <b>Boleto</b>
              <span>
                {tabela
                  ? `${dinheiro(opcoes.valor)} à vista${ultimaBoleto ? ` ou ${ultimaBoleto.parcelas}x ${dinheiro(ultimaBoleto.valorParcela)}` : ''}`
                  : opcoesBoleto.length > 1
                    ? `${opcoesBoleto[0]?.parcelas === 1 ? 'à vista ou ' : ''}em até ${m?.boleto.parcelasMax}x${m.boleto.descontoPct ? ` · ${m.boleto.descontoPct}% de desconto à vista` : ''}`
                    : opcoesBoleto[0] && opcoesBoleto[0].parcelas > 1
                      ? opcoesBoleto[0].descricao
                      : m.boleto.descontoPct && opcoesBoleto[0]
                        ? `${dinheiro(opcoesBoleto[0].valorEntrada)} · ${m.boleto.descontoPct}% de desconto`
                        : 'Compensa em até 3 dias úteis'}
              </span>
            </button>
          )}
          {mostraCartao && (
            <button class="opcao-pagamento" onClick={() => setMetodo('credit_card')} disabled={carregando}>
              <b>Cartão de crédito</b>
              <span>
                {tabela && ultimaCartao
                  ? `${ultimaCartao.parcelas}x ${dinheiro(ultimaCartao.valorParcela)}${ultimaCartao.semJuros ? ' sem juros' : ''}`
                  : opcoesCartao.length > 1
                    ? `em até ${opcoesCartao[opcoesCartao.length - 1].parcelas}x`
                    : 'à vista'}
              </span>
            </button>
          )}
        </div>
        )}
      </div>
    )
  }

  // ── cartão: escolher em quantas vezes, antes de criar a cobrança ──
  if (metodo === 'credit_card' && !cobranca && !carregando) {
    const lista = opcoes?.meios.cartao.opcoes ?? []
    const hospedado = !!opcoes?.meios.cartao.hospedado
    return (
      <div class="cartao">
        <h2>Cartão de crédito</h2>
        <p class="sub">
          {hospedado
            ? 'Confira as opções e escolha o parcelamento na página de pagamento.'
            : 'Escolha em quantas vezes você quer pagar.'}
        </p>
        {erro && <div class="aviso erro" role="alert">{erro}</div>}
        <div class="parcelas">
          {lista.map((o) => (
            <button
              key={o.parcelas}
              class="opcao-parcela"
              // Na página do provedor a escolha é lá; aqui a lista é simulação,
              // e fingir que o clique decide seria mentir para o candidato.
              aria-pressed={!hospedado && parcelas === o.parcelas}
              disabled={hospedado}
              onClick={() => setParcelas(o.parcelas)}
            >
              <span class="q">{o.parcelas}x</span>
              <span class="v">{dinheiro(o.valorParcela)}</span>
              <span class="j">{o.semJuros ? 'sem juros' : `total ${dinheiro(o.valorTotal)}`}</span>
            </button>
          ))}
        </div>
        {hospedado ? (
          <p class="ajuda" style="margin-top:12px">
            O pagamento com cartão é feito na página segura do nosso processador, que
            abre numa nova aba. As vezes disponíveis e os juros são os da operadora —
            os valores acima são uma simulação. Esta tela avança sozinha quando o
            pagamento cair.
          </p>
        ) : (
          <FormularioDeCartao
            valores={cartao}
            erros={errosCartao}
            aoMudar={(campo, valor) => {
              setCartao((c) => ({ ...c, [campo]: valor }))
              // Enquanto digita, só some com o erro já resolvido — acusar campo
              // pela metade atrapalha quem ainda está preenchendo.
              setErrosCartao((e) => {
                const novo = { ...e }
                delete novo[campo === 'expiryMonth' || campo === 'expiryYear' ? 'validade' : campo]
                return novo
              })
            }}
          />
        )}
        <div class="acoes">
          <button class="secundario" onClick={() => { setMetodo(null); setErro(null) }}>Voltar</button>
          <button class="principal" onClick={() => pagarComCartao(hospedado)} disabled={carregando}>
            {hospedado ? 'Ir para o pagamento' : `Pagar ${parcelas > 1 ? `em ${parcelas}x` : 'agora'}`}
          </button>
        </div>
      </div>
    )
  }

  // ── boleto parcelado: escolher em quantas vezes ──
  if (metodo === 'boleto' && !cobranca && !carregando && (opcoes?.meios.boleto.opcoes?.length ?? 0) > 1) {
    const lista = opcoes!.meios.boleto.opcoes!
    const escolhida = lista.find((o) => o.parcelas === parcelas) ?? lista[0]
    return (
      <div class="cartao">
        <h2>Boleto</h2>
        <p class="sub">Escolha em quantas vezes você quer pagar.</p>
        {erro && <div class="aviso erro" role="alert">{erro}</div>}
        <div class="parcelas">
          {lista.map((o) => (
            <button
              key={o.parcelas}
              class="opcao-parcela"
              aria-pressed={escolhida.parcelas === o.parcelas}
              onClick={() => setParcelas(o.parcelas)}
            >
              <span class="q">{o.parcelas}x</span>
              <span class="v">
                {dinheiro(o.parcelas === 1 ? o.valorEntrada : o.valorParcela)}
                {o.valorEmDia != null && <span class="em-dia">{dinheiro(o.valorEmDia)} pagando até {o.pontualidadeAte}</span>}
              </span>
              <span class="j">
                {o.semAcrescimo ? 'sem acréscimo' : `total ${dinheiro(o.valorTotal)}`}
              </span>
            </button>
          ))}
        </div>
        {escolhida.parcelas > 1 && (
          <p class="ajuda" style="margin-top:12px">
            Você paga agora {dinheiro(escolhida.valorEntrada)} e as {escolhida.parcelas - 1} parcelas
            seguintes chegam mês a mês, pelo canal que você usa.
            {escolhida.valorEmDia != null && ` Pagando até ${escolhida.pontualidadeAte}, cada uma sai por ${dinheiro(escolhida.valorEmDia)}.`}
          </p>
        )}
        <div class="acoes">
          <button class="secundario" onClick={() => { setMetodo(null); setErro(null) }}>Voltar</button>
          <button class="principal" onClick={() => escolher('boleto', escolhida.parcelas)}>
            {escolhida.parcelas > 1 ? `Gerar boleto da entrada` : 'Gerar boleto'}
          </button>
        </div>
      </div>
    )
  }

  const vencimento = dia(cobranca?.expiresAt)
  const noCartao = metodo === 'credit_card'

  return (
    <div class="cartao">
      <h2>
        {metodo === 'pix' ? 'Pague com PIX' : noCartao ? 'Cartão de crédito' : 'Boleto bancário'}
      </h2>
      <p class="sub">
        {dinheiro(cobranca?.amount)}
        {noCartao && parcelas > 1 && ` em ${parcelas}x`}
        {!noCartao && vencimento && ` · vence em ${vencimento}`}
      </p>

      {carregando && <div class="esqueleto" style="height:200px" />}
      {erro && <div class="aviso erro" role="alert">{erro}</div>}

      {cobranca?.provider === 'simulado' && (
        <div class="aviso info">
          <b>Ambiente de teste.</b> Esta cobrança tem a forma de uma real, mas
          nenhum banco a reconhece — serve para conferir o fluxo.
        </div>
      )}

      {encerrada && (
        <>
          <div class="aviso erro" role="alert">
            Esta cobrança não está mais válida{vencimento ? ` (venceu em ${vencimento})` : ''}.
            Gere uma nova para continuar — nada do que você já preencheu se perde.
          </div>
          <button class="principal" onClick={novaCobranca}>Gerar nova cobrança</button>
        </>
      )}

      {/* Cartão na página do provedor: a aba já abriu, mas o bloqueador de
          pop-up pode ter engolido — então o link fica à vista. */}
      {!encerrada && noCartao && checkoutUrl && (
        <>
          <p class="ajuda" style="text-align:center">
            Abrimos a página de pagamento numa nova aba. Se ela não apareceu, use o botão abaixo.
          </p>
          <a href={checkoutUrl} target="_blank" rel="noopener">
            <button class="principal" style="width:100%">Abrir página de pagamento</button>
          </a>
        </>
      )}

      {!encerrada && !carregando && !pronto && !noCartao && cobranca && (
        <>
          <div class="esqueleto" style="height:200px" />
          <p class="ajuda" style="text-align:center">
            Preparando seu {metodo === 'pix' ? 'código PIX' : 'boleto'}… isto costuma levar poucos segundos.
          </p>
        </>
      )}

      {!encerrada && metodo === 'pix' && cobranca?.qrCode && (
        <>
          {cobranca.qrCodeUrl && (
            <div class="qr-caixa"><img src={cobranca.qrCodeUrl} alt="QR Code do PIX" width={240} height={240} /></div>
          )}
          <p class="ajuda" style="text-align:center">Abra o aplicativo do banco e leia o código.</p>
          <button class="principal" style="width:100%" onClick={() => copiar(cobranca.qrCode!)}>
            {copiado ? 'Código copiado' : 'Copiar código PIX'}
          </button>
          <details style="margin-top:12px">
            <summary class="ajuda">Ver o código</summary>
            <p class="codigo-longo">{cobranca.qrCode}</p>
          </details>
        </>
      )}

      {!encerrada && metodo === 'boleto' && (cobranca?.boletoLine || cobranca?.boletoPdfUrl) && (
        <>
          {cobranca.boletoLine && (
            <>
              <p class="codigo-longo" style="text-align:center">{cobranca.boletoLine}</p>
              <button class="principal" style="width:100%" onClick={() => copiar(cobranca.boletoLine!)}>
                {copiado ? 'Linha copiada' : 'Copiar linha digitável'}
              </button>
            </>
          )}
          {/* O PDF aparece mesmo sem a linha (ela pode chegar um pouco depois). */}
          {cobranca.boletoPdfUrl && (
            <a href={cobranca.boletoPdfUrl} target="_blank" rel="noopener">
              <button class={cobranca.boletoLine ? 'secundario' : 'principal'} style="width:100%;margin-top:8px">Abrir boleto em PDF</button>
            </a>
          )}
        </>
      )}

      {!encerrada && (pronto || (noCartao && checkoutUrl)) && (
        <>
          <p class="ajuda" style="text-align:center;margin-top:14px">
            Assim que o pagamento cair, esta tela avança sozinha.
          </p>
          <button class="secundario" style="width:100%;margin-top:10px" onClick={verificarAgora} disabled={verificando}>
            {verificando ? 'Verificando…' : 'Já paguei — verificar agora'}
          </button>
        </>
      )}

      {cobranca?.provider === 'simulado' && !encerrada && (
        <button class="secundario" style="width:100%;margin-top:10px" onClick={confirmarSimulado} disabled={simulando}>
          {simulando ? 'Confirmando…' : 'Simular pagamento confirmado'}
        </button>
      )}

      {/* Trocar de meio: a cobrança atual continua valendo até vencer; a nova
          é gerada só quando a pessoa escolher outro meio. */}
      {!encerrada && !noCartao && pronto && (
        <button class="link" type="button" style="display:block;margin:14px auto 0" onClick={novaCobranca}>
          Pagar de outra forma
        </button>
      )}
    </div>
  )
}

/**
 * Formulário do cartão.
 *
 * Fica dentro da tela de pagamento e não guarda nada: os valores vivem no
 * estado do componente pai e são apagados assim que a cobrança é enviada. Nada
 * de `autocomplete` desligado — o preenchimento do navegador é o que faz a
 * pessoa não errar o número, e errar aqui custa uma transação recusada.
 */
function FormularioDeCartao(props: {
  valores: Partial<DadosDoCartao>
  erros: Record<string, string>
  aoMudar: (campo: keyof DadosDoCartao, valor: string) => void
}) {
  const numero = props.valores.number ?? ''
  const marca = bandeira(numero)
  const validade = props.valores.expiryMonth
    ? `${props.valores.expiryMonth}${props.valores.expiryYear ? '/' + props.valores.expiryYear.slice(-2) : ''}`
    : ''

  return (
    <div class="form-cartao">
      <div class={`campo ${props.erros.number ? 'ruim' : ''}`}>
        <label for="cc-numero">
          Número do cartão
          {marca && <span class="marca-cartao">{marca.nome}</span>}
        </label>
        <input
          id="cc-numero"
          name="cardnumber"
          inputMode="numeric"
          autocomplete="cc-number"
          placeholder="0000 0000 0000 0000"
          value={mascaraCartao(numero)}
          onInput={(e) => props.aoMudar('number', (e.target as HTMLInputElement).value.replace(/\D/g, ''))}
        />
        {props.erros.number && <span class="erro">{props.erros.number}</span>}
      </div>

      <div class={`campo ${props.erros.holderName ? 'ruim' : ''}`}>
        <label for="cc-nome">Nome impresso no cartão</label>
        <input
          id="cc-nome"
          name="ccname"
          autocomplete="cc-name"
          placeholder="Como aparece no cartão"
          value={props.valores.holderName ?? ''}
          onInput={(e) => props.aoMudar('holderName', (e.target as HTMLInputElement).value)}
        />
        {props.erros.holderName && <span class="erro">{props.erros.holderName}</span>}
      </div>

      <div class="cartao-linha">
        <div class={`campo ${props.erros.validade ? 'ruim' : ''}`}>
          <label for="cc-validade">Validade</label>
          <input
            id="cc-validade"
            name="cc-exp"
            inputMode="numeric"
            autocomplete="cc-exp"
            placeholder="MM/AA"
            value={mascaraValidade(validade)}
            onInput={(e) => {
              const n = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
              props.aoMudar('expiryMonth', n.slice(0, 2))
              props.aoMudar('expiryYear', n.length > 2 ? `20${n.slice(2)}` : '')
            }}
          />
          {props.erros.validade && <span class="erro">{props.erros.validade}</span>}
        </div>

        <div class={`campo ${props.erros.ccv ? 'ruim' : ''}`}>
          <label for="cc-ccv">
            Código de segurança
            <span class="opcional"> ({marca?.digitosCcv ?? 3} dígitos)</span>
          </label>
          <input
            id="cc-ccv"
            name="cvc"
            inputMode="numeric"
            autocomplete="cc-csc"
            placeholder={marca?.digitosCcv === 4 ? '0000' : '000'}
            maxLength={4}
            value={props.valores.ccv ?? ''}
            onInput={(e) => props.aoMudar('ccv', (e.target as HTMLInputElement).value.replace(/\D/g, ''))}
          />
          {props.erros.ccv && <span class="erro">{props.erros.ccv}</span>}
        </div>
      </div>

      <p class="ajuda" style="margin-top:4px">
        Os dados do cartão são usados só para esta cobrança e não ficam guardados.
      </p>
    </div>
  )
}

/**
 * Valor personalizado — só para a equipe, no atendimento pelo painel. O agente
 * controla o plano inteiro desta inscrição: matrícula, mensalidade, quantas
 * mensalidades, dia do vencimento, o que pode ser pago (só a entrada e/ou o
 * curso completo), cada forma (ligada, desconto, até quantas vezes, juros, preço
 * próprio), pontualidade e as datas de vencimento. O candidato vê só o valor
 * final — nada aqui aparece para ele.
 */
type Txt = string
type FormaTxt = { ativo: boolean; descontoPct: Txt; valorBase: Txt }
type ParcTxt = { ativo: boolean; parcelasMax: Txt; jurosMesPct: Txt; valorBase: Txt; multiFaixa: boolean }
type OpcaoTxt = { ativo: boolean; pix: FormaTxt; boleto: FormaTxt; cartao: ParcTxt; boletoParcelado: ParcTxt }
type EditorTxt = {
  matricula: Txt; mensalidade: Txt; numParcelas: Txt; diaVencimento: Txt
  opcoes: { entrada: OpcaoTxt; integral: OpcaoTxt }
  pontualidade: { ativo: boolean; descontoPct: Txt; diaLimite: Txt; ateVencimento: boolean; terminaEm90: boolean }
  vencimentoEntrada: Txt; primeiraSeguinte: Txt
}

const brl2 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : '')
const txt = (v: number | null | undefined) => (typeof v === 'number' ? String(v).replace('.', ',') : '')

function paraTexto(e: EditorDoPlanoNaTela): EditorTxt {
  const f = (x: EditorDoPlanoNaTela['opcoes']['entrada']['pix']): FormaTxt => ({ ativo: x.ativo, descontoPct: txt(x.descontoPct), valorBase: brl2(x.valorBase) })
  const p = (x: EditorDoPlanoNaTela['opcoes']['entrada']['cartao']): ParcTxt => ({
    ativo: x.ativo, parcelasMax: String(x.parcelasMax), valorBase: brl2(x.valorBase),
    jurosMesPct: x.jurosMesPct === null ? '' : txt(x.jurosMesPct), multiFaixa: x.jurosMesPct === null,
  })
  const o = (x: EditorDoPlanoNaTela['opcoes']['entrada']): OpcaoTxt => ({ ativo: x.ativo, pix: f(x.pix), boleto: f(x.boleto), cartao: p(x.cartao), boletoParcelado: p(x.boletoParcelado) })
  return {
    matricula: brl2(e.matricula), mensalidade: brl2(e.mensalidade), numParcelas: String(e.numParcelas), diaVencimento: String(e.diaVencimento),
    opcoes: { entrada: o(e.opcoes.entrada), integral: o(e.opcoes.integral) },
    pontualidade: { ativo: e.pontualidade.ativo, descontoPct: txt(e.pontualidade.descontoPct), diaLimite: String(e.pontualidade.diaLimite), ateVencimento: e.pontualidade.ateVencimento, terminaEm90: e.pontualidade.terminaEm90 },
    vencimentoEntrada: e.vencimentoEntrada ?? '', primeiraSeguinte: e.primeiraSeguinte ?? '',
  }
}

function paraEnvio(e: EditorTxt) {
  const parc = (x: ParcTxt) => ({ ativo: x.ativo, parcelasMax: x.parcelasMax, valorBase: x.valorBase || null, jurosMesPct: x.jurosMesPct.trim() === '' ? null : x.jurosMesPct })
  const forma = (x: FormaTxt) => ({ ativo: x.ativo, descontoPct: x.descontoPct || '0', valorBase: x.valorBase || null })
  const op = (x: OpcaoTxt) => ({ ativo: x.ativo, pix: forma(x.pix), boleto: forma(x.boleto), cartao: parc(x.cartao), boletoParcelado: parc(x.boletoParcelado) })
  return {
    matricula: e.matricula || '0', mensalidade: e.mensalidade || '0', numParcelas: e.numParcelas, diaVencimento: e.diaVencimento,
    opcoes: { entrada: op(e.opcoes.entrada), integral: op(e.opcoes.integral) },
    pontualidade: e.pontualidade,
    vencimentoEntrada: e.vencimentoEntrada || null, primeiraSeguinte: e.primeiraSeguinte || null,
  }
}

function Campo(props: { rotulo: string; valor: Txt; aoMudar: (v: Txt) => void; tabela?: string | undefined; tipo?: string; dica?: string; largura?: string }) {
  return (
    <label class="vp-campo" style={props.largura ? `max-width:${props.largura}` : undefined}>
      <span>{props.rotulo}</span>
      <input type={props.tipo ?? 'text'} inputMode={props.tipo ? undefined : 'decimal'} value={props.valor}
        onInput={(ev) => props.aoMudar((ev.target as HTMLInputElement).value)} />
      {(props.tabela || props.dica) && <small class="ajuda">{props.tabela ? `tabela: ${props.tabela}` : ''}{props.tabela && props.dica ? ' · ' : ''}{props.dica ?? ''}</small>}
    </label>
  )
}

function Marca(props: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <label class="vp-marca">
      <input type="checkbox" checked={props.marcado} onChange={(ev) => props.aoMudar((ev.target as HTMLInputElement).checked)} />
      <span>{props.rotulo}</span>
    </label>
  )
}

function ValorPersonalizado(props: {
  codigo: string
  token: string
  negociacao: NegociacaoNaTela
  aoMudar: (avisos: string[]) => void
}) {
  const { plano, atual, pode, tabela, editor: emVigor, resumo } = props.negociacao
  const [editando, setEditando] = useState(false)
  const [ed, setEd] = useState<EditorTxt | null>(null)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  if (!plano || !emVigor || !tabela) return null
  const ativoAqui = atual && atual.planoId === plano.id ? atual : null
  const emOutroPlano = atual && atual.planoId !== plano.id

  function abrir() { setEd(paraTexto(emVigor!)); setMotivo(ativoAqui?.motivo ?? ''); setErro(null); setEditando(true) }
  function voltarCamposATabela() { setEd({ ...paraTexto(tabela!), vencimentoEntrada: ed?.vencimentoEntrada ?? '', primeiraSeguinte: ed?.primeiraSeguinte ?? '' }) }
  const mudar = (f: (e: EditorTxt) => void) => setEd((e) => { if (!e) return e; const c: EditorTxt = JSON.parse(JSON.stringify(e)); f(c); return c })

  async function salvar() {
    if (!ed) return
    setSalvando(true); setErro(null)
    try {
      const r = await salvarValorPersonalizado(props.codigo, props.token, { planoId: plano!.id, motivo, editor: paraEnvio(ed) })
      setEditando(false); props.aoMudar(r.avisos ?? [])
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }
  async function voltarATabela() {
    setSalvando(true); setErro(null)
    try { const r = await removerValorPersonalizado(props.codigo, props.token); setEditando(false); props.aoMudar(r.avisos ?? []) }
    catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  const T = tabela
  const blocoOpcao = (chave: 'entrada' | 'integral', titulo: string) => {
    const o = ed!.opcoes[chave]
    const t = T.opcoes[chave]
    return (
      <fieldset class="vp-grupo">
        <legend><Marca rotulo={titulo} marcado={o.ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave].ativo = v })} /></legend>
        {o.ativo && (
          <div class="vp-formas">
            <div class="vp-forma">
              <Marca rotulo="Pix à vista" marcado={o.pix.ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave].pix.ativo = v })} />
              {o.pix.ativo && <div class="vp-linha">
                <Campo rotulo="Desconto %" valor={o.pix.descontoPct} tabela={`${txt(t.pix.descontoPct)}%`} largura="120px" aoMudar={(v) => mudar((e) => { e.opcoes[chave].pix.descontoPct = v })} />
                <Campo rotulo="Preço próprio (total R$)" valor={o.pix.valorBase} tabela={t.pix.valorBase ? brl2(t.pix.valorBase) : 'do plano'} dica="vazio = calcula pelo plano" aoMudar={(v) => mudar((e) => { e.opcoes[chave].pix.valorBase = v })} />
              </div>}
            </div>
            <div class="vp-forma">
              <Marca rotulo="Boleto à vista" marcado={o.boleto.ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave].boleto.ativo = v })} />
              {o.boleto.ativo && <div class="vp-linha">
                <Campo rotulo="Desconto %" valor={o.boleto.descontoPct} tabela={`${txt(t.boleto.descontoPct)}%`} largura="120px" aoMudar={(v) => mudar((e) => { e.opcoes[chave].boleto.descontoPct = v })} />
                <Campo rotulo="Preço próprio (total R$)" valor={o.boleto.valorBase} tabela={t.boleto.valorBase ? brl2(t.boleto.valorBase) : 'do plano'} dica="vazio = calcula pelo plano" aoMudar={(v) => mudar((e) => { e.opcoes[chave].boleto.valorBase = v })} />
              </div>}
            </div>
            {(['cartao', 'boletoParcelado'] as const).map((k) => {
              const x = o[k]; const tx = t[k]
              const nome = k === 'cartao' ? 'Cartão de crédito' : 'Boleto parcelado'
              return (
                <div class="vp-forma" key={k}>
                  <Marca rotulo={nome} marcado={x.ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].ativo = v })} />
                  {x.ativo && <div class="vp-linha">
                    <Campo rotulo="Até quantas vezes" valor={x.parcelasMax} tabela={`${tx.parcelasMax}x`} largura="130px" dica={k === 'cartao' ? 'máx. 12' : 'de 2 a 48'} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].parcelasMax = v })} />
                    <Campo rotulo="Juros % ao mês" valor={x.jurosMesPct} largura="130px"
                      tabela={tx.jurosMesPct === null ? 'por faixa' : `${txt(tx.jurosMesPct)}%`}
                      dica={x.multiFaixa ? 'vazio = mantém as faixas' : '0 = sem juros'}
                      aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].jurosMesPct = v })} />
                    <Campo rotulo="Preço próprio (total R$)" valor={x.valorBase} tabela={tx.valorBase ? brl2(tx.valorBase) : 'do plano'} dica="vazio = calcula pelo plano" aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].valorBase = v })} />
                  </div>}
                </div>
              )
            })}
          </div>
        )}
      </fieldset>
    )
  }

  return (
    <div class="valor-personalizado">
      <div class="vp-topo">
        <b>Valor personalizado</b>
        <span class="vp-selo">só a equipe vê</span>
      </div>
      {emOutroPlano && !ativoAqui && (
        <p class="ajuda">Há um valor personalizado em outro plano desta inscrição. Ele vale só lá.</p>
      )}
      {!editando && (
        <div class="vp-resumo">
          <div class="ajuda">{ativoAqui ? 'Condições combinadas em vigor:' : 'Condições da tabela deste plano:'}</div>
          <ul class="vp-lista">{resumo.map((l, i) => <li key={i} class={l.startsWith('  ·') ? 'sub' : ''}>{l.replace(/^ {2}· /, '')}</li>)}</ul>
          {ativoAqui && <div class="ajuda">Motivo: {ativoAqui.motivo}{ativoAqui.por ? ` · por ${ativoAqui.por}` : ''}{dia(ativoAqui.em) ? ` em ${dia(ativoAqui.em)}` : ''}</div>}
          <p class="ajuda" style="margin:6px 0 0">O candidato vê só o valor final.</p>
        </div>
      )}
      {!pode && <p class="ajuda" style="margin:6px 0 0">Seu perfil não pode personalizar valores (permissão "Valor personalizado").</p>}
      {pode && !editando && (
        <div class="vp-acoes">
          <button class="secundario" onClick={abrir} disabled={salvando}>{ativoAqui ? 'Editar condições' : 'Personalizar condições'}</button>
          {ativoAqui && <button class="link" onClick={voltarATabela} disabled={salvando}>{salvando ? 'Voltando…' : 'Voltar à tabela'}</button>}
        </div>
      )}
      {pode && editando && ed && (
        <div class="vp-form">
          <fieldset class="vp-grupo">
            <legend>Valores e parcelas</legend>
            <div class="vp-linha">
              <Campo rotulo="Matrícula (R$)" valor={ed.matricula} tabela={brl2(T.matricula)} dica="0 = sem matrícula separada" aoMudar={(v) => mudar((e) => { e.matricula = v })} />
              <Campo rotulo="Mensalidade (R$)" valor={ed.mensalidade} tabela={brl2(T.mensalidade)} aoMudar={(v) => mudar((e) => { e.mensalidade = v })} />
            </div>
            <div class="vp-linha">
              <Campo rotulo="Nº de mensalidades" valor={ed.numParcelas} tabela={String(T.numParcelas)} largura="150px" dica="além da matrícula" aoMudar={(v) => mudar((e) => { e.numParcelas = v })} />
              <Campo rotulo="Dia do vencimento" valor={ed.diaVencimento} tabela={String(T.diaVencimento)} largura="150px" dica="1 a 28" aoMudar={(v) => mudar((e) => { e.diaVencimento = v })} />
            </div>
            <small class="ajuda">Curso completo = matrícula + mensalidade × nº de mensalidades (ou o preço próprio de cada forma).</small>
          </fieldset>

          {blocoOpcao('entrada', 'Permitir pagar só a matrícula / 1ª parcela agora')}
          {blocoOpcao('integral', 'Permitir pagar o curso completo')}

          <fieldset class="vp-grupo">
            <legend><Marca rotulo="Desconto de pontualidade nas parcelas" marcado={ed.pontualidade.ativo} aoMudar={(v) => mudar((e) => { e.pontualidade.ativo = v })} /></legend>
            {ed.pontualidade.ativo && (
              <>
                <div class="vp-linha">
                  <Campo rotulo="Desconto %" valor={ed.pontualidade.descontoPct} tabela={`${txt(T.pontualidade.descontoPct)}%`} largura="130px" aoMudar={(v) => mudar((e) => { e.pontualidade.descontoPct = v })} />
                  {!ed.pontualidade.ateVencimento && <Campo rotulo="Pagando até o dia" valor={ed.pontualidade.diaLimite} tabela={String(T.pontualidade.diaLimite)} largura="150px" aoMudar={(v) => mudar((e) => { e.pontualidade.diaLimite = v })} />}
                </div>
                <Marca rotulo="Vale até o próprio vencimento" marcado={ed.pontualidade.ateVencimento} aoMudar={(v) => mudar((e) => { e.pontualidade.ateVencimento = v })} />
                <Marca rotulo="Arredondar a parcela com desconto para terminar em ,90" marcado={ed.pontualidade.terminaEm90} aoMudar={(v) => mudar((e) => { e.pontualidade.terminaEm90 = v })} />
              </>
            )}
          </fieldset>

          <fieldset class="vp-grupo">
            <legend>Vencimentos</legend>
            <div class="vp-linha">
              <Campo rotulo="Cobrança de agora vence em" tipo="date" valor={ed.vencimentoEntrada} dica="vazio = prazo padrão do portal" aoMudar={(v) => mudar((e) => { e.vencimentoEntrada = v })} />
              <Campo rotulo="1ª parcela seguinte em" tipo="date" valor={ed.primeiraSeguinte} dica="vazio = dia do vencimento, mês seguinte; as demais, mês a mês" aoMudar={(v) => mudar((e) => { e.primeiraSeguinte = v })} />
            </div>
          </fieldset>

          <label class="vp-campo">
            <span>Motivo</span>
            <textarea rows={2} value={motivo} placeholder="Ex.: condição combinada com o gerente, convênio, retenção" onInput={(ev) => setMotivo((ev.target as HTMLTextAreaElement).value)} />
          </label>
          {erro && <span class="erro">{erro}</span>}
          <div class="vp-acoes">
            <button class="principal" onClick={salvar} disabled={salvando || motivo.trim().length < 3}>{salvando ? 'Salvando…' : 'Salvar condições'}</button>
            <button class="link" onClick={voltarCamposATabela} disabled={salvando}>Preencher com a tabela</button>
            <button class="link" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</button>
          </div>
          <p class="ajuda" style="margin:6px 0 0">Ao salvar, os valores abaixo são recalculados. Um Pix ou boleto já gerado com as condições anteriores é cancelado.</p>
        </div>
      )}
      {erro && !editando && <span class="erro">{erro}</span>}
    </div>
  )
}

/**
 * Plano de pagamento e o que pagar agora. Cada botão diz o valor e o que
 * acontece depois ("R$ 599,90 agora e mais 5x…" × "curso completo").
 */
function EscolhaDoPlano(props: { opcoes: OpcoesDePagamento; aoEscolher: (e: EscolhaDePlano) => void }) {
  const planos = props.opcoes.planos ?? []
  const escolha = props.opcoes.escolha
  const atual = planos.find((p) => p.id === escolha?.planoId) ?? planos[0]
  if (!atual) return null
  return (
    <div class="plano-escolha">
      {planos.length > 1 && (
        <>
          <div class="plano-titulo">Plano de pagamento</div>
          <div class="pagamento-opcoes">
            {planos.map((p) => (
              <button
                key={p.id}
                class="opcao-pagamento"
                aria-pressed={p.id === atual.id}
                onClick={() => p.id !== atual.id && props.aoEscolher({ planoId: p.id, opcao: p.opcoes[0]?.chave ?? 'entrada' })}
              >
                <b>{p.nome}</b>
                <span>{p.resumo}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {atual.opcoes.length > 1 && (
        <>
          <div class="plano-titulo">O que você quer pagar agora?</div>
          <div class="pagamento-opcoes">
            {atual.opcoes.map((o) => (
              <button
                key={o.chave}
                class="opcao-pagamento"
                aria-pressed={o.chave === escolha?.opcao}
                onClick={() => o.chave !== escolha?.opcao && props.aoEscolher({ planoId: atual.id, opcao: o.chave })}
              >
                <b>{o.rotulo} · {dinheiro(o.valor)}</b>
                <span>{o.detalhe}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {atual.opcoes.length === 1 && planos.length === 1 && atual.opcoes[0] && (
        <p class="ajuda" style="margin:10px 0 0">{atual.opcoes[0].detalhe}</p>
      )}
      <div class="plano-titulo">Forma de pagamento</div>
    </div>
  )
}
