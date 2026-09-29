-- Endereço do curso no link do portal (/portal/<portal>/<slug>): abre o portal só com este curso.
ALTER TABLE `bychat_edu_offerings` ADD COLUMN `slug` VARCHAR(100) NULL;
CREATE UNIQUE INDEX `bychat_edu_offerings_slug_key` ON `bychat_edu_offerings`(`slug`);
