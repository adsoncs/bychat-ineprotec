// src/services/clinicaExperts/config.ts
//
// Configuração da integração, guardada em `Setting` (mesmo padrão do Kommo:
// chave prefixada, valor JSON). Nada em .env — a clínica troca o token pela
// tela, e reiniciar o processo por causa disso seria absurdo.

import { prisma } from '../../lib/prisma.js'

const CHAVE = 'clinica_experts.config'

export interface ClinicaExpertsConfig {
  /** Bearer token gerado na aba Integrações da plataforma da clínica. */
  token: string
  /** Liga/desliga o espelho sem apagar a configuração. */
  ativo: boolean
  /**
   * De qual profissional da clínica vem a agenda de cada tipo de reunião.
   * Chave = MeetingType.id, valor = uuid do profissional lá.
   *
   * Continua valendo para o tipo simples (um profissional fixo). Quando o tipo
   * tem `linhas` configuradas, quem manda é a linha — ver abaixo.
   */
  profissionalPorTipo: Record<string, string>
  /**
   * Quem é quem: usuário daqui ↔ profissional da clínica.
   * Chave = User.id, valor = uuid do profissional lá.
   *
   * É a peça que permite o paciente escolher COM QUEM se atender: a agenda
   * mostrada é a do usuário daqui, e o agendamento é criado no profissional
   * correspondente lá. Sem este vínculo, escolher profissional não tem como
   * funcionar — os dois cadastros não têm nenhuma chave em comum (a clínica
   * devolve id numérico nos procedimentos e uuid nos profissionais, e o id
   * numérico não aparece em lugar nenhum da listagem).
   */
  profissionalPorUsuario: Record<string, string>
  /**
   * Linha de serviço de cada tipo de agendamento: o que ele oferece e quem
   * atende. Chave = MeetingType.id.
   *
   * Um tipo com linha configurada passa a perguntar ao paciente o procedimento
   * e o profissional antes do horário. Sem linha, o tipo segue exatamente como
   * antes — é isso que mantém o comportamento atual intacto.
   */
  linhas: Record<string, LinhaDeServico>
  /** Procedimento padrão lançado no agendamento (id inteiro da clínica). */
  procedimentoPadraoId: number | null
  /** Sala padrão, quando a clínica usa salas. */
  salaPadraoId: number | null
  /**
   * Trazer os agendamentos feitos DIRETO na clínica como bloqueio de agenda,
   * para o motor de slots daqui não oferecer horário que lá já está ocupado.
   * É o contrapeso de o bychat ser quem decide os horários.
   */
  importarOcupacao: boolean
  /** Quantos dias à frente a importação de ocupação varre. */
  diasDeOcupacao: number
  /**
   * Segredo que vai na URL do webhook. A API deles não assina os avisos, então
   * é isto que separa um aviso da clínica de qualquer um batendo na rota.
   */
  webhookSegredo: string
  /** Quantos payloads já foram registrados por inteiro (o formato não é
   *  documentado; as primeiras amostras é que revelam a forma real). */
  webhookAmostrasVistas: number
}

/** O que uma linha de serviço oferece. */
export interface LinhaDeServico {
  /** Procedimentos da clínica que este tipo oferece (id inteiro de lá). */
  procedimentos: number[]
  /**
   * Usuários daqui que atendem esta linha (User.id). O profissional da clínica
   * sai do `profissionalPorUsuario` — assim a agenda consultada e o destino do
   * agendamento são sempre a mesma pessoa.
   */
  usuarios: number[]
  /** O paciente pode escolher o profissional, ou só "sem preferência"? */
  deixarEscolherProfissional: boolean
}

const PADRAO: ClinicaExpertsConfig = {
  token: '',
  ativo: false,
  profissionalPorTipo: {},
  profissionalPorUsuario: {},
  linhas: {},
  procedimentoPadraoId: null,
  salaPadraoId: null,
  importarOcupacao: true,
  diasDeOcupacao: 30,
  webhookSegredo: '',
  webhookAmostrasVistas: 0,
}

export async function getConfig(): Promise<ClinicaExpertsConfig> {
  const row = await prisma.setting.findUnique({ where: { key: CHAVE } }).catch(() => null)
  const v = (row?.value ?? {}) as Partial<ClinicaExpertsConfig>
  return {
    ...PADRAO,
    ...v,
    // O JSON do banco pode vir com o campo faltando ou nulo depois de uma
    // gravação parcial pela tela; normalizar aqui evita `undefined.x` lá.
    profissionalPorTipo: v.profissionalPorTipo ?? {},
    profissionalPorUsuario: v.profissionalPorUsuario ?? {},
    linhas: v.linhas ?? {},
  }
}

export async function salvarConfig(parcial: Partial<ClinicaExpertsConfig>): Promise<ClinicaExpertsConfig> {
  const atual = await getConfig()
  const novo: ClinicaExpertsConfig = { ...atual, ...parcial }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: {
      key: CHAVE,
      value: novo as never,
      label: 'Clinica Experts',
      grp: 'integracoes',
      fieldType: 'json',
    },
    update: { value: novo as never },
  })
  return novo
}

/** A integração está pronta para uso? Usado antes de qualquer espelho. */
export async function integracaoAtiva(): Promise<boolean> {
  const cfg = await getConfig()
  return !!(cfg.ativo && cfg.token)
}
