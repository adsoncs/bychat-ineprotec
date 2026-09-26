// Redação online (etapa "Prova") — a mesma API do portal do candidato, agora
// dentro da inscrição e do portal logado. Tema sorteado ao iniciar, cronômetro,
// salvamento automático, bloqueio de colar quando o processo pede.
import { useEffect, useRef, useState } from 'preact/hooks'
import { estadoDaRedacao, iniciarRedacao, salvarRedacao, enviarRedacao, type EstadoRedacao, type TentativaRedacao } from './api'

const palavras = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

export function Redacao(props: { token: string; aoMudar: () => void }) {
  const [estado, setEstado] = useState<EstadoRedacao | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<TentativaRedacao | null>(null)
  const [texto, setTexto] = useState('')
  const [agora, setAgora] = useState(Date.now())
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvoEm, setSalvoEm] = useState<Date | null>(null)
  const colagens = useRef(0)
  const saidas = useRef(0)
  const textoRef = useRef('')
  textoRef.current = texto

  async function carregar() {
    try {
      const e = await estadoDaRedacao(props.token)
      setEstado(e)
      // Rascunho em andamento: retoma com o texto salvo (o /start devolve o mesmo rascunho).
      if (e.activeDraft) {
        const r = await iniciarRedacao(props.token)
        setRascunho(r.submission)
        setTexto(r.submission.essayText ?? '')
      }
    } catch (e: any) { setFalha(e.message) }
  }
  useEffect(() => { void carregar() }, [props.token])

  // Cronômetro, salvamento a cada 20s e contagem de saídas da aba.
  useEffect(() => {
    if (!rascunho) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    const s = setInterval(() => {
      salvarRedacao(props.token, rascunho.id, textoRef.current, colagens.current, saidas.current).then(() => setSalvoEm(new Date())).catch(() => {})
    }, 20_000)
    const vis = () => { if (document.hidden) saidas.current++ }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); clearInterval(s); document.removeEventListener('visibilitychange', vis) }
  }, [rascunho?.id])

  if (falha) return <div class="aviso erro">{falha}</div>
  if (!estado) return <div class="esqueleto" style="height:200px" />
  if (!estado.eligible) return <div class="aviso info">{estado.reason}</div>
  const cfg = estado.config!

  const final = estado.finalResult
  const emCorrecao = estado.pendingReview
  if (!rascunho && (final?.status === 'approved' || emCorrecao)) {
    return (
      <div class="assinado">
        <strong>{final?.status === 'approved' ? 'Redação aprovada' : 'Redação enviada'}</strong>
        <span class="sub">{final?.status === 'approved' ? (final.finalScore != null ? `Nota ${final.finalScore}` : '') : 'Está em correção. Avisamos você assim que sair o resultado.'}</span>
      </div>
    )
  }

  async function comecar() {
    setOcupado(true); setErro(null)
    try {
      const r = await iniciarRedacao(props.token)
      setRascunho(r.submission); setTexto(r.submission.essayText ?? '')
      props.aoMudar()
    } catch (e: any) { setErro(e.message) } finally { setOcupado(false) }
  }
  async function enviar() {
    if (!rascunho) return
    setOcupado(true); setErro(null)
    try {
      await enviarRedacao(props.token, rascunho.id, texto, colagens.current, saidas.current)
      setRascunho(null)
      await carregar()
      props.aoMudar()
    } catch (e: any) { setErro(e.message) } finally { setOcupado(false) }
  }

  if (!rascunho) {
    return (
      <div class="redacao">
        {final?.status === 'rejected' && <div class="aviso erro">Sua redação anterior não atingiu a nota mínima.{final.humanNote ? ` ${final.humanNote}` : ''}</div>}
        <ul class="regras-redacao">
          {cfg.durationMinutes ? <li>Tempo: <b>{cfg.durationMinutes} minutos</b> a partir do início</li> : null}
          {cfg.minWords || cfg.maxWords ? <li>Tamanho: {cfg.minWords ? `mínimo ${cfg.minWords}` : ''}{cfg.minWords && cfg.maxWords ? ' e ' : ''}{cfg.maxWords ? `máximo ${cfg.maxWords}` : ''} palavras</li> : null}
          <li>Tentativas restantes: <b>{estado.attemptsLeft ?? 0}</b></li>
          {cfg.pasteBlocked && <li>Não é possível colar texto — escreva direto no campo.</li>}
          <li>O tema aparece quando você começar. O texto é salvo sozinho enquanto escreve.</li>
        </ul>
        {erro && <div class="aviso erro">{erro}</div>}
        {estado.canStart
          ? <button class="principal" type="button" disabled={ocupado} onClick={comecar}>{ocupado ? 'Preparando…' : 'Começar a redação'}</button>
          : <div class="aviso info">Não há tentativas disponíveis agora.</div>}
      </div>
    )
  }

  const restante = rascunho.expiresAt ? Math.max(0, new Date(rascunho.expiresAt).getTime() - agora) : null
  const min = restante != null ? Math.floor(restante / 60000) : null
  const seg = restante != null ? Math.floor((restante % 60000) / 1000) : null
  const n = palavras(texto)
  const foraDoTamanho = (cfg.minWords && n < cfg.minWords) || (cfg.maxWords && n > cfg.maxWords)
  return (
    <div class="redacao">
      <div class="tema"><b>Tema</b><p>{rascunho.prompt}</p></div>
      <div class="redacao-barra">
        <span class={restante != null && restante < 5 * 60000 ? 'alerta' : ''}>{restante != null ? `⏱ ${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}` : ''}</span>
        <span>{n} palavra(s){cfg.minWords ? ` · mín. ${cfg.minWords}` : ''}{cfg.maxWords ? ` · máx. ${cfg.maxWords}` : ''}</span>
        <span class="sub">{salvoEm ? `Salvo às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      </div>
      <textarea class="texto-redacao" rows={16} value={texto} disabled={restante === 0}
        onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)}
        onPaste={(e) => { colagens.current++; if (cfg.pasteBlocked) { e.preventDefault(); setErro('Colar texto não é permitido nesta redação.') } }}
        aria-label="Texto da redação" />
      {restante === 0 && <div class="aviso erro">O tempo acabou. Envie o que escreveu.</div>}
      {erro && <div class="aviso erro">{erro}</div>}
      <button class="principal" type="button" disabled={ocupado || !!foraDoTamanho} onClick={enviar}>
        {ocupado ? 'Enviando…' : 'Enviar redação'}
      </button>
    </div>
  )
}
