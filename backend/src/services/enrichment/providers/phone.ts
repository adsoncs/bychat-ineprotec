// Phone: análise de telefone sem dependência externa.
// Deriva DDD → região, operadora (heurística), tipo (móvel/fixo), formato internacional.
// Não usa libphonenumber-js para manter zero deps extras, mas a heurística é suficiente p/ Brasil.

import type { Provider, ProviderResult } from '../types.js'

const DDD_REGIONS: Record<string, { state: string; region: string; city?: string }> = {
  '11': { state: 'SP', region: 'Sudeste', city: 'São Paulo' },
  '12': { state: 'SP', region: 'Sudeste', city: 'Vale do Paraíba' },
  '13': { state: 'SP', region: 'Sudeste', city: 'Santos' },
  '14': { state: 'SP', region: 'Sudeste', city: 'Bauru' },
  '15': { state: 'SP', region: 'Sudeste', city: 'Sorocaba' },
  '16': { state: 'SP', region: 'Sudeste', city: 'Ribeirão Preto' },
  '17': { state: 'SP', region: 'Sudeste', city: 'São José do Rio Preto' },
  '18': { state: 'SP', region: 'Sudeste', city: 'Presidente Prudente' },
  '19': { state: 'SP', region: 'Sudeste', city: 'Campinas' },
  '21': { state: 'RJ', region: 'Sudeste', city: 'Rio de Janeiro' },
  '22': { state: 'RJ', region: 'Sudeste', city: 'Campos' },
  '24': { state: 'RJ', region: 'Sudeste', city: 'Volta Redonda' },
  '27': { state: 'ES', region: 'Sudeste', city: 'Vitória' },
  '28': { state: 'ES', region: 'Sudeste', city: 'Cachoeiro' },
  '31': { state: 'MG', region: 'Sudeste', city: 'Belo Horizonte' },
  '32': { state: 'MG', region: 'Sudeste', city: 'Juiz de Fora' },
  '33': { state: 'MG', region: 'Sudeste', city: 'Governador Valadares' },
  '34': { state: 'MG', region: 'Sudeste', city: 'Uberlândia' },
  '35': { state: 'MG', region: 'Sudeste', city: 'Poços de Caldas' },
  '37': { state: 'MG', region: 'Sudeste', city: 'Divinópolis' },
  '38': { state: 'MG', region: 'Sudeste', city: 'Montes Claros' },
  '41': { state: 'PR', region: 'Sul', city: 'Curitiba' },
  '42': { state: 'PR', region: 'Sul', city: 'Ponta Grossa' },
  '43': { state: 'PR', region: 'Sul', city: 'Londrina' },
  '44': { state: 'PR', region: 'Sul', city: 'Maringá' },
  '45': { state: 'PR', region: 'Sul', city: 'Cascavel' },
  '46': { state: 'PR', region: 'Sul', city: 'Francisco Beltrão' },
  '47': { state: 'SC', region: 'Sul', city: 'Joinville' },
  '48': { state: 'SC', region: 'Sul', city: 'Florianópolis' },
  '49': { state: 'SC', region: 'Sul', city: 'Chapecó' },
  '51': { state: 'RS', region: 'Sul', city: 'Porto Alegre' },
  '53': { state: 'RS', region: 'Sul', city: 'Pelotas' },
  '54': { state: 'RS', region: 'Sul', city: 'Caxias do Sul' },
  '55': { state: 'RS', region: 'Sul', city: 'Santa Maria' },
  '61': { state: 'DF', region: 'Centro-Oeste', city: 'Brasília' },
  '62': { state: 'GO', region: 'Centro-Oeste', city: 'Goiânia' },
  '63': { state: 'TO', region: 'Norte', city: 'Palmas' },
  '64': { state: 'GO', region: 'Centro-Oeste', city: 'Rio Verde' },
  '65': { state: 'MT', region: 'Centro-Oeste', city: 'Cuiabá' },
  '66': { state: 'MT', region: 'Centro-Oeste', city: 'Rondonópolis' },
  '67': { state: 'MS', region: 'Centro-Oeste', city: 'Campo Grande' },
  '68': { state: 'AC', region: 'Norte', city: 'Rio Branco' },
  '69': { state: 'RO', region: 'Norte', city: 'Porto Velho' },
  '71': { state: 'BA', region: 'Nordeste', city: 'Salvador' },
  '73': { state: 'BA', region: 'Nordeste', city: 'Ilhéus' },
  '74': { state: 'BA', region: 'Nordeste', city: 'Juazeiro' },
  '75': { state: 'BA', region: 'Nordeste', city: 'Feira de Santana' },
  '77': { state: 'BA', region: 'Nordeste', city: 'Vitória da Conquista' },
  '79': { state: 'SE', region: 'Nordeste', city: 'Aracaju' },
  '81': { state: 'PE', region: 'Nordeste', city: 'Recife' },
  '82': { state: 'AL', region: 'Nordeste', city: 'Maceió' },
  '83': { state: 'PB', region: 'Nordeste', city: 'João Pessoa' },
  '84': { state: 'RN', region: 'Nordeste', city: 'Natal' },
  '85': { state: 'CE', region: 'Nordeste', city: 'Fortaleza' },
  '86': { state: 'PI', region: 'Nordeste', city: 'Teresina' },
  '87': { state: 'PE', region: 'Nordeste', city: 'Petrolina' },
  '88': { state: 'CE', region: 'Nordeste', city: 'Juazeiro do Norte' },
  '89': { state: 'PI', region: 'Nordeste', city: 'Picos' },
  '91': { state: 'PA', region: 'Norte', city: 'Belém' },
  '92': { state: 'AM', region: 'Norte', city: 'Manaus' },
  '93': { state: 'PA', region: 'Norte', city: 'Santarém' },
  '94': { state: 'PA', region: 'Norte', city: 'Marabá' },
  '95': { state: 'RR', region: 'Norte', city: 'Boa Vista' },
  '96': { state: 'AP', region: 'Norte', city: 'Macapá' },
  '97': { state: 'AM', region: 'Norte', city: 'Tefé' },
  '98': { state: 'MA', region: 'Nordeste', city: 'São Luís' },
  '99': { state: 'MA', region: 'Nordeste', city: 'Imperatriz' },
}

