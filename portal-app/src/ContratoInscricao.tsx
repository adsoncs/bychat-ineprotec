// Contrato lido e assinado ainda na inscrição (etapa "Contrato" do portal).
// Mesmo aceite do portal logado: rolar até o fim, nome completo, e o texto
// congelado no momento da assinatura. A efetivação da matrícula reaproveita.
import { useEffect, useRef, useState } from 'preact/hooks'
import { carregarContratoDaInscricao, assinarContratoDaInscricao, type ContratoDaInscricao as Dados } from './api'

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const soLetras = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/gi, '').trim().toLowerCase().replace(/\s+/g, ' ')

export function ContratoInscricao(props: { codigo: string; token: string; aoAssinar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [leuTudo, setLeuTudo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const termoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    carregarContratoDaInscricao(props.codigo, props.token)
      .then((c) => { setDados(c); if (c.assinado) setLeuTudo(true) })
      .catch((e: any) => setFalha(e.message))
  }, [props.codigo, props.token])

  // Termo curto cabe inteiro e nunca dispara a rolagem — já foi lido.
  useEffect(() => {
    const el = termoRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setLeuTudo(true)
  }, [dados])

  if (falha) return <div class="aviso erro">{falha}</div>
  if (!dados) return <div class="esqueleto" style="height:260px" />

  const nomeConfere = soLetras(nome) === soLetras(dados.aluno)
  const podeAssinar = !dados.assinado && leuTudo && nome.trim().includes(' ') && nome.trim().length >= 5

  async function assinar() {
    if (!podeAssinar || enviando) return
    setEnviando(true); setErro(null)
    try {
      await assinarContratoDaInscricao(props.codigo, props.token, nome.trim())
      setDados((d) => (d ? { ...d, assinado: true, assinadoEm: new Date().toISOString(), assinadoPor: nome.trim() } : d))
      props.aoAssinar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div class="contrato-inscricao">
      <dl class="resumo-contrato">
        <div><dt>Curso</dt><dd>{dados.curso}</dd></div>
        {dados.valorTotalCentavos > 0 && <div><dt>Valor total</dt><dd>{money(dados.valorTotalCentavos)}</dd></div>}
        {dados.numParcelas > 0 && <div><dt>Parcelas</dt><dd>{dados.numParcelas}× de {money(dados.valorParcelaCentavos)}</dd></div>}
      </dl>
      <div class="termo" ref={termoRef} tabIndex={0} aria-label="Texto do contrato"
        onScroll={(e) => { const el = e.currentTarget as HTMLDivElement; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setLeuTudo(true) }}>
        {dados.termo.split('\n').map((l, i) => (l.trim() ? <p key={i}>{l}</p> : <br key={i} />))}
      </div>
      {dados.assinado ? (
        <div class="assinado">
          <strong>Contrato assinado</strong>
          <span class="sub">{dados.assinadoPor ? `Por ${dados.assinadoPor}` : ''}{dados.assinadoEm ? ` em ${new Date(dados.assinadoEm).toLocaleDateString('pt-BR')}` : ''}</span>
        </div>
      ) : (
        <>
          {!leuTudo && <div class="aviso info">Role o contrato até o fim para poder assinar.</div>}
          <div class="campo">
            <label for="assinatura-insc">Escreva seu nome completo para assinar</label>
            <input id="assinatura-insc" type="text" autocomplete="name" value={nome} placeholder={dados.aluno} disabled={!leuTudo}
              onInput={(e: any) => setNome(e.currentTarget.value)} />
          </div>
          {nome.trim().length >= 5 && !nomeConfere && (
            <div class="aviso info">Este nome é diferente do cadastro ({dados.aluno}). O contrato precisa sair no nome de quem se inscreveu.</div>
          )}
          {erro && <div class="aviso erro">{erro}</div>}
          <button class="principal" type="button" disabled={!podeAssinar || enviando} onClick={assinar}>
            {enviando ? 'Registrando…' : 'Assinar contrato'}
          </button>
          <p class="sub legal">Ao assinar, ficam registrados seu nome, a data, o endereço de rede de onde você assinou e uma cópia deste texto exatamente como está agora.</p>
        </>
      )}
    </div>
  )
}
