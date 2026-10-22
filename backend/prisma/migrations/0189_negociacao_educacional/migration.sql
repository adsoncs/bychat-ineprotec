-- Integração Negociações/Metas/Comissões × Educacional — Fase 1 (base de dados).
-- Aditivo: nenhum fluxo usa estes campos ainda.
ALTER TABLE `bychat_negotiations` ADD COLUMN `registrationId` INTEGER NULL, ADD COLUMN `offeringId` INTEGER NULL, ADD COLUMN `origem` VARCHAR(20) NULL;
CREATE INDEX `bychat_negotiations_registrationId_idx` ON `bychat_negotiations`(`registrationId`);
CREATE INDEX `bychat_negotiations_offeringId_idx` ON `bychat_negotiations`(`offeringId`);
ALTER TABLE `bychat_products` ADD COLUMN `courseId` INTEGER NULL;
CREATE INDEX `bychat_products_courseId_idx` ON `bychat_products`(`courseId`);
ALTER TABLE `bychat_enrollment_registrations` ADD COLUMN `vendedorUserId` INTEGER NULL;
CREATE INDEX `bychat_enrollment_registrations_vendedorUserId_idx` ON `bychat_enrollment_registrations`(`vendedorUserId`);
