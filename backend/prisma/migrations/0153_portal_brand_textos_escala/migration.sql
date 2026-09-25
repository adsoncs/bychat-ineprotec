-- Últimos pedaços da tela pública que ainda eram código: cor de apoio, escala
-- de tipografia, largura do conteúdo e os textos da interface.
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `brandSecondaryColor` VARCHAR(20) NULL,
  ADD COLUMN `brandTypeScale` VARCHAR(20) NULL,
  ADD COLUMN `brandContentWidth` VARCHAR(20) NULL,
  ADD COLUMN `brandLabels` JSON NULL;
