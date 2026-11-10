-- Agendamento: etapa por desfecho, capacidade por horário e controle de lembretes.
ALTER TABLE `bychat_meeting_types`
  ADD COLUMN `stageOnCompleted` VARCHAR(60) NULL,
  ADD COLUMN `stageOnNoShow` VARCHAR(60) NULL,
  ADD COLUMN `slotCapacity` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `bychat_bookings`
  ADD COLUMN `remindersSent` JSON NULL;
