// src/services/autentique.ts
// Integração com a Autentique (assinatura eletrônica) — GraphQL v2.
// https://docs.autentique.com.br/api · endpoint https://api.autentique.com.br/v2/graphql
// Auth: Authorization: Bearer <token>. Upload de arquivo via "GraphQL multipart request spec".
//
// Tudo aqui é isolado: se não houver token/modo=AUTENTIQUE, o orquestrador usa o modo
// SIMULADO (sem rede), então o fluxo é 100% testável sem credencial.

import { prisma } from '../lib/prisma.js'

const ENDPOINT = 'https://api.autentique.com.br/v2/graphql'

export interface AutentiqueConfig { modo: 'SIMULADO' | 'AUTENTIQUE'; token: string | null; sandbox: boolean }

async function getSetting(key: string): Promise<string | null> {
  const r = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  const v = r?.value as any
  return typeof v === 'string' ? v : (v == null ? null : String(v))
}

/** Configuração efetiva: token vem do env (preferência) ou Setting; modo idem. */
export async function getConfig(): Promise<AutentiqueConfig> {
  const token = process.env.AUTENTIQUE_API_TOKEN || (await getSetting('assinatura.autentique.token')) || null
  const modoRaw = (await getSetting('assinatura.modo')) || (token ? 'AUTENTIQUE' : 'SIMULADO')
  const modo = modoRaw === 'AUTENTIQUE' && token ? 'AUTENTIQUE' : 'SIMULADO'
  const sandbox = (await getSetting('assinatura.autentique.sandbox')) !== 'false' // default true (não consome documento)
  return { modo, token, sandbox }
}

export async function setConfig(p: { modo?: string; token?: string; sandbox?: boolean }): Promise<void> {
  const up = async (key: string, value: string, label: string, fieldType = 'text') =>
    prisma.setting.upsert({ where: { key }, update: { value: value as any }, create: { key, label, grp: 'academico', fieldType, value: value as any } })
  const tokenInformado = typeof p.token === 'string' && p.token.trim().length > 0
  if (p.token !== undefined) await up('assinatura.autentique.token', p.token.trim(), 'Token Autentique', 'text')
  // Se um token foi informado e o modo não foi explicitamente SIMULADO, liga o Autentique.
  const modoFinal = p.modo === 'SIMULADO' ? 'SIMULADO' : (p.modo === 'AUTENTIQUE' || tokenInformado) ? 'AUTENTIQUE' : undefined
  if (modoFinal !== undefined) await up('assinatura.modo', modoFinal, 'Modo de assinatura')
  if (p.sandbox !== undefined) await up('assinatura.autentique.sandbox', p.sandbox ? 'true' : 'false', 'Sandbox Autentique', 'boolean')
}

interface GqlResult<T> { data?: T; errors?: Array<{ message: string }> }

async function gql<T>(token: string, query: string, variables: any): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const j = (await res.json()) as GqlResult<T>
  if (j.errors?.length) throw new Error('Autentique: ' + j.errors.map((e) => e.message).join('; '))
  if (!j.data) throw new Error('Autentique: resposta vazia (HTTP ' + res.status + ')')
  return j.data
}

export interface CriarDocSigner { nome: string; email: string }
export interface CriarDocResult {
  id: string
  signatures: Array<{ public_id: string; name: string | null; email: string | null; link: { short_link: string } | null }>
}

/** Cria um documento para assinatura enviando o PDF (multipart GraphQL upload). */
export async function criarDocumento(token: string, sandbox: boolean, name: string, signers: CriarDocSigner[], pdf: Buffer): Promise<CriarDocResult> {
  const query = `mutation Criar($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!, $sandbox: Boolean) {
    createDocument(document: $document, signers: $signers, file: $file, sandbox: $sandbox) {
      id name
      signatures { public_id name email action { name } link { short_link } }
    }
  }`
  const operations = {
    query,
    variables: {
      document: { name },
      signers: signers.map((s) => ({ name: s.nome, email: s.email, action: 'SIGN' })),
      file: null,
      sandbox,
    },
  }
  const form = new FormData()
  form.append('operations', JSON.stringify(operations))
  form.append('map', JSON.stringify({ '0': ['variables.file'] }))
  form.append('0', new Blob([pdf], { type: 'application/pdf' }), `${name}.pdf`)

  const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const j = (await res.json()) as GqlResult<{ createDocument: CriarDocResult }>
  if (j.errors?.length) throw new Error('Autentique: ' + j.errors.map((e) => e.message).join('; '))
  if (!j.data?.createDocument) throw new Error('Autentique: createDocument falhou (HTTP ' + res.status + ')')
  return j.data.createDocument
}

export interface DocStatus {
  id: string
  signatures: Array<{
    public_id: string; name: string | null; email: string | null
    viewed: { created_at: string } | null
    signed: { created_at: string } | null
    rejected: { created_at: string } | null
  }>
}

/** Consulta o status de um documento (para reconciliar assinaturas). */
export async function consultarDocumento(token: string, id: string): Promise<DocStatus> {
  const query = `query($id: UUID!) { document(id: $id) {
    id name
    signatures { public_id name email viewed { created_at } signed { created_at } rejected { created_at } }
  } }`
  const d = await gql<{ document: DocStatus }>(token, query, { id })
  return d.document
}
