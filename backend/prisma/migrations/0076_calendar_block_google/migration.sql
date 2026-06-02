-- Espelho do bloqueio/compromisso manual no Google Calendar do operador
ALTER TABLE `bychat_calendar_blocks`
  ADD COLUMN `googleEventId` VARCHAR(191) NULL,
  ADD COLUMN `googleCalendarId` VARCHAR(191) NULL;
