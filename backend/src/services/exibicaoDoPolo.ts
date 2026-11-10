// Onde o polo (Local de Oferta) aparece. Cada empresa decide: há quem use o
// polo como escola certificadora ou parceiro interno e não quer o nome dele
// diante do aluno nem no contrato. Padrão: tudo ligado (como sempre foi).
//
// Setting `polo.exibicao` = { aluno, contrato }
//   aluno    → resumo da inscrição no portal do aluno ("Unidade · Polo")
//   contrato → variável {{polo}} dos contratos e termos (desligado = vazia)
// O painel interno sempre mostra o polo. Quando a oferta tem mais de um polo,
// o aluno ainda precisa escolher: a escolha continua aparecendo para ele.
import { prisma } from '../lib/prisma.js'

const CHAVE = 'polo.exibicao'
export interface ExibicaoDoPolo { aluno: boolean; contrato: boolean }

let cache: { valor: ExibicaoDoPolo; ate: number } | null = null

export async function exibicaoDoPolo(): Promise<ExibicaoDoPolo> {
  if (cache && cache.ate > Date.now()) return cache.valor
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  const valor: ExibicaoDoPolo = { aluno: v?.aluno !== false, contrato: v?.contrato !== false }
  cache = { valor, ate: Date.now() + 30_000 }
  return valor
}

export async function salvarExibicaoDoPolo(parcial: Partial<ExibicaoDoPolo>): Promise<ExibicaoDoPolo> {
  const atual = await exibicaoDoPolo()
  const valor: ExibicaoDoPolo = {
    aluno: typeof parcial.aluno === 'boolean' ? parcial.aluno : atual.aluno,
    contrato: typeof parcial.contrato === 'boolean' ? parcial.contrato : atual.contrato,
  }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: valor as any, label: 'Polo: aparece para o aluno e no contrato', grp: 'educacional', fieldType: 'json' } as any,
    update: { value: valor as any },
  })
  cache = null
  return valor
}
