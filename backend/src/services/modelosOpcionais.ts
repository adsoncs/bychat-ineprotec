// src/services/modelosOpcionais.ts
//
// Modelos de texto (Modelos › Automático do sistema) de módulos OPT-IN.
//
// Os módulos que nasceram numa única instalação — fluxo de atendimento do
// chatbot roteirizado, coleta de currículo, aviso de fila, aviso à equipe por
// HSM, pedido de confirmação de reunião por texto — registravam os modelos ao
// serem importados. No código comum isso criaria dezenas de registros em TODA
// instalação, inclusive nas que nunca ligaram nada disso. Aqui o registro só
// acontece quando a configuração que usa o modelo existe.
//
// Por que não basta o banco: os textos lidos de forma síncrona
// (`modeloCruEmMemoria`) só são carregados para chaves registradas no catálogo.
// Uma instalação que já tem as linhas no banco (o terram) precisa do registro
// para que a leitura em memória as enxergue.
//
// Roda na subida do servidor, a cada 10 min e logo depois de salvar um chatbot.
// Tudo idempotente: registrar de novo não duplica nada.

import { prisma } from '../lib/prisma.js'
import { recarregarModelosEmMemoria, registrarModelosPadrao } from './modelosDoSistema.js'

export async function ativarModelosOpcionais(): Promise<void> {
  try {
    const bots = await prisma.chatbot.findMany({
      where: { mode: 'scripted' },
      select: { scriptedConfig: true },
    })
    const cfgs = bots.map((b) => (b.scriptedConfig as any) || null).filter((c) => c && typeof c === 'object')
    const atendimento = cfgs.some((c) => !!c.supportFlow)
    const rh = cfgs.some((c) => !!c.supportFlow && !!c.hrIntake?.enabled)

    let registrou = false
    if (atendimento) {
      const { registrarModelosDoAtendimento } = await import('./scriptedSupportFlow.js')
      const { registrarModelosDaFila } = await import('./alertaFilaEquipe.js')
      registrarModelosDoAtendimento()
      registrarModelosDaFila()
      registrou = true
    }
    if (rh) {
      const { registrarModelosDoRh } = await import('./hrResumeIntake.js')
      registrarModelosDoRh()
      registrou = true
    }

    // Valor que entra num campo do HSM de aviso à equipe quando o lead não tem
    // o dado — só existe onde esse HSM foi configurado.
    const { configDoRoteador } = await import('./outboundRouter.js')
    if ((await configDoRoteador()).hsmAvisoEquipe || atendimento) {
      registrarModelosPadrao([{
        key: 'aviso_equipe_hsm_sem_dado', name: 'Aviso à equipe — texto no modelo da Meta quando falta um dado', channel: 'texto', body: '(não informado)',
      }])
      registrou = true
    }

    const { confirmacaoPorTextoLigada, registrarModelosDaConfirmacaoPorTexto } = await import('./schedulingNotify.js')
    if (await confirmacaoPorTextoLigada()) {
      registrarModelosDaConfirmacaoPorTexto()
      registrou = true
    }

    if (registrou) await recarregarModelosEmMemoria()
  } catch (e: any) {
    console.warn('[modelosOpcionais] falha ao ativar modelos opcionais:', e?.message || e)
  }
}

let handle: ReturnType<typeof setInterval> | null = null

export function startModelosOpcionais(): void {
  void ativarModelosOpcionais()
  if (!handle) handle = setInterval(() => { void ativarModelosOpcionais() }, 10 * 60_000)
  handle.unref?.()
}
