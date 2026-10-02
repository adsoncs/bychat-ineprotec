// /portal/senha — criar (primeiro acesso, senha padrão = CPF) ou trocar a senha.
import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, type MarcaDoPortal } from './marca'
import { Moldura, AcessoSair } from './Moldura'
import { t as tx } from './textos'

const q = new URLSearchParams(location.search)
const depois = /^\/(portal|candidato)(\/|$|\?|#)/.test(q.get('depois') || '') ? q.get('depois')! : '/portal'

export function Senha() {
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [eu, setEu] = useState<{ nome: string; temSenha: boolean } | null>(null)
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  const [erro, setErro] = useState<string | null>(q.get('erro'))
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    void carregarMarca().then(setMarca)
    fetch('/api/public/portal/eu', { credentials: 'same-origin' })
      .then(async (r) => { if (r.status === 401) { location.href = '/portal/login?erro=' + encodeURIComponent('Entre para criar sua senha.'); return } setEu((await r.json()).eu) })
      .catch(() => setErro('Não foi possível carregar sua conta.'))
  }, [])

  async function salvar(e: Event) {
    e.preventDefault()
    if (s1 !== s2) { setErro('As duas senhas não são iguais.'); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch('/api/public/portal/senha', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ senha: s1, confirmacao: s2 }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Não foi possível salvar a senha.')
      location.href = `${depois}${depois.includes('?') ? '&' : '?'}aviso=${encodeURIComponent('Senha atualizada.')}`
    } catch (e: any) { setErro(e.message); setSalvando(false) }
  }

  const primeiro = eu ? !eu.temSenha : false
  return (
    <Moldura marca={marca} acesso={<AcessoSair />}>
      <form class="cartao" onSubmit={salvar}>
        <h2>{primeiro ? tx('senha.criarTitulo', 'Criar sua senha') : tx('senha.trocarTitulo', 'Trocar senha')}</h2>
        <p class="sub">{!eu ? ' ' : primeiro
          ? tx('senha.criarTexto', 'Olá, {nome}. Você entrou com a senha padrão (o seu CPF). Crie uma senha só sua — a partir daí o CPF deixa de valer como senha.', { nome: eu.nome.split(' ')[0] ?? '' })
          : tx('senha.trocarTexto', 'A senha atual deixa de valer e os outros aparelhos saem do portal.')}</p>
        {erro && <div class="aviso erro">{erro}</div>}
        <div class="campo">
          <label for="sen-1">Nova senha</label>
          <input id="sen-1" type="password" value={s1} required minLength={8} autocomplete="new-password" onInput={(e: any) => setS1(e.currentTarget.value)} />
        </div>
        <div class="campo">
          <label for="sen-2">Repita a senha</label>
          <input id="sen-2" type="password" value={s2} required minLength={8} autocomplete="new-password" onInput={(e: any) => setS2(e.currentTarget.value)} />
        </div>
        <p class="sub legal" style="margin:-4px 0 14px">{tx('senha.regra', 'Ao menos 8 caracteres, misturando letras e números.')}</p>
        <div class="acoes-linha">
          <button class="principal" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : tx('senha.salvar', 'Salvar senha')}</button>
          {primeiro && <button class="secundario" type="button" onClick={() => { location.href = depois }}>{tx('senha.agoraNao', 'Agora não, continuar')}</button>}
          {!primeiro && eu && <button class="secundario" type="button" onClick={() => history.back()}>Cancelar</button>}
        </div>
      </form>
    </Moldura>
  )
}
