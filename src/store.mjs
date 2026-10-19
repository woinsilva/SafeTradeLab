import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadState(file, fallback) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.schemaVersion !== 1 || parsed?.mode !== 'PAPER_ONLY') throw new Error('Unsupported state file');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}
