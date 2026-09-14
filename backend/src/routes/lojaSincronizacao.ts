// src/routes/lojaSincronizacao.ts
//
// A loja central diz a este tenant o que o cliente tem direito de usar.
//
// O pedido carrega o ESTADO DESEJADO, não um comando: "estes são os pacotes
// contratados e esta é a data até quando valem". O tenant converge para isso —
// concede o que falta, empurra a data do que já tem, revoga o que saiu.
//
// Por que estado e não evento: webhook se perde. Com "renovar +1 mês", um
// pedido perdido deixa o cliente um mês atrasado para sempre e ninguém percebe.
// Com estado, o pedido seguinte corrige sozinho, e repetir o mesmo pedido duas
// vezes não cobra nem concede nada em dobro.
//
// ⚠️ Não confunde com o painel do dono (`donoAssinatura.ts`): lá é gente
// decidindo pela tela, aqui é servidor falando com servidor, autenticado por
// HMAC. Ver lib/lojaAssinatura.ts.

import type { FastifyInstance } from 'fastify'
import { conferirAssinatura } from '../lib/lojaAssinatura.js'
import { prisma } from '../lib/prisma.js'
import {
  UMBRELLA_ORDER, UMBRELLA_LABELS, type ModuleUmbrella,
} from '../lib/moduleRegistry.js'
import {
  concederPacote, revogarPacote, pacotesDisponiveis, modulosDoPacote,
  estadoDoPacote, PacoteIndisponivelError, invalidarCacheDeDireitos,
  modulosComDireito, carenciaDias, testeDias,
} from '../services/moduleEntitlements.js'
import { listModulesWithStatus } from '../lib/moduleManager.js'

function ehPacote(v: unknown): v is ModuleUmbrella {
  return typeof v === 'string' && (UMBRELLA_ORDER as string[]).includes(v)
}

