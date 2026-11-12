import { generatePublicId } from '@zirzircord/shared';
import { prisma } from './db';

/** Creates a user with a unique public id (retries on the rare collision). */
export async function createUserWithPublicId(data: {
  displayName: string;
  isGuest: boolean;
  email?: string;
  passwordHash?: string;
}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.user.create({ data: { ...data, publicId: generatePublicId() } });
    } catch (e: any) {
      if (e?.code === 'P2002' && String(e?.meta?.target ?? '').includes('publicId')) continue;
      throw e;
    }
  }
  throw new Error('Could not allocate a unique public id');
}
