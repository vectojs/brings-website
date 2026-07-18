import { expect, test } from 'bun:test';
import type { Result } from '@vectojs/brings-core';
import {
  viewportPoint,
  viewportToPagePoint,
  type EditorPagePoint,
  type ViewportPoint,
} from '../src/editor/selectionCoordinates';
import {
  PenPathSession,
  type PenPathEffect,
  type PenPointerSample,
} from '../src/view/PenPathSession';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function sample(pointerId: number, x: number, y: number): PenPointerSample {
  const viewport = unwrap(viewportPoint(x, y));
  return Object.freeze({
    pointerId,
    viewportPoint: viewport,
    pagePoint: unwrap(viewportToPagePoint(viewport)),
  });
}

function begin(pointerId = 1, x = 10, y = 10): PenPathSession {
  return unwrap(PenPathSession.begin(sample(pointerId, x, y)));
}

function finishCorner(session: PenPathSession, pointerId: number, x: number, y: number) {
  const started = session.beginAnchor(sample(pointerId, x, y));
  expect(started.kind).toBe('preview');
  return session.finishAnchor(sample(pointerId, x, y));
}

function expectCommit(effect: PenPathEffect) {
  if (effect.kind !== 'commit') throw new Error(`Expected commit, received ${effect.kind}`);
  return effect;
}

test('adds corner anchors and commits an open path through Enter', () => {
  const session = begin();
  expect(session.finishAnchor(sample(1, 10, 10))).toMatchObject({
    kind: 'preview',
    visual: { network: [{ position: { x: 10, y: 10 } }], previewAnchor: null },
  });
  expect(session.update(sample(7, 40, 20))).toMatchObject({
    kind: 'preview',
    visual: { previewAnchor: { position: { x: 40, y: 20 } } },
  });
  finishCorner(session, 2, 40, 20);

  const committed = expectCommit(session.commitOpen());
  expect(committed.closed).toBe(false);
  expect(committed.network).toHaveLength(2);
  expect(committed.network[0]).toEqual({
    position: { x: 10, y: 10 },
    incomingControl: { x: 0, y: 0 },
    outgoingControl: { x: 0, y: 0 },
  });
});

test('creates symmetric incoming and outgoing handles after crossing the drag threshold', () => {
  const session = begin(1, 20, 30);
  expect(session.update(sample(1, 32, 38))).toMatchObject({
    kind: 'preview',
    visual: {
      previewAnchor: {
        position: { x: 20, y: 30 },
        incomingControl: { x: -12, y: -8 },
        outgoingControl: { x: 12, y: 8 },
      },
    },
  });
  session.finishAnchor(sample(1, 32, 38));
  finishCorner(session, 2, 80, 30);

  const committed = expectCommit(session.commitOpen());
  expect(committed.network[0]).toEqual({
    position: { x: 20, y: 30 },
    incomingControl: { x: -12, y: -8 },
    outgoingControl: { x: 12, y: 8 },
  });
});

test('clicking the first anchor closes three corners without adding a duplicate', () => {
  const session = begin(1, 10, 10);
  session.finishAnchor(sample(1, 10, 10));
  finishCorner(session, 2, 60, 10);
  finishCorner(session, 3, 35, 50);

  expect(session.beginAnchor(sample(4, 14, 13))).toMatchObject({
    kind: 'preview',
    visual: { closeCandidate: true },
  });
  const committed = expectCommit(session.finishAnchor(sample(4, 14, 13)));
  expect(committed.closed).toBe(true);
  expect(committed.network).toHaveLength(3);
  expect(committed.network[0]?.position).toEqual({ x: 10, y: 10 });
});

test('double-click commits an existing open path without duplicating its last anchor', () => {
  const session = begin(1, 10, 10);
  session.finishAnchor(sample(1, 10, 10));
  finishCorner(session, 2, 60, 10);
  session.beginAnchor(sample(3, 60, 10));

  const committed = expectCommit(session.finishAnchor(sample(3, 60, 10), { doubleClick: true }));
  expect(committed.closed).toBe(false);
  expect(committed.network).toHaveLength(2);
});

test('Escape, pointer cancellation, tool changes, and authoring loss discard once', () => {
  for (const reason of ['escape', 'tool-change', 'authoring-disabled'] as const) {
    const session = begin();
    expect(session.cancel({ kind: reason })).toEqual({ kind: 'discard', reason });
    expect(session.cancel({ kind: reason })).toEqual({ kind: 'ignore' });
    expect(session.commitOpen()).toEqual({ kind: 'ignore' });
  }
  const pointerSession = begin(4);
  expect(pointerSession.cancel({ kind: 'pointercancel', pointerId: 9 })).toEqual({
    kind: 'ignore',
  });
  expect(pointerSession.cancel({ kind: 'pointercancel', pointerId: 4 })).toEqual({
    kind: 'discard',
    reason: 'pointercancel',
  });
});

test('ignores foreign active pointers before reading their remaining accessors', () => {
  const session = begin(1);
  let reads = 0;
  const foreign = {
    get pointerId() {
      return 9;
    },
    get viewportPoint() {
      reads += 1;
      throw new Error('must not read');
    },
    get pagePoint() {
      reads += 1;
      throw new Error('must not read');
    },
  } as unknown as PenPointerSample;

  expect(session.update(foreign)).toEqual({ kind: 'ignore' });
  expect(session.finishAnchor(foreign)).toEqual({ kind: 'ignore' });
  expect(reads).toBe(0);
});

test('contains invalid coordinates as one stable terminal discard', () => {
  const invalid = {
    pointerId: 1,
    viewportPoint: { x: 10, y: 10 } as ViewportPoint,
    pagePoint: { x: Number.NaN, y: 10 } as EditorPagePoint,
  };
  expect(PenPathSession.begin(invalid)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/pagePoint' },
  });

  const session = begin();
  expect(session.update(invalid)).toEqual({
    kind: 'discard',
    reason: 'error',
    error: { code: 'interaction.coordinate-invalid', path: '/pagePoint' },
  });
  expect(session.finishAnchor(sample(1, 20, 20))).toEqual({ kind: 'ignore' });
});

test('does not let reentrant cancellation from a sample accessor restore a draft', () => {
  const session = begin();
  const reentrant = {
    pointerId: 1,
    get viewportPoint() {
      session.cancel({ kind: 'escape' });
      return { x: 20, y: 20 } as ViewportPoint;
    },
    pagePoint: { x: 20, y: 20 } as EditorPagePoint,
  };

  expect(session.update(reentrant)).toEqual({ kind: 'ignore' });
  expect(session.snapshot()).toMatchObject({ phase: 'terminal', terminalEffect: 'discard' });
});

test('returns fresh deeply frozen diagnostics and terminal effects', () => {
  const session = begin();
  session.update(sample(1, 30, 10));
  const first = session.snapshot();
  const second = session.snapshot();

  expect(first).not.toBe(second);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.network)).toBe(true);
  expect(Object.isFrozen(first.previewAnchor?.position)).toBe(true);
  session.finishAnchor(sample(1, 30, 10));
  finishCorner(session, 2, 80, 20);
  const committed = expectCommit(session.commitOpen());
  expect(Object.isFrozen(committed)).toBe(true);
  expect(Object.isFrozen(committed.network)).toBe(true);
  expect(Object.isFrozen(committed.network[0]?.position)).toBe(true);
});
