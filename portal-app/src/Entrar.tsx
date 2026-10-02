// /portal/login — entrar no portal.
//
// Tela dividida, como o login do sistema: à esquerda o painel da marca (cor do
// Branding, ou a imagem da capa quando houver); à direita o formulário. No
// celular o painel some e fica só o formulário com o logo.
//
// Duas formas de entrar, na mesma tela e para o mesmo portal (/portal):
// e-mail + senha, ou código da inscrição + CPF (era a tela /candidato, que agora
// redireciona para cá com ?codigo=). Código + CPF vale enquanto a pessoa não
// criou senha própria — a mesma regra do CPF como senha padrão.
//
// "Esqueceu a senha?" não fica mais aberto embaixo: troca o formulário pelo de
// recuperação, com volta para o login.
import { useEffect, useState } from 'preact/hooks'
import { carregarAcesso, type LoginDoPortal, type MarcaDoPortal } from './marca'

const q = new URLSearchParams(location.search)

/** 000.000.000-00 enquanto digita. */
function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}

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
  recuperarTexto: 'Informe o e-mail do cadastro. Mandamos um link pelo WhatsApp ou e-mail — ele vale 48 horas e serve uma vez.',
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
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(q.get('erro'))
  const [aviso, setAviso] = useState<string | null>(q.get('aviso'))
  const [enviando, setEnviando] = useState(false)
  const [modo, setModo] = useState<'email' | 'codigo'>(q.get('codigo') || q.get('modo') === 'codigo' ? 'codigo' : 'email')
  const [codigo, setCodigo] = useState((q.get('codigo') || '').trim().toUpperCase())
  const [cpf, setCpf] = useState('')
  // Recuperação: escondida até a pessoa pedir.
  const [recuperando, setRecuperando] = useState(false)
  const [recuperar, setRecuperar] = useState('')
  const [linkEnviado, setLinkEnviado] = useState<string | null>(null)

  useEffect(() => {
    void carregarAcesso(q.get('portal') ?? undefined).then((r) => {
      setMarca(r.marca)
      if (r.login) {
        setLogin(r.login)
        // Só uma forma de entrar ligada: a tela abre nela.
        if (!r.login.modoCodigo) setModo('email')
        else if (!r.login.modoEmail) setModo('codigo')
      }
    })
  }, [])
  useEffect(() => { document.documentElement.classList.add('tela-login'); return () => document.documentElement.classList.remove('tela-login') }, [])

  function trocarModo(m: 'email' | 'codigo') { setModo(m); setErro(null) }

  function abrirRecuperacao() {
    setRecuperando(true); setErro(null); setAviso(null); setLinkEnviado(null)
    // O e-mail já digitado no login vem junto: não faz digitar de novo.
    if (!recuperar && usuario) setRecuperar(usuario)
  }

  async function entrar(e: Event) {
    e.preventDefault()
    setEnviando(true); setErro(null); setAviso(null)
    try {
      const r = await fetch('/api/public/portal/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identificador: usuario, senha }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Não foi possível entrar.')
      const destino = /^\/(portal|candidato)(\/|$|\?|#)/.test(q.get('destino') || '') ? q.get('destino')! : '/portal'
      location.href = j.senhaPadrao ? `/portal/senha?primeiro=1&depois=${encodeURIComponent(destino)}` : destino
    } catch (e: any) { setErro(e.message); setEnviando(false) }
  }

  async function entrarPorCodigo(e: Event) {
    e.preventDefault()
    if (!codigo.trim() || cpf.replace(/\D/g, '').length !== 11) { setErro('Informe o código da inscrição e o CPF.'); return }
    setEnviando(true); setErro(null); setAviso(null)
    try {
      const r = await fetch('/api/public/portal/entrar-codigo', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ codigo: codigo.trim().toUpperCase(), cpf }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j.temSenha) { setModo('email'); throw new Error(j.error) }
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
    setLinkEnviado(r?.mensagem || 'Se houver cadastro com esse e-mail, enviamos um link de acesso pelo WhatsApp ou e-mail.')
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
                  <label for="ent-rec">E-mail</label>
                  <input id="ent-rec" type="email" inputMode="email" value={recuperar} required autoFocus autocomplete="username"
                    placeholder="seu@email.com" onInput={(e: any) => setRecuperar(e.currentTarget.value)} />
                </div>
                <button class="principal largo" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Receber link de acesso'}</button>
              </>)}
              <button type="button" class="login-voltar" onClick={() => { setRecuperando(false); setLinkEnviado(null) }}>
                {Icone.voltar} Voltar para o login
              </button>
            </form>
          ) : (
            <form onSubmit={modo === 'email' ? entrar : entrarPorCodigo}>
              <h2 class="login-titulo">{login.formTitulo}</h2>
              {login.formSubtitulo && <p class="login-sub">{login.formSubtitulo}</p>}
              {login.modoEmail && login.modoCodigo && (
                <div class="modo-entrar" role="tablist">
                  <button type="button" role="tab" aria-selected={modo === 'email'} class={modo === 'email' ? 'ativo' : ''} onClick={() => trocarModo('email')}>E-mail e senha</button>
                  <button type="button" role="tab" aria-selected={modo === 'codigo'} class={modo === 'codigo' ? 'ativo' : ''} onClick={() => trocarModo('codigo')}>Código e CPF</button>
                </div>
              )}
              {erro && <div class="aviso erro">{erro}</div>}
              {aviso && <div class="aviso info">{aviso}</div>}
              {modo === 'codigo' ? (<>
                <div class="campo">
                  <label for="ent-codigo">Código da inscrição</label>
                  <input id="ent-codigo" value={codigo} required autocomplete="off" autocapitalize="characters" placeholder={`${login.prefixoCodigo}-26-000001-ABCD`}
                    onInput={(e: any) => setCodigo(e.currentTarget.value.toUpperCase())} />
                  <span class="ajuda">Está na confirmação da inscrição (começa com {login.prefixoCodigo}-).</span>
                </div>
                <div class="campo">
                  <label for="ent-cpf">CPF</label>
                  <input id="ent-cpf" value={cpf} required inputMode="numeric" autocomplete="off" placeholder="000.000.000-00"
                    onInput={(e: any) => setCpf(mascaraCpf(e.currentTarget.value))} />
                </div>
              </>) : (<>
                <div class="campo">
                  <label for="ent-usuario">E-mail</label>
                  <input id="ent-usuario" type="email" inputMode="email" value={usuario} required autocomplete="username" autocapitalize="off" autocorrect="off"
                    placeholder="seu@email.com" onInput={(e: any) => setUsuario(e.currentTarget.value)} />
                </div>
                <div class="campo">
                  <label for="ent-senha">Senha</label>
                  <div class="campo-senha">
                    <input id="ent-senha" type={verSenha ? 'text' : 'password'} value={senha} required autocomplete="current-password"
                      onInput={(e: any) => setSenha(e.currentTarget.value)} />
                    <button type="button" class="ver-senha" aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'} aria-pressed={verSenha}
                      onClick={() => setVerSenha(!verSenha)}>{Icone.olho(!verSenha)}</button>
                  </div>
                </div>
              </>)}
              <button class="principal largo" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
              <button type="button" class="login-esqueci" onClick={abrirRecuperacao}>
                {modo === 'email' ? login.esqueciTexto : 'Não tem o código? Receber link de acesso'}
              </button>
            </form>
          )}
        </div>
        {marca?.brandFooterText && <div class="login-rodape">{marca.brandFooterText}</div>}
      </main>
    </div>
  )
}
