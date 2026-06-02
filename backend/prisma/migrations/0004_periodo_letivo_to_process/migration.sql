-- Move periodoLetivo de CourseOffering para SelectionProcess

-- 1. Adiciona coluna em selection_processes
ALTER TABLE `bychat_edu_selection_processes`
  ADD COLUMN `periodoLetivo` VARCHAR(20) NULL;

CREATE INDEX `bychat_edu_selection_processes_periodoLetivo_idx`
  ON `bychat_edu_selection_processes`(`periodoLetivo`);

-- 2. Remove índice e coluna em offerings
DROP INDEX `bychat_edu_offerings_periodoLetivo_idx` ON `bychat_edu_offerings`;
ALTER TABLE `bychat_edu_offerings` DROP COLUMN `periodoLetivo`;
