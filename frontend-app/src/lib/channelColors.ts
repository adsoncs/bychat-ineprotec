/**
 * Paleta dos canais de WhatsApp.
 *
 * Fechada de propósito: com cor livre, o operador escolhe um amarelo claro que
 * some no tema claro ou um cinza que se confunde com a borda — e aí a marca
 * visual deixa de cumprir o papel de identificar a origem num relance. Estes
 * tons foram escolhidos para ter contraste nos dois temas.
 */
export const CANAL_CORES = [
  { hex: '#16a34a', nome: 'Verde' },
  { hex: '#0ea5e9', nome: 'Azul' },
  { hex: '#8b5cf6', nome: 'Roxo' },
  { hex: '#ec4899', nome: 'Rosa' },
  { hex: '#f97316', nome: 'Laranja' },
  { hex: '#eab308', nome: 'Amarelo' },
  { hex: '#14b8a6', nome: 'Turquesa' },
  { hex: '#ef4444', nome: 'Vermelho' },
  { hex: '#6366f1', nome: 'Índigo' },
  { hex: '#64748b', nome: 'Cinza' },
] as const

/** Cor do provedor, usada enquanto o canal não tem cor própria. */
export function corDoCanal(color: string | null | undefined, provider: string): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color
  return provider === 'cloud_api' ? '#0ea5e9' : '#16a34a'
}

/**
 * Nome do canal para o operador.
 *
 * O rótulo técnico do provedor ("Evolution") não diz nada a quem atende — o que
 * ele precisa saber é QUAL número está falando. Vale o nome que o cliente deu ao
 * canal, seja ele qual for: "Comercial", "vendas", "Loja Centro". O único caso
 * em que o nome é descartado é quando ele É o identificador técnico da conexão
 * (o campo veio em branco no cadastro e o sistema repetiu o instanceName ali).
 *
 * Sem nome utilizável, cai na distinção que de fato muda o que dá para fazer:
 * WhatsApp comum (número pareado) x WhatsApp Oficial (API da Meta, com
 * templates, botões e janela de 24h).
 */
export function nomeDoCanal(
  canal: { id?: string; label?: string | null; number?: string | null; provider: string } | null | undefined,
): string {
  if (!canal) return ''
  const rotulo = (canal.label || '').trim()
  // "evolution:beyond-main" / "cloud:3" → identificador técnico da conexão.
  const tecnico = (canal.id || '').split(':').slice(1).join(':')
  if (rotulo && rotulo !== tecnico) return rotulo
  return canal.number || (canal.provider === 'cloud_api' ? 'WhatsApp Oficial' : 'WhatsApp')
}
