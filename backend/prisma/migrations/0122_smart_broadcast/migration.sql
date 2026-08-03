-- Disparos Inteligentes (smart_broadcast): campanhas por número próprio (Evolution),
-- com ritmo humanizado, saúde/aquecimento por número, lista de bloqueio e nota de risco.

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_campaigns` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `senderInstances` json NOT NULL,
  `messageBlocks` json NOT NULL,
  `audienceType` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `audienceMeta` json DEFAULT NULL,
  `pacingProfileId` int DEFAULT NULL,
  `pacingConfig` json NOT NULL,
  `windowConfig` json NOT NULL,
  `dailyCapPerNumber` int NOT NULL DEFAULT '20',
  `requireOptIn` tinyint(1) NOT NULL DEFAULT '0',
  `legalBasis` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scheduledAt` datetime(3) DEFAULT NULL,
  `startedAt` datetime(3) DEFAULT NULL,
  `completedAt` datetime(3) DEFAULT NULL,
  `riskState` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ok',
  `riskReason` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `totalRecipients` int NOT NULL DEFAULT '0',
  `sentCount` int NOT NULL DEFAULT '0',
  `failedCount` int NOT NULL DEFAULT '0',
  `skippedCount` int NOT NULL DEFAULT '0',
  `repliedCount` int NOT NULL DEFAULT '0',
  `createdByUserId` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `linkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `optOutFooter` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `replyActions` json DEFAULT NULL,
  `usePreferredTime` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `bychat_smart_campaigns_status_idx` (`status`),
  KEY `bychat_smart_campaigns_scheduledAt_idx` (`scheduledAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_campaign_recipients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `campaignId` int NOT NULL,
  `leadId` int DEFAULT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phoneKey` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `variables` json NOT NULL,
  `assignedInstanceId` int DEFAULT NULL,
  `assignedInstance` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `variantIndex` int NOT NULL DEFAULT '0',
  `plannedAt` datetime(3) DEFAULT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `skipReason` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `externalId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sentText` text COLLATE utf8mb4_unicode_ci,
  `scheduledAt` datetime(3) DEFAULT NULL,
  `sentAt` datetime(3) DEFAULT NULL,
  `deliveredAt` datetime(3) DEFAULT NULL,
  `readAt` datetime(3) DEFAULT NULL,
  `repliedAt` datetime(3) DEFAULT NULL,
  `failedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bychat_smart_campaign_recipients_campaignId_status_idx` (`campaignId`,`status`),
  KEY `bychat_smart_campaign_recipients_plannedAt_idx` (`plannedAt`),
  KEY `bychat_smart_campaign_recipients_externalId_idx` (`externalId`),
  KEY `bychat_smart_campaign_recipients_phoneKey_idx` (`phoneKey`),
  CONSTRAINT `bychat_smart_campaign_recipients_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `bychat_smart_campaigns` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_sender_health` (
  `id` int NOT NULL AUTO_INCREMENT,
  `instanceId` int NOT NULL,
  `instanceName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `day` date NOT NULL,
  `sent` int NOT NULL DEFAULT '0',
  `delivered` int NOT NULL DEFAULT '0',
  `failed` int NOT NULL DEFAULT '0',
  `replies` int NOT NULL DEFAULT '0',
  `notFound` int NOT NULL DEFAULT '0',
  `warmupDay` int NOT NULL DEFAULT '1',
  `dailyCap` int NOT NULL DEFAULT '20',
  `state` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'warming',
  `pausedUntil` datetime(3) DEFAULT NULL,
  `pauseReason` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `score` int NOT NULL DEFAULT '100',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_smart_sender_health_instanceId_day_key` (`instanceId`,`day`),
  KEY `bychat_smart_sender_health_instanceName_idx` (`instanceName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_pacing_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isSystem` tinyint(1) NOT NULL DEFAULT '0',
  `minDelayMs` int NOT NULL DEFAULT '40000',
  `maxDelayMs` int NOT NULL DEFAULT '180000',
  `sessionSize` int NOT NULL DEFAULT '20',
  `sessionBreakMs` int NOT NULL DEFAULT '600000',
  `typingEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `readReceipts` tinyint(1) NOT NULL DEFAULT '1',
  `dailyCapStart` int NOT NULL DEFAULT '20',
  `dailyCapMax` int NOT NULL DEFAULT '250',
  `warmupCurve` json NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_smart_pacing_profiles_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_number_checks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phoneKey` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `exists` tinyint(1) NOT NULL,
  `jid` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `checkedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_smart_number_checks_phoneKey_key` (`phoneKey`),
  KEY `bychat_smart_number_checks_checkedAt_idx` (`checkedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bychat_smart_suppressions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phoneKey` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdByUserId` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_smart_suppressions_phoneKey_key` (`phoneKey`),
  KEY `bychat_smart_suppressions_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
