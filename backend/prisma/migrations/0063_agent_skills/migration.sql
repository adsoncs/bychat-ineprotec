-- 0063_agent_skills
-- Fase 5 do módulo Lead Routing — skills do agente para skill-based matching.
--
-- bychat_agent_skills: skill é VARCHAR(64) livre (ex: "graduacao", "pos", "pt-BR", "norte").
-- level 1-5 é informacional por enquanto (F5 só usa presença); F8+ pode aplicar scoring.
-- Constraint unique (userId, skill) evita duplicata; index em skill para query reversa.

CREATE TABLE `bychat_agent_skills` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `skill` VARCHAR(64) NOT NULL,
  `level` TINYINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_agent_skills_userId_skill_key` (`userId`, `skill`),
  KEY `bychat_agent_skills_skill_idx` (`skill`),
  CONSTRAINT `bychat_agent_skills_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
