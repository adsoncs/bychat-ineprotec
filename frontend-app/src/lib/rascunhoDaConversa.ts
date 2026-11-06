// Outra tela deixa um texto pronto na caixa da conversa de um lead (nada é enviado).
// Na sessão, e não na URL: o texto pode ter link de acesso do aluno.
const chave = (leadId: number) => `attrae:rascunho-conversa:${leadId}`

export function pedirRascunho(leadId: number, texto: string): void {
  try { sessionStorage.setItem(chave(leadId), texto) } catch { /* sem sessão: a caixa abre vazia */ }
}

export function pegarRascunhoPedido(leadId: number): string | null {
  try {
    const t = sessionStorage.getItem(chave(leadId))
    if (t) sessionStorage.removeItem(chave(leadId))
    return t
  } catch { return null }
}
