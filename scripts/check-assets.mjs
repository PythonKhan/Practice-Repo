// Verifies that every GIF named in src/exercises.json exists in public/ and is a real GIF.
// Default: warn only. With --strict: exit 1 if any are missing.
import { readFileSync, existsSync } from 'node:fs';

const strict = process.argv.includes('--strict');
const { exercises } = JSON.parse(readFileSync('src/exercises.json', 'utf8'));
const problems = [];
for (const ex of exercises) {
  const path = `public/${ex.gif}`;
  if (!existsSync(path)) {
    problems.push(`${path} is missing`);
    continue;
  }
  const head = readFileSync(path).subarray(0, 6).toString('latin1');
  if (head !== 'GIF87a' && head !== 'GIF89a') problems.push(`${path} is not a GIF file`);
}
if (problems.length) {
  console.warn(`\n⚠  Exercise GIF problems (${problems.length}/${exercises.length}):`);
  for (const p of problems) console.warn(`   - ${p}`);
  console.warn('   Copy the supplied GIFs into public/assets/ (see README).\n');
  if (strict) process.exit(1);
} else {
  console.log(`✓ All ${exercises.length} exercise GIFs present.`);
}
