import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const dir of ['src', 'public', 'scripts', 'test']) {
  for (const file of readdirSync(dir).filter((name) => /\.(m?js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
