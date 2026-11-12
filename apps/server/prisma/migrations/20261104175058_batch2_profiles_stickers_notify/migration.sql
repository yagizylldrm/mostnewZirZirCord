-- CreateEnum
CREATE TYPE "NotifyLevel" AS ENUM ('ALL', 'MENTIONS', 'NONE');

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'STICKER';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mentions" TEXT[],
ADD COLUMN     "mentionsEveryone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "membersCanMentionEveryone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SessionMember" ADD COLUMN     "mutedUntil" TIMESTAMP(3),
ADD COLUMN     "notifyLevel" "NotifyLevel" NOT NULL DEFAULT 'MENTIONS',
ADD COLUMN     "serverMuted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarStaticKey" TEXT,
ADD COLUMN     "bannerKey" TEXT,
ADD COLUMN     "bannerStaticKey" TEXT;

-- CreateTable
CREATE TABLE "ChannelMute" (
    "channelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mutedUntil" TIMESTAMP(3),

    CONSTRAINT "ChannelMute_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "Sticker" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelMute_userId_idx" ON "ChannelMute"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Sticker_storageKey_key" ON "Sticker"("storageKey");

-- CreateIndex
CREATE INDEX "Sticker_ownerId_idx" ON "Sticker"("ownerId");

-- AddForeignKey
ALTER TABLE "ChannelMute" ADD CONSTRAINT "ChannelMute_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
