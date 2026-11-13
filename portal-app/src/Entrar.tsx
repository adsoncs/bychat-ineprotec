// /portal/login — entrar no portal.
//
// Tela dividida, como o login do sistema: à esquerda o painel da marca (cor do
// Branding, ou a imagem da capa quando houver); à direita o formulário. No
// celular o painel some e fica só o formulário com o logo.
//
// Um formulário só (13/11/2026 — as abas "E-mail e senha" / "Código e CPF"
// confundiam os candidatos): Usuário = e-mail, CPF ou código da inscrição;
// Senha = a senha própria ou, enquanto não criou uma, o CPF. A tela descobre o
// caminho: código + CPF vai à rota do código (cria a conta se faltar); o resto
// vai ao login. CPF nos DOIS campos continua recusado (o CPF circula demais).
// /candidato redireciona para cá com ?codigo=, que já vem no campo Usuário.
//
// "Esqueceu a senha?" não fica mais aberto embaixo: troca o formulário pelo de
// recuperação, com volta para o login.
import { useEffect, useState } from 'preact/hooks'
import { carregarAcesso, type LoginDoPortal, type MarcaDoPortal } from './marca'

const q = new URLSearchParams(location.search)

const Icone = {
  olho: (aberto: boolean) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {aberto
        ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
        : <><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4" /><path d="m2 2 20 20" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>}
    </svg>
  ),
  voltar: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
  ),
}

// Textos de antes das Configurações Gerais: valem enquanto o servidor não
// responde (e se ele não responder).
const PADRAO: LoginDoPortal = {
  painelTitulo: 'Portal do candidato e do aluno',
  painelSubtitulo: 'Sua inscrição, seus documentos e sua vida acadêmica em um só lugar.',
  painelItens: ['Acompanhe as etapas da sua inscrição', 'Envie seus documentos', 'Assine o contrato e pague online'],
  painelImagemUrl: null, painelVeu: null, painelLado: 'esquerda', painelCorDe: null, painelCorPara: null,
  formTitulo: 'Acesse sua inscrição', formSubtitulo: 'Entre para acompanhar sua inscrição e sua vida acadêmica.',
  modoEmail: true, modoCodigo: true,
  esqueciTexto: 'Esqueceu a senha?', recuperarTitulo: 'Recuperar acesso',
  recuperarTexto: 'Informe o e-mail, o CPF ou o código da inscrição. Mandamos um link pelo WhatsApp ou e-mail — ele vale 48 horas e serve uma vez.',
  linkHoras: 48, prefixoCodigo: 'MAT',
}

// Configurações Gerais › Tela de login: textos, itens, cores, imagem e véu.
// Imagem: a do login; sem ela, a capa do portal (como antes).
function PainelDaMarca({ marca, login }: { marca: MarcaDoPortal | null; login: LoginDoPortal }) {
  const imagem = login.painelImagemUrl || (marca?.brandHeroEnabled !== false ? marca?.brandHeroUrl : null) || null
  const estilo: Record<string, string> = {}
  if (imagem) estilo.backgroundImage = `url("${imagem}")`
  if (login.painelCorDe) estilo['--painel-de'] = login.painelCorDe
  if (login.painelCorPara) estilo['--painel-para'] = login.painelCorPara
  if (login.painelVeu !== null) estilo['--painel-veu'] = `${login.painelVeu}%`
  return (
    <aside class={`login-painel${imagem ? ' com-capa' : ''}`} style={estilo}>
      <div class="login-painel-texto">
        {login.painelTitulo && <h1>{login.painelTitulo}</h1>}
        {login.painelSubtitulo && <p>{login.painelSubtitulo}</p>}
        {login.painelItens.length > 0 && (
          <ul>
            {login.painelItens.map((r) => <li key={r}><span>{Icone.check}</span>{r}</li>)}
          </ul>
        )}
      </div>
    </aside>
  )
}

