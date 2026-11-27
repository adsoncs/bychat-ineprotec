// src/lib/cpf.ts
// Validação de CPF (11 dígitos com dígitos verificadores).

export function normalizeCpf(cpf: string): string {
  return String(cpf || '').replace(/\D/g, '')
}

export function isValidCpf(cpf: string): boolean {
  const c = normalizeCpf(cpf)
  if (c.length !== 11) return false
  if (/^(\d)\1+$/.test(c)) return false  // todos iguais
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i)
  let d1 = 11 - (sum % 11)
  if (d1 >= 10) d1 = 0
  if (d1 !== parseInt(c[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i)
  let d2 = 11 - (sum % 11)
  if (d2 >= 10) d2 = 0
  return d2 === parseInt(c[10])
}

export function formatCpf(cpf: string): string {
  const c = normalizeCpf(cpf)
  if (c.length !== 11) return cpf
  return `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9,11)}`
}

/** CNPJ (14 dígitos) pelos dígitos verificadores. */
export function isValidCnpj(cnpj: string): boolean {
  const c = normalizeCpf(cnpj)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const dv = (base: string) => {
    let soma = 0, peso = base.length - 7
    for (const ch of base) { soma += Number(ch) * peso--; if (peso < 2) peso = 9 }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13])
}

/** CPF ou CNPJ válido. */
export const isValidCpfOuCnpj = (v: string) => isValidCpf(v) || isValidCnpj(v)
