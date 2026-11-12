// CPF no painel: máscara e conferência dos dígitos verificadores (mesma conta do
// backend em lib/cpf.ts e do portal do aluno em validacao.ts).

export const digitosDoCpf = (v: string) => String(v ?? '').replace(/\D+/g, '')

/** CPF pelos dígitos verificadores — não basta ter 11 números. */
export function cpfValido(valor: string): boolean {
  const d = digitosDoCpf(valor)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false // 111.111.111-11 e afins passam na conta
  for (const peso of [10, 11]) {
    let soma = 0
    for (let i = 0; i < peso - 1; i++) soma += Number(d[i]) * (peso - i)
    if ((soma * 10) % 11 % 10 !== Number(d[peso - 1])) return false
  }
  return true
}

/** Máscara 000.000.000-00 enquanto digita. */
export function mascararCpf(v: string): string {
  const d = digitosDoCpf(v).slice(0, 11)
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`
  return d
}

/** Mensagem do campo: null = ok (vazio também é ok aqui; obrigatório é outra regra). */
export function erroDoCpf(valor: string): string | null {
  const d = digitosDoCpf(valor)
  if (!d) return null
  if (d.length < 11) return `Faltam ${11 - d.length} dígito(s).`
  return cpfValido(d) ? null : 'CPF não confere. Verifique os números digitados.'
}

/** Chaves de CPF reconhecidas no cadastro. */
export const CHAVES_DE_CPF = ['cpf', 'responsavelCpf']
