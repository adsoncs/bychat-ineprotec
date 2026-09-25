import { useEffect, useRef, useState } from 'preact/hooks'
import {
  consultarPagamento, iniciarPagamento, opcoesDePagamento, simularPagamento,
  type MetodoPagamento, type OpcoesDePagamento,
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
  const confirmado = useRef(false)

  const pronto = temComoPagar(cobranca, metodo ?? 'pix')
  const encerrada = !!cobranca && ENCERRADAS.includes(cobranca.status)

  // Quais meios este portal aceita e quanto fica cada opção. A conta do
  // parcelamento é do servidor: juros e piso de parcela são regra de negócio, e
  // o número que a pessoa vê tem de ser o que vai ser cobrado.
  useEffect(() => {
    let vivo = true
    opcoesDePagamento(props.codigo, props.token, cupomAtivo || undefined)
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
  }, [props.codigo, props.token, cupomAtivo])

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

        <div class="pagamento-opcoes">
          {mostraPix && (
            <button class="opcao-pagamento" onClick={() => escolher('pix')} disabled={carregando}>
              <b>PIX</b>
              <span>
                {m?.pix.descontoPct
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
              onClick={() => (opcoesBoleto.length > 1 ? setMetodo('boleto') : escolher('boleto'))}
              disabled={carregando}
            >
              <b>Boleto</b>
              <span>
                {opcoesBoleto.length > 1
                  ? `à vista ou em até ${m?.boleto.parcelasMax}x`
                  : 'Compensa em até 3 dias úteis'}
              </span>
            </button>
          )}
          {mostraCartao && (
            <button class="opcao-pagamento" onClick={() => setMetodo('credit_card')} disabled={carregando}>
              <b>Cartão de crédito</b>
              <span>
                {opcoesCartao.length > 1
                  ? `em até ${opcoesCartao[opcoesCartao.length - 1].parcelas}x`
                  : 'à vista'}
              </span>
            </button>
          )}
        </div>
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
              <span class="v">{dinheiro(o.parcelas === 1 ? o.valorEntrada : o.valorParcela)}</span>
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
          <button class="principal" onClick={() => copiar(cobranca.qrCode!)}>
            {copiado ? 'Código copiado' : 'Copiar código PIX'}
          </button>
          <details style="margin-top:12px">
            <summary class="ajuda">Ver o código</summary>
            <p class="codigo-longo">{cobranca.qrCode}</p>
          </details>
        </>
      )}

      {!encerrada && metodo === 'boleto' && cobranca?.boletoLine && (
        <>
          <p class="codigo-longo" style="text-align:center">{cobranca.boletoLine}</p>
          <button class="principal" onClick={() => copiar(cobranca.boletoLine!)}>
            {copiado ? 'Linha copiada' : 'Copiar linha digitável'}
          </button>
          {cobranca.boletoPdfUrl && (
            <a href={cobranca.boletoPdfUrl} target="_blank" rel="noopener">
              <button class="secundario" style="width:100%;margin-top:8px">Abrir boleto em PDF</button>
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
