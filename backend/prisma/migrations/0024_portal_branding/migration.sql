-- Branding visual por portal (aba 🎨 Visual no admin).
-- Campos compartilhados entre /portal/:slug e /candidato/:code.

ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `brandLogoUrl`            VARCHAR(500) NULL,
  ADD COLUMN `brandLogoLink`           VARCHAR(500) NULL,
  ADD COLUMN `brandFaviconUrl`         VARCHAR(500) NULL,
  ADD COLUMN `brandPrimaryColor`       VARCHAR(20)  NULL,
  ADD COLUMN `brandHeroEnabled`        BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN `brandHeroUrl`            VARCHAR(500) NULL,
  ADD COLUMN `brandHeroTitle`          VARCHAR(191) NULL,
  ADD COLUMN `brandHeroSubtitle`       VARCHAR(500) NULL,
  ADD COLUMN `brandHeroOverlayOpacity` INT          NULL,
  ADD COLUMN `brandFooterText`         TEXT         NULL,
  ADD COLUMN `brandFontFamily`         VARCHAR(40)  NULL,
  ADD COLUMN `brandRadiusScale`        VARCHAR(20)  NULL;
