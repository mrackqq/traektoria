/**
 * Resolve-хук для `node --test`.
 *
 * Приложение импортирует соседние модули без расширения (moduleResolution
 * bundler) и использует алиасы `@core/*` и `@/*` из tsconfig. Node не знает
 * ни того, ни другого. Хук достраивает `.ts` и разворачивает алиасы, чтобы
 * тесты шли прямо на исходниках — без сборки и без dev-зависимостей
 * (REL-02: покрытие меряется по тому же коду, который работает).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALIASES = [
  { prefix: '@core/', target: path.join(ROOT, 'src', 'core') },
  { prefix: '@/', target: path.join(ROOT, 'src') },
];

function firstExisting(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (path.extname(candidate) !== '' && existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  for (const { prefix, target } of ALIASES) {
    if (specifier.startsWith(prefix)) {
      const base = path.join(target, specifier.slice(prefix.length));
      const found = firstExisting(base);
      if (found) return next(pathToFileURL(found).href, context);
    }
  }

  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && path.extname(specifier) === '') {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const found = firstExisting(path.resolve(path.dirname(parent), specifier));
    if (found) return next(pathToFileURL(found).href, context);
  }

  return next(specifier, context);
}
