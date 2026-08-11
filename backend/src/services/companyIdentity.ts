// src/services/companyIdentity.ts
//
// Dados da própria empresa que o time manda para o cliente o dia inteiro:
// endereço, mapa e PIX.
//
// Antes isso vivia digitado dentro de cada modelo de mensagem — no tenant da
// Clínica Elementus o mesmo endereço aparecia em três formatos diferentes, um
// deles com a quadra repetida e sem o número. Fonte única resolve, e mudar de
// endereço passa a ser uma edição em vez de quarenta.

import { prisma } from '../lib/prisma.js'
import { gerarPixCopiaECola, type TipoChavePix } from '../lib/pixBrCode.js'

export interface CompanyIdentity {
  // Endereço
  endereco: string
  cidade: string
  estado: string
  cep: string
  /** Coordenadas para enviar localização nativa no WhatsApp. */
  latitude: number | null
  longitude: number | null
  /** Link do mapa (Google Maps encurtado, por exemplo). */
  mapaUrl: string
  // PIX
  pixChave: string
  pixTipo: TipoChavePix
  pixBeneficiario: string
  pixCidade: string
  /** Banco/instituição — só informativo, aparece na mensagem. */
  pixBanco: string
}

const PADRAO: CompanyIdentity = {
  endereco: '', cidade: '', estado: '', cep: '',
  latitude: null, longitude: null, mapaUrl: '',
  pixChave: '', pixTipo: 'cnpj', pixBeneficiario: '', pixCidade: '', pixBanco: '',
}

const CACHE_TTL_MS = 60_000
let _cache: { dados: CompanyIdentity; expiresAt: number } | null = null

export function invalidateCompanyIdentityCache(): void {
  _cache = null
}

export async function getCompanyIdentity(): Promise<CompanyIdentity> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.dados
  const row = await prisma.setting.findUnique({ where: { key: 'company_identity' } }).catch(() => null)
  const dados = row?.value && typeof row.value === 'object'
    ? { ...PADRAO, ...(row.value as any) }
    : PADRAO
  _cache = { dados, expiresAt: Date.now() + CACHE_TTL_MS }
  return dados
}

/**
 * O "copia e cola" do PIX. Sem valor, é o código estático que o cliente cola no
 * banco e digita quanto vai pagar; com valor, o app já abre com o total.
 * Devolve '' quando a chave não está cadastrada — quem chama decide o que dizer.
 */
export async function pixCopiaECola(opts?: { valor?: number | null; txid?: string | null }): Promise<string> {
  const c = await getCompanyIdentity()
  if (!c.pixChave.trim()) return ''
  try {
    return gerarPixCopiaECola({
      chave: c.pixChave,
      tipo: c.pixTipo,
      beneficiario: c.pixBeneficiario || '',
      cidade: c.pixCidade || c.cidade || '',
      valor: opts?.valor ?? null,
      txid: opts?.txid ?? null,
    })
  } catch {
    return ''
  }
}

/** Endereço em uma linha, do jeito que vai para a mensagem. */
export function enderecoEmLinha(c: CompanyIdentity): string {
  const partes = [c.endereco, c.cidade && c.estado ? `${c.cidade}/${c.estado}` : c.cidade, c.cep]
  return partes.filter((p) => (p || '').trim()).join(' — ')
}

/**
 * Variáveis da EMPRESA para os modelos de mensagem.
 *
 * Até aqui só existiam variáveis do lead ({{nome}}, {{empresa}}…) — "empresa"
 * inclusive é a empresa DO LEAD, não a nossa. Daí o prefixo `empresa_` para os
 * dados próprios, sem colidir com o que já está em uso nos modelos existentes.
 */
export async function buildCompanyVars(): Promise<Record<string, string>> {
  const c = await getCompanyIdentity()
  const nome = await prisma.setting.findUnique({ where: { key: 'business.company_name' } }).catch(() => null)
  const copiaECola = await pixCopiaECola()
  return {
    empresa_nome: String(nome?.value ?? '').replace(/^"|"$/g, ''),
    empresa_endereco: enderecoEmLinha(c),
    empresa_cidade: c.cidade,
    empresa_cep: c.cep,
    empresa_mapa: c.mapaUrl,
    pix_chave: c.pixChave,
    pix_beneficiario: c.pixBeneficiario,
    pix_banco: c.pixBanco,
    pix_copia_cola: copiaECola,
  }
}
