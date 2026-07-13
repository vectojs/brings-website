import { expect, test } from 'bun:test';
import type { EditorSnapshot, NodeId, PageId, Result } from '@vectojs/brings-core';
import { type IRenderer, VectoJSEvent } from '@vectojs/core';
import type { EditorPagePoint, EditorPageRect } from '../src/editor/selectionCoordinates';
import type {
  AreaSelectionMode,
  PointSelectionMode,
  SelectionInteractionStart,
  SelectionProposal,
} from '../src/editor/selectionInteraction';
import { EditorShell } from '../src/view/EditorShell';

const documentId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002' as PageId;
const first = '11111111-1111-4111-8111-111111111111' as NodeId;
const second = '22222222-2222-4222-8222-222222222222' as NodeId;

function childById(shell: EditorShell, id: string) {
  const find = (
    candidates: readonly (typeof shell.children)[number][],
  ): (typeof shell.children)[number] | undefined => {
    for (const candidate of candidates) {
      if (candidate.id === id) return candidate;
      const nested = find(candidate.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const child = find(shell.children);
  if (!child) throw new Error(`Missing editor region: ${id}`);
  return child;
}

function editorSnapshot(nodeIds: readonly NodeId[] = []): EditorSnapshot {
  return {
    document: {
      id: documentId as EditorSnapshot['document']['id'],
      revision: 4,
      name: 'Fixture',
      pageOrder: [pageId],
      activePageId: pageId,
      pages: [{ id: pageId, name: 'Page 1', rootNodeIds: [first] }],
      nodes: [
        {
          id: first,
          name: 'Frame',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 100, 120],
          type: 'frame',
          childIds: [second],
          width: 100,
          height: 80,
          cornerRadii: [0, 0, 0, 0],
          background: { type: 'solid', r: 1, g: 1, b: 1, a: 1 },
          stroke: null,
          clipChildren: false,
        },
        {
          id: second,
          name: 'Rectangle',
          parentId: first,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 10, 12],
          type: 'rectangle',
          width: 20,
          height: 16,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid', r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
      ],
    },
    selection: { nodeIds: [...nodeIds], activeNodeId: nodeIds.at(-1) ?? null },
    undoDepth: 0,
    redoDepth: 0,
  };
}

function interactionStart(nodeIds: readonly NodeId[] = []): SelectionInteractionStart {
  return {
    token: { documentRevision: 4, selectionGeneration: 1 },
    selection: { nodeIds: [...nodeIds], activeNodeId: nodeIds.at(-1) ?? null },
  };
}

function proposal(start: SelectionInteractionStart, nodeIds: readonly NodeId[]): SelectionProposal {
  return {
    token: { ...start.token },
    originalSelection: {
      nodeIds: [...start.selection.nodeIds],
      activeNodeId: start.selection.activeNodeId,
    },
    selection: { nodeIds: [...nodeIds], activeNodeId: nodeIds.at(-1) ?? null },
  };
}

function dispatchPointer(
  shell: EditorShell,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  input: Readonly<{
    pointerId: number;
    x: number;
    y: number;
    button?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }>,
): VectoJSEvent {
  const canvas = childById(shell, 'brings-canvas-region');
  const event = new VectoJSEvent(
    type,
    canvas,
    {
      pointerId: input.pointerId,
      button: input.button ?? 0,
      shiftKey: input.shiftKey ?? false,
      altKey: input.altKey ?? false,
      ctrlKey: input.ctrlKey ?? false,
      metaKey: input.metaKey ?? false,
    },
    true,
    { x: canvas.x + input.x, y: canvas.y + input.y },
  );
  canvas.dispatchEvent(event);
  return event;
}

function recordingRenderer(): Readonly<{
  renderer: IRenderer;
  calls: Array<Readonly<{ method: string; args: readonly unknown[] }>>;
}> {
  const calls: Array<Readonly<{ method: string; args: readonly unknown[] }>> = [];
  const renderer = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: readonly unknown[]) => {
          calls.push({ method: String(property), args });
        };
      },
    },
  ) as IRenderer;
  return { renderer, calls };
}

