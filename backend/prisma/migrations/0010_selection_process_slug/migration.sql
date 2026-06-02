-- Slug único do processo seletivo — identificador público referenciado pelo portal de matrículas.
-- Coluna pode ter sido criada parcialmente numa tentativa anterior; este IF garante idempotência.
ALTER TABLE `bychat_edu_selection_processes`
  ADD UNIQUE INDEX `bychat_edu_selection_processes_slug_key` (`slug`);
