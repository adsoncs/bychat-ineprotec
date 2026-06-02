-- Gap #2 — Nota de corte por oferta (override opcional do processo)
ALTER TABLE `bychat_edu_offerings`
  ADD COLUMN `notaCorte` DOUBLE NULL;