function selectionPorts(input: Readonly<{ ownerId?: NodeId | null }> = {}) {
  const start = interactionStart();
  const pointCalls: Array<Readonly<{ point: EditorPagePoint; mode: PointSelectionMode }>> = [];
  const areaCalls: Array<Readonly<{ rect: EditorPageRect; mode: AreaSelectionMode }>> = [];
  const commits: SelectionProposal[] = [];
  return {
    start,
    pointCalls,
    areaCalls,
    commits,
    ports: {
      documentSnapshot: () => editorSnapshot(),
      beginSelectionInteraction: () => start,
      proposePointSelection(
        _captured: SelectionInteractionStart,
        point: EditorPagePoint,
        mode: PointSelectionMode,
      ) {
        pointCalls.push({ point, mode });
        const ownerId = input.ownerId ?? null;
        return {
          ok: true as const,
          value: { ownerId, proposal: proposal(start, ownerId === null ? [] : [ownerId]) },
        };
      },
      proposeAreaSelection(
        _captured: SelectionInteractionStart,
        rect: EditorPageRect,
        mode: AreaSelectionMode,
      ) {
        areaCalls.push({ rect, mode });
        return { ok: true as const, value: proposal(start, [first]) };
      },
      commitSelection(value: SelectionProposal): Result<EditorSnapshot> {
        commits.push(value);
        return { ok: true, value: editorSnapshot(value.selection.nodeIds) };
      },
    },
  };
}

test('projects the named Brings application and primary editor regions', () => {
  const shell = new EditorShell(1440, 900);

  expect(shell.getA11yAttributes()).toEqual({
    role: 'application',
    label: 'Brings design editor',
  });
  expect(shell.children.slice(0, 4).map((child) => child.getA11yAttributes())).toEqual([
    { role: 'toolbar', label: 'Tools' },
    { role: 'tree', label: 'Layers' },
    { role: 'region', label: 'Design canvas', tabIndex: 0 },
    { role: 'group', label: 'Properties' },
  ]);
});

