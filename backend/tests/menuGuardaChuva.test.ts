// tests/menuGuardaChuva.test.ts
//
// A costura entre o menu e o registro de módulos.
//
// O produto mantinha duas listas para a mesma coisa, em builds separados: o
// menu agrupava por `group` (frontend) e a tela de módulos por `category`
// (backend). Nada as obrigava a concordar — e elas pararam de concordar. Medido
// na demo em 11/09/2026: 7 dos 16 grupos do menu misturavam categorias, e
// "Chatbots" aparecia em Marketing no menu e em Captação na tela de módulos.
//
// Enquanto era arrumação, dava para conviver. Virando catálogo de loja, não:
// quem compra o pacote "Marketing" precisa receber exatamente o que viu.
//
// O frontend não importa do backend — são dois builds. Então o que impede a
// deriva é este teste, que IMPORTA os dois lados e exige que concordem. Não lê
// os arquivos como texto: o próprio `moduleRegistry.test.ts` registra que regex
// sobre o arquivo já fez alguém "ver um problema onde não havia", capturando
// palavras dentro de comentários.
//
//   cd backend && npx tsx --test tests/menuGuardaChuva.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'
import { sidebarSchema } from '../../frontend-app/src/modules/sidebar.config.js'

const porId = new Map(MODULE_REGISTRY.map((m) => [m.id, m]))
const todosItens = [
  ...sidebarSchema.pinned.map((i) => ({ i, grupo: '(topo)', umbrella: null as string | null })),
  ...sidebarSchema.groups.flatMap((g) => g.items.map((i) => ({ i, grupo: g.label, umbrella: g.umbrella }))),
  ...sidebarSchema.footer.map((i) => ({ i, grupo: '(rodapé)', umbrella: null as string | null })),
]

describe('todo item do menu aponta para um módulo real', () => {
  test('nenhum item sem módulo declarado', () => {
    // Item sem `permission` só aparece para SUPERADMIN (fail-closed do
    // SidebarBody). Na loja isso é pior: uma tela que ninguém compra e ninguém vê.
    const orfaos = todosItens.filter(({ i }) => !i.permission).map(({ grupo, i }) => `${grupo} › ${i.label}`)
    assert.deepEqual(orfaos, [])
  })

  test('nenhum item aponta para módulo que não existe', () => {
    const quebrados = todosItens
      .filter(({ i }) => i.permission && !porId.has(i.permission))
      .map(({ grupo, i }) => `${grupo} › ${i.label} (${i.permission})`)
    assert.deepEqual(quebrados, [],
      'item apontando para módulo inexistente some da tela sem erro — o pior tipo de defeito')
  })
})

describe('o grupo do menu e o guarda-chuva do módulo concordam', () => {
  test('todo grupo declara seu guarda-chuva', () => {
    const sem = sidebarSchema.groups.filter((g) => !g.umbrella).map((g) => g.label)
    assert.deepEqual(sem, [])
  })

  test('cada item vem de um módulo do mesmo guarda-chuva, ou é atalho declarado', () => {
    const divergentes: string[] = []
    for (const g of sidebarSchema.groups) {
      for (const i of g.items) {
        if (!i.permission) continue
        const m = porId.get(i.permission)
        if (!m || m.umbrella === g.umbrella || i.atalho) continue
        divergentes.push(`${g.label} (${g.umbrella}) › ${i.label} → módulo ${m.id} é de ${m.umbrella}`)
      }
    }
    assert.deepEqual(divergentes, [],
      'item em seção de outro pacote sem `atalho: true`: ou o guarda-chuva do módulo está errado, '
      + 'ou o item está no grupo errado, ou é atalho de propósito e precisa dizer isso')
  })

  test('atalho declarado é atalho de verdade', () => {
    // Um `atalho: true` sobrando é pior que ausente: desliga a checagem
    // justamente onde ela passaria a valer se o módulo mudasse de pacote.
    const sobrando: string[] = []
    for (const g of sidebarSchema.groups) {
      for (const i of g.items) {
        if (!i.atalho || !i.permission) continue
        const m = porId.get(i.permission)
        if (m && m.umbrella === g.umbrella) sobrando.push(`${g.label} › ${i.label}`)
      }
    }
    assert.deepEqual(sobrando, [], 'marcado como atalho, mas está no próprio guarda-chuva')
  })
})

describe('todo guarda-chuva aparece no menu', () => {
  test('nenhum pacote é invisível', () => {
    // Um pacote sem nenhuma seção no menu seria vendido e não apareceria em
    // lugar nenhum — o cliente paga e não encontra.
    const noMenu = new Set(sidebarSchema.groups.map((g) => g.umbrella))
    const doRegistro = new Set(MODULE_REGISTRY.map((m) => m.umbrella))
    const invisiveis = [...doRegistro].filter((u) => !noMenu.has(u as never))
    assert.deepEqual(invisiveis, [],
      'guarda-chuva sem seção no menu: vendável e inalcançável')
  })
})
