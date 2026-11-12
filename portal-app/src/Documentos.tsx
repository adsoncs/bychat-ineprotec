import { useEffect, useRef, useState } from 'preact/hooks'
import { carregarMarca, type MarcaDoPortal } from './marca'
import { Moldura, AcessoSair } from './Moldura'
import {
  carregarCandidato, enviarDocumento, removerDocumento,
  type Candidato, type DocumentoEnviado, type Exigencia,
} from './api'
import { comprimirSePreciso } from './imagem'
import { t as tx } from './textos'

// Situação de cada documento na linguagem de quem enviou, não a do banco.
const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  pending: { rotulo: 'Em análise', classe: 'analise' },
  approved: { rotulo: 'Aprovado', classe: 'ok' },
  rejected: { rotulo: 'Recusado', classe: 'ruim' },
}

const MAX_BYTES = 25 * 1024 * 1024

const tamanho = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`)

/**
 * `token` + `embutido`: a mesma tela dentro do fluxo de inscrição (etapa
 * "Documentos"), autenticada pelo token da inscrição, sem cabeçalho de página.
 */
export function Documentos(props: {
  token?: string; embutido?: boolean; aoMudar?: () => void
  /** Só estes documentos (ex.: os da análise acadêmica), sem o cabeçalho geral. */
  tipos?: Array<{ code: string; nome: string }>
} = {}) {
  const [dados, setDados] = useState<Candidato | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)

  async function recarregar() {
    try {
      const d = await carregarCandidato(props.token)
      // Branding completo (fonte, cantos, fundo, botões); a cor vem logo abaixo.
      if (!props.embutido && !marca) void carregarMarca().then(setMarca)
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
      if (!props.embutido && /expirad|inválid/i.test(e.message)) { location.href = '/portal/login'; return }
      setFalha(e.message)
    }
  }

  useEffect(() => { void recarregar() }, [])

  if (falha) {
    return (
      <Moldura marca={marca} acesso={<AcessoSair />}>
        <div class="cartao">
          <h2>Não foi possível abrir seus documentos</h2>
          <p class="sub">{falha}</p>
          <button class="principal" onClick={() => location.reload()}>Tentar de novo</button>
        </div>
      </Moldura>
    )
  }
  if (!dados) {
    return (
      props.embutido
        ? <div class="esqueleto" style="height:300px" />
        : <Moldura marca={marca}><div class="esqueleto" style="height:300px" /></Moldura>
    )
  }

  const todas = (dados.processRegistration?.effectiveDocumentRequirements ?? [])
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  // Recorte (análise acadêmica): o documento pedido entra mesmo que não esteja
  // na lista de exigências do processo — quem decide é a etapa.
  const exigencias: Exigencia[] = props.tipos
    ? props.tipos.map((t, i) => todas.find((e) => e.documentType.code === t.code)
      ?? { required: true, ordem: i, documentType: { id: 0, code: t.code, name: t.nome } })
    : todas
  const porTipo = new Map<string, DocumentoEnviado>()
  for (const d of dados.documents) porTipo.set(d.typeCode, d)

  const obrigatorios = exigencias.filter((e) => e.required)
  const entregues = obrigatorios.filter((e) => {
    const d = porTipo.get(e.documentType.code)
    return d && d.status !== 'rejected'
  })
  const faltam = obrigatorios.length - entregues.length

  async function subir(exig: Exigencia, escolhido: File, escolhidoVerso?: File | null) {
    const codigo = exig.documentType.code
    setErros((e) => ({ ...e, [codigo]: '' }))
    setEnviando(codigo)
    try {
      // Comprime antes de checar o limite: foto de 8 MB costuma virar menos de
      // 1 MB e passa, em vez de ser recusada por tamanho.
      const r = await comprimirSePreciso(escolhido)
      const rv = escolhidoVerso ? await comprimirSePreciso(escolhidoVerso) : null
      for (const [lado, x] of [['', r], ['O verso: ', rv]] as const) {
        if (x && x.arquivo.size > MAX_BYTES) {
          setErros((e) => ({ ...e, [codigo]: `${lado}${lado ? 'o' : 'O'} arquivo tem ${tamanho(x.arquivo.size)} — o limite é 25 MB. Envie em PDF ou tire a foto com menos qualidade.` }))
          return
        }
      }
      if (r.comprimido || rv?.comprimido) {
        const antes = r.de + (rv?.de ?? 0)
        const depois = r.para + (rv?.para ?? 0)
        setNotas((n) => ({ ...n, [codigo]: `${rv ? 'Fotos reduzidas' : 'Foto reduzida'} de ${tamanho(antes)} para ${tamanho(depois)} antes de enviar.` }))
      }
      await enviarDocumento(codigo, exig.documentType.name, r.arquivo, props.token, rv?.arquivo ?? null)
      await recarregar()
      props.aoMudar?.()
    } catch (e: any) {
      setErros((er) => ({ ...er, [codigo]: e.message }))
    } finally {
      setEnviando(null)
    }
  }

  async function remover(id: number) {
    await removerDocumento(id, props.token).catch(() => null)
    await recarregar()
    props.aoMudar?.()
  }

  // Fora da jornada (/portal/documentos): a moldura do portal, igual às demais telas.
  // (Função, não componente: um componente criado aqui seria outro a cada
  // render, e os filhos — upload em andamento incluído — seriam recriados.)
  const envolver = (conteudo: any) => props.embutido
    ? <div class="docs-embutidos">{conteudo}</div>
    : <Moldura marca={marca} acesso={<AcessoSair />}>{conteudo}</Moldura>
  return envolver(
    <>

      {!props.tipos && <div class="cartao" style="margin-bottom:14px">
        <h2>{tx('docs.titulo', 'Seus documentos')}</h2>
        <p class="sub" style="margin-bottom:12px">
          Inscrição {dados.enrollment.candidateCode} · {dados.lead.nome}
        </p>
        {exigencias.length === 0 ? (
          <div class="aviso info">
            {tx('docs.nenhum', 'Ainda não há documentos a enviar para esta inscrição. Se a secretaria pedir algum, ele aparece aqui.')}
          </div>
        ) : faltam > 0 ? (
          <div class="aviso info">
            <b>{faltam === 1 ? 'Falta 1' : `Faltam ${faltam}`} de {obrigatorios.length}</b>{' '}
            {faltam === 1 ? 'documento obrigatório' : 'documentos obrigatórios'}.
            Pode enviar foto pelo celular — a imagem precisa estar legível.
          </div>
        ) : (
          <div class="aviso info" style="color:var(--ok);border-color:var(--ok)">
            <b>Documentos recebidos!</b> Eles estão em análise pela secretaria — avisaremos você assim que a conferência for concluída.
          </div>
        )}
      </div>}

      {exigencias.map((exig) => (
        <ItemDeDocumento
          key={exig.documentType.code}
          exigencia={exig}
          enviado={porTipo.get(exig.documentType.code)}
          enviando={enviando === exig.documentType.code}
          erro={erros[exig.documentType.code]}
          nota={notas[exig.documentType.code]}
          aoEnviar={(a, v) => subir(exig, a, v)}
          aoRemover={remover}
        />
      ))}

    </>,
  )
}

function ItemDeDocumento(props: {
  exigencia: Exigencia
  enviado?: DocumentoEnviado
  enviando: boolean
  erro?: string
  nota?: string
  aoEnviar: (a: File, verso?: File | null) => void
  aoRemover: (id: number) => void
}) {
  const { exigencia: e, enviado } = props
  // Frente e verso: o padrão é um campo para cada lado (quem fotografa o RG
  // tira duas fotos); quem tem o documento escaneado num arquivo só escolhe
  // "um arquivo com as duas faces".
  const [modo, setModo] = useState<'separados' | 'unico'>('separados')
  const [frente, setFrente] = useState<File | null>(null)
  const [verso, setVerso] = useState<File | null>(null)
  const sit = enviado ? (SITUACAO[enviado.status] ?? { rotulo: enviado.status, classe: 'analise' }) : null
  const recusado = enviado?.status === 'rejected'
  const doisCampos = !!e.frenteVerso && modo === 'separados'
  const nome = e.documentType.name

  return (
    <div class="doc">
      <div class="doc-topo">
        <div>
          <span class="doc-nome">{nome}</span>
          {!e.required && <span class="opcional"> (opcional)</span>}
          {e.helpText && <span class="doc-ajuda">{e.helpText}</span>}
        </div>
        {sit && <span class={`selo ${sit.classe}`}>{sit.rotulo}</span>}
      </div>

      {enviado && (
        <div class="doc-arquivo">
          <span class="doc-arquivo-nome" title={enviado.fileName}>
            {enviado.versoFileName ? <>Frente: {enviado.fileName} · Verso: {enviado.versoFileName}</> : enviado.fileName}
          </span>
          <span class="doc-arquivo-tam">{tamanho(enviado.sizeBytes)}</span>
          {enviado.status !== 'approved' && (
            <button type="button" class="doc-remover" onClick={() => props.aoRemover(enviado.id)} aria-label={`Remover arquivo: ${nome}`}>remover</button>
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
          {e.frenteVerso && (
            <fieldset class="lados-modo">
              <legend>Este documento tem frente e verso. Como você vai enviar?</legend>
              <label><input type="radio" name={`modo-${e.documentType.code}`} checked={modo === 'separados'} onChange={() => setModo('separados')} /> Frente e verso separados</label>
              <label><input type="radio" name={`modo-${e.documentType.code}`} checked={modo === 'unico'} onChange={() => setModo('unico')} /> Um arquivo com as duas faces</label>
            </fieldset>
          )}

          {doisCampos ? (
            props.enviando ? (
              <div class="solta"><span role="status">Enviando…</span></div>
            ) : (
              <>
                <div class="lados">
                  {([['Frente', frente, setFrente], ['Verso', verso, setVerso]] as const).map(([lado, arquivo, definir]) => (
                    <div key={lado}>
                      <span class="lado-titulo">{lado}</span>
                      <ZonaDeEnvio descricao={`${lado} do ${nome}`} rotulo={arquivo ? 'Trocar arquivo' : 'Escolher arquivo'} aoEscolher={definir} />
                      {arquivo && <span class="lado-escolhido">✓ {arquivo.name}</span>}
                    </div>
                  ))}
                </div>
                <button type="button" class="principal lados-enviar" disabled={!frente || !verso}
                  onClick={() => { if (frente && verso) { props.aoEnviar(frente, verso); setFrente(null); setVerso(null) } }}>
                  {!frente && !verso ? 'Escolha a frente e o verso' : !frente ? 'Falta a frente' : !verso ? 'Falta o verso' : 'Enviar frente e verso'}
                </button>
              </>
            )
          ) : (
            props.enviando
              ? <div class="solta"><span role="status">Enviando…</span></div>
              : <ZonaDeEnvio descricao={nome} rotulo={recusado ? 'Enviar outro arquivo' : 'Escolher arquivo'} aoEscolher={(a) => props.aoEnviar(a)} />
          )}
        </>
      )}

      {props.erro && <div class="aviso erro" style="margin:10px 0 0" role="alert">{props.erro}</div>}
      {props.nota && !props.erro && <span class="doc-ajuda" style="margin-top:8px">{props.nota}</span>}
    </div>
  )
}

/**
 * Área de envio de um arquivo. Acessibilidade (11/11): dois botões de verdade
 * (teclado e leitor de tela chegam neles) — escolher um arquivo salvo, inclusive
 * PDF, ou tirar a foto na hora; arrastar continua valendo no computador.
 */
function ZonaDeEnvio(props: { descricao: string; rotulo: string; aoEscolher: (a: File) => void }) {
  const entrada = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const escolher = (ev: Event) => {
    const a = (ev.target as HTMLInputElement).files?.[0]
    if (a) props.aoEscolher(a)
    ;(ev.target as HTMLInputElement).value = ''
  }
  return (
    <>
      <div
        class={`solta ${arrastando ? 'ativa' : ''}`}
        onDragOver={(ev) => { ev.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(ev) => {
          ev.preventDefault()
          setArrastando(false)
          const a = ev.dataTransfer?.files?.[0]
          if (a) props.aoEscolher(a)
        }}
      >
        <div class="solta-botoes">
          <button type="button" class="solta-botao" onClick={() => entrada.current?.click()} aria-label={`${props.rotulo}: ${props.descricao}`}>
            {props.rotulo}
          </button>
          <button type="button" class="solta-botao" onClick={() => camera.current?.click()} aria-label={`Tirar foto: ${props.descricao}`}>
            Tirar foto
          </button>
        </div>
        <span class="solta-dica">JPG, PNG, HEIC ou PDF · até 25 MB</span>
      </div>
      <input ref={entrada} type="file" accept="image/*,.pdf,.heic,.heif" hidden tabIndex={-1} onChange={escolher} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} onChange={escolher} />
    </>
  )
}
