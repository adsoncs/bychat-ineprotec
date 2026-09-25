// A demo tem tipos de documento cadastrados, mas nenhuma forma de ingresso
// exigindo documento — então o candidato nunca via lista nenhuma. Semeia
// exigências realistas por forma de ingresso. Só cria o que falta.
import { prisma } from '../src/lib/prisma.js'

const tipos = await prisma.documentType.findMany({ select: { id: true, code: true, name: true } })
console.log('tipos de documento disponíveis:')
for (const t of tipos) console.log(`   ${String(t.id).padStart(2)} ${t.code.padEnd(24)} ${t.name}`)

const porCodigo = new Map(tipos.map((t) => [t.code, t]))
const modos = await prisma.entryMode.findMany({ select: { id: true, name: true } })

/** Cada exigência com o porquê — a pessoa precisa saber para que serve. */
const PLANO: Record<string, Array<{ code: string; required: boolean; helpText: string }>> = {
  'Vestibular online': [
    { code: 'RG', required: true, helpText: 'Frente e verso, com os dados legíveis.' },
    { code: 'CPF', required: true, helpText: 'Pode ser o CPF impresso no RG ou na CNH.' },
    { code: 'HIST_EM', required: true, helpText: 'Histórico completo do ensino médio, com todas as séries.' },
    { code: 'CERT_EM', required: true, helpText: 'Certificado ou declaração de conclusão do ensino médio.' },
    { code: 'COMP_END', required: true, helpText: 'Conta de luz, água ou internet dos últimos 3 meses.' },
    { code: 'FOTO', required: false, helpText: 'Usada na carteirinha de estudante.' },
  ],
  'Nota do ENEM': [
    { code: 'RG', required: true, helpText: 'Frente e verso, com os dados legíveis.' },
    { code: 'CPF', required: true, helpText: 'Pode ser o CPF impresso no RG ou na CNH.' },
    { code: 'HIST_EM', required: true, helpText: 'Histórico completo do ensino médio.' },
    { code: 'CERT_EM', required: true, helpText: 'Certificado ou declaração de conclusão.' },
    { code: 'COMP_END', required: true, helpText: 'Conta de luz, água ou internet dos últimos 3 meses.' },
  ],
  'Transferência externa': [
    { code: 'RG', required: true, helpText: 'Frente e verso, com os dados legíveis.' },
    { code: 'CPF', required: true, helpText: 'Pode ser o CPF impresso no RG ou na CNH.' },
    { code: 'HIST_SUP', required: true, helpText: 'Histórico da instituição de origem, com as notas.' },
    { code: 'EMENTA', required: true, helpText: 'Ementas das disciplinas cursadas — é o que permite o aproveitamento.' },
    { code: 'COMP_END', required: true, helpText: 'Conta de luz, água ou internet dos últimos 3 meses.' },
  ],
  'Segunda graduação': [
    { code: 'RG', required: true, helpText: 'Frente e verso, com os dados legíveis.' },
    { code: 'CPF', required: true, helpText: 'Pode ser o CPF impresso no RG ou na CNH.' },
    { code: 'DIPLOMA', required: true, helpText: 'Diploma do curso superior já concluído.' },
    { code: 'HIST_SUP', required: true, helpText: 'Histórico da graduação concluída.' },
    { code: 'COMP_END', required: true, helpText: 'Conta de luz, água ou internet dos últimos 3 meses.' },
  ],
}

let criadas = 0
let semTipo = new Set<string>()
for (const modo of modos) {
  const itens = PLANO[modo.name]
  if (!itens) { console.log(`\n${modo.name}: sem plano definido — pulado`); continue }
  console.log(`\n${modo.name}:`)
  let ordem = 0
  for (const item of itens) {
    const tipo = porCodigo.get(item.code)
    if (!tipo) { semTipo.add(item.code); continue }
    ordem++
    const existe = await prisma.entryModeDocumentRequirement.findFirst({
      where: { entryModeId: modo.id, documentTypeId: tipo.id }, select: { id: true },
    })
    if (existe) { console.log(`   já existia: ${tipo.name}`); continue }
    await prisma.entryModeDocumentRequirement.create({
      data: {
        entryModeId: modo.id, documentTypeId: tipo.id,
        required: item.required, ordem, helpText: item.helpText,
      },
    })
    console.log(`   + ${tipo.name}${item.required ? '' : ' (opcional)'}`)
    criadas++
  }
}

if (semTipo.size) console.log('\n⚠ códigos sem tipo cadastrado (ignorados):', [...semTipo].join(', '))
console.log(`\nexigências criadas: ${criadas} | total: ${await prisma.entryModeDocumentRequirement.count()}`)
process.exit(0)
