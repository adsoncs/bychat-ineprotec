-- Link rastreável (05/11/2026): código do clique na mensagem, que liga o clique ao lead.
ALTER TABLE `bychat_trackable_link_clicks`
  ADD COLUMN `codigo` VARCHAR(12) NULL,
  ADD COLUMN `leadId` INT NULL,
  ADD UNIQUE INDEX `bychat_trackable_link_clicks_codigo_key` (`codigo`),
  ADD INDEX `bychat_trackable_link_clicks_leadId_idx` (`leadId`);
