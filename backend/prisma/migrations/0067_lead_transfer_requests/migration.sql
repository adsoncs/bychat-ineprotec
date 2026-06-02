-- 0067_lead_transfer_requests
-- Reforma F3 — Transferência consensual de leads.
--
-- No modelo agente-isolado, força ≠ admin não pode roubar lead via /claim?force=1.
-- Em vez disso, agente A solicita transferência para agente B; B aceita ou recusa.
-- ADMIN/SUPERADMIN continuam usando /assign direto (bypass).
--
-- Status: pending | accepted | rejected | cancelled | expired
-- Auto-cancela após routing.transfer.timeoutHours (default 24h).

CREATE TABLE `bychat_lead_transfer_requests` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `leadId` INT NOT NULL,
  `fromUserId` INT NOT NULL,
  `toUserId` INT NOT NULL,
  `status` VARCHAR(15) NOT NULL DEFAULT 'pending',
  `reason` VARCHAR(255) NULL,
  `response` VARCHAR(255) NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `respondedAt` DATETIME(3) NULL,
  `respondedByUserId` INT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `bychat_lead_transfer_requests_leadId_idx` (`leadId`),
  KEY `bychat_lead_transfer_requests_toUserId_status_idx` (`toUserId`, `status`),
  KEY `bychat_lead_transfer_requests_fromUserId_status_idx` (`fromUserId`, `status`),
  KEY `bychat_lead_transfer_requests_status_expiresAt_idx` (`status`, `expiresAt`),
  CONSTRAINT `bychat_lead_transfer_requests_leadId_fkey`
    FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_lead_transfer_requests_fromUserId_fkey`
    FOREIGN KEY (`fromUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_lead_transfer_requests_toUserId_fkey`
    FOREIGN KEY (`toUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Setting de configuração do timeout
INSERT INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
  VALUES (
    'routing.transfer.timeoutHours',
    CAST('24' AS JSON),
    'Transferência — auto-cancela após (horas)',
    'routing',
    'number',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  )
  ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);
