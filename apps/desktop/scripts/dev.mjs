// Starts Electron against the Vite dev server. Strips ELECTRON_RUN_AS_NODE, which
// some editors (e.g. VS Code terminals) set and which would make Electron act like Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env, ZZ_DEV_URL: process.env.ZZ_DEV_URL ?? 'http://localhost:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, cwd: fileURLToPath(new URL('..', import.meta.url)) });
child.on('exit', (code) => process.exit(code ?? 0));
