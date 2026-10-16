-- Redação: a coordenação libera nova tentativa (reprovou, ou a tentativa travou).
-- Limite efetivo de tentativas = SelectionProcess.essayMaxAttempts + essayAttemptsGranted.
ALTER TABLE `bychat_enrollment_registrations`
  ADD COLUMN `essayAttemptsGranted` INTEGER NOT NULL DEFAULT 0;

-- Auditoria da liberação, na tentativa que a originou.
ALTER TABLE `bychat_edu_essay_submissions`
  ADD COLUMN `retakeReleasedBy` INTEGER NULL,
  ADD COLUMN `retakeReleasedAt` DATETIME(3) NULL,
  ADD COLUMN `retakeReleasedNote` TEXT NULL;
