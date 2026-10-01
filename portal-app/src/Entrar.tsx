// /portal/login — entrar no portal, com a moldura e a marca do portal de
// inscrição (antes era uma página do servidor com outro visual).
//
// Duas formas de entrar, na mesma tela e para o mesmo portal (/portal):
// e-mail + senha, ou código da inscrição + CPF (era a tela /candidato, que agora
// redireciona para cá com ?codigo=). Código + CPF vale enquanto a pessoa não
// criou senha própria — a mesma regra do CPF como senha padrão.
import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, type MarcaDoPortal } from './marca'
import { Moldura } from './Moldura'

const q = new URLSearchParams(location.search)

export function Entrar() {
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(q.get('erro'))
  const [aviso, setAviso] = useState<string | null>(q.get('aviso'))
  const [enviando, setEnviando] = useState(false)
  const [recuperar, setRecuperar] = useState('')
  const [modo, setModo] = useState<'email' | 'codigo'>(q.get('codigo') || q.get('modo') === 'codigo' ? 'codigo' : 'email')
  const [codigo, setCodigo] = useState((q.get('codigo') || '').trim().toUpperCase())
  const [cpf, setCpf] = useState('')

  useEffect(() => { void carregarMarca(undefined, q.get('portal') ?? undefined).then(setMarca) }, [])

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
    const r = await fetch('/api/public/portal/recuperar', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identificador: recuperar }),
    }).then((x) => x.json()).catch(() => null)
    setErro(null)
    setAviso(r?.mensagem || 'Se houver cadastro com esse dado, enviamos um link de acesso pelo WhatsApp ou e-mail.')
  }

  return (
    <Moldura marca={marca}>
      <form class="cartao" onSubmit={modo === 'email' ? entrar : entrarPorCodigo}>
        <h2 style="margin-bottom:12px">Acesse sua inscrição</h2>
        <div class="modo-entrar" role="tablist">
          <button type="button" role="tab" aria-selected={modo === 'email'} class={modo === 'email' ? 'ativo' : ''} onClick={() => { setModo('email'); setErro(null) }}>E-mail e senha</button>
          <button type="button" role="tab" aria-selected={modo === 'codigo'} class={modo === 'codigo' ? 'ativo' : ''} onClick={() => { setModo('codigo'); setErro(null) }}>Código e CPF</button>
        </div>
        {erro && <div class="aviso erro">{erro}</div>}
        {aviso && <div class="aviso info">{aviso}</div>}
        {modo === 'codigo' ? (
          <>
            <div class="campo">
              <label for="ent-codigo">Código da inscrição</label>
              <input id="ent-codigo" value={codigo} required autocomplete="off" autocapitalize="characters" placeholder="Ex.: MAT-26-000001-ABCD"
                onInput={(e: any) => setCodigo(e.currentTarget.value)} />
            </div>
            <div class="campo">
              <label for="ent-cpf">CPF</label>
              <input id="ent-cpf" value={cpf} required inputMode="numeric" autocomplete="off" placeholder="000.000.000-00"
                onInput={(e: any) => setCpf(e.currentTarget.value)} />
            </div>
            <p class="sub" style="margin:0 0 14px">O código está na confirmação da inscrição (começa com MAT-).</p>
          </>
        ) : (<>
        <div class="campo">
          <label for="ent-usuario">E-mail</label>
          <input id="ent-usuario" type="email" inputMode="email" value={usuario} required autocomplete="username" autocapitalize="off" autocorrect="off"
            onInput={(e: any) => setUsuario(e.currentTarget.value)} />
        </div>
        <div class="campo">
          <label for="ent-senha">Senha</label>
          <input id="ent-senha" type="password" value={senha} required autocomplete="current-password"
            onInput={(e: any) => setSenha(e.currentTarget.value)} />
        </div>
        </>)}
        <button class="principal" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <form class="cartao" onSubmit={pedirLink}>
        <h2 style="font-size:16px">Esqueceu a senha?</h2>
        <p class="sub">Mandamos um link pelo WhatsApp ou e-mail do seu cadastro. Ele vale 48 horas e serve uma vez.</p>
        <div class="campo">
          <label for="ent-rec">E-mail</label>
          <input id="ent-rec" type="email" inputMode="email" value={recuperar} required onInput={(e: any) => setRecuperar(e.currentTarget.value)} />
        </div>
        <button class="secundario" type="submit">Receber link de acesso</button>
      </form>
    </Moldura>
  )
}
