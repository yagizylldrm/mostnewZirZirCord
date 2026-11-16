-- CreateEnum
CREATE TYPE "GifRating" AS ENUM ('G', 'PG', 'PG13', 'R');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "gif" JSONB;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "gifRating" "GifRating" NOT NULL DEFAULT 'PG13';
