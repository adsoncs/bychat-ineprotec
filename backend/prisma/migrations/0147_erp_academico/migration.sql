-- AlterTable
ALTER TABLE `bychat_edu_units` ADD COLUMN `codigoEmecEndereco` VARCHAR(20) NULL,
    ADD COLUMN `enderecoJson` JSON NULL,
    ADD COLUMN `iesId` INTEGER NULL,
    ADD COLUMN `tipoUnidade` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `bychat_edu_courses` ADD COLUMN `areaCine` VARCHAR(120) NULL,
    ADD COLUMN `certificacaoIntermediaria` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `codigoCnct` VARCHAR(20) NULL,
    ADD COLUMN `codigoEmec` VARCHAR(20) NULL,
    ADD COLUMN `duracaoMaxPeriodos` INTEGER NULL,
    ADD COLUMN `duracaoMinPeriodos` INTEGER NULL,
    ADD COLUMN `eixoTecnologico` VARCHAR(80) NULL,
    ADD COLUMN `grau` VARCHAR(30) NULL,
    ADD COLUMN `modalidade` VARCHAR(20) NULL,
    ADD COLUMN `perfilConclusao` TEXT NULL,
    ADD COLUMN `regimeAcademico` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `bychat_edu_entry_modes` ADD COLUMN `censoForma` VARCHAR(30) NULL,
    ADD COLUMN `criterioClassificacao` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `bychat_aca_alunos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `ra` VARCHAR(30) NULL,
    `cpf` VARCHAR(20) NULL,
    `portalSenhaHash` VARCHAR(255) NULL,
    `portalSenhaDefinidaEm` DATETIME(3) NULL,
    `portalUltimoLoginEm` DATETIME(3) NULL,
    `portalTentativas` INTEGER NOT NULL DEFAULT 0,
    `portalBloqueadoAte` DATETIME(3) NULL,
    `dataNascimento` DATETIME(3) NULL,
    `sexo` VARCHAR(12) NULL,
    `nomeSocial` VARCHAR(191) NULL,
    `fotoUrl` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `documentosJson` JSON NULL,
    `socioEconomicoJson` JSON NULL,
    `roadmapJson` JSON NULL,
    `rg` VARCHAR(30) NULL,
    `rgOrgaoEmissor` VARCHAR(40) NULL,
    `racaCor` VARCHAR(40) NULL,
    `nacionalidade` VARCHAR(60) NULL,
    `naturalidade` VARCHAR(120) NULL,
    `estadoCivil` VARCHAR(40) NULL,
    `religiao` VARCHAR(60) NULL,
    `nomePai` VARCHAR(191) NULL,
    `nomeMae` VARCHAR(191) NULL,
    `codigoInep` VARCHAR(30) NULL,
    `emancipado` BOOLEAN NOT NULL DEFAULT false,
    `enderecoJson` JSON NULL,
    `codigoGdae` VARCHAR(30) NULL,
    `enemAno` INTEGER NULL,
    `enemInscricao` VARCHAR(30) NULL,
    `enemNota` DOUBLE NULL,
    `podeSairSozinho` BOOLEAN NOT NULL DEFAULT true,
    `pessoasAutorizadasJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_alunos_leadId_key`(`leadId`),
    UNIQUE INDEX `bychat_aca_alunos_ra_key`(`ra`),
    INDEX `bychat_aca_alunos_cpf_idx`(`cpf`),
    INDEX `bychat_aca_alunos_ra_idx`(`ra`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_mantenedoras` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `razaoSocial` VARCHAR(191) NOT NULL,
    `nomeFantasia` VARCHAR(191) NULL,
    `cnpj` VARCHAR(20) NULL,
    `repNome` VARCHAR(191) NULL,
    `repCpf` VARCHAR(20) NULL,
    `repCargo` VARCHAR(80) NULL,
    `enderecoJson` JSON NULL,
    `telefone` VARCHAR(30) NULL,
    `email` VARCHAR(191) NULL,
    `logoUrl` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_mantenedoras_cnpj_idx`(`cnpj`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mantenedoraId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `sigla` VARCHAR(30) NULL,
    `codigoEmec` VARCHAR(20) NULL,
    `categoriaAdmin` VARCHAR(40) NULL,
    `organizacaoAcad` VARCHAR(40) NULL,
    `enderecoJson` JSON NULL,
    `dirigenteNome` VARCHAR(191) NULL,
    `dirigenteCpf` VARCHAR(20) NULL,
    `dirigenteEmail` VARCHAR(191) NULL,
    `piNome` VARCHAR(191) NULL,
    `piCpf` VARCHAR(20) NULL,
    `piEmail` VARCHAR(191) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_ies_mantenedoraId_idx`(`mantenedoraId`),
    INDEX `bychat_aca_ies_codigoEmec_idx`(`codigoEmec`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_atos_autorizativos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `escopo` ENUM('IES', 'CURSO') NOT NULL,
    `entidadeId` INTEGER NOT NULL,
    `tipo` VARCHAR(40) NOT NULL,
    `numero` VARCHAR(40) NULL,
    `dataPublicacao` DATETIME(3) NULL,
    `dataDou` DATETIME(3) NULL,
    `validadeAte` DATETIME(3) NULL,
    `observacao` TEXT NULL,
    `arquivoUrl` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_atos_autorizativos_escopo_entidadeId_idx`(`escopo`, `entidadeId`),
    INDEX `bychat_aca_atos_autorizativos_validadeAte_idx`(`validadeAte`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_vinculos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `courseId` INTEGER NOT NULL,
    `matrizId` INTEGER NULL,
    `unidadeId` INTEGER NULL,
    `ra` VARCHAR(30) NULL,
    `situacao` ENUM('PRE_MATRICULADO', 'ATIVO', 'INTEGRALIZANDO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'TRANSFERIDO_INTERNO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NOT NULL DEFAULT 'PRE_MATRICULADO',
    `formaIngresso` VARCHAR(40) NULL,
    `entryModeId` INTEGER NULL,
    `cursoOrigemId` INTEGER NULL,
    `criterioClassificacao` VARCHAR(30) NULL,
    `amparoUrl` TEXT NULL,
    `turno` ENUM('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL', 'EAD') NULL,
    `periodoAtual` INTEGER NULL,
    `dataIngresso` DATETIME(3) NULL,
    `dataConclusao` DATETIME(3) NULL,
    `sensivel` BOOLEAN NOT NULL DEFAULT false,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_vinculos_situacao_idx`(`situacao`),
    INDEX `bychat_aca_vinculos_courseId_idx`(`courseId`),
    INDEX `bychat_aca_vinculos_ra_idx`(`ra`),
    UNIQUE INDEX `bychat_aca_vinculos_alunoId_courseId_matrizId_key`(`alunoId`, `courseId`, `matrizId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_vinculo_movimentacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vinculoId` INTEGER NOT NULL,
    `de` ENUM('PRE_MATRICULADO', 'ATIVO', 'INTEGRALIZANDO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'TRANSFERIDO_INTERNO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NULL,
    `para` ENUM('PRE_MATRICULADO', 'ATIVO', 'INTEGRALIZANDO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'TRANSFERIDO_INTERNO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NOT NULL,
    `motivo` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `dataEfeito` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `documentoUrl` TEXT NULL,
    `userId` INTEGER NULL,
    `userName` VARCHAR(100) NULL,
    `estornoDeId` INTEGER NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_vinculo_movimentacoes_vinculoId_dataEfeito_idx`(`vinculoId`, `dataEfeito`),
    INDEX `bychat_aca_vinculo_movimentacoes_para_idx`(`para`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_esquemas_avaliacao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `escopo` ENUM('INSTITUCIONAL', 'CURSO', 'MATRIZ', 'DISCIPLINA') NOT NULL DEFAULT 'INSTITUCIONAL',
    `escopoId` INTEGER NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `escala` ENUM('NUMERICA_0_10', 'NUMERICA_0_100', 'CONCEITO') NOT NULL DEFAULT 'NUMERICA_0_10',
    `notaMinima` DOUBLE NOT NULL DEFAULT 0,
    `notaMaxima` DOUBLE NOT NULL DEFAULT 10,
    `casasDecimais` INTEGER NOT NULL DEFAULT 1,
    `arredondamento` ENUM('MATEMATICO', 'CIMA', 'BAIXO') NOT NULL DEFAULT 'MATEMATICO',
    `mapaConceitos` JSON NULL,
    `formulaMedia` VARCHAR(500) NULL,
    `mediaAprovacao` DOUBLE NOT NULL DEFAULT 6,
    `notaEliminatoria` DOUBLE NULL,
    `exameHabilitado` BOOLEAN NOT NULL DEFAULT false,
    `exameMinimo` DOUBLE NULL,
    `formulaFinal` VARCHAR(500) NULL,
    `mediaFinalAprovacao` DOUBLE NULL,
    `segundaChamadaHabilitada` BOOLEAN NOT NULL DEFAULT false,
    `avaliacaoPorCompetencia` BOOLEAN NOT NULL DEFAULT false,
    `frequenciaObrigatoria` BOOLEAN NOT NULL DEFAULT true,
    `frequenciaMinima` INTEGER NOT NULL DEFAULT 75,
    `limiteDependencias` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_esquemas_avaliacao_ativo_idx`(`ativo`),
    UNIQUE INDEX `bychat_aca_esquemas_avaliacao_escopo_escopoId_key`(`escopo`, `escopoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_esquema_componentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `esquemaId` INTEGER NOT NULL,
    `sigla` VARCHAR(12) NOT NULL,
    `nome` VARCHAR(100) NOT NULL,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `obrigatorio` BOOLEAN NOT NULL DEFAULT true,

    INDEX `bychat_aca_esquema_componentes_esquemaId_idx`(`esquemaId`),
    UNIQUE INDEX `bychat_aca_esquema_componentes_esquemaId_sigla_key`(`esquemaId`, `sigla`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_push_inscricoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ativa` BOOLEAN NOT NULL DEFAULT true,
    `ultimoErro` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_push_inscricoes_alunoId_ativa_idx`(`alunoId`, `ativa`),
    UNIQUE INDEX `bychat_aca_push_inscricoes_endpoint_key`(`endpoint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_regimes_especiais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `vinculoId` INTEGER NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `dataInicio` DATETIME(3) NOT NULL,
    `dataFim` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'SOLICITADO',
    `amparoLegal` VARCHAR(120) NULL,
    `atestadoUrl` TEXT NULL,
    `observacao` TEXT NULL,
    `planoAtividades` TEXT NULL,
    `deferidoPor` INTEGER NULL,
    `deferidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_regimes_especiais_alunoId_status_idx`(`alunoId`, `status`),
    INDEX `bychat_aca_regimes_especiais_dataInicio_dataFim_idx`(`dataInicio`, `dataFim`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_eliminacao_termos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` VARCHAR(40) NOT NULL,
    `dataTermo` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `comissao` TEXT NOT NULL,
    `responsavel` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `itensJson` JSON NULL,
    `qtdItens` INTEGER NOT NULL DEFAULT 0,
    `criadoPor` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_eliminacao_termos_numero_key`(`numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_enade_regularidade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `vinculoId` INTEGER NULL,
    `ano` INTEGER NOT NULL,
    `condicao` VARCHAR(14) NOT NULL,
    `situacao` VARCHAR(14) NOT NULL DEFAULT 'PENDENTE',
    `dispensaMotivo` TEXT NULL,
    `documentoUrl` TEXT NULL,
    `observacao` TEXT NULL,
    `registradoPor` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_enade_regularidade_situacao_idx`(`situacao`),
    UNIQUE INDEX `bychat_aca_enade_regularidade_alunoId_ano_condicao_key`(`alunoId`, `ano`, `condicao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_questoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `area` VARCHAR(60) NOT NULL,
    `enunciado` TEXT NOT NULL,
    `tipo` VARCHAR(14) NOT NULL DEFAULT 'OBJETIVA',
    `alternativas` JSON NULL,
    `gabarito` VARCHAR(4) NULL,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `rubricaJson` JSON NULL,
    `dificuldade` VARCHAR(10) NULL,
    `ativa` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_questoes_area_ativa_idx`(`area`, `ativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_provas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `processoId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `instrucoes` TEXT NULL,
    `inicioEm` DATETIME(3) NULL,
    `fimEm` DATETIME(3) NULL,
    `duracaoMinutos` INTEGER NOT NULL DEFAULT 120,
    `notaMaxima` DOUBLE NOT NULL DEFAULT 100,
    `publicada` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_provas_processoId_idx`(`processoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provaId` INTEGER NOT NULL,
    `questaoId` INTEGER NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `peso` DOUBLE NOT NULL DEFAULT 1,

    UNIQUE INDEX `bychat_aca_prova_itens_provaId_questaoId_key`(`provaId`, `questaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_aplicacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provaId` INTEGER NOT NULL,
    `inscricaoId` INTEGER NULL,
    `candidatoNome` VARCHAR(191) NOT NULL,
    `candidatoCpf` VARCHAR(20) NULL,
    `token` VARCHAR(64) NOT NULL,
    `iniciadaEm` DATETIME(3) NULL,
    `entregueEm` DATETIME(3) NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'EM_ABERTO',
    `notaObjetiva` DOUBLE NULL,
    `notaDissertativa` DOUBLE NULL,
    `notaFinal` DOUBLE NULL,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_prova_aplicacoes_token_key`(`token`),
    INDEX `bychat_aca_prova_aplicacoes_provaId_status_idx`(`provaId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_respostas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `aplicacaoId` INTEGER NOT NULL,
    `questaoId` INTEGER NOT NULL,
    `resposta` TEXT NULL,
    `correta` BOOLEAN NULL,
    `notaManual` DOUBLE NULL,
    `rubricaNotasJson` JSON NULL,
    `parecer` TEXT NULL,
    `corrigidaPor` INTEGER NULL,
    `corrigidaEm` DATETIME(3) NULL,

    UNIQUE INDEX `bychat_aca_prova_respostas_aplicacaoId_questaoId_key`(`aplicacaoId`, `questaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_responsaveis` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `nome` VARCHAR(191) NOT NULL,
    `cpf` VARCHAR(20) NULL,
    `parentesco` VARCHAR(40) NULL,
    `tipo` ENUM('FINANCEIRO', 'PEDAGOGICO', 'LEGAL', 'CONTRATO', 'FAMILIAR') NOT NULL DEFAULT 'FINANCEIRO',
    `telefone` VARCHAR(30) NULL,
    `email` VARCHAR(191) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    INDEX `bychat_aca_responsaveis_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_periodos_letivos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(20) NOT NULL,
    `descricao` VARCHAR(191) NOT NULL,
    `anoLetivo` INTEGER NULL,
    `dataInicio` DATETIME(3) NULL,
    `dataFim` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `bychat_aca_periodos_letivos_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_disciplinas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `codigo` VARCHAR(50) NULL,
    `cargaHoraria` INTEGER NOT NULL DEFAULT 0,
    `ementa` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_disciplinas_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_matrizes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `versao` VARCHAR(40) NOT NULL,
    `vigenteDe` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `nome` VARCHAR(191) NULL,
    `status` ENUM('RASCUNHO', 'ATIVA', 'SUSPENSA', 'EXTINTA') NOT NULL DEFAULT 'RASCUNHO',
    `chObrigatoria` INTEGER NULL,
    `chEletiva` INTEGER NULL,
    `chOptativa` INTEGER NULL,
    `chEstagio` INTEGER NULL,
    `chTcc` INTEGER NULL,
    `chComplementar` INTEGER NULL,
    `chExtensao` INTEGER NULL,
    `publicadaEm` DATETIME(3) NULL,
    `publicadaPor` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_matrizes_courseId_idx`(`courseId`),
    INDEX `bychat_aca_matrizes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ppcp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `metodologia` TEXT NULL,
    `status` ENUM('RASCUNHO', 'AUTORIZADO', 'SUSPENSO', 'ENCERRADO') NOT NULL DEFAULT 'RASCUNHO',
    `atoAutorizacao` VARCHAR(191) NULL,
    `orgaoAutorizador` VARCHAR(191) NULL,
    `autorizadoEm` DATETIME(3) NULL,
    `vigenciaAte` DATETIME(3) NULL,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_ppcp_courseId_status_idx`(`courseId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_certificacao_processos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ppcpId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `matriculaId` INTEGER NULL,
    `protocolo` VARCHAR(40) NOT NULL,
    `status` ENUM('ABERTO', 'EM_AVALIACAO', 'DEFERIDO', 'INDEFERIDO', 'CANCELADO') NOT NULL DEFAULT 'ABERTO',
    `itinerario` TEXT NULL,
    `banca` TEXT NULL,
    `parecerFinal` TEXT NULL,
    `decididoPor` INTEGER NULL,
    `decididoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_certificacao_processos_alunoId_status_idx`(`alunoId`, `status`),
    UNIQUE INDEX `bychat_aca_certificacao_processos_protocolo_key`(`protocolo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_certificacao_avaliacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `processoId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `instrumento` VARCHAR(191) NOT NULL,
    `resultado` ENUM('RECONHECIDO', 'NAO_RECONHECIDO') NOT NULL,
    `parecer` TEXT NULL,
    `avaliadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `avaliadorNome` VARCHAR(191) NULL,
    `aproveitamentoId` INTEGER NULL,

    INDEX `bychat_aca_certificacao_avaliacoes_processoId_idx`(`processoId`),
    UNIQUE INDEX `bychat_aca_certificacao_avaliacoes_processoId_componenteId_key`(`processoId`, `componenteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_matriz_modulos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matrizId` INTEGER NOT NULL,
    `numero` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `tituloQualificacao` VARCHAR(191) NULL,
    `codigoCbo` VARCHAR(20) NULL,
    `cargaHoraria` INTEGER NULL,
    `descricao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_matriz_modulos_matrizId_idx`(`matrizId`),
    UNIQUE INDEX `bychat_aca_matriz_modulos_matrizId_numero_key`(`matrizId`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_capacidades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `componenteId` INTEGER NOT NULL,
    `tipo` ENUM('TECNICA', 'SOCIAL', 'ORGANIZATIVA', 'METODOLOGICA') NOT NULL DEFAULT 'TECNICA',
    `descricao` TEXT NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_capacidades_componenteId_idx`(`componenteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_criterios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `capacidadeId` INTEGER NOT NULL,
    `descricao` TEXT NOT NULL,
    `evidencia` TEXT NULL,
    `peso` ENUM('CRITICO', 'DESEJAVEL') NOT NULL DEFAULT 'DESEJAVEL',
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_criterios_capacidadeId_idx`(`capacidadeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_afericoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `criterioId` INTEGER NOT NULL,
    `matriculaId` INTEGER NOT NULL,
    `resultado` ENUM('ATENDE', 'EM_DESENVOLVIMENTO', 'NAO_ATENDE') NOT NULL,
    `observacao` TEXT NULL,
    `tentativa` INTEGER NOT NULL DEFAULT 1,
    `afericaoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `docenteUserId` INTEGER NULL,

    INDEX `bychat_aca_afericoes_matriculaId_idx`(`matriculaId`),
    UNIQUE INDEX `bychat_aca_afericoes_criterioId_matriculaId_tentativa_key`(`criterioId`, `matriculaId`, `tentativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_componentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matrizId` INTEGER NOT NULL,
    `disciplinaId` INTEGER NOT NULL,
    `fase` INTEGER NOT NULL DEFAULT 1,
    `obrigatoria` BOOLEAN NOT NULL DEFAULT true,
    `tipo` ENUM('OBRIGATORIA', 'ELETIVA', 'OPTATIVA', 'ESTAGIO', 'TCC', 'ATIVIDADE_COMPLEMENTAR', 'EXTENSAO') NOT NULL DEFAULT 'OBRIGATORIA',
    `chTotal` INTEGER NULL,
    `chTeorica` INTEGER NULL,
    `chPratica` INTEGER NULL,
    `chExtensao` INTEGER NULL,
    `grupoEletiva` VARCHAR(60) NULL,
    `ordem` INTEGER NULL,
    `moduloId` INTEGER NULL,

    INDEX `bychat_aca_componentes_matrizId_fase_idx`(`matrizId`, `fase`),
    UNIQUE INDEX `bychat_aca_componentes_matrizId_disciplinaId_key`(`matrizId`, `disciplinaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prerequisitos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `componenteId` INTEGER NOT NULL,
    `componenteRequeridoId` INTEGER NOT NULL,

    UNIQUE INDEX `bychat_aca_prerequisitos_componenteId_componenteRequeridoId_key`(`componenteId`, `componenteRequeridoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_turmas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseOfferingId` INTEGER NULL,
    `periodoLetivoId` INTEGER NOT NULL,
    `matrizId` INTEGER NULL,
    `nome` VARCHAR(191) NOT NULL,
    `faseAtual` INTEGER NULL,
    `turno` ENUM('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL', 'EAD') NULL,
    `capacidade` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `matriculaAberta` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_turmas_periodoLetivoId_idx`(`periodoLetivoId`),
    INDEX `bychat_aca_turmas_courseOfferingId_idx`(`courseOfferingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_matriculas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `turmaId` INTEGER NOT NULL,
    `vinculoId` INTEGER NULL,
    `courseOfferingId` INTEGER NULL,
    `status` ENUM('INSCRITO', 'PRE_MATRICULA', 'MATRICULADO', 'TRANCADO', 'TRANSFERIDO', 'CONCLUIDO', 'EVADIDO', 'CANCELADO') NOT NULL DEFAULT 'INSCRITO',
    `origem` VARCHAR(40) NULL,
    `enrollmentDraftId` INTEGER NULL,
    `listaEspera` BOOLEAN NOT NULL DEFAULT false,
    `dataMatricula` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataConclusao` DATETIME(3) NULL,
    `motivoSaida` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_matriculas_status_idx`(`status`),
    INDEX `bychat_aca_matriculas_vinculoId_idx`(`vinculoId`),
    UNIQUE INDEX `bychat_aca_matriculas_alunoId_turmaId_key`(`alunoId`, `turmaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_matricula_eventos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `de` VARCHAR(20) NULL,
    `para` VARCHAR(20) NOT NULL,
    `obs` TEXT NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_matricula_eventos_matriculaId_idx`(`matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_movimentacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `tipo` ENUM('TRANCAMENTO', 'REINGRESSO', 'AFASTAMENTO', 'TRANSFERENCIA_INTERNA', 'TRANSFERENCIA_EXTERNA', 'REMANEJAMENTO', 'RECLASSIFICACAO', 'CANCELAMENTO', 'EVASAO') NOT NULL,
    `statusDe` VARCHAR(20) NULL,
    `statusPara` VARCHAR(20) NULL,
    `turmaDestinoId` INTEGER NULL,
    `matriculaDestinoId` INTEGER NULL,
    `instituicaoDestino` VARCHAR(191) NULL,
    `motivo` TEXT NULL,
    `dataEfeito` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataRetornoPrevista` DATETIME(3) NULL,
    `protocolo` VARCHAR(30) NULL,
    `anexoUrl` TEXT NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_movimentacoes_matriculaId_idx`(`matriculaId`),
    INDEX `bychat_aca_movimentacoes_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_movimentacoes_tipo_idx`(`tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_equivalencia_grupos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `observacao` TEXT NULL,
    `bidirecional` BOOLEAN NOT NULL DEFAULT false,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_equivalencia_grupos_ativo_idx`(`ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_equivalencia_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grupoId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `lado` ENUM('ORIGEM', 'DESTINO') NOT NULL,

    INDEX `bychat_aca_equivalencia_itens_componenteId_idx`(`componenteId`),
    UNIQUE INDEX `bychat_aca_equivalencia_itens_grupoId_componenteId_lado_key`(`grupoId`, `componenteId`, `lado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_equivalencias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `componenteId` INTEGER NOT NULL,
    `componenteEquivalenteId` INTEGER NOT NULL,
    `bidirecional` BOOLEAN NOT NULL DEFAULT true,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_equivalencias_componenteId_idx`(`componenteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_aproveitamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `origem` ENUM('INTERNO', 'EXTERNO', 'SUFICIENCIA') NOT NULL DEFAULT 'EXTERNO',
    `instituicaoOrigem` VARCHAR(191) NULL,
    `disciplinaOrigem` VARCHAR(191) NULL,
    `cargaHorariaAproveitada` INTEGER NOT NULL DEFAULT 0,
    `nota` DOUBLE NULL,
    `status` ENUM('SOLICITADO', 'DEFERIDO', 'INDEFERIDO') NOT NULL DEFAULT 'SOLICITADO',
    `parecer` TEXT NULL,
    `documentoId` INTEGER NULL,
    `decididoPorUserId` INTEGER NULL,
    `decididoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_aproveitamentos_matriculaId_idx`(`matriculaId`),
    INDEX `bychat_aca_aproveitamentos_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_aproveitamentos_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_coordenadores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `leadId` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_coordenadores_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_dependencias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `tipo` ENUM('DEPENDENCIA', 'ADAPTACAO') NOT NULL DEFAULT 'DEPENDENCIA',
    `turmaId` INTEGER NULL,
    `situacao` VARCHAR(20) NOT NULL DEFAULT 'EM_CURSO',
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_dependencias_matriculaId_idx`(`matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_contas_financeiras` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(30) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `tipo` ENUM('RECEITA', 'DESPESA') NOT NULL DEFAULT 'RECEITA',
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_contas_bancarias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `bancoCodigo` VARCHAR(5) NOT NULL,
    `agencia` VARCHAR(12) NULL,
    `conta` VARCHAR(20) NULL,
    `carteira` VARCHAR(6) NULL,
    `convenio` VARCHAR(30) NULL,
    `cnab` VARCHAR(3) NOT NULL DEFAULT '400',
    `cedente` VARCHAR(191) NULL,
    `documentoCedente` VARCHAR(20) NULL,
    `sequencialRemessa` INTEGER NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_indexadores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(60) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_indexador_valores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `indexadorId` INTEGER NOT NULL,
    `competencia` VARCHAR(7) NOT NULL,
    `valorPct` DOUBLE NOT NULL,

    UNIQUE INDEX `bychat_aca_indexador_valores_indexadorId_competencia_key`(`indexadorId`, `competencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_feriados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `data` DATETIME(3) NOT NULL,
    `nome` VARCHAR(120) NOT NULL,

    UNIQUE INDEX `bychat_aca_feriados_data_key`(`data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_cobrancas_recorrentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contratoId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `descricao` VARCHAR(191) NOT NULL,
    `valorCentavos` INTEGER NOT NULL,
    `periodo` ENUM('MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL') NOT NULL DEFAULT 'MENSAL',
    `diaVencimento` INTEGER NOT NULL DEFAULT 10,
    `contaFinanceiraId` INTEGER NULL,
    `proximaGeracao` DATETIME(3) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_cobrancas_recorrentes_ativo_proximaGeracao_idx`(`ativo`, `proximaGeracao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_remessas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaBancariaId` INTEGER NOT NULL,
    `sequencial` INTEGER NOT NULL,
    `layout` VARCHAR(3) NOT NULL,
    `qtdTitulos` INTEGER NOT NULL DEFAULT 0,
    `valorTotalCentavos` INTEGER NOT NULL DEFAULT 0,
    `arquivo` LONGTEXT NOT NULL,
    `nomeArquivo` VARCHAR(60) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'GERADA',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_remessas_contaBancariaId_idx`(`contaBancariaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_cda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` VARCHAR(30) NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `valorCentavos` INTEGER NOT NULL,
    `qtdParcelas` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('INSCRITA', 'AJUIZADA', 'QUITADA', 'CANCELADA') NOT NULL DEFAULT 'INSCRITA',
    `bloqueioJudicial` BOOLEAN NOT NULL DEFAULT false,
    `acordoId` INTEGER NULL,
    `inscritaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ajuizadaEm` DATETIME(3) NULL,
    `quitadaEm` DATETIME(3) NULL,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_cda_numero_key`(`numero`),
    INDEX `bychat_aca_cda_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_cda_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_regras_contabeis` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento` VARCHAR(40) NOT NULL,
    `contaDebitoId` INTEGER NULL,
    `contaCreditoId` INTEGER NULL,
    `historico` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_lancamentos_contabeis` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `historico` VARCHAR(255) NOT NULL,
    `contaDebitoId` INTEGER NULL,
    `contaCreditoId` INTEGER NULL,
    `valorCentavos` INTEGER NOT NULL,
    `origem` VARCHAR(40) NOT NULL,
    `parcelaId` INTEGER NULL,
    `regraId` INTEGER NULL,
    `desfeito` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_lancamentos_contabeis_parcelaId_idx`(`parcelaId`),
    INDEX `bychat_aca_lancamentos_contabeis_origem_idx`(`origem`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_nfse_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provedor` VARCHAR(60) NULL,
    `ambiente` VARCHAR(12) NOT NULL DEFAULT 'homologacao',
    `cnpjPrestador` VARCHAR(20) NULL,
    `inscricaoMunicipal` VARCHAR(30) NULL,
    `codigoServico` VARCHAR(20) NULL,
    `aliquotaPct` DOUBLE NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_proc_componentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `selectionProcessId` INTEGER NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_proc_componentes_selectionProcessId_idx`(`selectionProcessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_proc_notas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `processRegistrationId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `nota` DOUBLE NOT NULL,

    INDEX `bychat_aca_proc_notas_processRegistrationId_idx`(`processRegistrationId`),
    UNIQUE INDEX `bychat_aca_proc_notas_processRegistrationId_componenteId_key`(`processRegistrationId`, `componenteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_proc_salas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `selectionProcessId` INTEGER NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `local` VARCHAR(191) NULL,
    `capacidade` INTEGER NOT NULL DEFAULT 30,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_proc_salas_selectionProcessId_idx`(`selectionProcessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_proc_ensalamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `selectionProcessId` INTEGER NOT NULL,
    `processRegistrationId` INTEGER NOT NULL,
    `salaId` INTEGER NOT NULL,
    `ordem` INTEGER NOT NULL,

    UNIQUE INDEX `bychat_aca_proc_ensalamento_processRegistrationId_key`(`processRegistrationId`),
    INDEX `bychat_aca_proc_ensalamento_selectionProcessId_idx`(`selectionProcessId`),
    INDEX `bychat_aca_proc_ensalamento_salaId_idx`(`salaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_avaliacoes_inst` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `publico` ENUM('ALUNO', 'PROFESSOR', 'TODOS') NOT NULL DEFAULT 'TODOS',
    `status` ENUM('RASCUNHO', 'ABERTA', 'ENCERRADA') NOT NULL DEFAULT 'RASCUNHO',
    `anonima` BOOLEAN NOT NULL DEFAULT true,
    `inicio` DATETIME(3) NULL,
    `fim` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_aval_dimensoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `avaliacaoId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,

    INDEX `bychat_aca_aval_dimensoes_avaliacaoId_idx`(`avaliacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_aval_perguntas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dimensaoId` INTEGER NOT NULL,
    `tipo` ENUM('ESCALA', 'NPS', 'TEXTO', 'SIMNAO') NOT NULL DEFAULT 'ESCALA',
    `enunciado` TEXT NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,

    INDEX `bychat_aca_aval_perguntas_dimensaoId_idx`(`dimensaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_aval_respostas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `avaliacaoId` INTEGER NOT NULL,
    `perguntaId` INTEGER NOT NULL,
    `sessaoId` VARCHAR(40) NOT NULL,
    `valor` INTEGER NULL,
    `texto` TEXT NULL,
    `origem` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_aval_respostas_avaliacaoId_idx`(`avaliacaoId`),
    INDEX `bychat_aca_aval_respostas_perguntaId_idx`(`perguntaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_docentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `titulacao` VARCHAR(40) NULL,
    `regime` ENUM('HORISTA', 'PARCIAL', 'INTEGRAL') NOT NULL DEFAULT 'HORISTA',
    `valorHoraCentavos` INTEGER NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `orientador` BOOLEAN NOT NULL DEFAULT false,
    `observacao` TEXT NULL,
    `dadosJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_docentes_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_tipos_atividade_docente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `fatorHora` DOUBLE NOT NULL DEFAULT 1,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_atividades_docente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `docenteId` INTEGER NOT NULL,
    `tipoId` INTEGER NOT NULL,
    `competencia` VARCHAR(7) NOT NULL,
    `descricao` VARCHAR(191) NULL,
    `horas` DOUBLE NOT NULL DEFAULT 0,
    `valorHoraCentavos` INTEGER NOT NULL DEFAULT 0,
    `fatorHora` DOUBLE NOT NULL DEFAULT 1,
    `valorCentavos` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('LANCADA', 'APROVADA', 'PAGA') NOT NULL DEFAULT 'LANCADA',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_atividades_docente_docenteId_idx`(`docenteId`),
    INDEX `bychat_aca_atividades_docente_competencia_idx`(`competencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_docente_aceites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `docenteId` INTEGER NOT NULL,
    `diarioId` INTEGER NOT NULL,
    `status` ENUM('PENDENTE', 'ACEITO', 'RECUSADO') NOT NULL DEFAULT 'PENDENTE',
    `observacao` TEXT NULL,
    `decididoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_docente_aceites_docenteId_idx`(`docenteId`),
    UNIQUE INDEX `bychat_aca_docente_aceites_docenteId_diarioId_key`(`docenteId`, `diarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_grupos_inscricao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `selectionProcessId` INTEGER NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_grupos_inscricao_selectionProcessId_idx`(`selectionProcessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_motivos_cancelamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_inscricao_empresas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `cnpj` VARCHAR(20) NULL,
    `contato` VARCHAR(191) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_inscricao_extra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `processRegistrationId` INTEGER NOT NULL,
    `grupoId` INTEGER NULL,
    `empresaId` INTEGER NULL,
    `comoConheceu` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_inscricao_extra_processRegistrationId_key`(`processRegistrationId`),
    INDEX `bychat_aca_inscricao_extra_grupoId_idx`(`grupoId`),
    INDEX `bychat_aca_inscricao_extra_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_tipos_ambiente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ambientes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `tipoId` INTEGER NULL,
    `capacidade` INTEGER NOT NULL DEFAULT 0,
    `localizacao` VARCHAR(191) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_tipos_equipamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_equipamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `tipoId` INTEGER NULL,
    `ambienteId` INTEGER NULL,
    `patrimonio` VARCHAR(40) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_equipamentos_ambienteId_idx`(`ambienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_reservas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ambienteId` INTEGER NOT NULL,
    `data` DATETIME(3) NOT NULL,
    `horaInicio` VARCHAR(5) NOT NULL,
    `horaFim` VARCHAR(5) NOT NULL,
    `finalidade` VARCHAR(191) NULL,
    `responsavel` VARCHAR(191) NULL,
    `userId` INTEGER NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ATIVA',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_reservas_ambienteId_data_idx`(`ambienteId`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_censo_justificativas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `anoBase` INTEGER NOT NULL,
    `motivo` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_censo_justificativas_anoBase_idx`(`anoBase`),
    UNIQUE INDEX `bychat_aca_censo_justificativas_matriculaId_anoBase_key`(`matriculaId`, `anoBase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_cadastros_aux` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(40) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(255) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_cadastros_aux_tipo_idx`(`tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ged_arquivos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `tipo` VARCHAR(60) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'RECEBIDO',
    `observacao` TEXT NULL,
    `classificacao` VARCHAR(60) NULL,
    `temporalidade` VARCHAR(12) NOT NULL DEFAULT 'PERMANENTE',
    `prazoGuardaAnos` INTEGER NULL,
    `guardaAte` DATETIME(3) NULL,
    `hashSha256` VARCHAR(64) NULL,
    `tamanhoBytes` INTEGER NULL,
    `mimeType` VARCHAR(100) NULL,
    `eliminadoEm` DATETIME(3) NULL,
    `eliminacaoTermoId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_ged_arquivos_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ead_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lmsNome` VARCHAR(120) NULL,
    `lmsBaseUrl` VARCHAR(255) NULL,
    `modo` VARCHAR(12) NOT NULL DEFAULT 'SIMULADO',
    `ativo` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ead_turmas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `turmaId` INTEGER NOT NULL,
    `chEad` INTEGER NOT NULL DEFAULT 0,
    `lmsRef` VARCHAR(80) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_ead_turmas_turmaId_key`(`turmaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ead_matriculas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `eadTurmaId` INTEGER NOT NULL,
    `lmsEnrollRef` VARCHAR(80) NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'PENDENTE',
    `syncedAt` DATETIME(3) NULL,

    UNIQUE INDEX `bychat_aca_ead_matriculas_matriculaId_key`(`matriculaId`),
    INDEX `bychat_aca_ead_matriculas_eadTurmaId_idx`(`eadTurmaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ead_notas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `disciplina` VARCHAR(191) NOT NULL,
    `nota` DOUBLE NOT NULL,
    `origem` VARCHAR(10) NOT NULL DEFAULT 'LMS',
    `recebidaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_ead_notas_matriculaId_idx`(`matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ead_acessos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `recurso` VARCHAR(191) NOT NULL,
    `acessadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_ead_acessos_matriculaId_idx`(`matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_pontos_acesso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `local` VARCHAR(191) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_credenciais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_credenciais_alunoId_key`(`alunoId`),
    UNIQUE INDEX `bychat_aca_credenciais_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_acesso_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NULL,
    `pontoId` INTEGER NULL,
    `tipo` VARCHAR(8) NOT NULL DEFAULT 'ENTRADA',
    `autorizado` BOOLEAN NOT NULL DEFAULT true,
    `motivo` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_acesso_logs_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_acesso_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_diplomas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `numero` VARCHAR(40) NULL,
    `livro` VARCHAR(20) NULL,
    `folha` VARCHAR(20) NULL,
    `status` ENUM('RASCUNHO', 'XML_GERADO', 'ASSINADO', 'REGISTRADO', 'ANULADO') NOT NULL DEFAULT 'RASCUNHO',
    `dataColacao` DATETIME(3) NULL,
    `dataEmissao` DATETIME(3) NULL,
    `cargaHoraria` INTEGER NOT NULL DEFAULT 0,
    `xmlDiplomado` LONGTEXT NULL,
    `assinaturaInfo` TEXT NULL,
    `codigoValidacao` VARCHAR(40) NULL,
    `motivoAnulacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_diplomas_matriculaId_key`(`matriculaId`),
    UNIQUE INDEX `bychat_aca_diplomas_codigoValidacao_key`(`codigoValidacao`),
    INDEX `bychat_aca_diplomas_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_diploma_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `iesEmissora` VARCHAR(191) NULL,
    `cnpjEmissora` VARCHAR(20) NULL,
    `codigoMecEmissora` VARCHAR(20) NULL,
    `iesRegistradora` VARCHAR(191) NULL,
    `codigoMecRegistradora` VARCHAR(20) NULL,
    `reitor` VARCHAR(191) NULL,
    `secretario` VARCHAR(191) NULL,
    `provedorAssinatura` VARCHAR(60) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_tccs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `orientador` VARCHAR(191) NULL,
    `orientadorUserId` INTEGER NULL,
    `resumo` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'REGISTRADO',
    `nota` DOUBLE NULL,
    `dataDefesa` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_tccs_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_planos_pagamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseOfferingId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `numParcelas` INTEGER NOT NULL,
    `valorParcelaCentavos` INTEGER NOT NULL,
    `taxaMatriculaCentavos` INTEGER NOT NULL DEFAULT 0,
    `diaVencimento` INTEGER NOT NULL DEFAULT 10,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_planos_pagamento_courseOfferingId_idx`(`courseOfferingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_bolsas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `tipo` ENUM('PERCENTUAL', 'VALOR', 'INTEGRAL') NOT NULL,
    `valor` INTEGER NOT NULL,
    `motivo` TEXT NULL,
    `validadeInicio` DATETIME(3) NULL,
    `validadeFim` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_bolsas_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_contratos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matriculaId` INTEGER NOT NULL,
    `planoPagamentoId` INTEGER NULL,
    `valorTotalCentavos` INTEGER NOT NULL,
    `descontoCentavos` INTEGER NOT NULL DEFAULT 0,
    `bolsaId` INTEGER NULL,
    `asaasCustomerId` VARCHAR(191) NULL,
    `status` ENUM('ATIVO', 'QUITADO', 'CANCELADO', 'RENEGOCIADO') NOT NULL DEFAULT 'ATIVO',
    `aceiteEm` DATETIME(3) NULL,
    `aceiteIp` VARCHAR(60) NULL,
    `aceiteNome` VARCHAR(191) NULL,
    `aceiteTermo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_contratos_matriculaId_key`(`matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_parcelas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contratoId` INTEGER NOT NULL,
    `nroParcela` INTEGER NOT NULL,
    `tipo` ENUM('MATRICULA', 'MENSALIDADE', 'MATERIAL', 'TAXA', 'OUTRO', 'ACORDO') NOT NULL DEFAULT 'MENSALIDADE',
    `valorBrutoCentavos` INTEGER NOT NULL,
    `valorPagoCentavos` INTEGER NOT NULL DEFAULT 0,
    `dataVencimento` DATETIME(3) NOT NULL,
    `situacao` ENUM('ABERTA', 'PAGA', 'VENCIDA', 'CANCELADA', 'RENEGOCIADA') NOT NULL DEFAULT 'ABERTA',
    `pagoEm` DATETIME(3) NULL,
    `asaasChargeId` VARCHAR(191) NULL,
    `linhaDigitavel` TEXT NULL,
    `pixCopiaCola` TEXT NULL,
    `acordoId` INTEGER NULL,
    `remessaId` INTEGER NULL,
    `nossoNumero` VARCHAR(30) NULL,
    `contaFinanceiraId` INTEGER NULL,
    `cdaId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_parcelas_contratoId_idx`(`contratoId`),
    INDEX `bychat_aca_parcelas_situacao_dataVencimento_idx`(`situacao`, `dataVencimento`),
    INDEX `bychat_aca_parcelas_asaasChargeId_idx`(`asaasChargeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_integracao_eventos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `origem` VARCHAR(40) NOT NULL,
    `eventoExternoId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDENTE', 'SUCESSO', 'ERRO') NOT NULL DEFAULT 'PENDENTE',
    `requestJson` JSON NULL,
    `responseJson` JSON NULL,
    `erroMotivo` TEXT NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_integracao_eventos_status_idx`(`status`),
    UNIQUE INDEX `bychat_aca_integracao_eventos_origem_eventoExternoId_key`(`origem`, `eventoExternoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_ocorrencias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NULL,
    `turmaId` INTEGER NULL,
    `tipo` VARCHAR(60) NOT NULL,
    `descricao` TEXT NOT NULL,
    `anexosJson` JSON NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_ocorrencias_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_diarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `turmaId` INTEGER NOT NULL,
    `disciplinaId` INTEGER NOT NULL,
    `professorUserId` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_diarios_turmaId_idx`(`turmaId`),
    UNIQUE INDEX `bychat_aca_diarios_turmaId_disciplinaId_key`(`turmaId`, `disciplinaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_aulas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `diarioId` INTEGER NOT NULL,
    `data` DATETIME(3) NOT NULL,
    `conteudo` TEXT NOT NULL,
    `quantidadeAulas` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_aulas_diarioId_data_idx`(`diarioId`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_frequencias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `aulaId` INTEGER NOT NULL,
    `matriculaId` INTEGER NOT NULL,
    `presente` BOOLEAN NOT NULL DEFAULT true,
    `justificada` BOOLEAN NOT NULL DEFAULT false,

    INDEX `bychat_aca_frequencias_matriculaId_idx`(`matriculaId`),
    UNIQUE INDEX `bychat_aca_frequencias_aulaId_matriculaId_key`(`aulaId`, `matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_avaliacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `diarioId` INTEGER NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `siglaEsquema` VARCHAR(12) NULL,
    `peso` INTEGER NOT NULL DEFAULT 1,
    `valorMaximo` DOUBLE NOT NULL DEFAULT 10,
    `data` DATETIME(3) NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_avaliacoes_diarioId_idx`(`diarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_notas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `avaliacaoId` INTEGER NOT NULL,
    `matriculaId` INTEGER NOT NULL,
    `valor` DOUBLE NULL,
    `origem` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    `origemObs` TEXT NULL,
    `origemEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_notas_matriculaId_idx`(`matriculaId`),
    UNIQUE INDEX `bychat_aca_notas_avaliacaoId_matriculaId_key`(`avaliacaoId`, `matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_resultados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `diarioId` INTEGER NOT NULL,
    `matriculaId` INTEGER NOT NULL,
    `mediaFinal` DOUBLE NULL,
    `frequenciaPct` INTEGER NOT NULL DEFAULT 100,
    `situacao` VARCHAR(30) NOT NULL,
    `observacao` TEXT NULL,
    `fechadoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_resultados_matriculaId_idx`(`matriculaId`),
    UNIQUE INDEX `bychat_aca_resultados_diarioId_matriculaId_key`(`diarioId`, `matriculaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_conselhos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `turmaId` INTEGER NOT NULL,
    `ata` TEXT NULL,
    `fechadoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_conselhos_turmaId_key`(`turmaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_documentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` VARCHAR(30) NOT NULL,
    `tipo` VARCHAR(40) NOT NULL,
    `alunoId` INTEGER NULL,
    `turmaId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `dadosJson` JSON NULL,
    `emitidoPorUserId` INTEGER NULL,
    `emitidoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_documentos_numero_key`(`numero`),
    INDEX `bychat_aca_documentos_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_documentos_turmaId_idx`(`turmaId`),
    INDEX `bychat_aca_documentos_tipo_idx`(`tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_comunicacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `canal` VARCHAR(20) NOT NULL,
    `destino` VARCHAR(191) NOT NULL,
    `assunto` VARCHAR(191) NULL,
    `conteudo` TEXT NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ENVIADO',
    `erro` TEXT NULL,
    `refId` INTEGER NULL,
    `chaveDedup` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_comunicacoes_chaveDedup_key`(`chaveDedup`),
    INDEX `bychat_aca_comunicacoes_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_comunicacoes_tipo_idx`(`tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_acordos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `contratoId` INTEGER NOT NULL,
    `valorOriginalCentavos` INTEGER NOT NULL,
    `valorEncargosCentavos` INTEGER NOT NULL DEFAULT 0,
    `valorTotalCentavos` INTEGER NOT NULL,
    `entradaCentavos` INTEGER NOT NULL DEFAULT 0,
    `numParcelas` INTEGER NOT NULL,
    `valorParcelaCentavos` INTEGER NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ATIVO',
    `observacao` TEXT NULL,
    `origem` VARCHAR(24) NOT NULL DEFAULT 'SECRETARIA',
    `descontoEncargosCentavos` INTEGER NOT NULL DEFAULT 0,
    `aceiteEm` DATETIME(3) NULL,
    `aceiteNome` VARCHAR(191) NULL,
    `aceiteDocumento` VARCHAR(30) NULL,
    `aceiteIp` VARCHAR(45) NULL,
    `aceiteUserAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_acordos_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_notas_fiscais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `parcelaId` INTEGER NULL,
    `valorCentavos` INTEGER NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    `numero` VARCHAR(40) NULL,
    `serie` VARCHAR(20) NULL,
    `link` TEXT NULL,
    `observacao` TEXT NULL,
    `emitidaEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_notas_fiscais_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_notas_fiscais_parcelaId_idx`(`parcelaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_requerimento_tipos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `descricao` TEXT NULL,
    `slaDias` INTEGER NOT NULL DEFAULT 5,
    `geraDocumento` VARCHAR(40) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `categoriaId` INTEGER NULL,
    `custoCentavos` INTEGER NOT NULL DEFAULT 0,
    `deferimentoAutomatico` BOOLEAN NOT NULL DEFAULT false,
    `restricaoJson` TEXT NULL,
    `camposJson` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_requerimento_categorias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_requerimento_tramites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requerimentoId` INTEGER NOT NULL,
    `deUserId` INTEGER NULL,
    `paraUserId` INTEGER NULL,
    `paraTeamId` INTEGER NULL,
    `estado` VARCHAR(16) NULL,
    `comentario` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_requerimento_tramites_requerimentoId_idx`(`requerimentoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_requerimentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `protocolo` VARCHAR(30) NOT NULL,
    `alunoId` INTEGER NOT NULL,
    `tipoId` INTEGER NULL,
    `tipoNome` VARCHAR(120) NOT NULL,
    `assunto` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ABERTO',
    `resposta` TEXT NULL,
    `documentoId` INTEGER NULL,
    `camposJson` TEXT NULL,
    `custoParcelaId` INTEGER NULL,
    `prazoEm` DATETIME(3) NULL,
    `respondidoPorUserId` INTEGER NULL,
    `respondidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_requerimentos_protocolo_key`(`protocolo`),
    INDEX `bychat_aca_requerimentos_alunoId_idx`(`alunoId`),
    INDEX `bychat_aca_requerimentos_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_eventos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `periodoLetivoId` INTEGER NULL,
    `turmaId` INTEGER NULL,
    `tipo` VARCHAR(20) NOT NULL DEFAULT 'EVENTO',
    `titulo` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `dataInicio` DATETIME(3) NOT NULL,
    `dataFim` DATETIME(3) NULL,
    `diaInteiro` BOOLEAN NOT NULL DEFAULT true,
    `cor` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_eventos_periodoLetivoId_idx`(`periodoLetivoId`),
    INDEX `bychat_aca_eventos_dataInicio_idx`(`dataInicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_horarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `turmaId` INTEGER NOT NULL,
    `disciplinaId` INTEGER NOT NULL,
    `professorUserId` INTEGER NULL,
    `sala` VARCHAR(60) NULL,
    `diaSemana` INTEGER NOT NULL,
    `horaInicio` VARCHAR(5) NOT NULL,
    `horaFim` VARCHAR(5) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_horarios_turmaId_idx`(`turmaId`),
    INDEX `bychat_aca_horarios_professorUserId_idx`(`professorUserId`),
    INDEX `bychat_aca_horarios_diaSemana_idx`(`diaSemana`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_planos_ensino` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `diarioId` INTEGER NOT NULL,
    `ementa` TEXT NULL,
    `objetivos` TEXT NULL,
    `conteudo` TEXT NULL,
    `metodologia` TEXT NULL,
    `bibliografia` TEXT NULL,
    `criterios` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_planos_ensino_diarioId_key`(`diarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_materiais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `diarioId` INTEGER NOT NULL,
    `aulaId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(12) NOT NULL DEFAULT 'LINK',
    `url` TEXT NOT NULL,
    `descricao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_materiais_diarioId_idx`(`diarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_estagios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `empresa` VARCHAR(191) NOT NULL,
    `supervisor` VARCHAR(191) NULL,
    `cargaHorariaH` INTEGER NOT NULL DEFAULT 0,
    `dataInicio` DATETIME(3) NULL,
    `dataFim` DATETIME(3) NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'EM_ANDAMENTO',
    `descricao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_estagios_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_atividades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `categoria` VARCHAR(40) NULL,
    `horas` INTEGER NOT NULL DEFAULT 0,
    `data` DATETIME(3) NULL,
    `comprovanteUrl` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_aca_atividades_alunoId_idx`(`alunoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcaAssinatura` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NULL,
    `matriculaId` INTEGER NULL,
    `contratoId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(30) NOT NULL DEFAULT 'AUTENTIQUE',
    `documentoExternoId` VARCHAR(120) NULL,
    `status` ENUM('RASCUNHO', 'ENVIADO', 'PARCIAL', 'ASSINADO', 'REJEITADO', 'CANCELADO') NOT NULL DEFAULT 'RASCUNHO',
    `termoTexto` TEXT NULL,
    `arquivoAssinadoUrl` TEXT NULL,
    `enviadoEm` DATETIME(3) NULL,
    `finalizadoEm` DATETIME(3) NULL,
    `metaJson` JSON NULL,
    `templateId` INTEGER NULL,
    `tipoNegocio` VARCHAR(40) NULL,
    `origem` ENUM('ESCRITO', 'UPLOAD', 'TEMPLATE') NOT NULL DEFAULT 'ESCRITO',
    `corpoTexto` TEXT NULL,
    `arquivoBase64` LONGTEXT NULL,
    `arquivoNome` VARCHAR(191) NULL,
    `deadlineEm` DATETIME(3) NULL,
    `reminder` VARCHAR(10) NULL,
    `sortable` BOOLEAN NOT NULL DEFAULT false,
    `refusable` BOOLEAN NOT NULL DEFAULT true,
    `mensagem` TEXT NULL,
    `pastaExternaId` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AcaAssinatura_alunoId_idx`(`alunoId`),
    INDEX `AcaAssinatura_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcaSignatario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `papel` ENUM('ALUNO', 'RESPONSAVEL', 'FIADOR', 'INSTITUICAO', 'TESTEMUNHA') NOT NULL DEFAULT 'ALUNO',
    `acao` ENUM('SIGN', 'APPROVE', 'RECOGNIZE', 'WITNESS') NOT NULL DEFAULT 'SIGN',
    `deliveryMethod` ENUM('EMAIL', 'SMS', 'WHATSAPP') NOT NULL DEFAULT 'EMAIL',
    `telefone` VARCHAR(30) NULL,
    `cpf` VARCHAR(20) NULL,
    `exigeCpf` BOOLEAN NOT NULL DEFAULT false,
    `exigeSelfie` BOOLEAN NOT NULL DEFAULT false,
    `publicId` VARCHAR(120) NULL,
    `linkAssinatura` TEXT NULL,
    `status` ENUM('PENDENTE', 'VISUALIZADO', 'ASSINADO', 'REJEITADO') NOT NULL DEFAULT 'PENDENTE',
    `viewedEm` DATETIME(3) NULL,
    `assinadoEm` DATETIME(3) NULL,
    `rejeitadoEm` DATETIME(3) NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,

    INDEX `AcaSignatario_assinaturaId_idx`(`assinaturaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcaContratoTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `tipoNegocio` ENUM('GRADUACAO', 'POS_GRADUACAO', 'ESPECIALIZACAO', 'MBA', 'TECNICO_TRADICIONAL', 'CERTIFICACAO_COMPETENCIA', 'EXTENSAO', 'CURSO_LIVRE', 'IDIOMAS', 'OUTRO') NOT NULL DEFAULT 'OUTRO',
    `descricao` VARCHAR(255) NULL,
    `corpoTexto` TEXT NOT NULL,
    `config` JSON NULL,
    `signatariosPadrao` JSON NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcaContratoGatilho` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `evento` ENUM('MANUAL', 'MATRICULA_CRIADA', 'INSCRICAO_APROVADA', 'CONTRATO_FINANCEIRO_CRIADO') NOT NULL DEFAULT 'MANUAL',
    `templateId` INTEGER NULL,
    `autoPorTipo` BOOLEAN NOT NULL DEFAULT false,
    `filtroTipoNegocio` VARCHAR(40) NULL,
    `autoEnviar` BOOLEAN NOT NULL DEFAULT false,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AcaContratoGatilho_evento_idx`(`evento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_alunos` ADD CONSTRAINT `bychat_aca_alunos_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_ies` ADD CONSTRAINT `bychat_aca_ies_mantenedoraId_fkey` FOREIGN KEY (`mantenedoraId`) REFERENCES `bychat_aca_mantenedoras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_vinculos` ADD CONSTRAINT `bychat_aca_vinculos_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_vinculo_movimentacoes` ADD CONSTRAINT `bychat_aca_vinculo_movimentacoes_vinculoId_fkey` FOREIGN KEY (`vinculoId`) REFERENCES `bychat_aca_vinculos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_esquema_componentes` ADD CONSTRAINT `bychat_aca_esquema_componentes_esquemaId_fkey` FOREIGN KEY (`esquemaId`) REFERENCES `bychat_aca_esquemas_avaliacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_regimes_especiais` ADD CONSTRAINT `bychat_aca_regimes_especiais_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_enade_regularidade` ADD CONSTRAINT `bychat_aca_enade_regularidade_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_itens` ADD CONSTRAINT `bychat_aca_prova_itens_provaId_fkey` FOREIGN KEY (`provaId`) REFERENCES `bychat_aca_provas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_itens` ADD CONSTRAINT `bychat_aca_prova_itens_questaoId_fkey` FOREIGN KEY (`questaoId`) REFERENCES `bychat_aca_questoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_aplicacoes` ADD CONSTRAINT `bychat_aca_prova_aplicacoes_provaId_fkey` FOREIGN KEY (`provaId`) REFERENCES `bychat_aca_provas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_respostas` ADD CONSTRAINT `bychat_aca_prova_respostas_aplicacaoId_fkey` FOREIGN KEY (`aplicacaoId`) REFERENCES `bychat_aca_prova_aplicacoes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_responsaveis` ADD CONSTRAINT `bychat_aca_responsaveis_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_certificacao_processos` ADD CONSTRAINT `bychat_aca_certificacao_processos_ppcpId_fkey` FOREIGN KEY (`ppcpId`) REFERENCES `bychat_aca_ppcp`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_certificacao_avaliacoes` ADD CONSTRAINT `bychat_aca_certificacao_avaliacoes_processoId_fkey` FOREIGN KEY (`processoId`) REFERENCES `bychat_aca_certificacao_processos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matriz_modulos` ADD CONSTRAINT `bychat_aca_matriz_modulos_matrizId_fkey` FOREIGN KEY (`matrizId`) REFERENCES `bychat_aca_matrizes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_capacidades` ADD CONSTRAINT `bychat_aca_capacidades_componenteId_fkey` FOREIGN KEY (`componenteId`) REFERENCES `bychat_aca_componentes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_criterios` ADD CONSTRAINT `bychat_aca_criterios_capacidadeId_fkey` FOREIGN KEY (`capacidadeId`) REFERENCES `bychat_aca_capacidades`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_afericoes` ADD CONSTRAINT `bychat_aca_afericoes_criterioId_fkey` FOREIGN KEY (`criterioId`) REFERENCES `bychat_aca_criterios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_componentes` ADD CONSTRAINT `bychat_aca_componentes_matrizId_fkey` FOREIGN KEY (`matrizId`) REFERENCES `bychat_aca_matrizes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_componentes` ADD CONSTRAINT `bychat_aca_componentes_disciplinaId_fkey` FOREIGN KEY (`disciplinaId`) REFERENCES `bychat_aca_disciplinas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_componentes` ADD CONSTRAINT `bychat_aca_componentes_moduloId_fkey` FOREIGN KEY (`moduloId`) REFERENCES `bychat_aca_matriz_modulos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prerequisitos` ADD CONSTRAINT `bychat_aca_prerequisitos_componenteId_fkey` FOREIGN KEY (`componenteId`) REFERENCES `bychat_aca_componentes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_turmas` ADD CONSTRAINT `bychat_aca_turmas_periodoLetivoId_fkey` FOREIGN KEY (`periodoLetivoId`) REFERENCES `bychat_aca_periodos_letivos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matriculas` ADD CONSTRAINT `bychat_aca_matriculas_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matriculas` ADD CONSTRAINT `bychat_aca_matriculas_turmaId_fkey` FOREIGN KEY (`turmaId`) REFERENCES `bychat_aca_turmas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matriculas` ADD CONSTRAINT `bychat_aca_matriculas_vinculoId_fkey` FOREIGN KEY (`vinculoId`) REFERENCES `bychat_aca_vinculos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matricula_eventos` ADD CONSTRAINT `bychat_aca_matricula_eventos_matriculaId_fkey` FOREIGN KEY (`matriculaId`) REFERENCES `bychat_aca_matriculas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_equivalencia_itens` ADD CONSTRAINT `bychat_aca_equivalencia_itens_grupoId_fkey` FOREIGN KEY (`grupoId`) REFERENCES `bychat_aca_equivalencia_grupos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_indexador_valores` ADD CONSTRAINT `bychat_aca_indexador_valores_indexadorId_fkey` FOREIGN KEY (`indexadorId`) REFERENCES `bychat_aca_indexadores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_aval_dimensoes` ADD CONSTRAINT `bychat_aca_aval_dimensoes_avaliacaoId_fkey` FOREIGN KEY (`avaliacaoId`) REFERENCES `bychat_aca_avaliacoes_inst`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_aval_perguntas` ADD CONSTRAINT `bychat_aca_aval_perguntas_dimensaoId_fkey` FOREIGN KEY (`dimensaoId`) REFERENCES `bychat_aca_aval_dimensoes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_atividades_docente` ADD CONSTRAINT `bychat_aca_atividades_docente_docenteId_fkey` FOREIGN KEY (`docenteId`) REFERENCES `bychat_aca_docentes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_docente_aceites` ADD CONSTRAINT `bychat_aca_docente_aceites_docenteId_fkey` FOREIGN KEY (`docenteId`) REFERENCES `bychat_aca_docentes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_equipamentos` ADD CONSTRAINT `bychat_aca_equipamentos_ambienteId_fkey` FOREIGN KEY (`ambienteId`) REFERENCES `bychat_aca_ambientes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_reservas` ADD CONSTRAINT `bychat_aca_reservas_ambienteId_fkey` FOREIGN KEY (`ambienteId`) REFERENCES `bychat_aca_ambientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_contratos` ADD CONSTRAINT `bychat_aca_contratos_matriculaId_fkey` FOREIGN KEY (`matriculaId`) REFERENCES `bychat_aca_matriculas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_parcelas` ADD CONSTRAINT `bychat_aca_parcelas_contratoId_fkey` FOREIGN KEY (`contratoId`) REFERENCES `bychat_aca_contratos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_ocorrencias` ADD CONSTRAINT `bychat_aca_ocorrencias_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_aulas` ADD CONSTRAINT `bychat_aca_aulas_diarioId_fkey` FOREIGN KEY (`diarioId`) REFERENCES `bychat_aca_diarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_frequencias` ADD CONSTRAINT `bychat_aca_frequencias_aulaId_fkey` FOREIGN KEY (`aulaId`) REFERENCES `bychat_aca_aulas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_avaliacoes` ADD CONSTRAINT `bychat_aca_avaliacoes_diarioId_fkey` FOREIGN KEY (`diarioId`) REFERENCES `bychat_aca_diarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_notas` ADD CONSTRAINT `bychat_aca_notas_avaliacaoId_fkey` FOREIGN KEY (`avaliacaoId`) REFERENCES `bychat_aca_avaliacoes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AcaSignatario` ADD CONSTRAINT `AcaSignatario_assinaturaId_fkey` FOREIGN KEY (`assinaturaId`) REFERENCES `AcaAssinatura`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

