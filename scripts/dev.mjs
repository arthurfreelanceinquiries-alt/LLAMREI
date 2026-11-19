// Runs the Llamrei API server (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, LLAMREI_HOST: process.env.LLAMREI_HOST ?? '0.0.0.0' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

const shutdown = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const p of procs) p.on('exit', (code) => { if (code && code !== 0) shutdown(); });
