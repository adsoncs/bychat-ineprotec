import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, JSX } from 'preact'
import {
  continuarPorToken,
  carregarPortal, enviarInscricao, lerRascunho, marcarConversao, rotulo, salvarRascunho,
  type DadosPortal, type Oferta, type Passo,
} from './api'
import { criarSenhaInicial } from './api'
import { Pagamento } from './Pagamento'
import { aplicarMarca } from './marca'
import { conclusaoDoPortal } from './api'
import { erroDoCampo, mascarar, modoEntrada, type Campo } from './validacao'

// ─────────────────────────────────────────────────────────────────────────────
// Estado do preenchimento

type Valores = Record<string, string | number | boolean>

const CHAVE_SESSAO = 'bh_portal_sessao'
const chaveRascunho = (slug: string) => `bh_rascunho_${slug}`

/** Devolve o id da sessão e diz se ela acabou de nascer. */
function idDeSessao(): { id: string; nova: boolean } {
  const guardado = localStorage.getItem(CHAVE_SESSAO)
  if (guardado) return { id: guardado, nova: false }
  const id = (crypto.randomUUID?.() ?? String(Date.now() + Math.random())).slice(0, 36)
  localStorage.setItem(CHAVE_SESSAO, id)
  return { id, nova: true }
}

const dinheiro = (v: unknown): string | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null
}

/**
 * Token do magic link, quando a pessoa chegou por um link da secretaria.
 *
 * Antes ninguém lia parâmetro nenhum desta URL: o link gerado pelo botão
 * "Gerar link de acesso" abria o formulário em branco, como se a pessoa nunca
 * tivesse se inscrito.
 */
function tokenDaUrl(): string {
  try {
    return new URLSearchParams(location.search).get('t') || ''
  } catch {
    return ''
  }
}

/** O slug vem do caminho (/portal/<slug>) — a mesma URL de sempre. */
function slugDaUrl(): string {
  const partes = location.pathname.split('/').filter(Boolean)
  const i = partes.indexOf('portal')
  return (i >= 0 ? partes[i + 1] : partes[0]) || ''
}

// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const slug = useMemo(slugDaUrl, [])
  const token = useMemo(tokenDaUrl, [])
  const [dados, setDados] = useState<DadosPortal | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [valores, setValores] = useState<Valores>({})
  const [tocados, setTocados] = useState<Record<string, boolean>>({})
  const [passo, setPasso] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [concluido, setConcluido] = useState<{ codigo: string; pagamentoUrl?: string | null; token?: string | null } | null>(null)
  const [retomado, setRetomado] = useState(false)
  // Acesso no topo: quem já tem senha vê "Entrar", quem não tem vê "Criar senha".
  // Só sabemos depois de a pessoa ser identificada (envio ou magic link).
  const [temSenha, setTemSenha] = useState(false)
  const [abrirSenha, setAbrirSenha] = useState(false)
  const topo = useRef<HTMLDivElement>(null)

  // ── carga inicial + rascunho ──
  useEffect(() => {
    let vivo = true
    carregarPortal(slug)
      .then(async (d) => {
        if (!vivo) return
        setDados(d)
        aplicarMarcaDoPortal(d)

        // Chegou por link da secretaria: o token manda mais que o rascunho local,
        // porque diz de quem é a inscrição — o rascunho é só o que este
        // navegador guardou, e pode ser de outra pessoa no mesmo aparelho.
        if (token) {
          try {
            const r = await continuarPorToken(slug, token)
            if (!vivo) return
            setTemSenha(r.temSenha)
            if (r.registration) {
              // Já se inscreveu: volta ao ponto onde parou, com o que falta.
              setConcluido({
                codigo: r.registration.candidateCode,
                pagamentoUrl: r.registration.paymentUrl,
                token: r.registration.candidateToken,
              })
              return
            }
            // Só demonstrou interesse: o formulário abre com o que já informou.
            setValores((v) => ({
              ...v,
              nome: r.prefill.nome ?? '',
              email: r.prefill.email ?? '',
              whatsapp: r.prefill.whatsapp ?? '',
              ...(r.prefill.offeringId ? { offeringId: String(r.prefill.offeringId) } : {}),
              ...(r.prefill.cidade ? { cidade: r.prefill.cidade } : {}),
            }))
            setRetomado(true)
            return
          } catch (e: any) {
            // Link vencido não pode virar tela de erro: a pessoa ainda pode se
            // inscrever do jeito normal. Avisa e segue para o formulário.
            if (vivo) setErroEnvio(e.message)
          }
        }

        const local = localStorage.getItem(chaveRascunho(slug))
        // Primeira visita não tem rascunho para buscar — poupa uma ida ao
        // servidor (e um 404 no console) de quem está em rede ruim.
        const sessao = idDeSessao()
        const doServidor = sessao.nova ? { draft: null } : await lerRascunho(slug, sessao.id)
        const guardado = doServidor?.draft?.formData ?? (local ? JSON.parse(local) : null)
        if (guardado && Object.keys(guardado).length) {
          setValores(guardado as Valores)
          setPasso(Math.min(Number(doServidor?.draft?.stepIndex ?? 0), d.portal.formConfig.steps.length))
          setRetomado(true)
        }
      })
      .catch((e) => vivo && setFalha(e.message))
    return () => { vivo = false }
  }, [slug, token])

  const offertasDisponiveis = dados?.offerings ?? []
  const passos: Passo[] = (dados?.portal.formConfig?.steps ?? [])
  /**
   * Campos visíveis do passo.
   *
   * O builder permite pedir dados só para certas formas de ingresso (o bloco
   * "entryModes" marca cada campo com `visibleWhen.entryMode`). Sem respeitar
   * isso, quem escolhe vestibular via campos de transferência — e é obrigado a
   * preencher o que não se aplica a ele.
   */
  const camposDoPasso = (p: Passo | undefined): Campo[] => {
    const todos = (p?.fields ?? []) as Campo[]
    const oferta = offertasDisponiveis.find((o) => String(o.id) === String(valores.offeringId))
    const modo = oferta?.selectionProcess?.entryMode?.code
    return todos.filter((c) => {
      const exigidos = c.visibleWhen?.entryMode
      if (!Array.isArray(exigidos) || exigidos.length === 0) return true
      // Sem curso escolhido ainda, esconde o condicional em vez de exigir cego.
      return !!modo && exigidos.includes(modo)
    })
  }

  // Um passo cujos campos são todos condicionais e não se aplicam vira etapa em
  // branco. Fora da lista: a pessoa não deve clicar "continuar" numa tela vazia.
  const passosVisiveis = passos.filter((p, i) => i === 0 || camposDoPasso(p).length > 0)
  const totalPassos = passosVisiveis.length + 1 // +1 = revisão
  const naRevisao = passo >= passosVisiveis.length
  const passoAtual = passosVisiveis[passo]

  // ── rascunho: local na hora, servidor com folga ──
  useEffect(() => {
    if (!dados || concluido || !Object.keys(valores).length) return
    localStorage.setItem(chaveRascunho(slug), JSON.stringify(valores))
    const t = setTimeout(() => { void salvarRascunho(slug, idDeSessao().id, valores, passo) }, 1200)
    return () => clearTimeout(t)
  }, [valores, passo, dados, concluido, slug])

  function definir(nome: string, valor: string | number | boolean) {
    setValores((v) => ({ ...v, [nome]: valor }))
  }


  function errosDoPasso(p: Passo | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    for (const c of camposDoPasso(p)) {
      if (c.type === 'offering-picker') {
        if (c.required && !valores[c.name]) out[c.name] = 'Escolha um curso para continuar.'
        continue
      }
      const e = erroDoCampo(c, String(valores[c.name] ?? ''))
      if (e) out[c.name] = e
    }
    return out
  }

  function avancar() {
    const erros = errosDoPasso(passoAtual)
    if (Object.keys(erros).length) {
      // Marca tudo do passo como tocado: os erros aparecem de uma vez, e o foco
      // vai para o primeiro problema em vez de deixar a pessoa procurando.
      setTocados((t) => ({ ...t, ...Object.fromEntries(camposDoPasso(passoAtual).map((c) => [c.name, true])) }))
      const primeiro = document.querySelector<HTMLElement>(`[name="${Object.keys(erros)[0]}"]`)
      primeiro?.focus()
      primeiro?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setPasso((p) => Math.min(p + 1, passosVisiveis.length))
    topo.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function voltar() {
    setPasso((p) => Math.max(0, p - 1))
    topo.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function enviar() {
    setEnviando(true)
    setErroEnvio(null)
    try {
      const r = await enviarInscricao(slug, { ...valores, lgpdConsent: true })
      localStorage.removeItem(chaveRascunho(slug))
      // Antes do redirecionamento configurável: se a instituição manda o
      // candidato para outra página, a conversão precisa ter sido contada aqui.
      marcarConversao(r.candidateCode, dados?.portal.nome ?? '')

      // Conclusão configurada no builder: quando for redirecionamento, a
      // instituição escolheu levar o candidato para outra página (obrigado
      // própria, campanha, matrícula) — respeitamos em vez de mostrar a nossa.
      const fim = dados ? conclusaoDoPortal(dados.portal) : null
      if (fim?.behavior === 'redirect' && fim.target) {
        location.href = fim.target
        return
      }
      setTemSenha(r.temSenha === true)
      setConcluido({ codigo: r.candidateCode, pagamentoUrl: r.paymentUrl, token: r.candidateToken })
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setEnviando(false)
    }
  }

  // ── telas de carga e falha ──
  if (falha) {
    return (
      <div class="pagina">
        <div class="cartao" style="margin-top:40px">
          <h2>Não foi possível abrir a inscrição</h2>
          <p class="sub">{falha}</p>
          <button class="principal" onClick={() => location.reload()}>Tentar de novo</button>
        </div>
      </div>
    )
  }
  if (!dados) return <Esqueleto />

  const { portal, offerings } = dados
  const ofertaEscolhida = offerings.find((o) => String(o.id) === String(valores.offeringId)) ?? null

  if (concluido) {
    const fim = conclusaoDoPortal(portal)
    return (
      <Concluido
        portal={portal} codigo={concluido.codigo} pagamentoUrl={concluido.pagamentoUrl}
        token={concluido.token} precisaPagar={portal.requirePayment} oferta={ofertaEscolhida}
        mensagem={fim?.behavior !== 'redirect' ? fim?.message : undefined}
        temSenha={temSenha}
        abrirSenha={abrirSenha}
        aoAbrirSenha={() => setAbrirSenha(true)}
        aoCriarSenha={() => setTemSenha(true)}
        passos={[...passosVisiveis.map((p) => p.name), rotulo(portal, 'revisao'), 'Pagamento']}
      />
    )
  }

  return (
    <div class="pagina">
      <div ref={topo} />
      {/* Com a barra de topo, logo e passos andam juntos numa faixa fixa — é o
          padrão dos checkouts. Sem ela, o logo fica solto acima da capa. */}
      {portal.brandHeaderStyle === 'barra' ? (
        <BarraTopo
          portal={portal}
          acesso={<AcessoNoTopo temSenha={temSenha} podeCriar={false} aoCriarSenha={() => {}} />}
          passos={[...passosVisiveis.map((p) => p.name), rotulo(portal, 'revisao')]}
          atual={passo}
          total={totalPassos}
        />
      ) : (
        <Cabecalho
          portal={portal}
          acesso={<AcessoNoTopo temSenha={temSenha} podeCriar={false} aoCriarSenha={() => {}} />}
          trilha={
            <Trilha
              passos={[...passosVisiveis.map((p) => p.name), rotulo(portal, 'revisao')]}
              atual={passo}
              total={totalPassos}
            />
          }
        />
      )}
      {portal.brandHeaderStyle === 'barra' && <Capa portal={portal} />}

      {retomado && !naRevisao && (
        <div class="aviso info">
          Retomamos de onde você parou. Confira os dados antes de seguir.
        </div>
      )}

      <div class="cartao">
        {naRevisao ? (
          <Revisao
            passos={passosVisiveis}
            valores={valores}
            oferta={ofertaEscolhida}
            portal={portal}
            aoEditar={(i) => setPasso(i)}
          />
        ) : (
          <>
            <h2>{passoAtual?.name}</h2>
            <p class="sub">Etapa {passo + 1} de {totalPassos}</p>
            <div class="campos">
            {camposDoPasso(passoAtual).map((campo) =>
              campo.type === 'offering-picker' ? (
                <EscolhaDeCurso
                  key={campo.name}
                  campo={campo}
                  ofertas={offerings}
                  valor={String(valores[campo.name] ?? '')}
                  aoEscolher={(id) => definir(campo.name, id)}
                  erro={tocados[campo.name] ? errosDoPasso(passoAtual)[campo.name] : undefined}
                />
              ) : (
                <CampoTexto
                  key={campo.name}
                  campo={campo}
                  valor={String(valores[campo.name] ?? '')}
                  tocado={!!tocados[campo.name]}
                  aoMudar={(v) => definir(campo.name, v)}
                  aoSair={() => setTocados((t) => ({ ...t, [campo.name]: true }))}
                />
              ),
            )}
            </div>
          </>
        )}

        {erroEnvio && <div class="aviso erro" role="alert">{erroEnvio}</div>}

        <div class="acoes">
          {passo > 0 && <button class="secundario" onClick={voltar} disabled={enviando}>{rotulo(portal, 'voltar')}</button>}
          {naRevisao ? (
            <button class="principal" onClick={enviar} disabled={enviando}>
              {enviando ? 'Enviando…' : rotulo(portal, 'enviar')}
            </button>
          ) : (
            <button class="principal" onClick={avancar}>{rotulo(portal, 'continuar')}</button>
          )}
        </div>
      </div>

      {!naRevisao && (ofertaEscolhida || portal.brandSummaryAlways) && (
        <ResumoDaOferta oferta={ofertaEscolhida} portal={portal} />
      )}

      <Rodape portal={portal} />
      <AjudaFlutuante portal={portal} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Peças

function aplicarMarcaDoPortal(d: DadosPortal) {
  // Mesma regra das telas logadas (marca.ts); aqui o título vem do portal.
  aplicarMarca(d.portal)
  document.title = d.portal.metaTitle || d.portal.nome
}

function Logo({ portal }: { portal: DadosPortal['portal'] }) {
  if (!portal.brandLogoUrl) return <span class="nome">{portal.nome}</span>
  const img = <img src={portal.brandLogoUrl} alt={portal.nome} />
  return portal.brandLogoLink ? <a href={portal.brandLogoLink}>{img}</a> : img
}

function Capa({ portal }: { portal: DadosPortal['portal'] }) {
  if (portal.brandHeroEnabled === false) return null
  if (!portal.brandHeroTitle && !portal.brandHeroSubtitle) return null
  const opacidade = (portal.brandHeroOverlayOpacity ?? 35) / 100
  return (
    <div
      class="capa"
      style={portal.brandHeroUrl
        ? `background-image:linear-gradient(rgba(0,0,0,${opacidade}),rgba(0,0,0,${opacidade})),url(${portal.brandHeroUrl})`
        : undefined}
    >
      <h1>{portal.brandHeroTitle || portal.nome}</h1>
      {portal.brandHeroSubtitle && <p>{portal.brandHeroSubtitle}</p>}
    </div>
  )
}

function Cabecalho(props: {
  portal: DadosPortal['portal']
  acesso?: ComponentChildren
  /** Trilha de passos: acompanha a pessoa até o pagamento, não só o formulário. */
  trilha?: ComponentChildren
}) {
  return (
    <>
      <div class="topo">
        <Logo portal={props.portal} />
        {props.acesso}
      </div>
      {props.trilha}
      <Capa portal={props.portal} />
    </>
  )
}

/**
 * Acesso no topo do portal: um botão só, que muda conforme a pessoa.
 *
 * Antes, criar senha era um formulário aberto no fim da inscrição — campo à
 * mostra, empurrando o pagamento para baixo, oferecido a todos inclusive a quem
 * já tinha conta. Agora é um convite discreto no topo, e o painel abre só para
 * quem clica.
 *
 * Qual dos dois aparece vem do servidor, e só onde a identidade já está provada
 * (token da inscrição ou magic link). Quem ainda está preenchendo o formulário
 * não foi identificado: vê "Entrar", que serve a quem já é da casa e caiu aqui
 * por engano.
 */
function AcessoNoTopo(props: {
  temSenha: boolean
  podeCriar: boolean
  aoCriarSenha: () => void
}) {
  if (props.podeCriar && !props.temSenha) {
    return (
      <button class="acesso-topo" type="button" onClick={props.aoCriarSenha}>
        Criar senha
      </button>
    )
  }
  // Leva o portal junto: a tela de entrar é uma só para a instituição, e é
  // por este parâmetro que ela veste a marca (cores, fonte, logo) deste portal.
  const slug = location.pathname.split('/').filter(Boolean)[1]
  const destino = slug && !['login', 'senha', 'aluno', 'documentos', 'contrato'].includes(slug)
    ? `/portal/login?portal=${encodeURIComponent(slug)}`
    : '/portal/login'
  return <a class="acesso-topo" href={destino}>Entrar</a>
}

/** Passos da inscrição. Em barras (padrão) ou em círculos numerados. */
function Trilha({ passos, atual, total }: { passos: string[]; atual: number; total: number }) {
  return (
    <div class="trilha" role="list" aria-label={`Etapa ${atual + 1} de ${total}`}>
      {passos.map((nome, i) => (
        <div class={`etapa ${i === atual ? 'atual' : i < atual ? 'feita' : ''}`} role="listitem" key={nome + i}>
          <div class="barra" />
          <span class="numero" aria-hidden="true">{i + 1}</span>
          <span class="rotulo">{nome}</span>
        </div>
      ))}
    </div>
  )
}

/** Faixa fixa do topo: logo, passos e o selo de segurança. */
function BarraTopo(props: {
  portal: DadosPortal['portal']
  passos: string[]
  atual: number
  total: number
  acesso?: ComponentChildren
}) {
  // A faixa é fixa, então a página precisa saber quanto ela ocupa para começar
  // logo abaixo. A altura muda com logo, selo, passos e largura da tela — um
  // número chutado no CSS escondia o começo do formulário atrás dela.
  const faixa = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = faixa.current
    if (!el) return
    const raiz = document.documentElement
    const medir = () => raiz.style.setProperty('--altura-barra', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => { obs.disconnect(); raiz.style.removeProperty('--altura-barra') }
  }, [])
  return (
    <header class="barra-topo" ref={faixa}>
      <div class="barra-conteudo">
        <div class="topo">
          <Logo portal={props.portal} />
          {props.acesso}
        </div>
        <Trilha passos={props.passos} atual={props.atual} total={props.total} />
        {props.portal.brandSecurityNote && (
          <span class="selo">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M12 2 4 5.5v6c0 4.7 3.2 8.9 8 10.5 4.8-1.6 8-5.8 8-10.5v-6L12 2Zm0 6a2.2 2.2 0 0 1 1 4.1V15a1 1 0 1 1-2 0v-2.9A2.2 2.2 0 0 1 12 8Z"
                fill="currentColor"
              />
            </svg>
            {props.portal.brandSecurityNote}
          </span>
        )}
      </div>
    </header>
  )
}

function CampoTexto(props: {
  campo: Campo
  valor: string
  tocado: boolean
  aoMudar: (v: string) => void
  aoSair: () => void
}) {
  const { campo, valor, tocado } = props
  // Enquanto digita, só avisa o que já dá para saber; o resto espera sair do campo.
  const erro = tocado ? erroDoCampo(campo, valor) : erroDoCampo(campo, valor, true)

  const comum = {
    name: campo.name,
    id: `c_${campo.name}`,
    value: valor,
    placeholder: campo.placeholder,
    onBlur: props.aoSair,
    'aria-invalid': erro ? true : undefined,
    'aria-describedby': erro ? `e_${campo.name}` : campo.helpText ? `a_${campo.name}` : undefined,
  }

  return (
    <div class={`campo ${erro ? 'ruim' : ''}`}>
      <label for={`c_${campo.name}`}>
        {campo.label} {!campo.required && <span class="opcional">(opcional)</span>}
      </label>

      {campo.options?.length ? (
        <select {...comum} onChange={(e) => props.aoMudar((e.target as HTMLSelectElement).value)}>
          <option value="">Selecione…</option>
          {campo.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          {...comum}
          type={campo.type === 'email' ? 'email' : 'text'}
          inputMode={modoEntrada(campo.type) as JSX.HTMLAttributes<HTMLInputElement>['inputMode']}
          autoComplete={autoPreenchimento(campo)}
          onInput={(e) => props.aoMudar(mascarar(campo.type, (e.target as HTMLInputElement).value))}
        />
      )}

      {erro
        ? <span class="erro" id={`e_${campo.name}`} role="alert">{erro}</span>
        : campo.helpText && <span class="ajuda" id={`a_${campo.name}`}>{campo.helpText}</span>}
    </div>
  )
}

/** Deixa o navegador preencher o que já sabe — menos digitação no celular. */
function autoPreenchimento(campo: Campo): string | undefined {
  if (campo.type === 'email') return 'email'
  if (campo.type === 'phone') return 'tel'
  if (campo.type === 'cep') return 'postal-code'
  if (/nome/i.test(campo.name)) return 'name'
  if (/nascimento/i.test(campo.name)) return 'bday'
  return undefined
}

function EscolhaDeCurso(props: {
  campo: Campo
  ofertas: Oferta[]
  valor: string
  aoEscolher: (id: number) => void
  erro?: string
}) {
  const [busca, setBusca] = useState('')
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return props.ofertas
    return props.ofertas.filter((o) => `${o.nome} ${o.turno ?? ''} ${o.complemento ?? ''}`.toLowerCase().includes(q))
  }, [busca, props.ofertas])

  return (
    <div class={`campo ${props.erro ? 'ruim' : ''}`}>
      <label for="busca_curso">{props.campo.label}</label>
      {props.ofertas.length > 6 && (
        <div class="busca">
          <input
            id="busca_curso"
            value={busca}
            placeholder="Buscar por nome ou turno"
            onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
          />
        </div>
      )}
      <div class="cursos">
        {filtradas.length === 0 && <div class="vazio">Nenhum curso encontrado para “{busca}”.</div>}
        {filtradas.map((o) => {
          const valor = dinheiro(o.valorMensalidade)
          return (
            <button
              type="button"
              class="curso"
              key={o.id}
              aria-pressed={String(o.id) === props.valor}
              onClick={() => props.aoEscolher(o.id)}
            >
              <span>
                <span class="t">{o.nome}</span>
                {detalheDaOferta(o) && <span class="d">{detalheDaOferta(o)}</span>}
              </span>
              {valor && <span class="v">{valor}<span style="font-weight:400;color:var(--tinta-3)">/mês</span></span>}
            </button>
          )
        })}
      </div>
      {props.erro && <span class="erro" role="alert">{props.erro}</span>}
    </div>
  )
}

/**
 * Complemento do nome da oferta. O turno costuma já vir no próprio nome
 * ("Enfermagem — Presencial Matutino"); repeti-lo produzia "MatutinoMatutino".
 */
function detalheDaOferta(o: Oferta): string {
  const partes: string[] = []
  if (o.turno && !o.nome.toLowerCase().includes(String(o.turno).toLowerCase())) partes.push(o.turno)
  if (o.complemento && !o.nome.includes(o.complemento)) partes.push(o.complemento)
  return partes.join(' · ')
}

function ResumoDaOferta({ oferta, portal }: { oferta: Oferta | null; portal: DadosPortal['portal'] }) {
  // Sem curso escolhido o resumo continua na tela, dizendo o que vai aparecer
  // ali. Uma coluna que some e volta faz a página pular embaixo da pessoa.
  if (!oferta) {
    return (
      <div class="resumo vazio">
        <h3>{rotulo(portal, 'resumoTitulo')}</h3>
        <p class="ajuda">{rotulo(portal, 'resumoVazio')}</p>
      </div>
    )
  }

  const mensalidade = dinheiro(oferta.valorMensalidade)
  const matricula = dinheiro(oferta.valorMatricula)
  const taxa = dinheiro(oferta.selectionProcess?.taxaInscricao)
  const etiquetas = [oferta.level?.nome, oferta.modality?.nome].filter(Boolean) as string[]
  const observacao = rotulo(portal, 'resumoObservacao')

  return (
    <div class="resumo">
      <h3>{rotulo(portal, 'resumoTitulo')}</h3>
      <p class="curso-escolhido">{oferta.nome}</p>
      {etiquetas.length > 0 && (
        <div class="etiquetas">
          {etiquetas.map((e, i) => (
            // A segunda etiqueta usa a cor de apoio quando existe: com uma cor
            // só as duas viram a mesma mancha.
            <span class={`etiqueta ${i > 0 ? 'apoio' : ''}`} key={e}>{e}</span>
          ))}
        </div>
      )}
      {oferta.turno && !oferta.nome.toLowerCase().includes(String(oferta.turno).toLowerCase())
        && <div class="linha"><span>Turno</span><b>{oferta.turno}</b></div>}
      {taxa && <div class="linha"><span>{rotulo(portal, 'resumoTaxa')}</span><b>{taxa}</b></div>}
      {matricula && <div class="linha"><span>{rotulo(portal, 'resumoMatricula')}</span><b>{matricula}</b></div>}
      {mensalidade && (
        <div class="destaque">
          <span>{rotulo(portal, 'resumoMensalidade')}</span>
          <b>{mensalidade}</b>
        </div>
      )}
      {observacao && <p class="ajuda" style="margin-top:10px">{observacao}</p>}
    </div>
  )
}

function Revisao(props: {
  passos: Passo[]
  valores: Valores
  oferta: Oferta | null
  portal: DadosPortal['portal']
  aoEditar: (indice: number) => void
}) {
  const subtitulo = rotulo(props.portal, 'revisaoSubtitulo')
  return (
    <div class="revisao">
      <h2>{rotulo(props.portal, 'revisaoTitulo')}</h2>
      {subtitulo && <p class="sub">{subtitulo}</p>}
      {props.passos.map((p, i) => {
        const campos = (p.fields ?? []).filter((c) => c.type !== 'offering-picker')
        return (
          <div key={p.id} style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px">
              <h3 style="margin:0;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--tinta-3)">{p.name}</h3>
              <button class="voltar" onClick={() => props.aoEditar(i)}>editar</button>
            </div>
            {campos.map((c) => (
              <div class="item" key={c.name}>
                <span>{c.label}</span>
                <b>{String(props.valores[c.name] ?? '—')}</b>
              </div>
            ))}
            {(p.fields ?? []).some((c) => c.type === 'offering-picker') && (
              <div class="item"><span>Curso</span><b>{props.oferta?.nome ?? '—'}</b></div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Concluido(props: {
  portal: DadosPortal['portal']
  codigo: string
  pagamentoUrl?: string | null
  token?: string | null
  precisaPagar?: boolean
  /** Texto de conclusão escolhido no builder; sem ele, o padrão do sistema. */
  mensagem?: string | undefined
  oferta: Oferta | null
  /** Já existe conta com senha: o topo oferece "Entrar" em vez de "Criar senha". */
  temSenha: boolean
  /** O painel de senha abre por clique no topo, não sozinho. */
  abrirSenha: boolean
  aoAbrirSenha: () => void
  aoCriarSenha: () => void
  /** A trilha acompanha até aqui: a última etapa é o pagamento. */
  passos: string[]
}) {
  const [pago, setPago] = useState(false)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const painelSenha = useRef<HTMLDivElement>(null)

  // O botão fica no topo e o painel abre lá embaixo, fora da tela: sem levar a
  // pessoa até ele, o clique parecia não fazer nada. Rola até o painel e põe o
  // cursor no campo — quem clicou em "Criar senha" quer digitar a senha.
  useEffect(() => {
    if (!props.abrirSenha) return
    const el = painelSenha.current
    if (!el) return
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'center' })
    // O foco espera a rolagem: focar antes faz o navegador saltar para o campo
    // e desfazer a animação que acabou de começar.
    const t = setTimeout(() => el.querySelector('input')?.focus({ preventScroll: true }), quieto ? 0 : 420)
    return () => clearTimeout(t)
  }, [props.abrirSenha])

  async function salvarSenha(e: Event) {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      await criarSenhaInicial(props.token!, senha)
      setPronto(true)
      props.aoCriarSenha()
    } catch (err: any) {
      setErro(err.message)
    } finally {
      setSalvando(false)
    }
  }
  return (
    <div class="pagina">
      <Cabecalho
        portal={props.portal}
        acesso={
          <AcessoNoTopo
            temSenha={props.temSenha || pronto}
            podeCriar={!!props.token}
            aoCriarSenha={props.aoAbrirSenha}
          />
        }
        trilha={
          <Trilha
            passos={props.passos}
            atual={props.passos.length - 1}
            total={props.passos.length}
          />
        }
      />
      <div class="cartao fim">
        <div class="marca" aria-hidden="true">✓</div>
        <h2>Inscrição recebida</h2>
        <p class="sub">Guarde este código — ele identifica sua inscrição.</p>
        <div class="codigo">{props.codigo}</div>
        {props.oferta && <p class="sub">{props.oferta.nome}</p>}
        {props.pagamentoUrl ? (
          <>
            <p class="sub">Falta concluir o pagamento para a inscrição valer.</p>
            <a href={props.pagamentoUrl}><button class="principal">Pagar agora</button></a>
          </>
        ) : props.precisaPagar && props.token && !pago ? (
          <p class="sub">Falta concluir o pagamento — escolha abaixo como pagar.</p>
        ) : (
          <p class="sub">{props.mensagem || 'Enviamos os próximos passos para o seu WhatsApp.'}</p>
        )}

        {/* O painel de senha deixou de vir aberto; sem este convite, criar
            acesso sumiria da vista de quem acabou de se inscrever — e é aqui
            que a pessoa está mais disposta a criar. */}
        {props.token && !pronto && !props.temSenha && !props.abrirSenha && (
          <p class="convite-senha">
            <button type="button" class="como-link" onClick={props.aoAbrirSenha}>
              Criar uma senha
            </button>{' '}
            para acompanhar sua inscrição sem precisar achar esta página de novo.
          </p>
        )}
      </div>

      {props.precisaPagar && props.token && !props.pagamentoUrl && !pago && (
        <div style="margin-top:14px;text-align:left">
          <Pagamento codigo={props.codigo} token={props.token} aoConfirmar={() => setPago(true)} />
        </div>
      )}

      {pago && (
        <div class="cartao" style="margin-top:14px">
          <h2 style="font-size:17px">Pagamento confirmado</h2>
          <p class="sub">Sua inscrição está completa. Avisamos os próximos passos pelo WhatsApp.</p>
        </div>
      )}

      {props.token && !pronto && !props.temSenha && props.abrirSenha && (
        <div class="cartao painel-senha" ref={painelSenha} style="margin-top:14px;text-align:left">
          <h2 style="font-size:17px">Crie uma senha para acompanhar</h2>
          <p class="sub">
            Com ela você entra quando quiser para enviar documentos, assinar o
            contrato e ver o que falta — sem depender de achar esta página de novo.
          </p>
          {erro && <div class="aviso erro" role="alert">{erro}</div>}
          <form onSubmit={salvarSenha}>
            <div class="campo">
              <label for="senha_inicial">Senha</label>
              <input
                id="senha_inicial" type="password" autoComplete="new-password" minLength={8}
                value={senha} onInput={(e) => setSenha((e.target as HTMLInputElement).value)}
              />
              <span class="ajuda">Ao menos 8 caracteres, misturando letras e números.</span>
            </div>
            <button class="principal" type="submit" disabled={salvando || senha.length < 8}>
              {salvando ? 'Salvando…' : 'Criar senha'}
            </button>
          </form>
          <p class="ajuda" style="text-align:center;margin-top:12px">
            Pode deixar para depois: dá para criar a senha pelo link que enviamos no WhatsApp.
          </p>
        </div>
      )}

      {pronto && (
        <div class="cartao" style="margin-top:14px;text-align:center">
          <h2 style="font-size:17px">Senha criada</h2>
          <p class="sub">Você já está identificado neste aparelho.</p>
          <a href="/portal"><button class="principal">Ir para meu portal</button></a>
        </div>
      )}
      <Rodape portal={props.portal} />
    </div>
  )
}

function Rodape({ portal }: { portal: DadosPortal['portal'] }) {
  if (!portal.brandFooterText) return null
  return <div class="rodape">{portal.brandFooterText}</div>
}

function AjudaFlutuante({ portal }: { portal: DadosPortal['portal'] }) {
  if (portal.ctaBehavior !== 'whatsapp' || !portal.ctaTarget) return null
  const url = `https://wa.me/${String(portal.ctaTarget).replace(/\D/g, '')}?text=${encodeURIComponent(portal.ctaMessage || 'Olá! Preciso de ajuda com a inscrição.')}`
  return <a class="ajuda-flutuante" href={url} target="_blank" rel="noopener">Falar com a gente</a>
}

function Esqueleto() {
  return (
    <div class="pagina" aria-busy="true" aria-label="Carregando a inscrição">
      <div class="topo"><div class="esqueleto" style="width:150px;height:26px" /></div>
      <div class="esqueleto" style="height:120px;margin-bottom:18px" />
      <div class="esqueleto" style="height:14px;margin-bottom:18px" />
      <div class="esqueleto" style="height:340px" />
    </div>
  )
}
