// Contrato em Word da instituição, na etapa "Contrato" da inscrição.
// Autentique: a pessoa lê o PDF e assina lá (link aberto numa nova aba).
// Clicksign: com o Widget Embedded, assina aqui mesmo, dentro da página; sem
// ele, a Clicksign manda o convite pelo WhatsApp (ou e-mail) da inscrição.
// Em todos, a tela acompanha a assinatura e segue sozinha quando fecha. O
// responsável financeiro recebe por e-mail/WhatsApp ou pelo link da tela.
// Sem provedor, o aceite é aqui mesmo (nome completo) sobre o mesmo PDF.
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  pdfDoContratoDaInscricao, iniciarAssinaturaDoContrato, situacaoDaAssinaturaDoContrato, assinarContratoDaInscricao,
  type ContratoDaInscricao, type ContratoWord, type AssinaturaDoContrato,
} from './api'

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const PAPEL: Record<string, string> = { ALUNO: 'Você', RESPONSAVEL: 'Responsável financeiro' }
const SITUACAO: Record<string, string> = { PENDENTE: 'aguardando assinatura', VISUALIZADO: 'abriu o contrato', ASSINADO: 'assinou', REJEITADO: 'recusou' }
const CANAL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'e-mail', SMS: 'SMS' }
const NOME_PROVEDOR: Record<string, string> = { AUTENTIQUE: 'Autentique', CLICKSIGN: 'Clicksign' }
const WIDGET_JS = 'https://cdn-public-library.clicksign.com/embedded/embedded.min-2.1.0.js'

/** Biblioteca do Widget Embedded da Clicksign, carregada só quando usada. */
function carregarWidgetClicksign(): Promise<any> {
  const w = window as any
  if (w.Clicksign) return Promise.resolve(w.Clicksign)
  return new Promise((ok, falha) => {
    const el = document.createElement('script')
    el.src = WIDGET_JS; el.async = true
    el.onload = () => (w.Clicksign ? ok(w.Clicksign) : falha(new Error('Widget da Clicksign indisponível')))
    el.onerror = () => falha(new Error('Não foi possível carregar a assinatura. Verifique a conexão e tente de novo.'))
    document.body.appendChild(el)
  })
}

