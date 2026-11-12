import { z } from 'zod';

/**
 * The site's Content-Security-Policy forbids eval. zod checks whether it may
 * compile validators with `Function()` when schemas are created, which the CSP
 * blocks and reports. Turning its JIT off skips that check; validation is the same.
 * Imported first in main.tsx so it runs before @zirzircord/shared defines schemas.
 */
z.config({ jitless: true });
