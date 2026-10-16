// Redação online (etapa "Prova") — a mesma API do portal do candidato, agora
// dentro da inscrição e do portal logado. Tema sorteado ao iniciar, cronômetro,
// salvamento automático, bloqueio de colar quando o processo pede.
import { useEffect, useRef, useState } from 'preact/hooks'
import { estadoDaRedacao, iniciarRedacao, salvarRedacao, enviarRedacao, type EstadoRedacao, type TentativaRedacao, type TelemetriaRedacao, type FalhaPedido } from './api'

const palavras = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

// Cópia do texto neste aparelho, por tentativa. Se a internet ou a sessão cair,
// nada do que a pessoa escreveu se perde: ao voltar, o texto é restaurado.
const chaveCopia = (id: number) => `redacao:${id}`
function lerCopia(id: number): string | null {
  try { const v = localStorage.getItem(chaveCopia(id)); return v ? (JSON.parse(v).texto as string) : null } catch { return null }
}
function gravarCopia(id: number, texto: string) {
  try { localStorage.setItem(chaveCopia(id), JSON.stringify({ texto, em: Date.now() })) } catch { /* navegador sem espaço/privado */ }
}
function apagarCopia(id: number) {
  try { localStorage.removeItem(chaveCopia(id)) } catch { /* idem */ }
}

/** Estado do salvamento automático, mostrado ao candidato. */
type Salvamento = 'ok' | 'falhou' | 'sessao'

// Como o texto nasce: o servidor recebe só o que mudou desde o último envio e
// soma — recarregar a página não zera nada. Usado pela coordenação na análise
// de integridade da prova; nada disso aparece para o candidato.
const telemetriaVazia = (): TelemetriaRedacao => ({
  teclas: 0, apagamentos: 0, insercoesGrandes: 0, caracteresInseridos: 0, colagens: 0,
  caracteresColados: 0, arrastes: 0, msAtivo: 0, msFora: 0, saidas: 0, linhaDoTempo: [],
})
/** Inserção de uma vez acima disto (sem colar) conta como "texto inserido". */
const INSERCAO_GRANDE = 25

