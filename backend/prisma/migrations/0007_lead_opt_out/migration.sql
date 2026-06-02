-- Sales Engagement A2: Opt-out por canal + token público
-- optOutChannels: ["email","sms",...] | NULL = nada bloqueado
-- optOutToken: identificador único pra link público /preferencias/:token

ALTER TABLE `bychat_leads`
  ADD COLUMN `optOutChannels` JSON NULL,
  ADD COLUMN `optOutToken`    VARCHAR(64) NULL,
  ADD UNIQUE INDEX `bychat_leads_optOutToken_key` (`optOutToken`);
