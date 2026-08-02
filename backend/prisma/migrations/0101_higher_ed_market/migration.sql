-- CreateTable
CREATE TABLE `bychat_he_institutions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `coIes` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `acronym` VARCHAR(60) NULL,
    `uf` VARCHAR(2) NULL,
    `city` VARCHAR(120) NULL,
    `isCapital` BOOLEAN NOT NULL DEFAULT false,
    `organization` INTEGER NULL,
    `category` INTEGER NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `lastYear` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_he_institutions_coIes_key`(`coIes`),
    INDEX `bychat_he_institutions_uf_city_idx`(`uf`, `city`),
    INDEX `bychat_he_institutions_isPrivate_idx`(`isPrivate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_he_courses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `coIes` INTEGER NOT NULL,
    `coCurso` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `cineArea` VARCHAR(120) NULL,
    `cineDetailed` VARCHAR(191) NULL,
    `degree` INTEGER NULL,
    `modality` INTEGER NULL,
    `category` INTEGER NULL,
    `organization` INTEGER NULL,
    `uf` VARCHAR(2) NULL,
    `city` VARCHAR(120) NULL,
    `cityCode` INTEGER NULL,
    `isCapital` BOOLEAN NOT NULL DEFAULT false,
    `seats` INTEGER NOT NULL DEFAULT 0,
    `seatsNight` INTEGER NOT NULL DEFAULT 0,
    `applicants` INTEGER NOT NULL DEFAULT 0,
    `entrants` INTEGER NOT NULL DEFAULT 0,
    `entrantsNight` INTEGER NOT NULL DEFAULT 0,
    `entrantsEnem` INTEGER NOT NULL DEFAULT 0,
    `entrantsVest` INTEGER NOT NULL DEFAULT 0,
    `entrantsFies` INTEGER NOT NULL DEFAULT 0,
    `entrantsProuni` INTEGER NOT NULL DEFAULT 0,
    `enrolled` INTEGER NOT NULL DEFAULT 0,
    `enrolledFem` INTEGER NOT NULL DEFAULT 0,
    `enrolled1824` INTEGER NOT NULL DEFAULT 0,
    `enrolled2529` INTEGER NOT NULL DEFAULT 0,
    `enrolled30p` INTEGER NOT NULL DEFAULT 0,
    `graduates` INTEGER NOT NULL DEFAULT 0,
    `locked` INTEGER NOT NULL DEFAULT 0,
    `dropped` INTEGER NOT NULL DEFAULT 0,
    `transferred` INTEGER NOT NULL DEFAULT 0,
    `enrolledFies` INTEGER NOT NULL DEFAULT 0,
    `enrolledProuni` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_he_courses_year_coIes_idx`(`year`, `coIes`),
    INDEX `bychat_he_courses_year_uf_cityCode_idx`(`year`, `uf`, `cityCode`),
    INDEX `bychat_he_courses_year_cineArea_idx`(`year`, `cineArea`),
    INDEX `bychat_he_courses_year_coCurso_idx`(`year`, `coCurso`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_he_market` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `uf` VARCHAR(2) NULL,
    `cityCode` INTEGER NULL,
    `city` VARCHAR(120) NULL,
    `cineArea` VARCHAR(120) NULL,
    `modality` INTEGER NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `courses` INTEGER NOT NULL DEFAULT 0,
    `institutions` INTEGER NOT NULL DEFAULT 0,
    `seats` INTEGER NOT NULL DEFAULT 0,
    `applicants` INTEGER NOT NULL DEFAULT 0,
    `entrants` INTEGER NOT NULL DEFAULT 0,
    `enrolled` INTEGER NOT NULL DEFAULT 0,
    `graduates` INTEGER NOT NULL DEFAULT 0,
    `dropped` INTEGER NOT NULL DEFAULT 0,
    `locked` INTEGER NOT NULL DEFAULT 0,
    `fies` INTEGER NOT NULL DEFAULT 0,
    `prouni` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_he_market_year_uf_idx`(`year`, `uf`),
    INDEX `bychat_he_market_year_cineArea_idx`(`year`, `cineArea`),
    UNIQUE INDEX `bychat_he_market_year_uf_cityCode_cineArea_modality_isPrivat_key`(`year`, `uf`, `cityCode`, `cineArea`, `modality`, `isPrivate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_he_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `fileName` VARCHAR(191) NULL,
    `fileBytes` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'running',
    `courses` INTEGER NOT NULL DEFAULT 0,
    `institutions` INTEGER NOT NULL DEFAULT 0,
    `marketRows` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_he_imports_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

