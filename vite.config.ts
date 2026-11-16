import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Writes dist/sw.js with a precache list of every built file (app shell + GIFs). */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'heel10-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync('src/sw.template.js', 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        template
          .replace('__VERSION__', version)
          .replace('"__PRECACHE__"', JSON.stringify(['./', ...list])),
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  test: { include: ['src/**/*.test.ts'] },
});