export function Entrar() {
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [login, setLogin] = useState<LoginDoPortal>(PADRAO)
  const [usuario, setUsuario] = useState((q.get('codigo') || '').trim().toUpperCase())
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(q.get('erro'))
  const [aviso, setAviso] = useState<string | null>(q.get('aviso'))
  const [enviando, setEnviando] = useState(false)
  // Recuperação: escondida até a pessoa pedir.
  const [recuperando, setRecuperando] = useState(false)
  const [recuperar, setRecuperar] = useState('')
  const [linkEnviado, setLinkEnviado] = useState<string | null>(null)

  useEffect(() => {
    void carregarAcesso(q.get('portal') ?? undefined).then((r) => {
      setMarca(r.marca)
      if (r.login) setLogin(r.login)
    })
  }, [])
  useEffect(() => { document.documentElement.classList.add('tela-login'); return () => document.documentElement.classList.remove('tela-login') }, [])

  function abrirRecuperacao() {
    setRecuperando(true); setErro(null); setAviso(null); setLinkEnviado(null)
    // O e-mail já digitado no login vem junto: não faz digitar de novo.
    if (!recuperar && usuario) setRecuperar(usuario)
  }

  // Código da inscrição (MAT-26-000004-LKGW) e senha que é um CPF.
  const ehCodigo = (v: string) => /^[A-Za-z]{2,5}-\d{2}-\d{3,}-[A-Za-z0-9]{3,}$/.test(v.trim())
  const ehCpf = (v: string) => /^[\d.\-\s]+$/.test(v.trim()) && v.replace(/\D/g, '').length === 11

  async function entrar(e: Event) {
    e.preventDefault()
    const u = usuario.trim()
    if (!u || !senha) { setErro('Preencha o usuário e a senha.'); return }
    if (ehCpf(u) && ehCpf(senha) && u.replace(/\D/g, '') === senha.replace(/\D/g, '')) {
      setErro('Por segurança, o CPF não serve como usuário e senha ao mesmo tempo. No usuário, use o seu e-mail ou o código da inscrição.')
      return
    }
    if (ehCodigo(u) && ehCpf(senha)) return entrarPorCodigo(u, senha)
    setEnviando(true); setErro(null); setAviso(null)
    try {
      const r = await fetch('/api/public/portal/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identificador: u, senha }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Senha digitada é um CPF e não serviu: quase sempre é quem já criou a
        // própria senha e tentou o CPF (o servidor não diz qual erro foi).
        const dica = ehCpf(senha) && /incorret/i.test(j.error || '')
          ? ' Se você já criou uma senha, use ela no lugar do CPF.' : ''
        throw new Error((j.error || 'Não foi possível entrar.') + dica)
      }
      const destino = /^\/(portal|candidato)(\/|$|\?|#)/.test(q.get('destino') || '') ? q.get('destino')! : '/portal'
      location.href = j.senhaPadrao ? `/portal/senha?primeiro=1&depois=${encodeURIComponent(destino)}` : destino
    } catch (e: any) { setErro(e.message); setEnviando(false) }
  }

  async function entrarPorCodigo(codigo: string, cpf: string) {
    setEnviando(true); setErro(null); setAviso(null)
    try {
      const r = await fetch('/api/public/portal/entrar-codigo', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ codigo: codigo.toUpperCase(), cpf }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j.temSenha) {
        setSenha('')
        throw new Error('Você já criou uma senha. Digite a sua senha no lugar do CPF — ou use "Esqueceu a senha?".')
      }
      if (!r.ok) throw new Error(j.error || 'Não foi possível entrar.')
      location.href = j.senhaPadrao ? `/portal/senha?primeiro=1&depois=${encodeURIComponent('/portal')}` : '/portal'
    } catch (e: any) { setErro(e.message); setEnviando(false) }
  }

  async function pedirLink(e: Event) {
    e.preventDefault()
    if (!recuperar.trim()) return
    setEnviando(true)
    const r = await fetch('/api/public/portal/recuperar', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identificador: recuperar }),
    }).then((x) => x.json()).catch(() => null)
    setEnviando(false); setErro(null)
    setLinkEnviado(r?.mensagem || 'Se houver cadastro com esse dado, enviamos um link de acesso pelo WhatsApp ou e-mail.')
  }

  const logo = marca && (marca.brandLogoUrl
    ? <img class="login-logo" src={marca.brandLogoUrl} alt={marca.nome ?? ''} />
    : <div class="login-logo-nome">{marca.nome}</div>)

  return (
    <div class={`login-dividido${login.painelLado === 'direita' ? ' painel-direita' : ''}`}>
      <PainelDaMarca marca={marca} login={login} />
      <main class="login-lado">
        <div class="login-caixa">
          {logo ?? <div class="esqueleto" style="width:140px;height:40px;margin:0 auto 28px" />}

          {recuperando ? (
            <form onSubmit={pedirLink}>
              <h2 class="login-titulo">{login.recuperarTitulo}</h2>
              <p class="login-sub">{login.recuperarTexto}</p>
              {linkEnviado ? (
                <div class="aviso info">{linkEnviado}</div>
              ) : (<>
                <div class="campo">
                  <label for="ent-rec">E-mail, CPF ou código da inscrição</label>
                  <input id="ent-rec" value={recuperar} required autoFocus autocomplete="username" autocapitalize="off"
                    placeholder="E-mail, CPF ou código" onInput={(e: any) => setRecuperar(e.currentTarget.value)} />
                </div>
                <button class="principal largo" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Receber link de acesso'}</button>
              </>)}
              <button type="button" class="login-voltar" onClick={() => { setRecuperando(false); setLinkEnviado(null) }}>
                {Icone.voltar} Voltar para o login
              </button>
            </form>
          ) : (
            <form onSubmit={entrar}>
              <h2 class="login-titulo">{login.formTitulo}</h2>
              {login.formSubtitulo && <p class="login-sub">{login.formSubtitulo}</p>}
              {erro && <div class="aviso erro">{erro}</div>}
              {aviso && <div class="aviso info">{aviso}</div>}
              <div class="campo">
                <label for="ent-usuario">Usuário</label>
                <input id="ent-usuario" value={usuario} required autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck={false}
                  placeholder="E-mail, CPF ou código da inscrição" onInput={(e: any) => setUsuario(e.currentTarget.value)} />
              </div>
              <div class="campo">
                <label for="ent-senha">Senha</label>
                <div class="campo-senha">
                  <input id="ent-senha" type={verSenha ? 'text' : 'password'} value={senha} required autocomplete="current-password"
                    onInput={(e: any) => setSenha(e.currentTarget.value)} />
                  <button type="button" class="ver-senha" aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'} aria-pressed={verSenha}
                    onClick={() => setVerSenha(!verSenha)}>{Icone.olho(!verSenha)}</button>
                </div>
                <span class="ajuda">Ainda não criou uma senha? Use o seu CPF.</span>
              </div>
              <button class="principal largo" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
              <button type="button" class="login-esqueci" onClick={abrirRecuperacao}>
                {login.esqueciTexto}
              </button>
            </form>
          )}
        </div>
        {marca?.brandFooterText && <div class="login-rodape">{marca.brandFooterText}</div>}
      </main>
    </div>
  )
}
