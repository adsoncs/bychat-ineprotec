// Dados pedidos numa etapa da matrícula (Educacional › Dados por etapa):
// "Completar cadastro", ou os dados que uma etapa pede antes da sua ação — o
// responsável financeiro antes do contrato, por exemplo. Vem preenchido com o
// que a pessoa já informou (ou a secretaria já digitou); ela só completa.
import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { carregarDados, salvarDados, type DadosDaEtapa } from './api'
import { erroDoCampo, mascarar, modoEntrada, type Campo } from './validacao'

export function DadosEtapa(props: {
  codigo: string
  token: string
  etapa: string
  /** Texto do botão; na etapa com ação própria, o botão leva à ação. */
  rotuloBotao?: string
  aoSalvar: () => void
}) {
  const [dados, setDados] = useState<DadosDaEtapa | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [tocados, setTocados] = useState<Record<string, boolean>>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarDados(props.codigo, props.token, props.etapa)
      .then((d) => {
        if (!vivo) return
        setDados(d)
        setValores(Object.fromEntries(d.campos.map((c) => [c.name, d.valores[c.name] == null ? '' : String(d.valores[c.name])])))
      })
      .catch((e) => vivo && setFalha(e.message))
    return () => { vivo = false }
  }, [props.codigo, props.token, props.etapa])

  if (falha && !dados) return <div class="aviso erro">{falha}</div>
  if (!dados) return <div class="esqueleto" style="height:120px" />
  if (!dados.campos.length) return null

  const erros = Object.fromEntries(
    dados.campos.map((c) => [c.name, erroDoCampo(c as Campo, valores[c.name] ?? '')]).filter(([, e]) => e),
  ) as Record<string, string>

  async function salvar() {
    if (Object.keys(erros).length) {
      setTocados(Object.fromEntries(dados!.campos.map((c) => [c.name, true])))
      const primeiro = document.querySelector<HTMLElement>(`.dados-etapa [name="${Object.keys(erros)[0]}"]`)
      primeiro?.focus()
      primeiro?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setSalvando(true)
    setFalha(null)
    try {
      await salvarDados(props.codigo, props.token, props.etapa, valores)
      props.aoSalvar()
    } catch (e: any) {
      setFalha(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div class="dados-etapa">
      <div class="campos">
        {dados.campos.map((c) => {
          const campo = c as Campo
          const v = valores[c.name] ?? ''
          const erro = tocados[c.name] ? erros[c.name] : erroDoCampo(campo, v, true)
          const comum = {
            name: c.name, id: `d_${c.name}`, value: v,
            onBlur: () => setTocados((t) => ({ ...t, [c.name]: true })),
            'aria-invalid': erro ? true : undefined,
            'aria-describedby': erro ? `de_${c.name}` : undefined,
          }
          return (
            <div class={`campo ${erro ? 'ruim' : ''}`} key={c.name}>
              <label for={`d_${c.name}`}>{c.label} {!c.required && <span class="opcional">(opcional)</span>}</label>
              {c.options?.length ? (
                <select {...comum} onChange={(e) => setValores((x) => ({ ...x, [c.name]: (e.target as HTMLSelectElement).value }))}>
                  <option value="">Selecione…</option>
                  {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  {...comum}
                  type={c.type === 'email' ? 'email' : 'text'}
                  inputMode={modoEntrada(campo.type) as JSX.HTMLAttributes<HTMLInputElement>['inputMode']}
                  onInput={(e) => setValores((x) => ({ ...x, [c.name]: mascarar(campo.type, (e.target as HTMLInputElement).value) }))}
                />
              )}
              {erro && <span class="erro" id={`de_${c.name}`} role="alert">{erro}</span>}
            </div>
          )
        })}
      </div>
      {falha && <div class="aviso erro" role="alert">{falha}</div>}
      <div class="acoes">
        <button class="principal" type="button" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : props.rotuloBotao ?? 'Salvar dados'}
        </button>
      </div>
    </div>
  )
}