export function ContratoWordInscricao(props: {
  codigo: string; token: string; dados: ContratoDaInscricao; word: ContratoWord; aoAssinar: () => void
}) {
  const { dados, word } = props
  const [assinatura, setAssinatura] = useState<AssinaturaDoContrato | null>(word.assinatura)
  const [pdf, setPdf] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [nome, setNome] = useState('')
  const [li, setLi] = useState(false)
  const assinado = dados.assinado || assinatura?.status === 'ASSINADO'
  const provedor = assinatura?.provedor ?? word.provedor ?? 'AUTENTIQUE'
  const clicksign = provedor === 'CLICKSIGN'
  const widgetRef = useRef<any>(null)
  const [widgetAberto, setWidgetAberto] = useState(false)
  const largo = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 760px)').matches

  // PDF na tela larga (celular não mostra PDF dentro da página: vai pelo botão).
  useEffect(() => {
    if (!largo) return
    let url: string | null = null
    pdfDoContratoDaInscricao(props.codigo, props.token).then((u) => { url = u; setPdf(u) }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [props.codigo, props.token, assinatura?.envelopeId])

  // Enquanto alguém assina na Autentique, a tela confere a cada poucos segundos.
  useEffect(() => {
    if (!assinatura || assinado) return
    let vivo = true
    const t = setInterval(async () => {
      if (document.hidden) return
      const a = await situacaoDaAssinaturaDoContrato(props.codigo, props.token).catch(() => null)
      if (!vivo || !a) return
      setAssinatura(a)
      if (a.status === 'ASSINADO') props.aoAssinar()
    }, 6000)
    return () => { vivo = false; clearInterval(t) }
  }, [assinatura?.envelopeId, assinado])

  async function abrirPdf() {
    const janela = window.open('', '_blank')
    try {
      const u = await pdfDoContratoDaInscricao(props.codigo, props.token)
      if (janela) janela.location.href = u; else window.location.href = u
    } catch (e: any) { janela?.close(); setErro(e.message) }
  }

  // Widget da Clicksign: monta dentro da página. O "signed" do navegador só
  // apressa a conferência — quem confirma é o webhook/servidor.
  async function abrirWidget(a: AssinaturaDoContrato) {
    const meu = a.signatarios.find((s) => s.papel === 'ALUNO')
    if (!meu?.widgetId || !a.widget) { setErro('A assinatura ainda está sendo preparada. Tente de novo em alguns segundos.'); return }
    const Clicksign = await carregarWidgetClicksign()
    try { widgetRef.current?.unmount() } catch { /* já desmontado */ }
    setWidgetAberto(true)
    // O container precisa existir no DOM antes do mount.
    await new Promise((r) => setTimeout(r, 0))
    const w = new Clicksign(meu.widgetId)
    w.endpoint = a.widget.endpoint
    w.origin = window.location.origin
    w.mount('clicksign-widget')
    w.on('resized', (ev: any) => { const el = document.getElementById('clicksign-widget'); if (el && ev?.data?.height) el.style.height = `${ev.data.height}px` })
    w.on('signed', async () => {
      const novo = await situacaoDaAssinaturaDoContrato(props.codigo, props.token).catch(() => null)
      if (novo) { setAssinatura(novo); if (novo.status === 'ASSINADO') props.aoAssinar() }
    })
    widgetRef.current = w
  }
  useEffect(() => () => { try { widgetRef.current?.unmount() } catch { /* nada */ } }, [])

  async function assinarNaClicksign() {
    setErro(null); setOcupado(true)
    try {
      const a = assinatura ?? await iniciarAssinaturaDoContrato(props.codigo, props.token)
      setAssinatura(a)
      if (a.widget) await abrirWidget(a)
    } catch (e: any) { setErro(e.message) } finally { setOcupado(false) }
  }

  async function assinarNaAutentique() {
    if (clicksign) return assinarNaClicksign()
    setErro(null); setOcupado(true)
    // A aba abre no clique (senão o navegador bloqueia) e recebe o link depois.
    const janela = window.open('', '_blank')
    try {
      const a = assinatura ?? await iniciarAssinaturaDoContrato(props.codigo, props.token)
      setAssinatura(a)
      const meu = a.signatarios.find((s) => s.papel === 'ALUNO')
      if (meu?.link) { if (janela) janela.location.href = meu.link; else window.location.href = meu.link }
      else { janela?.close(); setErro('O link de assinatura ainda está sendo gerado. Tente de novo em alguns segundos.') }
    } catch (e: any) { janela?.close(); setErro(e.message) } finally { setOcupado(false) }
  }

  async function aceitarAqui() {
    setErro(null); setOcupado(true)
    try { await assinarContratoDaInscricao(props.codigo, props.token, nome.trim()); props.aoAssinar() }
    catch (e: any) { setErro(e.message) } finally { setOcupado(false) }
  }

  async function copiar(link: string) {
    try { await navigator.clipboard.writeText(link) } catch { /* sem permissão: o link está visível */ }
  }

  return (
    <div class="contrato-inscricao">
      <dl class="resumo-contrato">
        <div><dt>Contrato</dt><dd>{word.modelo.nome}</dd></div>
        <div><dt>Curso</dt><dd>{dados.curso}</dd></div>
        {dados.valorTotalCentavos > 0 && <div><dt>Valor total</dt><dd>{money(dados.valorTotalCentavos)}</dd></div>}
      </dl>

      {pdf ? <iframe class="contrato-pdf" src={pdf} title="Contrato" /> : null}
      <button class={assinado ? 'principal' : 'secundario'} type="button" onClick={abrirPdf}>
        {assinado ? 'Ver contrato assinado (PDF)' : 'Ler o contrato completo (PDF)'}
      </button>

      {assinado ? (
        <div class="assinado" style="margin-top:16px">
          <strong>Contrato assinado</strong>
          <span class="sub">{dados.assinadoEm || assinatura?.assinadoEm ? `Em ${new Date((dados.assinadoEm || assinatura?.assinadoEm)!).toLocaleDateString('pt-BR')}` : ''}</span>
        </div>
      ) : word.menorSemResponsavel ? (
        <div class="aviso info" style="margin-top:16px">Como você é menor de idade, o contrato é assinado junto com o responsável financeiro. Preencha os dados do responsável acima para continuar.</div>
      ) : word.eletronica ? (
        <div style="margin-top:16px">
          {assinatura && (
            <ul class="signatarios">
              {assinatura.signatarios.map((s) => (
                <li key={s.id}>
                  <span><strong>{PAPEL[s.papel] ?? s.papel}</strong>{s.papel !== 'ALUNO' ? ` — ${s.nome}` : ''}</span>
                  <span class={`situacao ${s.status === 'ASSINADO' ? 'ok' : ''}`}>{SITUACAO[s.status] ?? s.status}</span>
                  {s.papel !== 'ALUNO' && s.status !== 'ASSINADO' && (
                    s.porEmail ? <span class="sub">O convite para assinar foi enviado ao e-mail do responsável.</span>
                    : !s.link && s.canal && CANAL[s.canal] ? <span class="sub">O convite para assinar foi enviado ao {CANAL[s.canal]} do responsável.</span>
                    : s.link ? (
                      <span class="sub">Envie este link ao responsável: <a href={s.link} target="_blank" rel="noopener">{s.link}</a>{' '}
                        <button type="button" class="link" onClick={() => copiar(s.link!)}>copiar</button>{' · '}
                        <a href={`https://wa.me/?text=${encodeURIComponent(`Assine o contrato de matrícula de ${dados.aluno}: ${s.link}`)}`} target="_blank" rel="noopener">enviar pelo WhatsApp</a>
                      </span>
                    ) : null
                  )}
                </li>
              ))}
            </ul>
          )}
          {erro && <div class="aviso erro">{erro}</div>}
          {(() => {
            const meu = assinatura?.signatarios.find((s) => s.papel === 'ALUNO')
            if (meu?.status === 'ASSINADO') return null
            // Clicksign sem widget: o convite já saiu pela Clicksign — a tela só orienta.
            if (clicksign && assinatura && !assinatura.widget) {
              return <div class="aviso info">A Clicksign enviou o convite para assinar ao seu <b>{CANAL[meu?.canal ?? ''] ?? 'contato'}</b> informado na inscrição. Abra a mensagem da Clicksign, siga o link e assine — esta página atualiza sozinha quando a assinatura for concluída.</div>
            }
            if (widgetAberto) return null
            return (
              <button class="principal" type="button" disabled={ocupado} onClick={assinarNaAutentique}>
                {ocupado ? 'Preparando o contrato…' : clicksign && !word.widget ? 'Receber o contrato para assinar' : 'Assinar contrato'}
              </button>
            )
          })()}
          {clicksign && <div id="clicksign-widget" class="clicksign-widget" style={widgetAberto && !assinado ? 'height:600px;margin-top:12px' : 'display:none'} />}
          <p class="sub legal">A assinatura é eletrônica, pela {NOME_PROVEDOR[provedor] ?? 'plataforma de assinatura'}, com validade jurídica (MP 2.200-2/2001 e Lei 14.063/2020). {clicksign
            ? (word.widget || assinatura?.widget ? 'Ela acontece aqui mesmo, nesta página.' : 'O convite chega pela Clicksign, no seu WhatsApp ou e-mail; depois de assinar, volte aqui — esta página atualiza sozinha.')
            : 'Ela abre numa nova aba; depois de assinar, volte aqui — esta página atualiza sozinha.'}</p>
        </div>
      ) : (
        <div style="margin-top:16px">
          <label class="caixa"><input type="checkbox" checked={li} onChange={(e: any) => setLi(e.currentTarget.checked)} /> Li o contrato completo e concordo com ele.</label>
          <div class="campo">
            <label for="assinatura-word">Escreva seu nome completo para assinar</label>
            <input id="assinatura-word" type="text" autocomplete="name" value={nome} placeholder={dados.aluno} disabled={!li}
              onInput={(e: any) => setNome(e.currentTarget.value)} />
          </div>
          {erro && <div class="aviso erro">{erro}</div>}
          <button class="principal" type="button" disabled={!li || ocupado || nome.trim().length < 5 || !nome.trim().includes(' ')} onClick={aceitarAqui}>
            {ocupado ? 'Registrando…' : 'Assinar contrato'}
          </button>
          <p class="sub legal">Ao assinar, ficam registrados seu nome, a data e uma cópia do contrato exatamente como está agora.</p>
        </div>
      )}
    </div>
  )
}
