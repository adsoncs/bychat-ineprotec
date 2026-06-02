-- Equipes/Setores + atribuição de leads a operadores e equipes
-- Suporta atendimento humano multi-agente com transferência entre setores.

-- ─── Tabela bychat_teams (setores: Comercial, Financeiro, Suporte, ...) ───
CREATE TABLE `bychat_teams` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `slug`        VARCHAR(50) NOT NULL,
  `description` VARCHAR(255) NULL,
  `color`       VARCHAR(20) NOT NULL DEFAULT '#6B7280',
  `icon`        VARCHAR(30) NULL,
  `active`      TINYINT(1) NOT NULL DEFAULT 1,
  `position`    INT NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_teams_slug_key` (`slug`),
  INDEX `bychat_teams_active_position_idx` (`active`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Tabela bychat_team_members (junction User ↔ Team com isLeader) ───
CREATE TABLE `bychat_team_members` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `teamId`    INT NOT NULL,
  `userId`    INT NOT NULL,
  `isLeader`  TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_team_members_teamId_userId_key` (`teamId`, `userId`),
  INDEX `bychat_team_members_userId_idx` (`userId`),
  INDEX `bychat_team_members_teamId_idx` (`teamId`),
  CONSTRAINT `bychat_team_members_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_team_members_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Lead: assignedUserId, teamId, assignedAt (todos NULL — leads legados ficam na fila geral) ───
ALTER TABLE `bychat_leads`
  ADD COLUMN `assignedUserId` INT NULL,
  ADD COLUMN `teamId`         INT NULL,
  ADD COLUMN `assignedAt`     DATETIME(3) NULL,
  ADD INDEX `bychat_leads_assignedUserId_idx` (`assignedUserId`),
  ADD INDEX `bychat_leads_teamId_idx` (`teamId`),
  ADD CONSTRAINT `bychat_leads_assignedUserId_fkey`
    FOREIGN KEY (`assignedUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `bychat_leads_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Chatbot: defaultTeamId (roteamento padrão: chatbot X → setor Y) ───
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `defaultTeamId` INT NULL,
  ADD INDEX `bychat_chatbots_defaultTeamId_idx` (`defaultTeamId`),
  ADD CONSTRAINT `bychat_chatbots_defaultTeamId_fkey`
    FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
