-- Etapas depois da inscrição, com ordem escolhida por portal (inscrição e
-- portal logado), e o aceite do contrato feito já na inscrição.
ALTER TABLE `bychat_enrollment_portals` ADD COLUMN `jornadaEtapas` JSON NULL;
ALTER TABLE `bychat_enrollment_registrations` ADD COLUMN `contratoAceite` JSON NULL;
