-- AlterTable
ALTER TABLE `bychat_aca_componentes` ADD COLUMN `chExtensao` INTEGER NULL,
    ADD COLUMN `chPratica` INTEGER NULL,
    ADD COLUMN `chTeorica` INTEGER NULL,
    ADD COLUMN `chTotal` INTEGER NULL,
    ADD COLUMN `grupoEletiva` VARCHAR(60) NULL,
    ADD COLUMN `ordem` INTEGER NULL,
    ADD COLUMN `tipo` ENUM('OBRIGATORIA', 'ELETIVA', 'OPTATIVA', 'ESTAGIO', 'TCC', 'ATIVIDADE_COMPLEMENTAR', 'EXTENSAO') NOT NULL DEFAULT 'OBRIGATORIA';

-- AlterTable
ALTER TABLE `bychat_aca_matriculas` ADD COLUMN `vinculoId` INTEGER NULL;

-- AlterTable
ALTER TABLE `bychat_aca_matrizes` ADD COLUMN `chComplementar` INTEGER NULL,
    ADD COLUMN `chEletiva` INTEGER NULL,
    ADD COLUMN `chEstagio` INTEGER NULL,
    ADD COLUMN `chExtensao` INTEGER NULL,
    ADD COLUMN `chObrigatoria` INTEGER NULL,
    ADD COLUMN `chOptativa` INTEGER NULL,
    ADD COLUMN `chTcc` INTEGER NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `nome` VARCHAR(191) NULL,
    ADD COLUMN `publicadaEm` DATETIME(3) NULL,
    ADD COLUMN `publicadaPor` INTEGER NULL,
    ADD COLUMN `status` ENUM('RASCUNHO', 'ATIVA', 'SUSPENSA', 'EXTINTA') NOT NULL DEFAULT 'RASCUNHO',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `bychat_edu_courses` ADD COLUMN `areaCine` VARCHAR(120) NULL,
    ADD COLUMN `codigoEmec` VARCHAR(20) NULL,
    ADD COLUMN `duracaoMaxPeriodos` INTEGER NULL,
    ADD COLUMN `duracaoMinPeriodos` INTEGER NULL,
    ADD COLUMN `grau` VARCHAR(30) NULL,
    ADD COLUMN `modalidade` VARCHAR(20) NULL,
    ADD COLUMN `regimeAcademico` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `bychat_edu_units` ADD COLUMN `codigoEmecEndereco` VARCHAR(20) NULL,
    ADD COLUMN `enderecoJson` JSON NULL,
    ADD COLUMN `iesId` INTEGER NULL,
    ADD COLUMN `tipoUnidade` VARCHAR(40) NULL;

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
    `situacao` ENUM('PRE_MATRICULADO', 'ATIVO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NOT NULL DEFAULT 'PRE_MATRICULADO',
    `formaIngresso` VARCHAR(40) NULL,
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
    `de` ENUM('PRE_MATRICULADO', 'ATIVO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NULL,
    `para` ENUM('PRE_MATRICULADO', 'ATIVO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO', 'CANCELADO', 'FORMADO', 'DIPLOMADO', 'FALECIDO') NOT NULL,
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

-- CreateIndex
CREATE INDEX `bychat_aca_matriculas_vinculoId_idx` ON `bychat_aca_matriculas`(`vinculoId`);

-- CreateIndex
CREATE INDEX `bychat_aca_matrizes_status_idx` ON `bychat_aca_matrizes`(`status`);

-- AddForeignKey
ALTER TABLE `bychat_aca_ies` ADD CONSTRAINT `bychat_aca_ies_mantenedoraId_fkey` FOREIGN KEY (`mantenedoraId`) REFERENCES `bychat_aca_mantenedoras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_vinculos` ADD CONSTRAINT `bychat_aca_vinculos_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_vinculo_movimentacoes` ADD CONSTRAINT `bychat_aca_vinculo_movimentacoes_vinculoId_fkey` FOREIGN KEY (`vinculoId`) REFERENCES `bychat_aca_vinculos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_matriculas` ADD CONSTRAINT `bychat_aca_matriculas_vinculoId_fkey` FOREIGN KEY (`vinculoId`) REFERENCES `bychat_aca_vinculos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

