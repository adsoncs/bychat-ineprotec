-- EnrollmentPortal: funil/etapa destino para leads criados via portal
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `funnelId` INT NULL,
  ADD COLUMN `stageKey` VARCHAR(50) NULL,
  ADD INDEX `bychat_enrollment_portals_funnelId_idx` (`funnelId`);