function normalizeBrazilPhone(raw: string): { digits: string; ddd?: string; isMobile: boolean; e164: string } | null {
  const d = raw.replace(/\D/g, '')
  if (!d) return null
  // remove 55 inicial se presente
  let n = d
  if (n.length === 13 && n.startsWith('55')) n = n.slice(2)
  if (n.length === 12 && n.startsWith('55')) n = n.slice(2)
  if (n.length < 10 || n.length > 11) return null
  const ddd = n.slice(0, 2)
  const rest = n.slice(2)
  const isMobile = rest.length === 9 && rest.startsWith('9')
  return { digits: n, ddd, isMobile, e164: `+55${n}` }
}

export const phoneProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const raw = seed.whatsapp || ''
  if (!raw) return result

  const parsed = normalizeBrazilPhone(raw)
  if (!parsed) {
    result.facts.push({ source: 'phone', field: 'phone_valid', value: 'false', confidence: 0.9 })
    return result
  }

  result.facts.push({ source: 'phone', field: 'phone_e164', value: parsed.e164, confidence: 1.0 })
  result.facts.push({ source: 'phone', field: 'phone_type', value: parsed.isMobile ? 'mobile' : 'landline', confidence: 0.9 })
  result.facts.push({ source: 'phone', field: 'phone_valid', value: 'true', confidence: 1.0 })

  if (parsed.ddd) {
    const region = DDD_REGIONS[parsed.ddd]
    result.facts.push({ source: 'phone', field: 'phone_ddd', value: parsed.ddd, confidence: 1.0 })
    if (region) {
      result.facts.push({ source: 'phone', field: 'phone_state', value: region.state, confidence: 0.95 })
      result.facts.push({ source: 'phone', field: 'phone_region', value: region.region, confidence: 0.95 })
      if (region.city) result.facts.push({ source: 'phone', field: 'phone_city_guess', value: region.city, confidence: 0.6 })
    }
  }

  return result
}
