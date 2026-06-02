-- Chatbot vinculado a Enrollment Portal
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `enrollmentPortalId` INT NULL,
  ADD INDEX `bychat_chatbots_enrollmentPortalId_idx` (`enrollmentPortalId`);
