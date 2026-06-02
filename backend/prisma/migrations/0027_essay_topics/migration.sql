-- Multi-tema da Redação Online: 1 SelectionProcess pode ter N temas (EssayTopic)
-- e o backend sorteia um ativo a cada tentativa. O campo legado SelectionProcess.essayPrompt
-- continua como fallback se a SP não tiver nenhum tema cadastrado.

CREATE TABLE `bychat_edu_essay_topics` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `selectionProcessId` INT          NOT NULL,
  `title`              VARCHAR(150) NULL,
  `prompt`             TEXT         NOT NULL,
  `supportTexts`       TEXT         NULL,
  `active`             BOOLEAN      NOT NULL DEFAULT TRUE,
  `ordem`              INT          NOT NULL DEFAULT 0,
  `createdAt`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`          DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bychat_edu_essay_topics_spId_idx` (`selectionProcessId`),
  KEY `bychat_edu_essay_topics_active_idx` (`active`),
  CONSTRAINT `bychat_edu_essay_topics_spId_fkey`
    FOREIGN KEY (`selectionProcessId`) REFERENCES `bychat_edu_selection_processes` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
