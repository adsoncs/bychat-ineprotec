-- Duplicidade de inscrições no portal: mesclagem (reversível) e "manter separadas".
ALTER TABLE `bychat_enrollment_registrations`
  ADD COLUMN `mergedIntoId` INTEGER NULL,
  ADD COLUMN `statusAntesDaMescla` VARCHAR(30) NULL,
  ADD COLUMN `duplicataIgnorada` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `bychat_enrollment_registrations_mergedIntoId_idx` ON `bychat_enrollment_registrations`(`mergedIntoId`);
