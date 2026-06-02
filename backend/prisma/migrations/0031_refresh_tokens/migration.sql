-- Refresh tokens com rotação por família.
--
-- Cada login gera (access JWT 15min) + (refresh 30d). O refresh vai num
-- cookie httpOnly e nunca expõe-se ao JS do frontend. Quando o access
-- expira, o cliente chama POST /api/admin/refresh: o servidor valida o
-- refresh, **revoga o atual** (one-time use), gera um novo dentro da
-- mesma `family` (UUID compartilhado entre as gerações de uma sessão) e
-- devolve um novo access + novo refresh cookie.
--
-- Detecção de roubo: se um refresh já revogado é apresentado de novo,
-- toda a `family` é revogada (signal de que alguém clonou o cookie).
--
-- O hash é SHA-256 do token bruto — o token nunca é gravado em claro.

CREATE TABLE `bychat_refresh_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `family` VARCHAR(36) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `replacedById` INT NULL,
  `userAgent` VARCHAR(255) NULL,
  `ip` VARCHAR(45) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_refresh_tokens_tokenHash_key` (`tokenHash`),
  INDEX `bychat_refresh_tokens_userId_idx` (`userId`),
  INDEX `bychat_refresh_tokens_family_idx` (`family`),
  INDEX `bychat_refresh_tokens_expiresAt_idx` (`expiresAt`),

  CONSTRAINT `bychat_refresh_tokens_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
