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

/** Chaves de CPF reconhecidas no cadastro (o do responsável aceita CNPJ: ver CHAVES_DE_CPF_OU_CNPJ). */
export const CHAVES_DE_CPF = ['cpf', 'responsavelRepresentanteCpf']

// ── CNPJ: o responsável financeiro pode ser uma empresa ──

/** CNPJ pelos dígitos verificadores. */
export function cnpjValido(valor: string): boolean {
  const d = digitosDoCpf(valor)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string) => {
    let soma = 0, peso = base.length - 7
    for (const ch of base) { soma += Number(ch) * peso--; if (peso < 2) peso = 9 }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** Máscara de CPF até 11 números; passou disso, de CNPJ (00.000.000/0000-00). */
export function mascararCpfOuCnpj(v: string): string {
  const d = digitosDoCpf(v).slice(0, 14)
  if (d.length <= 11) return mascararCpf(d)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function erroDoCpfOuCnpj(valor: string): string | null {
  const d = digitosDoCpf(valor)
  if (!d || d.length === 11) return erroDoCpf(d)
  if (d.length < 14) return d.length < 11 ? `Faltam ${11 - d.length} dígito(s) para CPF.` : `Faltam ${14 - d.length} dígito(s) para CNPJ.`
  return cnpjValido(d) ? null : 'CNPJ não confere. Verifique os números digitados.'
}

/** Documento do responsável financeiro: CPF ou CNPJ. */
export const CHAVES_DE_CPF_OU_CNPJ = ['responsavelCpf']
export const ehCnpj = (v: string) => digitosDoCpf(v).length === 14