test('keeps closed drawers out of hit testing and accessibility projection', () => {
  const shell = new EditorShell(1024, 768);
  const properties = childById(shell, 'brings-properties');

  expect(properties.interactive).toBe(false);
  expect({
    x: properties.x,
    y: properties.y,
    width: properties.width,
    height: properties.height,
  }).toEqual({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  expect(shell.openDrawer('right')).toBe(true);
  expect(properties.interactive).toBe(true);
  expect({
    x: properties.x,
    y: properties.y,
    width: properties.width,
    height: properties.height,
  }).toEqual({
    x: 728,
    y: 56,
    width: 296,
    height: 712,
  });
});

test('keeps mobile drawers exclusive and marks phone layouts view-only', () => {
  const shell = new EditorShell(700, 600);
  const layers = childById(shell, 'brings-layers');
  const properties = childById(shell, 'brings-properties');

  expect(layers.interactive).toBe(false);
  expect(properties.interactive).toBe(false);
  expect(shell.openDrawer('left')).toBe(true);
  expect(layers.interactive).toBe(true);
  expect(properties.interactive).toBe(false);

  expect(shell.openDrawer('right')).toBe(true);
  expect(layers.interactive).toBe(false);
  expect(properties.interactive).toBe(true);

  shell.resize(390, 600);
  expect(shell.authoringEnabled).toBe(false);
  const notice = childById(shell, 'brings-mobile-mode-notice');
  expect(notice.interactive).toBe(false);
  expect(notice.getContentProjection()).toMatchObject({
    text: 'Authoring tools are disabled on narrow screens. Use view, select, pan, and zoom.',
  });
});

test('projects static chrome labels without making them pointer targets', () => {
  const shell = new EditorShell(1440, 900);
  const title = childById(shell, 'brings-title');
  const workspace = childById(shell, 'brings-workspace-label');

  expect(title.interactive).toBe(false);
  expect(title.getContentProjection()).toMatchObject({ text: 'Brings' });
  expect(workspace.getContentProjection()).toMatchObject({
    text: 'Local-first design workspace',
  });
});

test('starts with the Select tool active so canvas clicks select instead of creating', () => {
  const shell = new EditorShell(1440, 900);
  const selectTool = childById(shell, 'brings-select-tool');

  expect(selectTool.getA11yAttributes()).toEqual({ role: 'button', label: 'Select tool selected' });
});

test('routes unmodified deletion from the focused VMT design region', () => {
  let deleteCalls = 0;
  let prevented = false;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const event = new VectoJSEvent('keydown', canvasRegion, {
    key: 'Delete',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      prevented = true;
    },
  });

  canvasRegion.dispatchEvent(event);

  expect(deleteCalls).toBe(1);
  expect(prevented).toBe(true);
  expect(event.propagationStopped).toBe(true);
});

test('yields modified deletion keys without consuming the focused VMT event', () => {
  let deleteCalls = 0;
  let prevented = 0;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const events = [
    { key: 'Delete', altKey: true, shiftKey: false },
    { key: 'Backspace', altKey: true, shiftKey: false },
    { key: 'Delete', altKey: false, shiftKey: true },
    { key: 'Backspace', altKey: false, shiftKey: true },
  ].map(
    ({ key, altKey, shiftKey }) =>
      new VectoJSEvent('keydown', canvasRegion, {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey,
        shiftKey,
        target: { tagName: 'CANVAS' },
        preventDefault: () => {
          prevented += 1;
        },
      }),
  );

  for (const event of events) canvasRegion.dispatchEvent(event);

  expect(deleteCalls).toBe(0);
  expect(prevented).toBe(0);
  expect(events.map((event) => event.propagationStopped)).toEqual([false, false, false, false]);
});

test('yields deletion to native editors and ignores key events outside the design region', () => {
  let deleteCalls = 0;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const toolbar = childById(shell, 'brings-toolbar');

  canvasRegion.dispatchEvent(
    new VectoJSEvent('keydown', canvasRegion, {
      key: 'Backspace',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: { tagName: 'INPUT' },
      preventDefault: () => undefined,
    }),
  );
  toolbar.dispatchEvent(
    new VectoJSEvent('keydown', toolbar, {
      key: 'Delete',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: { tagName: 'CANVAS' },
      preventDefault: () => undefined,
    }),
  );

  expect(deleteCalls).toBe(0);
});

test('routes one primary Shift marquee through pure proposal and commit ports', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);

  dispatchPointer(shell, 'pointerdown', { pointerId: 7, x: 10, y: 20, shiftKey: true });
  dispatchPointer(shell, 'pointermove', { pointerId: 7, x: 50, y: 70, shiftKey: true });
  dispatchPointer(shell, 'pointerup', { pointerId: 7, x: 50, y: 70, shiftKey: true });

  expect(
    state.pointCalls.map(({ point, mode }) => ({ point: { x: point.x, y: point.y }, mode })),
  ).toEqual([{ point: { x: 10, y: 20 }, mode: 'toggle' }]);
  expect(
    state.areaCalls.map(({ rect, mode }) => ({
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      mode,
    })),
  ).toEqual([
    { rect: { x: 10, y: 20, width: 40, height: 50 }, mode: 'add' },
    { rect: { x: 10, y: 20, width: 40, height: 50 }, mode: 'add' },
  ]);
  expect(state.commits).toEqual([proposal(state.start, [first])]);
});

test('ignores modified and secondary starts while isolating the owner pointer', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);
  const rejected = [
    { pointerId: 1, x: 1, y: 1, altKey: true },
    { pointerId: 2, x: 1, y: 1, ctrlKey: true },
    { pointerId: 3, x: 1, y: 1, metaKey: true },
    { pointerId: 4, x: 1, y: 1, button: 2 },
  ];
  for (const sample of rejected) {
    dispatchPointer(shell, 'pointerdown', sample);
    dispatchPointer(shell, 'pointerup', sample);
  }

  dispatchPointer(shell, 'pointerdown', { pointerId: 8, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 9, x: 60, y: 80 });
  dispatchPointer(shell, 'pointerup', { pointerId: 9, x: 60, y: 80 });
  expect(state.areaCalls).toEqual([]);
  expect(state.commits).toEqual([]);
  dispatchPointer(shell, 'pointerup', { pointerId: 8, x: 10, y: 20 });

  expect(state.pointCalls).toHaveLength(1);
  expect(state.commits).toHaveLength(1);
});

