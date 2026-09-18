/**
 * Проверки «Моста к мечте»: BR-06, BR-07, ST-05 и регрессия на откат
 * расписания в прошлое при отсутствии экзаменационной сессии.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EVALUATED } from '../kernel/status.ts';
import type { EvaluatedNode } from '../eligibility/evaluate.ts';
import type { Deadline, PlanningClock } from '../kernel/time.ts';
import { buildBridge, type TaskOverride } from './bridge.ts';
import { findTemplate } from './tasks-library.ts';

const CLOCK: PlanningClock = { now: '2026-09-18T06:00:00Z', timezone: 'Asia/Almaty' };

function leaf(nodeId: string, countingKey: string): EvaluatedNode {
  return {
    nodeId,
    title: `Условие ${nodeId}`,
    kind: 'LEAF',
    outcome: EVALUATED('NOT_MET'),
    reasonCodes: [],
    explanation: '',
    sourceIds: ['src-1'],
    critical: true,
    evidence: [],
    children: [],
    countingKey,
  };
}

function tree(children: EvaluatedNode[]): EvaluatedNode {
  return {
    nodeId: 'root',
    title: 'Условия приёма',
    kind: 'ALL',
    outcome: EVALUATED('NOT_MET'),
    reasonCodes: [],
    explanation: '',
    sourceIds: ['src-1'],
    critical: true,
    evidence: [],
    children,
  };
}

function deadline(over: Partial<Deadline> & { id: string }): Deadline {
  return {
    id: over.id,
    kind: over.kind ?? 'application_submission',
    precision: over.precision ?? 'instant',
    localDate: over.localDate ?? '2027-07-05',
    localTime: 'localTime' in over ? over.localTime : '18:00',
    timezone: 'timezone' in over ? over.timezone : 'Asia/Almaty',
    inclusive: over.inclusive ?? true,
    hard: over.hard ?? true,
    sourceId: over.sourceId ?? 'src-1',
    ...(over.note ? { note: over.note } : {}),
  };
}

function run(overrides?: Map<string, TaskOverride>, deadlines: Deadline[] = [deadline({ id: 'dl-apply' })]) {
  return buildBridge({
    programId: 'p-1',
    intakeId: 'i-1',
    admissionPathId: 'path-1',
    evaluation: tree([leaf('l-ent', 'exam:ent')]),
    deadlines,
    clock: CLOCK,
    weeklyHours: 20,
    ...(overrides ? { taskOverrides: overrides } : {}),
  });
}

test('BR-05: цепочка действий строится по семантическому ключу условия', () => {
  const bridge = run();
  const route = bridge.routes[0];
  assert.ok(route, 'маршрут должен быть построен');

  const keys = route.tasks.map((t) => t.semanticKey).sort();
  assert.deepEqual(keys, [
    'application:submit',
    'ent:prepare',
    'ent:register',
    'ent:result',
    'ent:take',
  ]);
});

test('ST-05: выполненная часть подготовки не теряется и сокращает остаток', () => {
  const base = run();
  const withProgress = run(
    new Map([['ent:prepare', { completedFraction: 0.6 }]]),
  );

  const before = base.routes[0]!.tasks.find((t) => t.semanticKey === 'ent:prepare')!;
  const after = withProgress.routes[0]!.tasks.find((t) => t.semanticKey === 'ent:prepare')!;

  assert.ok(
    after.earliestFinish < before.earliestFinish,
    `остаток подготовки должен заканчиваться раньше: было ${before.earliestFinish}, стало ${after.earliestFinish}`,
  );
  assert.equal(after.earliestStart, before.earliestStart, 'дата начала не меняется');
});

test('Регрессия: нет сессии после нужной даты — задача не уезжает в прошлое', () => {
  const sessions = findTemplate('ent:take')?.sessionDates ?? [];
  const lastSession = sessions[sessions.length - 1]!;

  const base = run();
  const baseTake = base.routes[0]!.tasks.find((t) => t.semanticKey === 'ent:take')!;

  // Сдвигаем доступность за последнюю опубликованную сессию.
  const afterLast = addOneDay(lastSession);
  const after = run(new Map([['ent:take', { availableFrom: afterLast }]]));
  const shifted = after.routes[0]!.tasks.find((t) => t.semanticKey === 'ent:take')!;

  assert.ok(
    shifted.earliestStart >= afterLast,
    `дата сдачи не может стать раньше доступности: ${shifted.earliestStart}`,
  );
  assert.ok(
    shifted.earliestStart >= baseTake.earliestStart,
    'событие-задержка не имеет права двигать задачу в прошлое',
  );

  const codes = after.routes[0]!.feasibility.limitations.map((l) => l.code);
  assert.ok(
    codes.includes('NO_EXAM_SESSION_IN_WINDOW'),
    `отсутствие сессии должно быть названо явно, получено: ${codes.join(', ')}`,
  );
  assert.notEqual(
    after.routes[0]!.feasibility.status,
    'feasible_under_assumptions',
    'график без доступной сессии не может считаться сходящимся',
  );
});

test('BR-07 / AC-08: отсечка без времени и зоны не даёт точного обратного отсчёта', () => {
  const bridge = run(undefined, [
    deadline({
      id: 'dl-apply',
      precision: 'date_only',
      localTime: undefined,
      timezone: undefined,
      inclusive: 'unknown',
      note: 'Источник не указал время и часовой пояс.',
    }),
  ]);

  const route = bridge.routes[0]!;
  const bound = route.tasks.filter((t) => t.boundByDeadlineId === 'dl-apply');
  assert.ok(bound.length > 0, 'хотя бы одна задача подчинена отсечке');
  assert.ok(
    bound.every((t) => t.deadlineUncertain),
    'неполная отсечка помечается как неопределённая',
  );
  assert.ok(
    route.feasibility.limitations.some((l) => l.code === 'DEADLINE_UNKNOWN'),
    'неопределённость срока называется прямо, а не подставляется как 23:59',
  );
});

test('BR-09: число рассмотренных альтернатив и полнота перебора сообщаются', () => {
  const bridge = run();
  assert.ok(bridge.consideredCount >= 1);
  assert.equal(typeof bridge.searchComplete, 'boolean');
  assert.ok(bridge.routes.length <= 3, 'показываем не более трёх путей');
});

function addOneDay(d: string): string {
  const ms = Date.parse(`${d}T00:00:00Z`) + 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