export async function lojaSincronizacaoRoutes(app: FastifyInstance) {
  // O corpo cru é necessário para conferir a assinatura: reserializar o JSON
  // reordenaria chaves e a conta não fecharia.
  app.addHook('preParsing', async (req, _reply, payload) => {
    if (!req.url.startsWith('/api/loja/')) return payload
    const pedacos: Buffer[] = []
    for await (const p of payload) pedacos.push(Buffer.from(p))
    const cru = Buffer.concat(pedacos)
    ;(req as unknown as { corpoCru?: string }).corpoCru = cru.toString('utf8')
    const { Readable } = await import('node:stream')
    return Readable.from(cru)
  })

  /**
   * Estado da assinatura, para a loja conferir o que este tenant entende.
   *
   * Serve para a loja detectar divergência sem depender da própria memória —
   * é a pergunta "o que você acha que tem?", que é como se descobre webhook
   * perdido antes do cliente descobrir.
   */
  app.get('/api/loja/estado', async (req, reply) => {
    const erro = autenticar(req, reply, '')
    if (erro) return erro
    const disponiveis = pacotesDisponiveis()
    const pacotes = await Promise.all(
      disponiveis.map(async (p) => {
        const st = await estadoDoPacote(p)
        return {
          id: p, rotulo: UMBRELLA_LABELS[p],
          modulos: modulosDoPacote(p).length,
          estado: st.estado, expiraEm: st.expiraEm,
        }
      }),
    )
    return { instalados: disponiveis, pacotes }
  })

  /**
   * O retrato COMPLETO desta instalação.
   *
   * A loja precisa espelhar o tenant, não guardar um cadastro paralelo: o que
   * está ativo, quem ligou, quantos módulos existem, quanto se usa. Sem isto, a
   * loja mostraria o que alguém digitou nela um dia, e não o que a instalação é
   * hoje — e as duas verdades divergiriam em silêncio.
   *
   * Inclui o que o DONO ligou pela tela de Módulos: o interruptor do
   * administrador é tão parte do retrato quanto o direito de uso, e é a
   * diferença entre "não pagou" e "pagou e está desligado".
   */
  app.get('/api/loja/inventario', async (req, reply) => {
    const erro = autenticar(req, reply, '')
    if (erro) return erro

    const modulos = await listModulesWithStatus()
    const comDireito = await modulosComDireito()
    const disponiveis = pacotesDisponiveis()

    // ⚠️ `enabled` de `listModulesWithStatus` é direito E interruptor JUNTOS
    // (ver isModuleEnabled). Para a loja distinguir "não pagou" de "pagou e
    // desligou", o interruptor do dono precisa vir puro — e ele mora em
    // `bychat_modules.active`.
    const interruptor = new Map<string, boolean>()
    for (const m of await prisma.module.findMany({ select: { id: true, active: true } })) {
      interruptor.set(m.id, m.active)
    }
    // Módulo sem linha na tabela nunca foi tocado: vale o padrão do registro.
    const ligadoPeloDono = (m: { id: string; core?: boolean; defaultEnabled?: boolean }) =>
      m.core ? true : (interruptor.get(m.id) ?? m.defaultEnabled === true)

    const pacotes = await Promise.all(
      UMBRELLA_ORDER.map(async (p) => {
        const doPacote = modulos.filter((m) => m.umbrella === p)
        const st = disponiveis.includes(p)
          ? await estadoDoPacote(p)
          : { estado: 'nao_instalado' as const, expiraEm: null, diasRestantes: null }
        return {
          id: p,
          rotulo: UMBRELLA_LABELS[p],
          instalado: disponiveis.includes(p),
          modulos: doPacote.length,
          // Três contagens diferentes de propósito: um módulo pode existir, ter
          // direito e ainda assim estar desligado pelo dono.
          vendaveis: doPacote.filter((m) => !m.core).length,
          ligados: doPacote.filter((m) => ligadoPeloDono(m)).length,
          comDireito: doPacote.filter((m) => comDireito.has(m.id)).length,
          // Quantos realmente abrem: precisa dos dois.
          emUso: doPacote.filter((m) => m.enabled).length,
          estado: st.estado,
          expiraEm: st.expiraEm,
          diasRestantes: 'diasRestantes' in st ? st.diasRestantes : null,
        }
      }),
    )

    // Números de uso: é o que diz se a instalação está viva e se o preço faz
    // sentido. Tolera ausência de tabela — tenant sem um módulo não tem a
    // tabela dele, e isso não pode derrubar o inventário inteiro.
    const uso = {
      usuarios: await prisma.user.count().catch(() => null),
      usuariosAtivos: await prisma.user.count({ where: { active: true } }).catch(() => null),
      leads: await prisma.lead.count().catch(() => null),
      leads30d: await prisma.lead.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
      }).catch(() => null),
    }

    return {
      instalacao: {
        appUrl: process.env.APP_URL ?? null,
        node: process.version,
        em: new Date().toISOString(),
      },
      modulos: modulos.map((m) => ({
        id: m.id,
        nome: m.name,
        umbrella: m.umbrella,
        cobranca: m.cobranca,
        core: Boolean(m.core),
        // Três estados, e os três são diferentes:
        //   ligado     — o interruptor do dono na tela de Módulos
        //   comDireito — a contratação
        //   emUso      — o módulo realmente abre (precisa dos dois)
        // Sem separá-los, "pagou e desligou" e "não pagou" viram a mesma linha.
        ligado: ligadoPeloDono(m),
        comDireito: comDireito.has(m.id),
        emUso: m.enabled,
      })),
      pacotes,
      uso,
      assinatura: {
        carenciaDias: await carenciaDias(),
        testeDias: await testeDias(),
        ultimosEventos: await prisma.assinaturaEvento.findMany({
          orderBy: { id: 'desc' }, take: 10,
          select: { tipo: true, pacote: true, competencia: true, valorCentavos: true, feitoPor: true, createdAt: true },
        }).catch(() => []),
      },
    }
  })

  /**
   * Aplica o estado desejado.
   *
   * `pacotes` é a lista COMPLETA do que o cliente tem direito. O que não está
   * nela é revogado — é isso que faz um downgrade funcionar sem comando próprio.
   */
  app.post('/api/loja/assinatura', async (req, reply) => {
    const cru = (req as unknown as { corpoCru?: string }).corpoCru ?? ''
    const erro = autenticar(req, reply, cru)
    if (erro) return erro

    const b = req.body as { pacotes?: unknown; vigenteAte?: unknown; referencia?: unknown }
    if (!Array.isArray(b.pacotes) || !b.pacotes.every(ehPacote)) {
      return reply.code(400).send({ error: 'pacotes deve ser uma lista de guarda-chuvas válidos' })
    }
    const pedidos = b.pacotes as ModuleUmbrella[]

    // `null` = sem prazo (cortesia, contrato sem vencimento). Data inválida é
    // recusada: gravar "Invalid Date" tiraria o acesso de um cliente pagante.
    let vigenteAte: Date | null = null
    if (b.vigenteAte !== null && b.vigenteAte !== undefined) {
      if (typeof b.vigenteAte !== 'string') {
        return reply.code(400).send({ error: 'vigenteAte deve ser uma data ISO ou null' })
      }
      vigenteAte = new Date(b.vigenteAte)
      if (Number.isNaN(vigenteAte.getTime())) {
        return reply.code(400).send({ error: 'vigenteAte inválida' })
      }
    }
    const referencia = typeof b.referencia === 'string' ? b.referencia.slice(0, 190) : 'loja'

    // Vender o que a instalação não roda grava zero direitos e devolve sucesso.
    // Melhor a loja saber disso agora do que o cliente descobrir na segunda.
    const indisponiveis = pedidos.filter((p) => !pacotesDisponiveis().includes(p))
    if (indisponiveis.length) {
      return reply.code(409).send({
        error: `Esta instalação não roda: ${indisponiveis.join(', ')}`,
        indisponiveis,
      })
    }

    const concedidos: string[] = []
    try {
      for (const p of pedidos) {
        const r = await concederPacote({
          pacote: p, expiraEm: vigenteAte, referencia, concedidoPor: 'loja',
        })
        concedidos.push(...r.concedidos)
      }
    } catch (e) {
      if (e instanceof PacoteIndisponivelError) return reply.code(409).send({ error: e.message })
      throw e
    }

    // O que saiu do contrato perde o direito de PACOTE. Cortesia e migração são
    // outras origens e não caem junto — cancelar o contrato não pode apagar um
    // módulo que foi dado à parte.
    const revogados: string[] = []
    for (const p of pacotesDisponiveis()) {
      if (pedidos.includes(p)) continue
      const n = await revogarPacote(p)
      if (n > 0) revogados.push(p)
    }

    invalidarCacheDeDireitos()
    await prisma.assinaturaEvento.create({
      data: {
        tipo: 'renovado',
        vencimentoNovo: vigenteAte,
        observacao: `Loja: ${pedidos.join(', ') || 'nenhum pacote'}`,
        feitoPor: 'loja',
      },
    }).catch(() => {})

    return { ok: true, concedidos: concedidos.length, revogados, vigenteAte }
  })
}

/**
 * Devolve a resposta de recusa, ou nada quando o pedido é legítimo.
 *
 * Sem segredo configurado a rota responde 404, como as do dono: uma instalação
 * que ainda não foi ligada à loja não deve nem revelar que a porta existe.
 */
function autenticar(req: unknown, reply: unknown, corpoCru: string) {
  const r = req as { headers: Record<string, string | undefined> }
  const res = reply as { code: (n: number) => { send: (o: unknown) => unknown } }
  const conferido = conferirAssinatura({
    corpoCru,
    assinatura: r.headers['x-loja-assinatura'],
    timestamp: r.headers['x-loja-timestamp'],
    segredo: process.env.LOJA_SEGREDO,
  })
  if (conferido.ok) return null
  if (conferido.motivo === 'sem_segredo') return res.code(404).send({ error: 'Não encontrado' })
  // As demais recusas não distinguem o motivo para quem chama: dizer "fora da
  // janela" versus "assinatura inválida" ajuda quem está tentando adivinhar.
  return res.code(401).send({ error: 'Não autorizado' })
}