export function Redacao(props: { token: string; aoMudar: () => void }) {
  const [estado, setEstado] = useState<EstadoRedacao | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<TentativaRedacao | null>(null)
  const [texto, setTexto] = useState('')
  const [agora, setAgora] = useState(Date.now())
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvoEm, setSalvoEm] = useState<Date | null>(null)
  const [salvamento, setSalvamento] = useState<Salvamento>('ok')
  const [recuperado, setRecuperado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const enviando = useRef(false)
  const envioAutomatico = useRef(false)
  const colagens = useRef(0)
  const saidas = useRef(0)
  const textoRef = useRef('')
  textoRef.current = texto
  const tel = useRef<TelemetriaRedacao>(telemetriaVazia())
  const ultimaTecla = useRef(0)
  const escondidaDesde = useRef<number | null>(null)

  /** Entrega o que foi medido e começa a contar de novo (só depois do OK). */
  function tirarTelemetria(): TelemetriaRedacao {
    if (escondidaDesde.current != null) { tel.current.msFora += Date.now() - escondidaDesde.current; escondidaDesde.current = Date.now() }
    const inicio = rascunho?.startedAt ? new Date(rascunho.startedAt).getTime() : Date.now()
    tel.current.linhaDoTempo.push({ s: Math.round((Date.now() - inicio) / 1000), n: textoRef.current.length })
    const enviado = tel.current
    tel.current = telemetriaVazia()
    return enviado
  }
  /** Envia a tentativa. `automatico`: o cronômetro acabou. */
  async function enviar(automatico = false) {
    if (!rascunho || enviando.current) return
    if (automatico && !palavras(textoRef.current)) { setRascunho(null); await carregar(); return }
    enviando.current = true
    setOcupado(true); setErro(null)
    const id = rascunho.id
    try {
      const t = tirarTelemetria()
      try { await enviarRedacao(props.token, id, textoRef.current, colagens.current, saidas.current, t) } catch (e) { devolverTelemetria(t); throw e }
      apagarCopia(id)
      setRascunho(null); setRecuperado(false)
      await carregar()
      props.aoMudar()
    } catch (e: any) {
      const f = e as FalhaPedido
      if (f.sessaoExpirada) {
        setSalvamento('sessao')
        setErro('Sua sessão expirou e a redação não foi enviada. O texto está guardado neste aparelho: entre de novo no portal, abra esta etapa e clique em Enviar.')
      } else setErro(f.message)
    } finally { enviando.current = false; setOcupado(false) }
  }
  async function copiarTexto() {
    try { await navigator.clipboard.writeText(textoRef.current); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { /* sem permissão */ }
  }

  /** Envio falhou: devolve o que não chegou ao servidor. */
  function devolverTelemetria(t: TelemetriaRedacao) {
    const a = tel.current
    tel.current = {
      teclas: a.teclas + t.teclas, apagamentos: a.apagamentos + t.apagamentos, insercoesGrandes: a.insercoesGrandes + t.insercoesGrandes,
      caracteresInseridos: a.caracteresInseridos + t.caracteresInseridos, colagens: a.colagens + t.colagens,
      caracteresColados: a.caracteresColados + t.caracteresColados, arrastes: a.arrastes + t.arrastes,
      msAtivo: a.msAtivo + t.msAtivo, msFora: a.msFora + t.msFora, saidas: a.saidas + t.saidas,
      linhaDoTempo: [...t.linhaDoTempo, ...a.linhaDoTempo],
    }
  }

  async function carregar() {
    try {
      const e = await estadoDaRedacao(props.token)
      setEstado(e)
      // Rascunho em andamento: retoma com o texto salvo (o /start devolve o mesmo rascunho).
      if (e.activeDraft) {
        const r = await iniciarRedacao(props.token)
        const doServidor = r.submission.essayText ?? ''
        const local = lerCopia(r.submission.id)
        // O aparelho tem mais do que o servidor recebeu (sessão/internet caiu
        // antes do último salvamento): o texto daqui vale.
        const usarLocal = local != null && local !== doServidor && local.length >= doServidor.length
        setRascunho(r.submission)
        setTexto(usarLocal ? local : doServidor)
        setRecuperado(usarLocal)
      }
    } catch (e: any) { setFalha(e.message) }
  }
  useEffect(() => { void carregar() }, [props.token])

  // Cópia local a cada mudança do texto.
  useEffect(() => { if (rascunho) gravarCopia(rascunho.id, texto) }, [texto, rascunho?.id])

  function salvarAgora() {
    if (!rascunho || enviando.current) return
    const t = tirarTelemetria()
    salvarRedacao(props.token, rascunho.id, textoRef.current, colagens.current, saidas.current, t)
      .then(() => { setSalvoEm(new Date()); setSalvamento('ok') })
      .catch((e: FalhaPedido) => {
        devolverTelemetria(t)
        if (e.tempoEsgotado) { void enviar(true); return }
        if (e.jaEnviada) return
        setSalvamento(e.sessaoExpirada ? 'sessao' : 'falhou')
      })
  }

  // Cronômetro, salvamento a cada 20s (e ao sair da aba) e contagem de saídas.
  useEffect(() => {
    if (!rascunho) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    const s = setInterval(salvarAgora, 20_000)
    const vis = () => {
      if (document.hidden) { saidas.current++; tel.current.saidas++; escondidaDesde.current = Date.now(); salvarAgora() }
      else if (escondidaDesde.current != null) { tel.current.msFora += Date.now() - escondidaDesde.current; escondidaDesde.current = null }
    }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); clearInterval(s); document.removeEventListener('visibilitychange', vis) }
  }, [rascunho?.id])

  // Fim do cronômetro: envia o que foi escrito, uma vez só.
  const acabouTempo = !!rascunho?.expiresAt && agora >= new Date(rascunho.expiresAt).getTime()
  useEffect(() => {
    if (acabouTempo && !envioAutomatico.current) { envioAutomatico.current = true; void enviar(true) }
  }, [acabouTempo])

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

  if (!rascunho) {
    return (
      <div class="redacao">
        {estado.retakeReleased
          ? <div class="aviso info">A coordenação liberou uma <b>nova tentativa</b> para você. Um novo tema será sorteado quando começar.</div>
          : final?.status === 'rejected' && <div class="aviso erro">{final.humanNote ? `Sua redação anterior não foi aprovada. ${final.humanNote}` : 'Sua redação anterior não atingiu a nota mínima.'}</div>}
        {!estado.retakeReleased && final?.status === 'expired' && <div class="aviso erro">Sua tentativa anterior foi encerrada sem envio.</div>}
        <ul class="regras-redacao">
          {cfg.durationMinutes ? <li>Tempo: <b>{cfg.durationMinutes} minutos</b> a partir do início</li> : null}
          {cfg.minWords || cfg.maxWords ? <li>Tamanho: {cfg.minWords ? `mínimo ${cfg.minWords}` : ''}{cfg.minWords && cfg.maxWords ? ' e ' : ''}{cfg.maxWords ? `máximo ${cfg.maxWords}` : ''} palavras</li> : null}
          <li>Tentativas restantes: <b>{estado.attemptsLeft ?? 0}</b></li>
          {cfg.pasteBlocked && <li>Não é possível colar texto — escreva direto no campo.</li>}
          {cfg.dragBlocked && !cfg.pasteBlocked && <li>Não é possível arrastar texto para o campo.</li>}
          <li>A forma de escrita é registrada para garantir a integridade da prova.</li>
          <li>O tema aparece quando você começar. O texto é salvo sozinho enquanto escreve.</li>
        </ul>
        {erro && <div class="aviso erro">{erro}</div>}
        {estado.canStart
          ? <button class="principal" type="button" disabled={ocupado} onClick={comecar}>{ocupado ? 'Preparando…' : 'Começar a redação'}</button>
          : <div class="aviso info">Não há tentativas disponíveis agora. Se precisar refazer, fale com a secretaria — ela pode liberar uma nova tentativa.</div>}
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
        <span class="sub">{salvamento === 'ok' && salvoEm ? `Salvo às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : salvamento !== 'ok' ? 'Guardado neste aparelho' : ''}</span>
      </div>
      {recuperado && <div class="aviso info">Recuperamos o texto que estava guardado neste aparelho. Confira e continue.</div>}
      {salvamento === 'falhou' && <div class="aviso info">Sem conexão com o servidor agora. Seu texto está guardado neste aparelho e tentamos salvar de novo sozinhos.</div>}
      {salvamento === 'sessao' && !erro && <div class="aviso erro">Sua sessão expirou. O texto está guardado neste aparelho: entre de novo no portal e ele volta aqui. Se preferir, copie o texto antes.</div>}
      <textarea class="texto-redacao" rows={16} value={texto} disabled={restante === 0}
        spellcheck={!cfg.spellcheckOff}
        autoComplete="off" autoCorrect={cfg.spellcheckOff ? 'off' : 'on'} autoCapitalize="sentences"
        onKeyDown={(e) => {
          const agoraMs = Date.now()
          if (ultimaTecla.current && agoraMs - ultimaTecla.current < 5000) tel.current.msAtivo += agoraMs - ultimaTecla.current
          ultimaTecla.current = agoraMs
          if (e.key === 'Backspace' || e.key === 'Delete') { tel.current.apagamentos++; tel.current.teclas++ }
          else if (e.key.length === 1 || e.key === 'Enter') tel.current.teclas++
        }}
        onInput={(e) => {
          const novo = (e.target as HTMLTextAreaElement).value
          const tipo = (e as unknown as InputEvent).inputType || ''
          const cresceu = novo.length - textoRef.current.length
          // Texto grande que entra de uma vez sem ser colagem: ditado, extensão,
          // autocompletar, teclado virtual de outro app.
          if (cresceu >= INSERCAO_GRANDE && tipo !== 'insertFromPaste' && tipo !== 'insertFromDrop') {
            tel.current.insercoesGrandes++; tel.current.caracteresInseridos += cresceu
          }
          setTexto(novo)
        }}
        onPaste={(e) => {
          colagens.current++; tel.current.colagens++
          if (cfg.pasteBlocked) { e.preventDefault(); setErro('Colar texto não é permitido nesta redação.'); return }
          tel.current.caracteresColados += (e.clipboardData?.getData('text') ?? '').length
        }}
        onDrop={(e) => {
          tel.current.arrastes++
          if (cfg.dragBlocked || cfg.pasteBlocked) { e.preventDefault(); setErro('Arrastar texto para o campo não é permitido nesta redação.'); return }
          tel.current.caracteresColados += (e.dataTransfer?.getData('text') ?? '').length
        }}
        aria-label="Texto da redação" />
      {restante === 0 && <div class="aviso erro">O tempo acabou. {ocupado ? 'Enviando o que você escreveu…' : 'O que você escreveu será enviado.'}</div>}
      {erro && <div class="aviso erro">{erro}</div>}
      <button class="principal" type="button" disabled={ocupado || (!!foraDoTamanho && restante !== 0)} onClick={() => void enviar(restante === 0)}>
        {ocupado ? 'Enviando…' : 'Enviar redação'}
      </button>
      {(salvamento === 'sessao' || erro) && (
        <button type="button" class="secundario" onClick={() => void copiarTexto()}>{copiado ? 'Texto copiado' : 'Copiar meu texto'}</button>
      )}
    </div>
  )
}
