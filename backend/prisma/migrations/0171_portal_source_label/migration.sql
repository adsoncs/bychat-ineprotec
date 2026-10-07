-- "Nome da origem" por portal: leads do portal passam a ter `source`
-- = enrollment_portal:<id> quando preenchido (mesmo esquema do form:<id>).
ALTER TABLE `bychat_enrollment_portals` ADD COLUMN `sourceLabel` VARCHAR(100) NULL;
