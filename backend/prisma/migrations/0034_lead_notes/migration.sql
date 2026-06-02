-- LeadNote: substitui o campo único Lead.annotation por um histórico append-only.
-- Cada anotação fica salva como registro próprio (autor + timestamp + conteúdo)
-- e o operador vê toda a evolução do lead, não só o último texto.
-- O campo Lead.annotation é mantido na tabela como deprecated; o conteúdo
-- pré-existente é portado para esta tabela como nota legada (userId NULL).

CREATE TABLE `bychat_lead_notes` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `leadId`    INT NOT NULL,
  `userId`    INT NULL,
  `userName`  VARCHAR(100) NULL,
  `content`   TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `bychat_lead_notes_leadId_createdAt_idx` (`leadId`, `createdAt`),
  CONSTRAINT `bychat_lead_notes_leadId_fkey`
    FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: cada anotação legada vira uma nota com autor desconhecido (userId=NULL,
-- userName=NULL → UI mostra como "—"). Usa updatedAt do lead como aproximação
-- de "quando foi escrita" — não temos a data real do antigo modelo.
INSERT INTO `bychat_lead_notes` (`leadId`, `userId`, `userName`, `content`, `createdAt`)
SELECT `id`, NULL, NULL, `annotation`, COALESCE(`updatedAt`, `createdAt`)
FROM `bychat_leads`
WHERE `annotation` IS NOT NULL
  AND TRIM(`annotation`) <> '';
