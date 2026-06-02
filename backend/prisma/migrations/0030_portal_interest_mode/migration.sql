-- Portal de Matrículas — modo "interesse" (captura leve para sites/LPs/parceiros).
--
-- Antes: cada portal era um formulário completo de matrícula (multi-step,
-- documentos, pagamento). Bom para vestibular formal mas pesado demais para
-- captura no topo de funil em parceiros/anúncios.
--
-- Depois: cada portal tem um modo:
--   • formMode='full' (padrão, comportamento atual)
--   • formMode='interest' (form curto: nome+WhatsApp+email+curso+LGPD;
--     gera Lead em status INTERESSADO; dispara workflow com magic link
--     para que o lead complete a inscrição cheia depois)
--
-- Portais 'interest' precisam apontar para um portal 'full' destino
-- (continuationPortalId) — o magic link leva o lead até lá pré-preenchido.
-- Validado em código (FK opcional no schema porque NULL é OK durante criação).

ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `formMode` VARCHAR(20) NOT NULL DEFAULT 'full' AFTER `formConfig`,
  ADD COLUMN `continuationPortalId` INT NULL AFTER `formMode`,
  ADD COLUMN `magicLinkTtlDays` INT NOT NULL DEFAULT 30 AFTER `continuationPortalId`,
  ADD CONSTRAINT `fk_portal_continuation`
    FOREIGN KEY (`continuationPortalId`) REFERENCES `bychat_enrollment_portals`(`id`)
    ON DELETE SET NULL,
  ADD INDEX `idx_form_mode` (`formMode`),
  ADD INDEX `idx_continuation` (`continuationPortalId`);