test('cancels before shortcuts, ignores late terminals, and releases the pointer id for reuse', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);
  const canvas = childById(shell, 'brings-canvas-region');
  dispatchPointer(shell, 'pointerdown', { pointerId: 5, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 5, x: 30, y: 40 });
  const escape = new VectoJSEvent('keydown', canvas, {
    key: 'Escape',
    target: { tagName: 'CANVAS' },
    preventDefault: () => undefined,
  });
  canvas.dispatchEvent(escape);
  dispatchPointer(shell, 'pointermove', { pointerId: 5, x: 80, y: 90 });
  dispatchPointer(shell, 'pointerup', { pointerId: 5, x: 80, y: 90 });

  expect(escape.propagationStopped).toBe(true);
  expect(state.commits).toEqual([]);
  const callsBeforeReuse = state.pointCalls.length;
  dispatchPointer(shell, 'pointerdown', { pointerId: 5, x: 4, y: 6 });
  dispatchPointer(shell, 'pointerup', { pointerId: 5, x: 4, y: 6 });
  expect(state.pointCalls).toHaveLength(callsBeforeReuse + 1);
  expect(state.commits).toHaveLength(1);
});

test('does not install a stale begin after its proposal callback routes the owner terminal', () => {
  const state = selectionPorts();
  let shell!: EditorShell;
  let routeTerminal = true;
  shell = new EditorShell(1440, 900, {
    ...state.ports,
    proposePointSelection(start, point, mode) {
      if (routeTerminal) {
        routeTerminal = false;
        dispatchPointer(shell, 'pointerup', { pointerId: 23, x: point.x, y: point.y });
      }
      return state.ports.proposePointSelection(start, point, mode);
    },
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 23, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 23, x: 40, y: 50 });
  dispatchPointer(shell, 'pointerup', { pointerId: 23, x: 40, y: 50 });
  expect(state.commits).toEqual([]);

  dispatchPointer(shell, 'pointerdown', { pointerId: 23, x: 4, y: 6 });
  dispatchPointer(shell, 'pointerup', { pointerId: 23, x: 4, y: 6 });
  expect(state.commits).toHaveLength(1);
});

test('does not let a stale finish close a newer session routed by its area provider', () => {
  const state = selectionPorts();
  let shell!: EditorShell;
  let areaCalls = 0;
  shell = new EditorShell(1440, 900, {
    ...state.ports,
    proposeAreaSelection(start, rect, mode) {
      areaCalls += 1;
      if (areaCalls === 2) {
        dispatchPointer(shell, 'pointercancel', { pointerId: 31, x: 40, y: 50 });
        dispatchPointer(shell, 'pointerdown', { pointerId: 32, x: 8, y: 9 });
      }
      return state.ports.proposeAreaSelection(start, rect, mode);
    },
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 31, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 31, x: 40, y: 50 });
  dispatchPointer(shell, 'pointerup', { pointerId: 31, x: 40, y: 50 });
  dispatchPointer(shell, 'pointerup', { pointerId: 32, x: 8, y: 9 });

  expect(state.commits).toHaveLength(1);
});

test('lets an active wide-screen gesture finish after resizing narrow', () => {
  const state = selectionPorts();
  const shell = new EditorShell(700, 600, state.ports);
  dispatchPointer(shell, 'pointerdown', { pointerId: 11, x: 10, y: 20 });
  shell.resize(390, 600);
  dispatchPointer(shell, 'pointermove', { pointerId: 11, x: 30, y: 50 });
  dispatchPointer(shell, 'pointerup', { pointerId: 11, x: 30, y: 50 });

  expect(state.areaCalls).toHaveLength(2);
  expect(state.commits).toHaveLength(1);
});

test('reports coordinate and begin failures once and quarantines the id until its terminal', () => {
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  let begins = 0;
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    beginSelectionInteraction: () => {
      begins += 1;
      return state.start;
    },
    proposePointSelection: () => ({
      ok: false,
      error: { code: 'test.begin', path: '/point' },
    }),
    reportInteractionError: (error) => errors.push(error),
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 13, x: 1, y: 2 });
  dispatchPointer(shell, 'pointermove', { pointerId: 13, x: 5, y: 6 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 13, x: 7, y: 8 });
  expect(begins).toBe(1);
  expect(errors).toEqual([{ code: 'test.begin', path: '/point' }]);
  dispatchPointer(shell, 'pointerup', { pointerId: 13, x: 7, y: 8 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 13, x: 9, y: 10 });
  expect(begins).toBe(2);
  expect(errors).toHaveLength(2);
});

