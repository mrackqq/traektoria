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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  locks.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
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

export class FileStore implements Store {
  async read(ownerId: string): Promise<UserState> {
    try {
      const raw = await readFile(fileFor(ownerId), 'utf8');
      // Файл мог быть записан прежней версией и не знать о новых полях.
      // Сохранённые данные пользователя обязаны переживать обновление кода.
      return normalizeUserState(deserializeState(raw), ownerId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyUserState(ownerId);
      throw err;
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
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, serializeState(state), 'utf8');
    await rename(tmp, target);
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
