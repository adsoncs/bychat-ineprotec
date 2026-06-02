// ViaCEP: resolve endereço completo a partir de CEP.

import type { Provider, ProviderResult } from '../types.js'

function extractCep(text?: string | null): string | null {
  if (!text) return null
  const m = text.replace(/\D/g, '').match(/\b\d{8}\b/)
  return m ? m[0] : null
}

export const viacepProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const cep =
    extractCep(seed.formData?.cep) ||
    extractCep(seed.formData?.endereco) ||
    extractCep(seed.cidade)
  if (!cep) return result

  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
    if (!resp.ok) return result
    const data = await resp.json() as any
    if (data.erro) return result
    result.facts.push({ source: 'viacep', field: 'cep', value: cep, confidence: 1.0, rawData: data })
    if (data.logradouro) result.facts.push({ source: 'viacep', field: 'address_street', value: data.logradouro, confidence: 0.95 })
    if (data.bairro) result.facts.push({ source: 'viacep', field: 'address_district', value: data.bairro, confidence: 0.95 })
    if (data.localidade) result.facts.push({ source: 'viacep', field: 'address_city', value: data.localidade, confidence: 0.95 })
    if (data.uf) result.facts.push({ source: 'viacep', field: 'address_state', value: data.uf, confidence: 0.95 })
    if (data.ddd) result.facts.push({ source: 'viacep', field: 'address_ddd', value: data.ddd, confidence: 0.9 })
  } catch { /* ignore */ }

  return result
}