test('snapshots native pointer getters once before beginning a session', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);
  const canvas = childById(shell, 'brings-canvas-region');
  const reads = new Map<string, number>();
  const once =
    <T>(name: string, value: T): (() => T) =>
    () => {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return value;
    };
  const native = {
    get pointerId() {
      return once('pointerId', 21)();
    },
    get button() {
      return once('button', 0)();
    },
    get shiftKey() {
      return once('shiftKey', true)();
    },
    get altKey() {
      return once('altKey', false)();
    },
    get ctrlKey() {
      return once('ctrlKey', false)();
    },
    get metaKey() {
      return once('metaKey', false)();
    },
  };
  canvas.dispatchEvent(
    new VectoJSEvent('pointerdown', canvas, native, true, {
      x: canvas.x + 10,
      y: canvas.y + 20,
    }),
  );

  expect(Object.fromEntries(reads)).toEqual({
    pointerId: 1,
    button: 1,
    shiftKey: 1,
    altKey: 1,
    ctrlKey: 1,
    metaKey: 1,
  });
  dispatchPointer(shell, 'pointercancel', { pointerId: 21, x: 10, y: 20 });
});

test('renders preview movement once per selected branch and paints marquee after outlines', () => {
  const start = interactionStart([first, second]);
  const state = selectionPorts({ ownerId: first });
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    documentSnapshot: () => editorSnapshot([first, second]),
    beginSelectionInteraction: () => start,
    proposePointSelection: (_start, _point, _mode) => ({
      ok: true,
      value: { ownerId: first, proposal: proposal(start, [first, second]) },
    }),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 15, x: 100, y: 120 });
  dispatchPointer(shell, 'pointermove', { pointerId: 15, x: 120, y: 150 });
  const movementRecording = recordingRenderer();
  shell.render(movementRecording.renderer);
  const movementRects = movementRecording.calls
    .filter((call) => call.method === 'roundRect')
    .map((call) => call.args.slice(0, 4));
  expect(movementRects).toContainEqual([120, 150, 100, 80]);
  expect(movementRects).toContainEqual([130, 162, 20, 16]);
  expect(movementRecording.calls.filter((call) => call.method === 'save')).toHaveLength(
    movementRecording.calls.filter((call) => call.method === 'restore').length,
  );

  const marqueeState = selectionPorts();
  const marqueeShell = new EditorShell(1440, 900, marqueeState.ports);
  dispatchPointer(marqueeShell, 'pointerdown', { pointerId: 17, x: 50, y: 70 });
  dispatchPointer(marqueeShell, 'pointermove', { pointerId: 17, x: 10, y: 20 });
  const marqueeRecording = recordingRenderer();
  marqueeShell.render(marqueeRecording.renderer);
  const marqueeIndex = marqueeRecording.calls.findIndex(
    (call) =>
      call.method === 'roundRect' &&
      JSON.stringify(call.args.slice(0, 5)) === JSON.stringify([10, 20, 40, 50, 0]),
  );
  const outlineIndex = marqueeRecording.calls.findIndex(
    (call) =>
      call.method === 'roundRect' &&
      JSON.stringify(call.args.slice(0, 4)) === JSON.stringify([98, 118, 104, 84]),
  );
  const panelIndex = marqueeRecording.calls.findLastIndex(
    (call) => call.method === 'roundRect' && call.args[1] === 56,
  );
  expect(outlineIndex).toBeGreaterThan(-1);
  expect(marqueeIndex).toBeGreaterThan(outlineIndex);
  expect(panelIndex).toBeGreaterThan(marqueeIndex);
  expect(marqueeRecording.calls.slice(marqueeIndex - 3, marqueeIndex + 4)).toEqual([
    { method: 'save', args: [] },
    { method: 'setGlobalAlpha', args: [1] },
    { method: 'beginPath', args: [] },
    { method: 'roundRect', args: [10, 20, 40, 50, 0] },
    { method: 'fill', args: ['rgba(37, 99, 235, 0.12)'] },
    { method: 'stroke', args: ['#2563eb', 1] },
    { method: 'restore', args: [] },
  ]);
});
