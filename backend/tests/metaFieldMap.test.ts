// tests/metaFieldMap.test.ts
//
// Guarda o casamento entre a pergunta do formulário Meta e o campo do lead.
//
// Este arquivo existe por causa do incidente severiano (05-08/09/2026): a
// campanha trocou de formulário na Meta, o novo tinha os mesmos rótulos em
// português de sempre ("nome_do_responsável", "whatsapp_do_responsável"), o
// mapeamento automático só reconhecia rótulo exato em inglês, e 24 leads de
// anúncio entraram sem nome e sem telefone — impossíveis de contatar, todos
// reprovados na condição de telefone do workflow de boas-vindas. Ninguém viu
// erro nenhum: o dado estava inteiro no payload cru, só não na coluna certa.
//
// Os rótulos abaixo são os REAIS dos formulários em produção (severiano,
// terram, unialfa, habitat, ineprotec); os valores são fictícios.
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { guessCoreField, buildAutoMapping, normKey } from '../src/lib/metaFieldMap.js'

const q = (...keys: string[]) => keys.map(k => ({ key: k, label: k }))

describe('guessCoreField — rótulo composto em português', () => {
  test('o que a campanha do severiano usa', () => {
    assert.equal(guessCoreField('nome_do_responsável'), 'nome')
    assert.equal(guessCoreField('whatsapp_do_responsável'), 'whatsapp')
    assert.equal(guessCoreField('whatsapp_do_responsável_'), 'whatsapp')
    assert.equal(guessCoreField('email'), 'email')
  })

  test('campo que fala de terceiro não vira o nome do contato', () => {
    assert.equal(guessCoreField('nome_do_aluno'), null)
    assert.equal(guessCoreField('nome_da_criança'), null)
    assert.equal(guessCoreField('nome_do_filho'), null)
    assert.equal(guessCoreField('escola_que_o_aluno_estuda_atualmente'), null)
    assert.equal(guessCoreField('série_atual_do_aluno'), null)
    assert.equal(guessCoreField('selecione_seu_curso_de_interesse'), null)
  })

  test('rótulos nativos do Meta continuam valendo', () => {
    assert.equal(guessCoreField('full_name'), 'nome')
    assert.equal(guessCoreField('phone_number'), 'whatsapp')
    assert.equal(guessCoreField('city'), 'cidade')
  })

  test('variações de telefone', () => {
    for (const k of ['telefone', 'celular', 'whatsapp', 'seu_whatsapp', 'telefone_de_contato', 'phone']) {
      assert.equal(guessCoreField(k), 'whatsapp', k)
    }
  })

  test('empresa ganha de nome em "nome_da_empresa"', () => {
    assert.equal(guessCoreField('nome_da_empresa'), 'empresa')
  })

  test('perguntas de qualificação não viram campo núcleo', () => {
    for (const k of [
      'como_está_seu_pasto_hoje?',
      'qual_o_tamanho_da_sua_área_de_pastagem?',
      'qual_seu_cargo/função_na_fazenda?',
      'qual_seu_nível_de_escolaridade_atual?',
      'quando_pretende_matricular?',
      'qual_o_melhor_período_para_conhecer_a_escola?',
      'escolha_seu_polo',
      'menos_de_1_ano',
    ]) assert.equal(guessCoreField(k), null, k)
  })
})

describe('buildAutoMapping', () => {
  test('formulário do severiano: nome e telefone saem do responsável, aluno vira custom field', () => {
    const cf = { nome_do_aluno: 'cf_filho_1_nome', escola_que_o_aluno_estuda_atualmente: 'cf_escola' }
    const map = buildAutoMapping(
      q('email', 'nome_do_aluno', 'nome_do_responsável', 'série_atual_do_aluno', 'whatsapp_do_responsável', 'escola_que_o_aluno_estuda_atualmente'),
      cf
    )
    assert.equal(map['nome_do_responsável'], 'nome')
    assert.equal(map['whatsapp_do_responsável'], 'whatsapp')
    assert.equal(map['email'], 'email')
    assert.equal(map['nome_do_aluno'], 'cf_filho_1_nome')
    assert.equal(map['escola_que_o_aluno_estuda_atualmente'], 'cf_escola')
    assert.equal(map['série_atual_do_aluno'], '_formData')
  })

  test('sem custom field cadastrado, o campo do aluno não rouba o nome do contato', () => {
    const map = buildAutoMapping(q('nome_do_aluno', 'nome_do_responsável'), {})
    assert.equal(map['nome_do_aluno'], '_formData')
    assert.equal(map['nome_do_responsável'], 'nome')
  })

  test('dois candidatos ao mesmo campo: o primeiro vence, o segundo não concatena', () => {
    const map = buildAutoMapping(q('nome_completo', 'nome_do_contato'), {})
    assert.equal(map['nome_completo'], 'nome')
    assert.notEqual(map['nome_do_contato'], 'nome')
  })

  test('formulários em inglês (terram/unialfa/habitat) seguem iguais', () => {
    const map = buildAutoMapping(q('email', 'full_name', 'phone_number', 'escolha_seu_polo'), { escolha_seu_polo: 'cf_polo' })
    assert.deepEqual(map, { email: 'email', full_name: 'nome', phone_number: 'whatsapp', escolha_seu_polo: 'cf_polo' })
  })

  test('todo formulário com um campo de nome e um de telefone produz os dois', () => {
    const map = buildAutoMapping(q('nome_do_responsável', 'whatsapp_do_responsável', 'qualquer_pergunta'), {})
    const destinos = Object.values(map)
    assert.ok(destinos.includes('nome'))
    assert.ok(destinos.includes('whatsapp'))
  })

  test('pergunta sem chave não entra no mapa', () => {
    const map = buildAutoMapping([{ key: '', label: '' }, { key: 'telefone', label: 'telefone' }], {})
    assert.deepEqual(Object.keys(map), ['telefone'])
  })
})

describe('normKey', () => {
  test('tira acento, pontuação e caixa', () => {
    assert.equal(normKey('Whatsapp do Responsável?'), 'whatsapp_do_responsavel')
    assert.equal(normKey('qual_seu_cargo/função_na_fazenda?'), 'qual_seu_cargo_funcao_na_fazenda')
  })
})
