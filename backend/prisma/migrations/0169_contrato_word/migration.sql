-- Contrato em Word: o modelo guarda o .docx da instituição, onde ele vale
-- (portais e cursos) e os campos que o arquivo usa. O envelope aponta para a
-- inscrição do portal quando é assinado ainda na inscrição.
ALTER TABLE `AcaContratoTemplate`
  ADD COLUMN `arquivoDocx` LONGTEXT NULL,
  ADD COLUMN `arquivoDocxNome` VARCHAR(191) NULL,
  ADD COLUMN `camposDocx` JSON NULL,
  ADD COLUMN `portalIds` JSON NULL,
  ADD COLUMN `cursoIds` JSON NULL;
ALTER TABLE `AcaAssinatura`
  ADD COLUMN `registrationId` INTEGER NULL;
CREATE INDEX `AcaAssinatura_registrationId_idx` ON `AcaAssinatura`(`registrationId`);
-- Assinatura por link (a pessoa assina na hora, pelo portal — sem e-mail).
ALTER TABLE `AcaSignatario`
  MODIFY `deliveryMethod` ENUM('EMAIL', 'SMS', 'WHATSAPP', 'LINK') NOT NULL DEFAULT 'EMAIL';
