// /candidato e /candidato/<código> — entrada por código da inscrição + CPF.
//
// É o link que vai nos avisos (e-mail/WhatsApp). Antes abria um portal à parte
// (candidate-portal.js), que não conhecia a ordem das etapas nem o contrato;
// agora mostra a MESMA jornada do portal logado. Quem já tem sessão no portal
// nem chega aqui: o servidor manda para /portal/aluno.
import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, TopoDaMarca, type MarcaDoPortal } from './marca'
import { Jornada } from './Jornada'

const CHAVE = (codigo: string) => `bh_candidato_${codigo}`
const lerToken = (codigo: string) => { try { return sessionStorage.getItem(CHAVE(codigo)) } catch { return null } }
const gravarToken = (codigo: string, t: string | null) => {
  try { if (t) sessionStorage.setItem(CHAVE(codigo), t); else sessionStorage.removeItem(CHAVE(codigo)) } catch { /* sem storage: entra de novo */ }
}

/** Token curto do candidato vence: quando a jornada responde 401, volta ao login. */
function tokenValido(t: string | null): boolean {
  if (!t) return false
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return !p.exp || p.exp * 1000 > Date.now()
  } catch { return true }
}

export function Candidato() {
  const doLink = (location.pathname.split('/')[2] || '').trim().toUpperCase()
  const [codigo, setCodigo] = useState(doLink)
  const [cpf, setCpf] = useState('')
  const [token, setToken] = useState<string | null>(() => {
    const t = doLink ? lerToken(doLink) : null
    return tokenValido(t) ? t : null
  })
  const [nome, setNome] = useState<string | null>(null)
  const [portal, setPortal] = useState<string | null>(null)
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  useEffect(() => { void carregarMarca(codigo || undefined).then(setMarca) }, [token])

  async function entrar(e: Event) {
    e.preventDefault()
    const cod = codigo.trim().toUpperCase()
    if (!cod || cpf.replace(/\D/g, '').length !== 11) { setErro('Informe o código da inscrição e o CPF.'); return }
    setEntrando(true); setErro(null)
    try {
      const r = await fetch('/api/candidate/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateCode: cod, cpf }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.token) throw new Error(j.error || 'Não foi possível entrar.')
      gravarToken(cod, j.token)
      setCodigo(cod); setNome(j.candidate?.name ?? null); setPortal(j.candidate?.portalName ?? null)
      if (location.pathname.split('/')[2]?.toUpperCase() !== cod) history.replaceState(null, '', `/candidato/${cod}${location.hash}`)
      setToken(j.token)
    } catch (e: any) { setErro(e.message) } finally { setEntrando(false) }
  }

  function sair() { gravarToken(codigo, null); setToken(null); setCpf('') }

  if (!token) {
    return (
      <div class="pagina">
        <TopoDaMarca marca={marca} />
        <form class="cartao" style="margin-top:14px" onSubmit={entrar}>
          <h2>Minha inscrição</h2>
          <p class="sub">Entre com o código da inscrição e o seu CPF para acompanhar e concluir as etapas.</p>
          <div class="campo">
            <label for="cand-codigo">Código da inscrição</label>
            <input id="cand-codigo" value={codigo} autocomplete="off" autocapitalize="characters" placeholder="Ex.: MAT-26-000001-ABCD"
              onInput={(e: any) => setCodigo(e.currentTarget.value)} />
          </div>
          <div class="campo">
            <label for="cand-cpf">CPF</label>
            <input id="cand-cpf" value={cpf} inputMode="numeric" autocomplete="off" placeholder="000.000.000-00"
              onInput={(e: any) => setCpf(e.currentTarget.value)} />
          </div>
          {erro && <div class="aviso erro">{erro}</div>}
          <button class="principal" type="submit" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button>
          <p class="sub legal">Tem senha do portal? <a href="/portal/login">Entre pelo portal</a>.</p>
        </form>
      </div>
    )
  }

  return (
    <div class="pagina">
      <TopoDaMarca marca={marca} />
      <div class="cartao" style="margin-bottom:14px">
        <h2>{nome ? `Olá, ${nome.split(' ')[0]}` : 'Minha inscrição'}</h2>
        <p class="sub" style="margin:0">Código {codigo}{portal ? ` · ${portal}` : ''}</p>
        <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
          <a href={`/api/candidate/receipt.pdf`} onClick={(e) => { e.preventDefault(); void baixarComprovante(token) }}>Comprovante de inscrição</a>
          <button class="link" type="button" onClick={sair}>Sair</button>
        </div>
      </div>
      <div class="cartao">
        <Jornada key={token} codigo={codigo} token={token} contexto="painel" />
      </div>
    </div>
  )
}

async function baixarComprovante(token: string) {
  const r = await fetch('/api/candidate/receipt.pdf', { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) { alert('Comprovante indisponível no momento.'); return }
  const url = URL.createObjectURL(await r.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
