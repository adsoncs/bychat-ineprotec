// scripts/corrigir-telefones-internacionais.ts
//
// Repara o acervo de leads cujo telefone estrangeiro foi gravado como
// brasileiro.
//
// Até 10/09/2026 todo bloco de 10 ou 11 dígitos era adotado como número do
// Brasil sem DDI. O de +1 (689) 206-4057 (a Marcia, mãe de aluna do severiano)
// tem 11 dígitos, então virou `5516892064057` — DDD 16, Ribeirão Preto — e o
// envio passou a bater num número que não existe. Este script encontra os que
// ficaram assim e regrava o número correto, com a chave e o log do que mudou.
//
// Roda em CONFERÊNCIA por padrão; só escreve com --aplicar.
//
//   npx tsx scripts/corrigir-telefones-internacionais.ts
//   npx tsx scripts/corrigir-telefones-internacionais.ts --aplicar

import { prisma } from '../src/lib/prisma.js'
import { phoneKey, paisDoTelefone, onlyDigits } from '../src/lib/phone.js'
import { ehE164Br } from '../src/lib/countryCodes.js'

const aplicar = process.argv.includes('--aplicar')

interface Correcao {
  id: number
  nome: string
  de: string
  para: string
  pais: string
}

async function main(): Promise<void> {
  const leads = await prisma.lead.findMany({
    select: { id: true, nome: true, whatsapp: true, phoneKey: true, isGroup: true },
  })

  const corrigir: Correcao[] = []
  const chaveSoltas: Correcao[] = []
  // Casam com um país só pelo comprimento. Ficam como estão e viram lista para
  // conferência humana — o operador sabe de quem é o número, o script não.
  const suspeitos: Correcao[] = []

  for (const l of leads) {
    if (l.isGroup) continue
    const bruto = l.whatsapp || ''
    if (!bruto || bruto.includes('@')) continue

    const certo = phoneKey(bruto)
    if (!certo) continue

    // O caso central: o cadastro tem "55" na frente de um número que, sem ele,
    // é um telefone internacional válido. `phoneKey(bruto)` não desfaz isso
    // sozinho — o 55 já está gravado —, então a verificação é explícita.
    //
    // A guarda é `ehE164Br`: enquanto o miolo for um telefone brasileiro
    // legítimo, o 55 fica onde está. Só quando ele reprova na estrutura BR
    // (DDD da lista fechada + o 9 do celular) é que se pergunta de que país
    // aquele bloco seria — foi o que aconteceu com "5516892064057", onde
    // "16892064057" é um NANP perfeito e um celular de Ribeirão Preto
    // impossível.
    const d = onlyDigits(bruto)
    let alvo = certo
    // Cadastro que traz "+55" ESCRITO é palavra de quem preencheu, e não se
    // desfaz aqui. No unialfa há "+55 (17) 54225-3852" — um número brasileiro
    // digitado com um dígito a mais, que casaria com um NANP perfeito. Trocar
    // o país dele seria inventar um contato americano a partir de um erro de
    // digitação.
    const declarouBrasil = /^\s*(\+\s*55|0055)/.test(bruto)
    if (!declarouBrasil && d.startsWith('55') && !ehE164Br(d)) {
      const semDdi = d.slice(2)
      const p = paisDoTelefone(semDdi)
      // Duas exigências, ambas pagas com casos reais do acervo:
      //
      //  · a pergunta é feita SEM o "+", para o script não ser mais ousado que
      //    o `phoneKey`;
      //  · e o país tem de estar provado pela ESTRUTURA do número. Só o
      //    comprimento não basta: "5559991313059" (cadastro gaúcho quebrado,
      //    aparece em terram, ineprotec e unialfa) casa com Curaçao (+599) só
      //    porque sobram 8 dígitos, e regravá-lo assim destruiria o contato.
      if (p && !p.brasileiro && p.estrutural && phoneKey(semDdi) === semDdi) {
        // "5516892064057" → "16892064057" (Estados Unidos)
        alvo = semDdi
      } else if (p && !p.brasileiro && phoneKey(semDdi) === semDdi) {
        suspeitos.push({ id: l.id, nome: l.nome, de: bruto, para: semDdi, pais: p.nome })
      }
    }

    if (alvo !== d) {
      const p = paisDoTelefone(alvo)
      corrigir.push({ id: l.id, nome: l.nome, de: bruto, para: alvo, pais: p ? p.nome : '?' })
    } else if (l.phoneKey !== alvo) {
      const p = paisDoTelefone(alvo)
      chaveSoltas.push({ id: l.id, nome: l.nome, de: l.phoneKey ?? '(vazia)', para: alvo, pais: p ? p.nome : '?' })
    }
  }

  console.log(`Leads conferidos: ${leads.length}`)
  console.log(`Número a regravar: ${corrigir.length}`)
  for (const c of corrigir) {
    console.log(`  lead ${c.id} "${c.nome.slice(0, 28)}": ${c.de} → ${c.para}  [${c.pais}]`)
  }
  console.log(`Suspeitos, NÃO regravados (conferir na mão): ${suspeitos.length}`)
  for (const c of suspeitos.slice(0, 30)) {
    console.log(`  lead ${c.id} "${c.nome.slice(0, 28)}": ${c.de} pareceria ${c.para} [${c.pais}]`)
  }
  console.log(`Só a chave fora do lugar: ${chaveSoltas.length}`)
  for (const c of chaveSoltas.slice(0, 20)) {
    console.log(`  lead ${c.id} "${c.nome.slice(0, 28)}": phoneKey ${c.de} → ${c.para}  [${c.pais}]`)
  }

  if (!aplicar) {
    console.log('\nConferência apenas. Repita com --aplicar para gravar.')
    return
  }

  for (const c of corrigir) {
    await prisma.lead.update({ where: { id: c.id }, data: { whatsapp: c.para, phoneKey: c.para } })
  }
  for (const c of chaveSoltas) {
    await prisma.lead.update({ where: { id: c.id }, data: { phoneKey: c.para } })
  }
  console.log(`\nGravado: ${corrigir.length} número(s) e ${chaveSoltas.length} chave(s).`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
