-- Documento exigido só quando uma resposta do formulário bate (ex.: laudo de quem declarou deficiência).
ALTER TABLE `bychat_edu_entry_mode_doc_requirements` ADD COLUMN `condicao` JSON NULL;
ALTER TABLE `bychat_edu_sp_doc_requirements` ADD COLUMN `condicao` JSON NULL;
