import { useEffect, useRef, useState } from 'preact/hooks'
import {
  carregarCandidato, enviarDocumento, removerDocumento,
  type Candidato, type DocumentoEnviado, type Exigencia,
} from './api'
import { comprimirSePreciso } from './imagem'

// Situação de cada documento na linguagem de quem enviou, não a do banco.
const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  pending: { rotulo: 'Em análise', classe: 'analise' },
  approved: { rotulo: 'Aprovado', classe: 'ok' },
  rejected: { rotulo: 'Recusado', classe: 'ruim' },
}

const MAX_BYTES = 25 * 1024 * 1024

const tamanho = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`)

export function Documentos() {
  const [dados, setDados] = useState<Candidato | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})

  async function recarregar() {
    try {
      const d = await carregarCandidato()
      // A identidade da instituição vale na área logada também: sem isto a
      // pessoa sai do portal roxo e cai numa tela com a cor padrão do sistema.
      if (d.portal?.brandPrimaryColor) {
        const raiz = document.documentElement
        raiz.style.setProperty('--marca', d.portal.brandPrimaryColor)
        raiz.style.setProperty('--marca-suave', `color-mix(in srgb, ${d.portal.brandPrimaryColor} 12%, transparent)`)
      }
      setDados(d)
    } catch (e: any) {
      // 401 aqui quer dizer sessão vencida — a saída é entrar de novo.
      if (/expirad|inválid/i.test(e.message)) { location.href = '/portal/login'; return }
      setFalha(e.message)
    }
  }

  useEffect(() => { void recarregar() }, [])

  if (falha) {
    return (
      <div class="pagina">
        <div class="cartao" style="margin-top:40px">
          <h2>Não foi possível abrir seus documentos</h2>
          <p class="sub">{falha}</p>
          <button class="principal" onClick={() => location.reload()}>Tentar de novo</button>
        </div>
      </div>
    )
  }
  if (!dados) {
    return (
      <div class="pagina" aria-busy="true">
        <div class="topo"><div class="esqueleto" style="width:160px;height:26px" /></div>
        <div class="esqueleto" style="height:300px" />
      </div>
    )
  }

  const exigencias = (dados.processRegistration?.effectiveDocumentRequirements ?? [])
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const porTipo = new Map<string, DocumentoEnviado>()
  for (const d of dados.documents) porTipo.set(d.typeCode, d)

  const obrigatorios = exigencias.filter((e) => e.required)
  const entregues = obrigatorios.filter((e) => {
    const d = porTipo.get(e.documentType.code)
    return d && d.status !== 'rejected'
  })
  const faltam = obrigatorios.length - entregues.length

  async function subir(exig: Exigencia, escolhido: File) {
    const codigo = exig.documentType.code
    setErros((e) => ({ ...e, [codigo]: '' }))
    setEnviando(codigo)
    try {
      // Comprime antes de checar o limite: foto de 8 MB costuma virar menos de
      // 1 MB e passa, em vez de ser recusada por tamanho.
      const r = await comprimirSePreciso(escolhido)
      if (r.arquivo.size > MAX_BYTES) {
        setErros((e) => ({ ...e, [codigo]: `O arquivo tem ${tamanho(r.arquivo.size)} — o limite é 25 MB. Envie em PDF ou tire a foto com menos qualidade.` }))
        return
      }
      if (r.comprimido) setNotas((n) => ({ ...n, [codigo]: `Foto reduzida de ${tamanho(r.de)} para ${tamanho(r.para)} antes de enviar.` }))
      await enviarDocumento(codigo, exig.documentType.name, r.arquivo)
      await recarregar()
    } catch (e: any) {
      setErros((er) => ({ ...er, [codigo]: e.message }))
    } finally {
      setEnviando(null)
    }
  }

  async function remover(id: number) {
    await removerDocumento(id).catch(() => null)
    await recarregar()
  }

  return (
    <div class="pagina">
      <div class="topo">
        {dados.portal.brandLogoUrl
          ? <img src={dados.portal.brandLogoUrl} alt={dados.portal.nome} />
          : <span class="nome">{dados.portal.nome}</span>}
      </div>

      <div class="cartao" style="margin-bottom:14px">
        <h2>Seus documentos</h2>
        <p class="sub" style="margin-bottom:12px">
          Inscrição {dados.enrollment.candidateCode} · {dados.lead.nome}
        </p>
        {exigencias.length === 0 ? (
          <div class="aviso info">
            Ainda não há documentos a enviar para esta inscrição. Se a secretaria
            pedir algum, ele aparece aqui.
          </div>
        ) : faltam > 0 ? (
          <div class="aviso info">
            <b>{faltam === 1 ? 'Falta 1' : `Faltam ${faltam}`} de {obrigatorios.length}</b>{' '}
            {faltam === 1 ? 'documento obrigatório' : 'documentos obrigatórios'}.
            Pode enviar foto pelo celular — a imagem precisa estar legível.
          </div>
        ) : (
          <div class="aviso info" style="color:var(--ok);border-color:var(--ok)">
            <b>Tudo enviado.</b> A secretaria confere e avisa você pelo WhatsApp.
          </div>
        )}
      </div>

      {exigencias.map((exig) => (
        <ItemDeDocumento
          key={exig.documentType.code}
          exigencia={exig}
          enviado={porTipo.get(exig.documentType.code)}
          enviando={enviando === exig.documentType.code}
          erro={erros[exig.documentType.code]}
          nota={notas[exig.documentType.code]}
          aoEnviar={(a) => subir(exig, a)}
          aoRemover={remover}
        />
      ))}

      {dados.portal.brandFooterText && <div class="rodape">{dados.portal.brandFooterText}</div>}
    </div>
  )
}

function ItemDeDocumento(props: {
  exigencia: Exigencia
  enviado?: DocumentoEnviado
  enviando: boolean
  erro?: string
  nota?: string
  aoEnviar: (a: File) => void
  aoRemover: (id: number) => void
}) {
  const { exigencia: e, enviado } = props
  const entrada = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const sit = enviado ? (SITUACAO[enviado.status] ?? { rotulo: enviado.status, classe: 'analise' }) : null
  const recusado = enviado?.status === 'rejected'

  return (
    <div class="doc">
      <div class="doc-topo">
        <div>
          <span class="doc-nome">{e.documentType.name}</span>
          {!e.required && <span class="opcional"> (opcional)</span>}
          {e.helpText && <span class="doc-ajuda">{e.helpText}</span>}
        </div>
        {sit && <span class={`selo ${sit.classe}`}>{sit.rotulo}</span>}
      </div>

      {enviado && (
        <div class="doc-arquivo">
          <span class="doc-arquivo-nome" title={enviado.fileName}>{enviado.fileName}</span>
          <span class="doc-arquivo-tam">{tamanho(enviado.sizeBytes)}</span>
          {enviado.status !== 'approved' && (
            <button class="doc-remover" onClick={() => props.aoRemover(enviado.id)}>remover</button>
          )}
        </div>
      )}

      {recusado && enviado?.reviewNote && (
        <div class="aviso erro" style="margin:10px 0 0">
          <b>Recusado:</b> {enviado.reviewNote}
        </div>
      )}

      {(!enviado || recusado) && (
        <>
          <div
            class={`solta ${arrastando ? 'ativa' : ''}`}
            onClick={() => entrada.current?.click()}
            onDragOver={(ev) => { ev.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(ev) => {
              ev.preventDefault()
              setArrastando(false)
              const a = ev.dataTransfer?.files?.[0]
              if (a) props.aoEnviar(a)
            }}
          >
            {props.enviando
              ? <span>Enviando…</span>
              : <span>{recusado ? 'Enviar outro arquivo' : 'Tirar foto ou escolher arquivo'}</span>}
            <span class="solta-dica">JPG, PNG, HEIC ou PDF · até 25 MB</span>
          </div>
          <input
            ref={entrada}
            type="file"
            accept="image/*,.pdf,.heic,.heif"
            capture="environment"
            hidden
            onChange={(ev) => {
              const a = (ev.target as HTMLInputElement).files?.[0]
              if (a) props.aoEnviar(a)
              ;(ev.target as HTMLInputElement).value = ''
            }}
          />
        </>
      )}

      {props.erro && <div class="aviso erro" style="margin:10px 0 0" role="alert">{props.erro}</div>}
      {props.nota && !props.erro && <span class="doc-ajuda" style="margin-top:8px">{props.nota}</span>}
    </div>
  )
}
