-- MeetingType: período do dia liberado ao lead na geração de slots.
-- open = todos os horários da disponibilidade · morning = até 12:00 ·
-- afternoon = 12:00–18:00 · morning_afternoon = até 18:00 (exclui noite).
ALTER TABLE `bychat_meeting_types`
  ADD COLUMN `availabilityPeriod` VARCHAR(20) NOT NULL DEFAULT 'open';
