// Moldura única das telas do portal fora do formulário: entrar, criar senha,
// início (/portal), painel, candidato, documentos e contrato.
//
// É a mesma do portal de inscrição — logo, botão de acesso no topo, faixa
// fixa ("barra") ou topo simples, selo, rodapé, cores, fonte, botões e fundo
// vêm do Branding do portal. Mudou o Branding, muda em todas as telas: nada
// aqui escolhe cor ou forma por conta própria.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { MarcaDoPortal } from './marca'

function Logo({ marca }: { marca: MarcaDoPortal }) {
  if (!marca.brandLogoUrl) return <span class="nome">{marca.nome}</span>
  const img = <img src={marca.brandLogoUrl} alt={marca.nome ?? ''} />
  return marca.brandLogoLink ? <a href={marca.brandLogoLink}>{img}</a> : img
}

function Selo({ texto }: { texto: string }) {
  return (
    <span class="selo">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M12 2 4 5.5v6c0 4.7 3.2 8.9 8 10.5 4.8-1.6 8-5.8 8-10.5v-6L12 2Zm0 6a2.2 2.2 0 0 1 1 4.1V15a1 1 0 1 1-2 0v-2.9A2.2 2.2 0 0 1 12 8Z" fill="currentColor" />
      </svg>
      {texto}
    </span>
  )
}

/** Faixa fixa (Branding › topo "barra"): mede a própria altura, como na inscrição. */
function BarraFixa({ marca, acesso }: { marca: MarcaDoPortal; acesso?: ComponentChildren }) {
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
          <Logo marca={marca} />
          {acesso}
        </div>
        {marca.brandSecurityNote && <Selo texto={marca.brandSecurityNote} />}
      </div>
    </header>
  )
}

/** Botão do topo: "Entrar" (fora) ou "Sair" (dentro) — o mesmo lugar e estilo da inscrição. */
export function AcessoEntrar({ slug }: { slug?: string | null }) {
  const destino = slug ? `/portal/login?portal=${encodeURIComponent(slug)}` : '/portal/login'
  return <a class="acesso-topo" href={destino}>Entrar</a>
}

export function AcessoSair(props: { aoSair?: () => void }) {
  async function sair() {
    if (props.aoSair) return props.aoSair()
    await fetch('/api/public/portal/sair', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }).catch(() => null)
    location.href = '/portal/login?aviso=' + encodeURIComponent('Você saiu do portal.')
  }
  return <button class="acesso-topo" type="button" onClick={sair}>Sair</button>
}

/**
 * Menu da conta no topo do portal logado: o primeiro nome abre um submenu com
 * "Editar meus dados", criar/trocar senha e "Sair". Enquanto a pessoa entra
 * com o CPF como senha, uma bolinha no botão e um aviso no menu lembram de
 * criar a própria. Fecha ao clicar fora, ao escolher um item ou com Esc.
 */
export function MenuDaConta(props: { nome: string; temSenha: boolean; aoEditar?: () => void }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])
  async function sair() {
    await fetch('/api/public/portal/sair', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }).catch(() => null)
    location.href = '/portal/login?aviso=' + encodeURIComponent('Você saiu do portal.')
  }
  const primeiro = props.nome.trim().split(/\s+/)[0] || 'Minha conta'
  return (
    <div class="menu-conta" ref={caixa}>
      <button type="button" class="acesso-topo menu-conta-botao" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
        <span>{primeiro}</span>
        {!props.temSenha && <span class="menu-conta-ponto" title="Crie sua senha" />}
        <svg class="menu-conta-seta" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div class="menu-conta-lista" role="menu">
          {props.aoEditar && (
            <button type="button" role="menuitem" onClick={() => { setAberto(false); props.aoEditar!() }}>Editar meus dados</button>
          )}
          <a role="menuitem" href="/portal/senha">
            {props.temSenha ? 'Trocar senha' : 'Criar minha senha'}
            {!props.temSenha && <small>Você ainda entra com o CPF como senha.</small>}
          </a>
          <button type="button" role="menuitem" class="menu-conta-sair" onClick={sair}>Sair</button>
        </div>
      )}
    </div>
  )
}

export function Moldura(props: {
  marca: MarcaDoPortal | null
  acesso?: ComponentChildren
  children: ComponentChildren
}) {
  const m = props.marca
  return (
    <div class="pagina logada">
      {m && (m.brandHeaderStyle === 'barra'
        ? <BarraFixa marca={m} acesso={props.acesso} />
        : <div class="topo"><Logo marca={m} />{props.acesso}</div>)}
      {!m && <div class="topo"><div class="esqueleto" style="width:150px;height:26px" /></div>}
      <div class="conteudo-logado">{props.children}</div>
      {m?.brandFooterText && <div class="rodape">{m.brandFooterText}</div>}
    </div>
  )
}
