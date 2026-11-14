// Teste (demo) da identidade por unidade — duas empresas no mesmo ambiente.
// Cria uma unidade/portal/leads de teste, confere cada ponto e APAGA tudo no fim.
// Não envia nada: chama só funções de leitura/decisão.
import { prisma } from '../src/lib/prisma.js'
import { cfgComIdentidade, identidadeDoLead, unidadeDoLead, esquecerIdentidade, canalDaUnidade } from '../src/lib/identidadeDaUnidade.js'
import { getFromAddress, getEmailConfig } from '../src/services/notify.js'
import { getDocHeader } from '../src/services/acaDocRender.js'
import { acharConta } from '../src/services/portalAccount.js'
import { fichaParaMatricula } from '../src/services/fichaDaMatricula.js'
import { sendCapiEvent } from '../src/services/metaCapi.js'

let falhas = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) falhas++ }
const cpfAleatorio = () => {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const dv = (arr: number[]) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  const d1 = dv(n); const d2 = dv([...n, d1]); return [...n, d1, d2].join('')
}

const criados: { units: number[]; portals: number[]; leads: number[] } = { units: [], portals: [], leads: [] }
try {
  const modelo = await prisma.enrollmentPortal.findFirst({ where: { id: 1 } })
  const unitB = await prisma.educationalUnit.create({ data: { nome: 'test:empresa B', identidade: {
    marca: 'Empresa B', razaoSocial: 'EMPRESA B LTDA', cnpj: '11222333000181', emailNome: 'Empresa B', emailCaixa: 'empresab',
    whatsappConexaoId: 7, capiDesligado: true,
  } } })
  criados.units.push(unitB.id); esquecerIdentidade()
  const portalB = await prisma.enrollmentPortal.create({ data: {
    slug: `test-empresa-b-${Date.now()}`, nome: 'test:portal B', unitId: unitB.id, selectionProcessIds: [], formConfig: (modelo?.formConfig ?? {}) as any, codePrefix: 'MAT',
  } })
  criados.portals.push(portalB.id)

  // 1) remetente e {{marca}}
  const cfg = await getEmailConfig()
  const geral = getFromAddress(cfg)
  const leadA = await prisma.lead.create({ data: { nome: 'test:Ana A', empresa: '', whatsapp: '5511900000001', email: `a${Date.now()}@teste.invalid`, formData: {}, scores: {} } })
  const leadB = await prisma.lead.create({ data: { nome: 'test:Ana B', empresa: '', whatsapp: '5511900000002', email: `b${Date.now()}@teste.invalid`, formData: {}, scores: {} } })
  criados.leads.push(leadA.id, leadB.id)
  await prisma.enrollmentRegistration.create({ data: { portalId: portalB.id, leadId: leadB.id, candidateCode: `MAT-26-TEST-${Date.now().toString(36).toUpperCase()}`, formData: {} } as any })
  const doB = getFromAddress(cfgComIdentidade(cfg, await identidadeDoLead(leadB.id)))
  const doA = getFromAddress(cfgComIdentidade(cfg, await identidadeDoLead(leadA.id)))
  console.log('  geral:', geral, '| A:', doA, '| B:', doB)
  ok(doA === geral, 'lead sem empresa usa o remetente geral')
  ok(doB.startsWith('Empresa B <empresab@'), 'lead da empresa B usa o remetente dela')

  // 2) contrato
  const hGeral = await getDocHeader(); const hB = await getDocHeader(unitB.id); const h1 = await getDocHeader(1)
  ok(hB.instituicao === 'EMPRESA B LTDA' && hB.cnpj === '11222333000181', 'contrato da unidade B: razão social e CNPJ dela')
  ok(h1.instituicao === hGeral.instituicao, 'unidade sem identidade: cabeçalho geral')

  // 3) canal da ficha nova
  ok((await canalDaUnidade(unitB.id)).cloudApiConnectionId === 7, 'ficha nova do portal B nasce no número 7')
  ok(!(await canalDaUnidade(1)).cloudApiConnectionId, 'portal da unidade 1 não grava número (como antes)')

  // 4) unidade por número da conversa (lead B2 sem inscrição, na conexão 7)
  const leadB2 = await prisma.lead.create({ data: { nome: 'test:Bia', empresa: '', whatsapp: '5511900000003', email: '', formData: {}, scores: {}, cloudApiConnectionId: 7 } })
  criados.leads.push(leadB2.id)
  ok((await unidadeDoLead(leadB2.id)) === unitB.id, 'lead sem inscrição no número da empresa B é da empresa B')

  // 5) login: mesma pessoa com conta nas duas empresas
  const cpf = cpfAleatorio()
  const leadA3 = await prisma.lead.create({ data: { nome: 'test:Caio', empresa: '', whatsapp: '5511900000004', email: '', formData: { cpf }, scores: {} } })
  const leadB3 = await prisma.lead.create({ data: { nome: 'test:Caio', empresa: '', whatsapp: '5511900000004', email: '', formData: { cpf }, scores: {} } })
  criados.leads.push(leadA3.id, leadB3.id)
  await prisma.enrollmentRegistration.create({ data: { portalId: 1, leadId: leadA3.id, candidateCode: `INE-26-TEST-${Date.now().toString(36).toUpperCase()}`, formData: { cpf } } as any })
  await prisma.enrollmentRegistration.create({ data: { portalId: portalB.id, leadId: leadB3.id, candidateCode: `MAT-26-TST2-${Date.now().toString(36).toUpperCase()}`, formData: { cpf } } as any })
  const cA = await prisma.portalAccount.create({ data: { leadId: leadA3.id, cpf } as any })
  const cB = await prisma.portalAccount.create({ data: { leadId: leadB3.id, cpf } as any })
  ok((await acharConta(cpf, unitB.id))?.id === cB.id, 'login pelo portal B acha a conta da empresa B')
  ok((await acharConta(cpf, 1))?.id === cA.id, 'login pelo portal da unidade 1 acha a conta dela')
  ok((await acharConta(cpf))?.id === cA.id, 'sem portal: primeira conta (como antes)')

  // 6) matrícula pela equipe
  const dono = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true }, select: { id: true, role: true } })
  const fB = await fichaParaMatricula({ nome: 'Caio', whatsapp: '5511900000004', cpf }, { userId: dono!.id, role: String(dono!.role) }, portalB.id)
  ok(fB.tipo === 'ficha' && fB.lead.id === leadB3.id, `equipe no portal B usa a ficha da empresa B (${fB.tipo})`)
  const fA = await fichaParaMatricula({ nome: 'Caio', whatsapp: '5511900000004', cpf }, { userId: dono!.id, role: String(dono!.role) }, 1)
  ok(fA.tipo === 'ficha' && fA.lead.id === leadA3.id, `equipe no portal 1 usa a ficha da unidade 1 (${fA.tipo})`)
  const fNovo = await fichaParaMatricula({ nome: 'Ana', whatsapp: '5511900000001' }, { userId: dono!.id, role: String(dono!.role) }, portalB.id)
  ok(fNovo.tipo === 'nenhuma', `ficha sem empresa não vai para a empresa B com número próprio (${fNovo.tipo})`)

  // 7) CAPI
  const r = await sendCapiEvent({ leadId: leadB.id, eventName: 'Purchase', funnelStage: 'teste' } as any)
  ok(!r.success && /Empresa da pessoa/.test(r.error || ''), `CAPI não envia pela empresa B (${r.error})`)

  // 7b) filtro "Empresa (unidade)" dos fluxos
  const { matchesTriggerConfig, unidadeDoEvento } = await import('../src/services/workflowEngine.js')
  const regB = await prisma.enrollmentRegistration.findFirst({ where: { leadId: leadB.id }, select: { id: true } })
  const evB: any = { type: 'enrollment.payment_confirmed', leadId: leadB.id, payload: { enrollmentId: regB!.id }, timestamp: new Date() }
  evB.__unitId = await unidadeDoEvento(evB)
  ok(evB.__unitId === unitB.id, 'evento da inscrição B é da unidade B')
  ok(!matchesTriggerConfig({ unitIds: [1] }, evB), 'fluxo só da unidade 1 NÃO dispara para a empresa B')
  ok(matchesTriggerConfig({ unitIds: [unitB.id] }, evB), 'fluxo da empresa B dispara')
  ok(matchesTriggerConfig({}, evB), 'fluxo sem filtro dispara (como antes)')

  // 7c) pixel e token próprios da empresa (sem enviar nada à Meta)
  const { identidadeParaGravar, identidadeParaTela, capiDoLead, esquecerIdentidade: esq } = await import('../src/lib/identidadeDaUnidade.js')
  const gravada = await identidadeParaGravar({ marca: 'Empresa B', capiPixelId: '254568664290421', capiToken: 'TOKEN-DE-TESTE-123456789012345' }, null)
  ok(!!gravada?.capiTokenCifrado && !JSON.stringify(gravada).includes('TOKEN-DE-TESTE'), 'token gravado só cifrado')
  const tela = identidadeParaTela(gravada)
  ok(tela?.capiTokenSalvo === true && !JSON.stringify(tela).includes(gravada!.capiTokenCifrado!), 'tela recebe só "token salvo", nunca o token')
  const mantida = await identidadeParaGravar({ ...tela, capiToken: '' }, gravada)
  ok(mantida?.capiTokenCifrado === gravada?.capiTokenCifrado, 'salvar sem digitar o token mantém o salvo')
  await prisma.educationalUnit.update({ where: { id: unitB.id }, data: { identidade: gravada as any } }); esq()
  const cfgB = await capiDoLead(leadB.id)
  ok(cfgB?.pixelId === '254568664290421' && cfgB.accessToken === 'TOKEN-DE-TESTE-123456789012345' && !cfgB.desligado, 'pessoa da empresa B usa o pixel e o token dela')
  ok((await capiDoLead(leadA.id)) === null, 'pessoa sem empresa usa o pixel geral')
  const limpa = await identidadeParaGravar({ ...tela, capiTokenLimpar: true }, gravada)
  ok(!limpa?.capiTokenCifrado, 'apagar o token funciona')

  // 7d) lead do formulário (sem conversa nem inscrição) é da empresa pelo funil
  const funilB = await prisma.funnel.findFirst({ select: { id: true }, orderBy: { id: 'desc' } })
  await prisma.educationalUnit.update({ where: { id: unitB.id }, data: { identidade: { ...(gravada as any), funis: [funilB!.id] } } }); esq()
  const leadForm = await prisma.lead.create({ data: { nome: 'test:Form', empresa: '', whatsapp: '5511900000009', email: '', formData: {}, scores: {}, funnelId: funilB!.id } })
  criados.leads.push(leadForm.id)
  ok((await unidadeDoLead(leadForm.id)) === unitB.id, 'lead de formulário no funil da empresa B é da empresa B')
  ok((await unidadeDoLead(leadA.id)) === null, 'lead sem funil da empresa continua sem empresa')

  // 8) Asaas da secretaria = primeira conta
  const { getAsaasConfig } = await import('../src/services/acaFinanceiro.js')
  const primeira = await prisma.paymentProviderConnection.findFirst({ where: { provider: 'asaas', active: true }, orderBy: { id: 'asc' }, select: { id: true } })
  ok(!!(await getAsaasConfig()) === !!primeira, 'getAsaasConfig responde com a primeira conta ativa')
} finally {
  await prisma.portalAccount.deleteMany({ where: { leadId: { in: criados.leads } } })
  await prisma.enrollmentRegistration.deleteMany({ where: { leadId: { in: criados.leads } } })
  await prisma.lead.deleteMany({ where: { id: { in: criados.leads } } })
  await prisma.enrollmentPortal.deleteMany({ where: { id: { in: criados.portals } } })
  await prisma.educationalUnit.deleteMany({ where: { id: { in: criados.units } } })
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK', '— dados de teste apagados')
  await prisma.$disconnect()
}
process.exit(falhas ? 1 : 0)
