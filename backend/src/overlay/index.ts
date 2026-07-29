import type { FastifyInstance } from 'fastify'
import { acaAlunoRoutes } from '../routes/acaAluno.js'
import { acaCatalogoRoutes } from '../routes/acaCatalogo.js'
import { acaInscricaoRoutes } from '../routes/acaInscricao.js'
import { acaMatriculaRoutes } from '../routes/acaMatricula.js'
import { acaMovimentacaoRoutes } from '../routes/acaMovimentacao.js'
import { acaEadRoutes } from '../routes/acaEad.js'
import { acaAcessoRoutes } from '../routes/acaAcesso.js'
import { acaCadastrosRoutes } from '../routes/acaCadastros.js'
import { acaGedRoutes } from '../routes/acaGed.js'
import { acaTccRoutes } from '../routes/acaTcc.js'
import { acaCensoRoutes } from '../routes/acaCenso.js'
import { acaAlocacaoRoutes } from '../routes/acaAlocacao.js'
import { acaDocenteRoutes } from '../routes/acaDocente.js'
import { acaVestibularRoutes } from '../routes/acaVestibular.js'
import { acaCurriculoRoutes } from '../routes/acaCurriculo.js'
import { acaFundacaoRoutes } from '../routes/acaFundacao.js'
import { acaAvaliacaoEsquemaRoutes } from '../routes/acaAvaliacaoEsquema.js'
import { acaEquivalenciaRoutes } from '../routes/acaEquivalencia.js'
import { acaRegimeEspecialRoutes } from '../routes/acaRegimeEspecial.js'
import { acaAcordoPortalRoutes } from '../routes/acaAcordoPortal.js'
import { acaPortalPwaRoutes } from '../routes/acaPortalPwa.js'
import { acaRegulatorioRoutes } from '../routes/acaRegulatorio.js'
import { acaInteligenciaRoutes } from '../routes/acaInteligencia.js'
import { acaImportacaoRoutes } from '../routes/acaImportacao.js'
import { acaProvaRoutes } from '../routes/acaProva.js'
import { twoFactorRoutes } from '../routes/twoFactor.js'
import { acaPortalLoginRoutes } from '../routes/acaPortalLogin.js'
import { acaAcordoPaginaRoutes } from '../routes/acaAcordoPagina.js'
import { acaFinanceiroRoutes } from '../routes/acaFinanceiro.js'
import { acaFinBancoRoutes } from '../routes/acaFinBanco.js'
import { acaCobrancaFiscalRoutes } from '../routes/acaCobrancaFiscal.js'
import { acaDiarioRoutes } from '../routes/acaDiario.js'
import { acaNotaRoutes } from '../routes/acaNota.js'
import { acaFechamentoRoutes } from '../routes/acaFechamento.js'
import { acaSecretariaRoutes } from '../routes/acaSecretaria.js'
import { acaPortalRoutes } from '../routes/acaPortal.js'
import { acaPortalPlusRoutes } from '../routes/acaPortalPlus.js'
import { acaDiplomaRoutes } from '../routes/acaDiploma.js'
import { acaAvaliacaoInstRoutes } from '../routes/acaAvaliacaoInst.js'
import { acaComunicacaoRoutes } from '../routes/acaComunicacao.js'
import { acaBiRoutes } from '../routes/acaBi.js'
import { acaFinanceiroCentralRoutes } from '../routes/acaFinanceiroCentral.js'
import { acaRenegociacaoRoutes } from '../routes/acaRenegociacao.js'
import { acaFiscalRoutes } from '../routes/acaFiscal.js'
import { acaRequerimentoRoutes } from '../routes/acaRequerimento.js'
import { acaCalendarioRoutes } from '../routes/acaCalendario.js'
import { acaHorarioRoutes } from '../routes/acaHorario.js'
import { acaMaterialRoutes } from '../routes/acaMaterial.js'
import { acaEstagioRoutes } from '../routes/acaEstagio.js'
import { acaSistecRoutes } from '../routes/acaSistec.js'
import { acaAssinaturaRoutes } from '../routes/acaAssinatura.js'

// Overlay do tenant INEPROTEC — ERP acadêmico nativo (módulos aca*). Registrado
// pelo hook de overlay em server.ts (idêntico ao core). Mantém o ERP fora do
// server.ts do núcleo compartilhado.
export async function registerOverlay(app: FastifyInstance): Promise<void> {
  await app.register(acaAlunoRoutes)
  await app.register(acaCatalogoRoutes)
  await app.register(acaInscricaoRoutes)
  await app.register(acaMatriculaRoutes)
  await app.register(acaMovimentacaoRoutes)
  await app.register(acaEadRoutes)
  await app.register(acaAcessoRoutes)
  await app.register(acaCadastrosRoutes)
  await app.register(acaGedRoutes)
  await app.register(acaTccRoutes)
  await app.register(acaCensoRoutes)
  await app.register(acaAlocacaoRoutes)
  await app.register(acaDocenteRoutes)
  await app.register(acaVestibularRoutes)
  await app.register(acaCurriculoRoutes)
  await app.register(acaFundacaoRoutes)
  await app.register(acaAvaliacaoEsquemaRoutes)
  await app.register(acaEquivalenciaRoutes)
  await app.register(acaRegimeEspecialRoutes)
  await app.register(acaAcordoPortalRoutes)
  await app.register(acaPortalPwaRoutes)
  await app.register(acaRegulatorioRoutes)
  await app.register(acaInteligenciaRoutes)
  await app.register(acaImportacaoRoutes)
  await app.register(acaProvaRoutes)
  await app.register(twoFactorRoutes)
  await app.register(acaPortalLoginRoutes)
  await app.register(acaAcordoPaginaRoutes)
  await app.register(acaFinanceiroRoutes)
  await app.register(acaFinBancoRoutes)
  await app.register(acaCobrancaFiscalRoutes)
  await app.register(acaDiarioRoutes)
  await app.register(acaNotaRoutes)
  await app.register(acaFechamentoRoutes)
  await app.register(acaSecretariaRoutes)
  await app.register(acaPortalRoutes)
  await app.register(acaPortalPlusRoutes)
  await app.register(acaDiplomaRoutes)
  await app.register(acaAvaliacaoInstRoutes)
  await app.register(acaComunicacaoRoutes)
  await app.register(acaBiRoutes)
  await app.register(acaFinanceiroCentralRoutes)
  await app.register(acaRenegociacaoRoutes)
  await app.register(acaFiscalRoutes)
  await app.register(acaRequerimentoRoutes)
  await app.register(acaCalendarioRoutes)
  await app.register(acaHorarioRoutes)
  await app.register(acaMaterialRoutes)
  await app.register(acaEstagioRoutes)
  await app.register(acaSistecRoutes)
  await app.register(acaAssinaturaRoutes)
  // Scheduler de comunicação acadêmica (avisos de vencimento/notas).
  import('../services/acaComunicacao.js')
    .then(m => m.startAcaComunicacaoScheduler())
    .catch(err => console.warn('[acaComunicacao] init falhou:', err?.message || err))
}
