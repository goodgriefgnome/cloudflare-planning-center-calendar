import { spawn } from 'node:child_process';

// Accept the conventional --host argument used by generic development runners.
// Wrangler calls the same setting --ip.
const args = process.argv.slice(2).filter((arg) => arg !== '--' && arg !== '--strictPort').map((arg) => {
  if (arg === '--host' || arg === '--hostname') return '--ip';
  return arg.replace(/^--(?:host|hostname)=/, '--ip=');
});
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
