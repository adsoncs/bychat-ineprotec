// Recursos de leitura do portal (acessibilidade, frente C — 11/11/2026).
//
// Um botão "Acessibilidade" em todas as telas do portal (inscrição, área
// logada, documentos, contrato, redação) abre um painel com:
//   · tamanho do texto (4 níveis) — `zoom` no <body>, porque o estilo do portal
//     é todo em px e mudar o font-size da raiz não aumentaria nada;
//   · alto contraste — troca as cores do tema (inclusive a cor da marca, que o
//     Branding injeta inline no <html>: por isso o !important no CSS).
// A escolha fica guardada neste aparelho e vale já na próxima tela, antes do
// primeiro desenho (aplicarPreferencias() roda no main.tsx).
import { useEffect, useRef, useState } from 'preact/hooks'

const CHAVE = 'portal:acessibilidade'
const NIVEIS = [100, 115, 130, 150] as const

interface Preferencias { fonte: number; contraste: boolean }

function ler(): Preferencias {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || '{}')
    const fonte = Number.isInteger(v.fonte) && v.fonte >= 0 && v.fonte < NIVEIS.length ? v.fonte : 0
    return { fonte, contraste: v.contraste === true }
  } catch { return { fonte: 0, contraste: false } }
}

function gravar(p: Preferencias) {
  try { localStorage.setItem(CHAVE, JSON.stringify(p)) } catch { /* navegação privada / sem espaço */ }
}

function aplicar(p: Preferencias) {
  const raiz = document.documentElement
  if (p.fonte) raiz.setAttribute('data-fonte', String(p.fonte)); else raiz.removeAttribute('data-fonte')
  if (p.contraste) raiz.setAttribute('data-contraste', 'alto'); else raiz.removeAttribute('data-contraste')
}

/** Chamado antes do primeiro render: a tela já nasce com a preferência da pessoa. */
export function aplicarPreferencias() { aplicar(ler()) }

export function Acessibilidade() {
  const [aberto, setAberto] = useState(false)
  const [p, setP] = useState<Preferencias>(ler)
  const botao = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  function mudar(novo: Preferencias) { setP(novo); aplicar(novo); gravar(novo) }

  useEffect(() => {
    if (!aberto) return
    painel.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberto(false); botao.current?.focus() } }
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!painel.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false)
    }
    document.addEventListener('keydown', esc)
    document.addEventListener('mousedown', fora)
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', fora) }
  }, [aberto])

  const pct = NIVEIS[p.fonte]
  return (
    <div class="a11y">
      <button ref={botao} type="button" class="a11y-botao" aria-expanded={aberto} aria-controls="a11y-painel"
        onClick={() => setAberto(!aberto)} title="Acessibilidade">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
          <circle cx="12" cy="4.2" r="2.2" />
          <path d="M4.5 7.6a1 1 0 0 1 1.2-.8c2.1.5 4.2.8 6.3.8s4.2-.3 6.3-.8a1 1 0 1 1 .4 2c-1.6.3-3.2.6-4.8.7v3.6l1.9 6.9a1 1 0 1 1-1.9.5L12.3 15h-.6l-1.6 5.5a1 1 0 1 1-1.9-.5l1.9-6.9V9.5c-1.6-.1-3.2-.4-4.8-.7a1 1 0 0 1-.8-1.2Z" />
        </svg>
        <span class="a11y-rotulo">Acessibilidade</span>
      </button>
      {aberto && (
        <div ref={painel} id="a11y-painel" class="a11y-painel" role="dialog" aria-label="Opções de acessibilidade">
          <div class="a11y-titulo">Acessibilidade</div>
          <div class="a11y-grupo" role="group" aria-label="Tamanho do texto">
            <span class="a11y-legenda">Tamanho do texto</span>
            <div class="a11y-linha">
              <button type="button" class="a11y-opcao" disabled={p.fonte === 0}
                onClick={() => mudar({ ...p, fonte: p.fonte - 1 })} aria-label="Diminuir o texto">A−</button>
              <output class="a11y-valor" aria-live="polite">{pct}%</output>
              <button type="button" class="a11y-opcao" disabled={p.fonte === NIVEIS.length - 1}
                onClick={() => mudar({ ...p, fonte: p.fonte + 1 })} aria-label="Aumentar o texto">A+</button>
            </div>
          </div>
          <label class="a11y-chave">
            <input type="checkbox" checked={p.contraste} onChange={(e) => mudar({ ...p, contraste: (e.target as HTMLInputElement).checked })} />
            <span>Alto contraste</span>
          </label>
          {(p.fonte !== 0 || p.contraste) && (
            <button type="button" class="a11y-restaurar" onClick={() => mudar({ fonte: 0, contraste: false })}>Voltar ao padrão</button>
          )}
          <button type="button" class="a11y-fechar" onClick={() => { setAberto(false); botao.current?.focus() }}>Fechar</button>
        </div>
      )}
    </div>
  )
}

/**
 * "Ouvir" um texto com a voz do próprio aparelho (Web Speech API, sem envio
 * para servidor nenhum). Some quando o navegador não tem síntese de voz.
 */
export function BotaoOuvir(props: { texto: string; rotulo?: string }) {
  const suporta = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  const [falando, setFalando] = useState(false)
  useEffect(() => () => { if (suporta) window.speechSynthesis.cancel() }, [])
  if (!suporta || !props.texto.trim()) return null
  function alternar() {
    const s = window.speechSynthesis
    if (falando) { s.cancel(); setFalando(false); return }
    s.cancel()
    const u = new SpeechSynthesisUtterance(props.texto)
    u.lang = 'pt-BR'
    const voz = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt'))
    if (voz) u.voice = voz
    u.onend = () => setFalando(false)
    u.onerror = () => setFalando(false)
    setFalando(true)
    s.speak(u)
  }
  return (
    <button type="button" class="botao-ouvir" onClick={alternar} aria-pressed={falando}>
      {falando ? 'Parar leitura' : (props.rotulo ?? 'Ouvir')}
    </button>
  )
}
