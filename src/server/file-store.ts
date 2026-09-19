/**
 * Файловая реализация хранилища.
 *
 * Честная область применения: один процесс, демонстрационный контур.
 * ARCH-01 требует PostgreSQL, и подмену этого не изображаем — здесь
 * воспроизведена та же СЕМАНТИКА (атомарная запись, сериализация команд
 * по владельцу, оптимистичная блокировка по ревизии), но не те же гарантии:
 * при нескольких процессах атомарности между чтением и записью не будет.
 * Заменяется одной новой реализацией `Store` без правок ядра и страниц.
 *
 * MODEL-04: суммы хранятся в минимальных единицах как bigint, поэтому
 * сериализация своя — JSON.stringify не умеет bigint, а превращать деньги
 * в number нельзя (DATA-09).
 */

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  emptyUserState,
  normalizeUserState,
  type Store,
  type TxOutcome,
  type UserState,
} from './ports';

const DATA_DIR = process.env.TRAJECTORY_DATA_DIR ?? path.join(process.cwd(), '.data');

/* ------------------------------------------------------------------ */
/* Сериализация с bigint                                               */
/* ------------------------------------------------------------------ */

const BIGINT_TAG = '__bigint__';

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    BIGINT_TAG in (value as Record<string, unknown>)
  ) {
    return BigInt(String((value as Record<string, unknown>)[BIGINT_TAG]));
  }
  return value;
}

export function serializeState(state: UserState): string {
  return JSON.stringify(state, replacer, 2);
}

export function deserializeState(raw: string): UserState {
  return JSON.parse(raw, reviver) as UserState;
}

/* ------------------------------------------------------------------ */
/* Сериализация команд по владельцу                                    */
/* ------------------------------------------------------------------ */

/**
 * Очередь промисов на владельца: пока одна транзакция не завершилась,
 * следующая не начинает читать. Без этого два параллельных запроса
 * прочитали бы один снимок и второй затёр бы первый — ровно та «тихая
 * потеря данных», которую запрещают PF-06 и TASK-06.
 */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.then(fn, fn);
  // В карте держим «хвост» без значения, чтобы отказ одной команды
  // не отменял следующие.
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, tail);

  // Очередь пуста — запись больше не нужна. Без этого карта росла бы на
  // одну строку с каждым НОВЫМ владельцем и не уменьшалась никогда:
  // за время жизни процесса это утечка, пропорциональная числу посетителей.
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });

  return current;
}

/** Сколько живёт чужой временный файл, прежде чем его считать брошенным. */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

let sweptDirs: Set<string> | undefined;

/**
 * Уборка временных файлов, брошенных прошлым запуском.
 *
 * `writeAtomically` пишет во временный файл и переименовывает его. Если
 * процесс умер между этими шагами, `.tmp` остаётся на диске навсегда:
 * штатный цикл чтения и записи его не трогает. Подметаем один раз за запуск
 * и только заведомо старые файлы, чтобы не тронуть запись соседнего процесса.
 */
async function sweepStaleTmp(dir: string): Promise<void> {
  sweptDirs ??= new Set();
  if (sweptDirs.has(dir)) return;
  sweptDirs.add(dir);

  try {
    const now = Date.now();
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.tmp')) continue;
      const full = path.join(dir, name);
      try {
        const info = await stat(full);
        if (now - info.mtimeMs > TMP_MAX_AGE_MS) await unlink(full);
      } catch {
        // Файл уже убрали или он занят — это не наша забота.
      }
    }
  } catch {
    // Каталога ещё нет либо он недоступен: уборка не обязана мешать работе.
  }
}

/* ------------------------------------------------------------------ */
/* Реализация                                                          */
/* ------------------------------------------------------------------ */

function fileFor(ownerId: string): string {
  // Идентификатор владельца не попадает в путь как есть: имя файла не место
  // для пользовательского ввода.
  const safe = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

/**
 * Отвести испорченный файл в сторону, а не удалять.
 *
 * Данные пользователя нельзя молча выбрасывать даже когда они нечитаемы:
 * из отложенной копии их можно разобрать руками. Переименование — лучшая
 * попытка, и его неудача не должна мешать странице открыться.
 */
async function quarantine(target: string): Promise<string | null> {
  const parked = `${target}.corrupt-${Date.now()}`;
  try {
    await rename(target, parked);
    return parked;
  } catch {
    return null;
  }
}

export class FileStore implements Store {
  async read(ownerId: string): Promise<UserState> {
    const target = fileFor(ownerId);

    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyUserState(ownerId);
      throw err;
    }

    try {
      // Файл мог быть записан прежней версией и не знать о новых полях.
      // Сохранённые данные пользователя обязаны переживать обновление кода.
      return normalizeUserState(deserializeState(raw), ownerId);
    } catch (err) {
      // Содержимое нечитаемо: оборванная запись, ручная правка, испорченный
      // тег bigint. Раньше SyntaxError всплывал до страницы и посетитель
      // получал 500 без единого способа выбраться. Отводим файл в сторону
      // и продолжаем с пустым состоянием: продукт остаётся рабочим, а данные
      // сохраняются для разбора.
      const parked = await quarantine(target);
      console.error(
        `[file-store] состояние владельца ${ownerId} нечитаемо и отложено` +
          `${parked ? ` в ${path.basename(parked)}` : ' (переименовать не удалось)'}: ` +
          `${(err as Error).message}`,
      );
      return emptyUserState(ownerId);
    }
  }

  async transact<T>(ownerId: string, fn: (state: UserState) => TxOutcome<T>): Promise<T> {
    return withLock(ownerId, async () => {
      const state = await this.read(ownerId);
      const outcome = fn(state);
      if (outcome.kind === 'abort') return outcome.result;
      await this.writeAtomically(ownerId, outcome.next);
      return outcome.result;
    });
  }

  /** Запись через временный файл и rename: недописанный JSON не станет состоянием. */
  private async writeAtomically(ownerId: string, state: UserState): Promise<void> {
    const target = fileFor(ownerId);
    const dir = path.dirname(target);
    await mkdir(dir, { recursive: true });
    await sweepStaleTmp(dir);

    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmp, serializeState(state), 'utf8');
      await rename(tmp, target);
    } catch (err) {
      // Диск полон, нет прав, файл занят — временный файл не должен пережить
      // неудачу и копиться на диске.
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}

/**
 * Один экземпляр на процесс.
 *
 * В dev-режиме Next перезагружает модули, поэтому ссылка живёт в globalThis —
 * иначе при каждом обновлении появлялся бы новый набор блокировок и
 * сериализация команд переставала бы работать ровно тогда, когда её проверяют.
 */
const globalRef = globalThis as typeof globalThis & { __trajectoryStore?: Store };

export function getStore(): Store {
  if (!globalRef.__trajectoryStore) globalRef.__trajectoryStore = new FileStore();
  return globalRef.__trajectoryStore;
}
