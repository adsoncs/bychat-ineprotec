import { useEffect, useRef, useState } from 'preact/hooks'
import { carregarMarca, TopoDaMarca, type MarcaDoPortal } from './marca'
import { carregarContrato, assinarContrato, type ContratoDoAluno } from './api'

// Contrato de matrícula — Fase 5 da consolidação ERP × Portal.
//
// A assinatura vale por si: nome completo digitado, IP, data e uma cópia do
// termo congelada no momento do aceite. É o mesmo mecanismo que o portal antigo
// do ERP já usava; o que mudou foi o lugar — a pessoa assina onde já está.
//
// Duas decisões de tela que não são estéticas:
//
//  • O botão de assinar só acende depois que a pessoa **rola até o fim** do
//    termo. Assinar sem ter tido a chance de ler é o tipo de coisa que se
//    discute em juízo, e o custo de exigir a rolagem é um segundo.
//  • O nome digitado é conferido contra o nome do cadastro. Não por burocracia:
//    quem digita outro nome quase sempre é o responsável assinando pelo aluno, e
//    esse caso tem tratamento próprio no ERP — melhor avisar do que registrar
//    uma assinatura com o nome errado.

const money = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const soLetras = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim()

export function Contrato() {
  const [dados, setDados] = useState<ContratoDoAluno | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [leuTudo, setLeuTudo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  useEffect(() => { void carregarMarca().then(setMarca) }, [])
  const [pronto, setPronto] = useState<{ efetivou: boolean } | null>(null)
  const termoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    carregarContrato()
      .then((c) => {
        if (!vivo) return
        setDados(c)
        if (c.assinado) setLeuTudo(true)
      })
      .catch((e: any) => {
        if (/expirad|inválid|Entre no portal/i.test(e.message)) { location.href = '/portal/login'; return }
        setFalha(e.message)
      })
    return () => { vivo = false }
  }, [])

  // Termo curto cabe inteiro na tela e nunca dispara o evento de rolagem —
  // nesse caso a leitura já aconteceu por definição.
  useEffect(() => {
    const el = termoRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setLeuTudo(true)
  }, [dados])

  const aoRolar = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setLeuTudo(true)
  }

  const nomeConfere = !dados || soLetras(nome) === soLetras(dados.aluno)
  const podeAssinar = !!dados && !dados.assinado && leuTudo && nome.trim().includes(' ') && nome.trim().length >= 5

  async function assinar() {
    if (!podeAssinar || enviando) return
    setEnviando(true); setErro(null)
    try {
      const r = await assinarContrato(nome.trim())
      setPronto({ efetivou: r.matriculaEfetivada })
      setDados((d) => (d ? { ...d, assinado: true, assinadoEm: new Date().toISOString(), assinadoPor: nome.trim() } : d))
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  if (falha) {
    return (
      <div class="pagina">
        <div class="cartao">
          <h2>Contrato</h2>
          <p class="sub">{falha}</p>
          <a href="/portal/aluno"><button class="secundario" type="button">Voltar ao meu portal</button></a>
        </div>
      </div>
    )
  }

  if (!dados) {
    return <div class="pagina" aria-busy="true"><div class="topo" /><div class="esqueleto" style="height:320px" /></div>
  }

  return (
    <div class="pagina">
      <TopoDaMarca marca={marca} />
      <div class="cartao contrato">
        <h2>{dados.titulo}</h2>
        <p class="sub">{dados.curso} · {dados.turma}</p>

        <dl class="resumo-contrato">
          <div><dt>Aluno</dt><dd>{dados.aluno}{dados.ra !== '—' ? ` · RA ${dados.ra}` : ''}</dd></div>
          <div><dt>Valor total</dt><dd>{money(dados.valorTotalCentavos)}</dd></div>
          {dados.numParcelas > 0 && (
            <div>
              <dt>Parcelas</dt>
              <dd>{dados.numParcelas}× de {money(dados.valorParcelaCentavos)}</dd>
            </div>
          )}
        </dl>

        <div class="termo" ref={termoRef} onScroll={aoRolar} tabIndex={0} aria-label="Texto do contrato">
          {dados.termo.split('\n').map((linha, i) =>
            linha.trim() ? <p key={i}>{linha}</p> : <br key={i} />,
          )}
        </div>

        {dados.assinado ? (
          <div class="assinado">
            <strong>Contrato assinado</strong>
            <span class="sub">
              {dados.assinadoPor ? `Por ${dados.assinadoPor}` : ''}
              {dados.assinadoEm ? ` em ${new Date(dados.assinadoEm).toLocaleDateString('pt-BR')}` : ''}
            </span>
            {pronto?.efetivou && <span class="sub">Sua matrícula foi efetivada.</span>}
            <a href="/portal/aluno"><button class="principal" type="button">Voltar ao meu portal</button></a>
          </div>
        ) : (
          <>
            {!leuTudo && (
              <div class="aviso info">Role o contrato até o fim para poder assinar.</div>
            )}

            <div class="campo">
              <label for="assinatura">Escreva seu nome completo para assinar</label>
              <input
                id="assinatura" name="assinatura" type="text" autocomplete="name"
                value={nome} onInput={(e: any) => setNome(e.currentTarget.value)}
                placeholder={dados.aluno} disabled={!leuTudo}
              />
            </div>

            {nome.trim().length >= 5 && !nomeConfere && (
              <div class="aviso info">
                Este nome é diferente do cadastro ({dados.aluno}). Se você está assinando
                pelo aluno, fale com a secretaria antes — o contrato precisa sair no nome certo.
              </div>
            )}

            {erro && <div class="aviso erro">{erro}</div>}

            <button class="principal" type="button" disabled={!podeAssinar || enviando} onClick={assinar}>
              {enviando ? 'Registrando…' : 'Assinar contrato'}
            </button>

            <p class="sub legal">
              Ao assinar, ficam registrados seu nome, a data, o endereço de rede de onde você
              assinou e uma cópia deste texto exatamente como está agora.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
