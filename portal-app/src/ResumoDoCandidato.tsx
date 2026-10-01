// Bloco de cima do portal do candidato: quem é (anonimizado — LGPD) e o resumo
// da inscrição, num cartão só. Os dados vêm mascarados do servidor
// (/registrations/:code/resumo): o completo nem chega ao navegador.
// As ações da conta (senha, comprovante, sair) entram como filhos.
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

interface Resumo {
  candidato: { nome: string; email: string | null; whatsapp: string | null; cpf: string | null }
  inscricao: { codigo: string; situacao: string; portal: string | null; curso: string | null; oferta: string | null; modalidade: string | null; turno: string | null }
  pagamento: { valorCheio: number | null; cupom: string | null; desconto: number; valor: number | null; meio: string | null; parcelas: number; pago: boolean } | null
}

const SITUACAO: Record<string, string> = {
  draft: 'Rascunho', pending: 'Em andamento', submitted: 'Enviada', paid: 'Paga',
  docs_uploaded: 'Documentos enviados', docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados',
  docs_rejected: 'Documentos recusados', reviewing: 'Em análise', approved: 'Aprovada', enrolled: 'Matriculado(a)',
  rejected: 'Não aprovada', cancelled: 'Cancelada', expired: 'Expirada',
}
const MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
const reais = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

export function ResumoDoCandidato(props: { codigo: string; token: string; children?: ComponentChildren }) {
  const [r, setR] = useState<Resumo | null>(null)
  useEffect(() => {
    fetch(`/api/public/registrations/${encodeURIComponent(props.codigo)}/resumo`, { headers: { Authorization: `Bearer ${props.token}` } })
      .then((x) => (x.ok ? x.json() : null)).then(setR).catch(() => {})
  }, [props.codigo, props.token])

  if (!r) return <div class="cartao"><div class="esqueleto" style="height:150px" /></div>
  const i = r.inscricao
  const p = r.pagamento
  const detalhesCurso = [i.oferta !== i.curso ? i.oferta : null, i.modalidade, i.turno].filter(Boolean).join(' · ')
  return (
    <div class="cartao resumo-candidato">
      <div class="rc-topo">
        <div>
          <h2>Olá, {r.candidato.nome}</h2>
          <p class="sub" style="margin:0">Inscrição <b>{i.codigo}</b>{i.portal ? ` · ${i.portal}` : ''}</p>
        </div>
        <span class="rc-situacao">{SITUACAO[i.situacao] ?? i.situacao}</span>
      </div>
      <dl class="rc-dados">
        {i.curso && <div class="rc-largo"><dt>Curso</dt><dd>{i.curso}{detalhesCurso && <span class="rc-mini">{detalhesCurso}</span>}</dd></div>}
        {p && (
          <div class="rc-largo">
            <dt>{p.pago ? 'Valor pago' : 'Valor a pagar'}</dt>
            <dd>
              <b>{reais(p.valor)}</b>
              {[p.meio && MEIO[p.meio], p.parcelas > 1 && `${p.parcelas}x`].filter(Boolean).length > 0 && <span> · {[p.meio && MEIO[p.meio], p.parcelas > 1 && `${p.parcelas}x`].filter(Boolean).join(' · ')}</span>}
              {p.desconto > 0 && (
                <span class="rc-mini">de <s>{reais(p.valorCheio)}</s> · desconto {reais(p.desconto)}{p.cupom ? ` (cupom ${p.cupom})` : ''}</span>
              )}
            </dd>
          </div>
        )}
        {r.candidato.email && <div><dt>E-mail</dt><dd>{r.candidato.email}</dd></div>}
        {r.candidato.whatsapp && <div><dt>WhatsApp</dt><dd>{r.candidato.whatsapp}</dd></div>}
        {r.candidato.cpf && <div><dt>CPF</dt><dd>{r.candidato.cpf}</dd></div>}
      </dl>
      {props.children && <div class="rc-acoes">{props.children}</div>}
    </div>
  )
}
