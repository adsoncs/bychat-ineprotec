// Liga os módulos do ERP acadêmico usados no fluxo de matrícula.
// Chama setModuleEnabled (cascata de dependências + permissões + setting legado),
// em vez de escrever direto em bychat_modules.
import { setModuleEnabled, isModuleEnabled } from '../src/lib/moduleManager.js'

const MODULOS = [
  'aca_estrutura',
  'aca_matriculas',
  'aca_vestibular',
  'aca_cadastros',
  'aca_financeiro',
  'aca_secretaria',
  'aca_ged',
  'aca_assinatura',
  'aca_portais',
]

for (const id of MODULOS) {
  const antes = await isModuleEnabled(id)
  if (antes) { console.log(`${id.padEnd(20)} já estava ligado`); continue }
  await setModuleEnabled(id, true)
  console.log(`${id.padEnd(20)} ligado`)
}

console.log('\n--- estado final ---')
for (const id of [...MODULOS, 'educacional', 'enrollment_portals']) {
  console.log(`${id.padEnd(20)} ${(await isModuleEnabled(id)) ? 'ON' : 'off'}`)
}
process.exit(0)
