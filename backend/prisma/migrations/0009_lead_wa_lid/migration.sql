-- Campo para associar lead a JID @lid (LID / Linked ID) do WhatsApp
-- quando o LID não consegue ser resolvido para o número real.
ALTER TABLE `bychat_leads`
  ADD COLUMN `waLid` VARCHAR(100) NULL,
  ADD INDEX `bychat_leads_waLid_idx` (`waLid`);
