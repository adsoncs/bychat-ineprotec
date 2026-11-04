// Faixa do topo na inscrição assistida: deixa claro, o tempo todo, que é a
// equipe operando o portal — e dá as duas saídas: passar para o candidato
// continuar sozinho, ou encerrar o atendimento nesta aba.
import { useEffect, useState } from 'preact/hooks'
import {
  aoMudarInscricao, dadosDoAtendimento, encerrarAtendimento, inscricaoDoAtendimento, linkParaOCandidato,
} from './atendimento'

function slugDaUrl(): string {
  const partes = location.pathname.split('/').filter(Boolean)
  const i = partes.indexOf('portal')
  return (i >= 0 ? partes[i + 1] : partes[0]) || ''
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function FaixaDoAtendimento() {
  const dados = dadosDoAtendimento()
  const [, forcar] = useState(0)
  const [link, setLink] = useState<{ url: string; validadeDias: number; whatsapp?: string | null; nome?: string | null } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [encerrado, setEncerrado] = useState(false)
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => aoMudarInscricao(() => forcar((n) => n + 1)), [])
  useEffect(() => { const i = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(i) }, [])

  if (!dados) return null
  const vencido = dados.exp > 0 && agora > dados.exp
  const codigo = inscricaoDoAtendimento()

  async function gerar() {
    setGerando(true); setErro(null); setCopiado(false)
    try {
      const r = await linkParaOCandidato(slugDaUrl())
      setLink({ url: r.url, validadeDias: r.validadeDias, whatsapp: r.candidato?.whatsapp, nome: r.candidato?.nome })
    } catch (e: any) { setErro(e.message) } finally { setGerando(false) }
  }
  async function copiar() {
    if (!link) return
    try { await navigator.clipboard.writeText(link.url); setCopiado(true) } catch { setCopiado(false) }
  }
  function encerrar() {
    encerrarAtendimento()
    setEncerrado(true)
    try { window.close() } catch { /* aba não aberta por script */ }
  }

  const barra: Record<string, string> = {
    position: 'sticky', top: '0', zIndex: '1000', background: vencido ? '#7f1d1d' : '#1e293b', color: '#fff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontSize: '13px', lineHeight: '1.35',
    padding: '8px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px',
    boxShadow: '0 1px 4px rgba(0,0,0,.25)',
  }
  const botao: Record<string, string> = {
    background: '#fff', color: '#0f172a', border: '0', borderRadius: '6px', padding: '5px 10px',
    fontSize: '12.5px', fontWeight: '600', cursor: 'pointer',
  }
  const fantasma = { ...botao, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.45)' }

  if (encerrado) {
    return <div style={barra} role="status"><strong>Atendimento encerrado.</strong> Pode fechar esta aba.</div>
  }

  return (
    <div style={barra} role="region" aria-label="Atendimento assistido">
      <span style={{ flex: '1 1 260px', minWidth: '0' }}>
        <strong>Atendimento assistido</strong> · {dados.nome}
        {codigo && <> · inscrição <code style={{ fontSize: '12px' }}>{codigo}</code></>}
        <span style={{ opacity: '.75' }}>
          {vencido ? ' · sessão encerrada — abra de novo pelo painel' : ` · válido até ${hora(dados.exp)}`}
        </span>
      </span>
      {!vencido && <button type="button" style={botao} onClick={gerar} disabled={gerando}>{gerando ? 'Gerando…' : 'Passar para o candidato'}</button>}
      {/* Dentro do painel quem encerra é o painel ("Voltar às inscrições"). */}
      {window.top === window && <button type="button" style={fantasma} onClick={encerrar}>Encerrar</button>}
      {erro && <span style={{ flexBasis: '100%', color: '#fecaca' }}>{erro}</span>}
      {link && (
        <div style={{ flexBasis: '100%', background: 'rgba(255,255,255,.08)', borderRadius: '8px', padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <span style={{ flex: '1 1 100%', opacity: '.85' }}>
            Link para {link.nome || 'o candidato'} continuar sozinho (vale {link.validadeDias} dia{link.validadeDias > 1 ? 's' : ''}). Nada foi enviado: cole o link na conversa do candidato no Attrae.
          </span>
          <input readOnly value={link.url} onFocus={(e) => (e.target as HTMLInputElement).select()}
            style={{ flex: '1 1 240px', minWidth: '0', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: '0', color: '#0f172a' }} />
          <button type="button" style={botao} onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar link'}</button>
        </div>
      )}
    </div>
  )
}
