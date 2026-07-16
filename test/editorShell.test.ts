import { expect, test } from 'bun:test';
import type {
  AlignmentGuide,
  EditorSnapshot,
  Matrix,
  NodeId,
  PageId,
  ResizeHandlePosition,
  Result,
  SelectionResizeProposalInput,
} from '@vectojs/brings-core';
import { type IRenderer, VectoJSEvent } from '@vectojs/core';
import type { EditorPagePoint, EditorPageRect } from '../src/editor/selectionCoordinates';
import type {
  AreaSelectionMode,
  PointSelectionMode,
  ResizeInteractionProposal,
  ResizeInteractionStart,
  SelectionInteractionStart,
  SelectionProposal,
} from '../src/editor/selectionInteraction';
import { EditorShell } from '../src/view/EditorShell';

const documentId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002' as PageId;
const first = '11111111-1111-4111-8111-111111111111' as NodeId;
const second = '22222222-2222-4222-8222-222222222222' as NodeId;
const third = '33333333-3333-4333-8333-333333333333' as NodeId;
const fourth = '44444444-4444-4444-8444-444444444444' as NodeId;

function alignmentGuide(
  axis: AlignmentGuide['axis'],
  coordinate: number,
  minExtent: number,
  maxExtent: number,
): AlignmentGuide {
  return Object.freeze({
    axis,
    sourceAnchor: 'center',
    targetAnchor: 'center',
    targetNodeId: third,
    coordinate,
    minExtent,
    maxExtent,
  });
}

const resizeHandles = Object.freeze([
  { handle: 'north-west', point: { x: 100, y: 120 } },
  { handle: 'north', point: { x: 150, y: 120 } },
  { handle: 'north-east', point: { x: 200, y: 120 } },
  { handle: 'east', point: { x: 200, y: 160 } },
  { handle: 'south-east', point: { x: 200, y: 200 } },
  { handle: 'south', point: { x: 150, y: 200 } },
  { handle: 'south-west', point: { x: 100, y: 200 } },
  { handle: 'west', point: { x: 100, y: 160 } },
] satisfies readonly ResizeHandlePosition[]);

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

function resizeStart(
  handles: readonly ResizeHandlePosition[] = resizeHandles,
): ResizeInteractionStart {
  return Object.freeze({
    token: Object.freeze({ documentRevision: 4, selectionGeneration: 1 }),
    selection: Object.freeze({ nodeIds: Object.freeze([first]), activeNodeId: first }),
    bounds: Object.freeze({ minX: 100, minY: 120, maxX: 200, maxY: 200 }),
    handles: Object.freeze(
      handles.map((entry) =>
        Object.freeze({
          handle: entry.handle,
          point: Object.freeze({ x: entry.point.x, y: entry.point.y }),
        }),
      ),
    ),
  });
}

function resizeProposal(
  start: ResizeInteractionStart,
  input: SelectionResizeProposalInput,
  delta: Matrix = Object.freeze([2, 0, 0, 3, -100, -240]),
  guides: readonly AlignmentGuide[] = Object.freeze([]),
): ResizeInteractionProposal {
  return Object.freeze({
    token: start.token,
    selection: start.selection,
    input: Object.freeze({
      handle: input.handle,
      startPoint: Object.freeze({ ...input.startPoint }),
      currentPoint: Object.freeze({ ...input.currentPoint }),
      preserveAspectRatio: input.preserveAspectRatio,
      fromCenter: input.fromCenter,
    }),
    resize: Object.freeze({
      handle: input.handle,
      anchor: Object.freeze({ x: 100, y: 120 }),
      scaleX: delta[0],
      scaleY: delta[3],
      bounds: Object.freeze({ minX: 100, minY: 120, maxX: 300, maxY: 360 }),
      command: Object.freeze({
        kind: 'apply-transform-delta',
        nodeIds: start.selection.nodeIds,
        delta,
      }),
    }),
    guides,
  });
}

function resizePorts(
  input: Readonly<{
    start?: ResizeInteractionStart;
    delta?: Matrix;
    guides?: readonly AlignmentGuide[];
    snapshot?: () => EditorSnapshot;
  }> = {},
) {
  const start = input.start ?? resizeStart();
  const proposals: ResizeInteractionProposal[] = [];
  const samples: SelectionResizeProposalInput[] = [];
  const commits: ResizeInteractionProposal[] = [];
  let beginCalls = 0;
  return {
    start,
    proposals,
    samples,
    commits,
    get beginCalls() {
      return beginCalls;
    },
    ports: {
      documentSnapshot: input.snapshot ?? (() => editorSnapshot([first])),
      beginResizeInteraction: () => {
        beginCalls += 1;
        return { ok: true as const, value: start };
      },
      proposeResize(
        value: Readonly<{ start: ResizeInteractionStart; input: SelectionResizeProposalInput }>,
      ) {
        samples.push(value.input);
        const proposed = resizeProposal(value.start, value.input, input.delta, input.guides);
        proposals.push(proposed);
        return { ok: true as const, value: proposed };
      },
      commitResize(value: ResizeInteractionProposal): Result<EditorSnapshot> {
        commits.push(value);
        return { ok: true, value: editorSnapshot([first]) };
      },
    },
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
  let prevented = false;
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
      get defaultPrevented() {
        return prevented;
      },
      preventDefault() {
        prevented = true;
      },
    },
    true,
    { x: canvas.x + input.x, y: canvas.y + input.y },
  );
  canvas.dispatchEvent(event);
  return event;
}

function dispatchShortcut(shell: EditorShell, key: string): VectoJSEvent {
  const canvas = childById(shell, 'brings-canvas-region');
  const event = new VectoJSEvent('keydown', canvas, {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'CANVAS' },
    preventDefault: () => undefined,
  });
  canvas.dispatchEvent(event);
  return event;
}

function dispatchWheel(
  shell: EditorShell,
  input: Readonly<{
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    deltaMode?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }>,
): VectoJSEvent {
  const canvas = childById(shell, 'brings-canvas-region');
  let prevented = false;
  const event = new VectoJSEvent(
    'wheel',
    canvas,
    {
      deltaX: input.deltaX,
      deltaY: input.deltaY,
      deltaMode: input.deltaMode ?? 0,
      shiftKey: input.shiftKey ?? false,
      ctrlKey: input.ctrlKey ?? false,
      metaKey: input.metaKey ?? false,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault() {
        prevented = true;
      },
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
  paintedRects: Array<Readonly<{ matrix: readonly number[]; args: readonly unknown[] }>>;
}> {
  const calls: Array<Readonly<{ method: string; args: readonly unknown[] }>> = [];
  const paintedRects: Array<Readonly<{ matrix: readonly number[]; args: readonly unknown[] }>> = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const multiply = (right: readonly number[]) => {
    const left = matrix;
    matrix = [
      left[0]! * right[0]! + left[2]! * right[1]!,
      left[1]! * right[0]! + left[3]! * right[1]!,
      left[0]! * right[2]! + left[2]! * right[3]!,
      left[1]! * right[2]! + left[3]! * right[3]!,
      left[0]! * right[4]! + left[2]! * right[5]! + left[4]!,
      left[1]! * right[4]! + left[3]! * right[5]! + left[5]!,
    ];
  };
  const renderer = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: readonly unknown[]) => {
          const method = String(property);
          calls.push({ method, args });
          if (method === 'save') stack.push([...matrix]);
          if (method === 'restore') matrix = stack.pop() ?? matrix;
          if (method === 'translate') multiply([1, 0, 0, 1, args[0] as number, args[1] as number]);
          if (method === 'scale') multiply([args[0] as number, 0, 0, args[1] as number, 0, 0]);
          if (method === 'roundRect') paintedRects.push({ matrix: [...matrix], args });
        };
      },
    },
  ) as IRenderer;
  return { renderer, calls, paintedRects };
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
  expect(shell.children.slice(0, 5).map((child) => child.getA11yAttributes())).toEqual([
    { role: 'toolbar', label: 'Document controls' },
    { role: 'tree', label: 'Layers' },
    { role: 'region', label: 'Design canvas', tabIndex: 0 },
    { role: 'group', label: 'Properties' },
    { role: 'toolbar', label: 'Creation tools' },
  ]);
});

test('constructs safely before the host has measurable viewport dimensions', () => {
  const shell = new EditorShell();

  expect(shell.cameraSnapshot()).toEqual({ center: { x: 0.5, y: 0.5 }, zoom: 1 });
  shell.resize(1440, 900);
  expect(shell.cameraSnapshot()).toEqual({ center: { x: 456, y: 426 }, zoom: 1 });
});

test('keeps document selection in page space while camera gestures stay ephemeral', () => {
  const selection = selectionPorts({ ownerId: first });
  const shell = new EditorShell(1440, 900, selection.ports);

  expect(shell.cameraSnapshot()).toEqual({ center: { x: 456, y: 426 }, zoom: 1 });
  const zoom = dispatchWheel(shell, {
    x: 300,
    y: 220,
    deltaX: 0,
    deltaY: -100,
    ctrlKey: true,
  });
  expect(zoom.defaultPrevented).toBe(true);
  expect(shell.cameraSnapshot().zoom).toBeGreaterThan(1);

  dispatchPointer(shell, 'pointerdown', { pointerId: 91, x: 300, y: 220, button: 1 });
  dispatchPointer(shell, 'pointermove', { pointerId: 91, x: 320, y: 210, button: 1 });
  const panEnd = dispatchPointer(shell, 'pointerup', {
    pointerId: 91,
    x: 320,
    y: 210,
    button: 1,
  });
  expect(panEnd.defaultPrevented).toBe(true);
  expect(selection.pointCalls).toEqual([]);

  const camera = shell.cameraSnapshot();
  dispatchPointer(shell, 'pointerdown', { pointerId: 92, x: 300, y: 220 });
  dispatchPointer(shell, 'pointerup', { pointerId: 92, x: 300, y: 220 });
  expect(selection.pointCalls).toHaveLength(1);
  expect(selection.pointCalls[0]?.point).toMatchObject({
    x: camera.center.x + (300 - 456) / camera.zoom,
    y: camera.center.y + (220 - 426) / camera.zoom,
  });
});

test('consumes wheel pan and Shift-wheel pan without creating a document interaction', () => {
  const selection = selectionPorts({ ownerId: first });
  const shell = new EditorShell(1440, 900, selection.ports);

  const pan = dispatchWheel(shell, { x: 300, y: 220, deltaX: 10, deltaY: 20 });
  const shiftPan = dispatchWheel(shell, { x: 300, y: 220, deltaX: 0, deltaY: 15, shiftKey: true });

  expect(pan.defaultPrevented).toBe(true);
  expect(shiftPan.defaultPrevented).toBe(true);
  expect(shell.cameraSnapshot()).toEqual({ center: { x: 481, y: 446 }, zoom: 1 });
  expect(selection.pointCalls).toEqual([]);
  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'idle' });
});

test('uses Space drag for a transient camera pan without starting a document gesture', () => {
  const selection = selectionPorts({ ownerId: first });
  const shell = new EditorShell(1440, 900, selection.ports);
  const canvas = childById(shell, 'brings-canvas-region');
  let keyDownPrevented = false;
  const keyDown = new VectoJSEvent('keydown', canvas, {
    key: ' ',
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      keyDownPrevented = true;
    },
  });
  canvas.dispatchEvent(keyDown);

  dispatchPointer(shell, 'pointerdown', { pointerId: 93, x: 300, y: 220 });
  dispatchPointer(shell, 'pointermove', { pointerId: 93, x: 324, y: 205 });
  dispatchPointer(shell, 'pointerup', { pointerId: 93, x: 324, y: 205 });

  expect(keyDownPrevented).toBe(true);
  expect(keyDown.propagationStopped).toBe(true);
  expect(selection.pointCalls).toEqual([]);
  expect(shell.cameraSnapshot()).toEqual({ center: { x: 432, y: 441 }, zoom: 1 });

  const keyUp = new VectoJSEvent('keyup', canvas, {
    key: ' ',
    target: { tagName: 'CANVAS' },
    preventDefault: () => undefined,
  });
  canvas.dispatchEvent(keyUp);
  dispatchPointer(shell, 'pointerdown', { pointerId: 94, x: 300, y: 220 });
  dispatchPointer(shell, 'pointerup', { pointerId: 94, x: 300, y: 220 });
  expect(selection.pointCalls).toHaveLength(1);
});

test('exposes center-anchored zoom toolbar controls without changing the active tool', () => {
  const shell = new EditorShell(1440, 900);
  const zoomIn = childById(shell, 'brings-zoom-in');
  const zoomOut = childById(shell, 'brings-zoom-out');

  zoomIn.dispatchEvent(
    new VectoJSEvent('pointerdown', zoomIn, { preventDefault: () => undefined }),
  );
  expect(shell.cameraSnapshot()).toEqual({ center: { x: 456, y: 426 }, zoom: 1.2 });
  expect(zoomIn.getA11yAttributes()).toEqual({ role: 'button', label: 'Zoom in' });
  expect(childById(shell, 'brings-zoom-readout').getA11yAttributes()).toEqual({
    role: 'status',
    label: 'Zoom 120%',
  });

  zoomOut.dispatchEvent(
    new VectoJSEvent('pointerdown', zoomOut, { preventDefault: () => undefined }),
  );
  expect(shell.cameraSnapshot()).toEqual({ center: { x: 456, y: 426 }, zoom: 1 });
  expect(childById(shell, 'brings-select-tool').getA11yAttributes()).toEqual({
    role: 'button',
    label: 'Select tool selected',
  });
});

test('keeps authoring and navigation controls inside the viewport-owned dock', () => {
  const shell = new EditorShell(700, 600);
  const dock = childById(shell, 'brings-tool-dock');
  const text = childById(shell, 'brings-text-tool');
  const zoomOut = childById(shell, 'brings-zoom-out');
  const zoomReadout = childById(shell, 'brings-zoom-readout');
  const zoomIn = childById(shell, 'brings-zoom-in');

  expect(text.x + text.width).toBeLessThanOrEqual(zoomOut.x);
  expect(zoomOut.x + zoomOut.width).toBeLessThanOrEqual(zoomReadout.x);
  expect(zoomReadout.x + zoomReadout.width).toBeLessThanOrEqual(zoomIn.x);
  expect({ x: dock.x, y: dock.y, width: dock.width, height: dock.height }).toEqual({
    x: 104,
    y: 532,
    width: 492,
    height: 48,
  });

  shell.resize(780, 600);
  expect(text.x + text.width).toBeLessThanOrEqual(zoomOut.x);
  expect(zoomOut.x + zoomOut.width).toBeLessThanOrEqual(zoomReadout.x);
  expect(zoomReadout.x + zoomReadout.width).toBeLessThanOrEqual(zoomIn.x);

  shell.resize(390, 600);
  expect(childById(shell, 'brings-frame-tool').width).toBe(0);
  expect(childById(shell, 'brings-rectangle-tool').width).toBe(0);
  expect(childById(shell, 'brings-ellipse-tool').width).toBe(0);
  expect(text.width).toBe(0);
  expect(zoomIn.x + zoomIn.width + 8).toBeLessThanOrEqual(dock.width);
});

test('projects local document state and routes enabled history controls through Core ports', () => {
  let snapshot = { ...editorSnapshot(), undoDepth: 2, redoDepth: 0 };
  const actions: Array<'undo' | 'redo'> = [];
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => snapshot,
    runHistory: (action) => {
      actions.push(action);
      snapshot = { ...snapshot, undoDepth: 1, redoDepth: 1 };
      return { ok: true, value: snapshot };
    },
  });
  const documentName = childById(shell, 'brings-document-name');
  const localStatus = childById(shell, 'brings-local-status');
  const undo = childById(shell, 'brings-undo');
  const redo = childById(shell, 'brings-redo');

  expect(documentName.getContentProjection()).toMatchObject({ text: 'Fixture' });
  expect(localStatus.getContentProjection()).toMatchObject({ text: 'Saved locally' });
  expect(undo.getA11yAttributes()).toEqual({ role: 'button', label: 'Undo' });
  expect(redo.getA11yAttributes()).toEqual({ role: 'button', label: 'Redo', disabled: true });

  undo.dispatchEvent(new VectoJSEvent('pointerdown', undo, { preventDefault: () => undefined }));
  expect(actions).toEqual(['undo']);
  expect(redo.getA11yAttributes()).toEqual({ role: 'button', label: 'Redo' });
});

test('refreshes projected history availability after an external Core command', () => {
  let snapshot = editorSnapshot();
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => snapshot });
  const undo = childById(shell, 'brings-undo');

  expect(undo.getA11yAttributes()).toEqual({ role: 'button', label: 'Undo', disabled: true });
  snapshot = { ...snapshot, undoDepth: 1 };
  shell.render(recordingRenderer().renderer);
  expect(undo.getA11yAttributes()).toEqual({ role: 'button', label: 'Undo' });
});

test('keeps resize handles at eight screen pixels after camera zoom', () => {
  const state = resizePorts();
  const shell = new EditorShell(1440, 900, state.ports);
  const zoomIn = childById(shell, 'brings-zoom-in');
  zoomIn.dispatchEvent(
    new VectoJSEvent('pointerdown', zoomIn, { preventDefault: () => undefined }),
  );
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(
    recording.paintedRects.some(
      ({ matrix, args }) => matrix[0] === 1 && matrix[3] === 1 && args[2] === 8 && args[3] === 8,
    ),
  ).toBe(true);
});

test('renders ordered interactive layer rows from the Core snapshot', () => {
  const selected = editorSnapshot([second]);
  const selections: Array<readonly string[]> = [];
  const visibility: string[] = [];
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => selected,
    selectLayer: (nodeIds, activeNodeId) => {
      selections.push([...nodeIds, activeNodeId ?? '']);
      return { ok: true, value: selected };
    },
    setLayerVisibility: (nodeId) => {
      visibility.push(nodeId);
      return { ok: true, value: selected };
    },
  });
  shell.render(recordingRenderer().renderer);

  const frame = childById(shell, `brings-layer-${first}`);
  const rectangle = childById(shell, `brings-layer-${second}`);
  expect(frame.getA11yAttributes()).toEqual({ role: 'button', label: 'Frame layer' });
  expect(rectangle.getA11yAttributes()).toEqual({
    role: 'button',
    label: 'Rectangle layer selected',
  });
  expect(rectangle.x).toBeGreaterThan(frame.x);
  expect(rectangle.y).toBeGreaterThan(frame.y);

  rectangle.dispatchEvent(
    new VectoJSEvent('pointerdown', rectangle, { button: 0 }, true, {
      x: rectangle.x + 20,
      y: rectangle.y + 12,
    }),
  );
  expect(selections).toEqual([[second, second]]);

  rectangle.dispatchEvent(
    new VectoJSEvent('pointerdown', rectangle, { button: 0 }, true, {
      x: rectangle.x + rectangle.width - 12,
      y: rectangle.y + 12,
    }),
  );
  expect(visibility).toEqual([second]);
});

test('projects selected-node properties and commits only through the Core port', () => {
  const selected = editorSnapshot([second]);
  const patches: unknown[] = [];
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => selected,
    setSelectionProperties: (patch) => {
      patches.push(patch);
      return { ok: true, value: selected };
    },
  });
  shell.render(recordingRenderer().renderer);

  const name = childById(shell, 'brings-property-name');
  const opacity = childById(shell, 'brings-property-opacity');
  const width = childById(shell, 'brings-property-width');
  const position = childById(shell, 'brings-position-label');
  const appearance = childById(shell, 'brings-appearance-label');
  const visible = childById(shell, 'brings-property-visible');
  expect(name.getA11yAttributes()).toMatchObject({ label: 'Name', value: 'Rectangle' });
  expect(opacity.getA11yAttributes()).toMatchObject({ label: 'Opacity', value: '100' });
  expect(visible.getA11yAttributes()).toEqual({ role: 'switch', label: 'Visible', checked: true });
  expect(position.y + position.height).toBeLessThanOrEqual(width.y);
  expect(appearance.y + appearance.height).toBeLessThanOrEqual(opacity.y);

  visible.dispatchEvent(new VectoJSEvent('pointerdown', visible, { button: 0 }));
  expect(patches).toEqual([{ visible: false }]);
});

test('hides inactive property controls instead of painting empty editor chrome', () => {
  const empty = new EditorShell(1440, 900);
  empty.render(recordingRenderer().renderer);

  for (const id of [
    'brings-property-name',
    'brings-property-opacity',
    'brings-property-width',
    'brings-property-height',
    'brings-property-visible',
    'brings-property-locked',
  ]) {
    expect(childById(empty, id).opacity).toBe(0);
  }

  const selected = new EditorShell(1440, 900, { documentSnapshot: () => editorSnapshot([second]) });
  selected.render(recordingRenderer().renderer);
  expect(childById(selected, 'brings-property-name').opacity).toBe(1);
  expect(childById(selected, 'brings-property-visible').opacity).toBe(1);
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
    x: 744,
    y: 48,
    width: 280,
    height: 720,
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
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => editorSnapshot() });
  const title = childById(shell, 'brings-title');
  const workspace = childById(shell, 'brings-workspace-label');
  const activePage = childById(shell, 'brings-active-page');
  const propertiesEmpty = childById(shell, 'brings-properties-empty');

  expect(title.interactive).toBe(false);
  expect(title.getContentProjection()).toMatchObject({ text: 'Brings' });
  expect(workspace.getContentProjection()).toMatchObject({
    text: 'Local-first design workspace',
  });
  expect(activePage.getContentProjection()).toMatchObject({ text: 'Page 1' });
  expect(propertiesEmpty.getContentProjection()).toMatchObject({
    text: 'Select an object to edit properties',
  });
});

test('starts with the Select tool active so canvas clicks select instead of creating', () => {
  const shell = new EditorShell(1440, 900);
  const selectTool = childById(shell, 'brings-select-tool');

  expect(selectTool.getA11yAttributes()).toEqual({ role: 'button', label: 'Select tool selected' });
});

test('routes unmodified tool shortcuts from the focused VMT design region', () => {
  const shell = new EditorShell(1440, 900);
  const canvasRegion = childById(shell, 'brings-canvas-region');
  let prevented = false;
  const event = new VectoJSEvent('keydown', canvasRegion, {
    key: 'O',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      prevented = true;
    },
  });

  canvasRegion.dispatchEvent(event);

  expect(prevented).toBe(true);
  expect(event.propagationStopped).toBe(true);
  expect(childById(shell, 'brings-ellipse-tool').getA11yAttributes()).toEqual({
    role: 'button',
    label: 'Ellipse tool selected',
  });
});

test('defers shape creation until pointer up and exposes one live drag preview', () => {
  const commits: Array<
    Readonly<{
      tool: 'frame' | 'rectangle' | 'ellipse';
      bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>
  > = [];
  const shell = new EditorShell(1440, 900, {
    createInBounds: (tool, bounds) => {
      commits.push({ tool, bounds: { ...bounds } });
      return { ok: true, value: editorSnapshot() };
    },
  });
  dispatchShortcut(shell, 'R');

  dispatchPointer(shell, 'pointerdown', { pointerId: 301, x: 100, y: 120 });
  expect(commits).toEqual([]);
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'pending',
    tool: 'rectangle',
    pointerId: 301,
    creationVisual: null,
  });

  dispatchPointer(shell, 'pointermove', { pointerId: 301, x: 170, y: 180 });
  expect(commits).toEqual([]);
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'drawing',
    tool: 'rectangle',
    bounds: { x: 100, y: 120, width: 70, height: 60 },
    creationVisual: {
      tool: 'rectangle',
      bounds: { x: 100, y: 120, width: 70, height: 60 },
    },
  });

  dispatchPointer(shell, 'pointerup', { pointerId: 301, x: 180, y: 190 });
  expect(commits).toEqual([
    { tool: 'rectangle', bounds: { x: 100, y: 120, width: 80, height: 70 } },
  ]);
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit',
    creationVisual: null,
  });
});

test('commits click defaults and samples Shift plus Alt at the latest creation event', () => {
  const commits: Array<Readonly<{ tool: string; bounds: Readonly<Record<string, number>> }>> = [];
  const shell = new EditorShell(1440, 900, {
    createInBounds: (tool, bounds) => {
      commits.push({ tool, bounds: { ...bounds } });
      return { ok: true, value: editorSnapshot() };
    },
  });

  dispatchShortcut(shell, 'F');
  dispatchPointer(shell, 'pointerdown', { pointerId: 302, x: 40, y: 50 });
  dispatchPointer(shell, 'pointerup', { pointerId: 302, x: 42, y: 51 });
  dispatchShortcut(shell, 'O');
  dispatchPointer(shell, 'pointerdown', { pointerId: 303, x: 200, y: 300 });
  dispatchPointer(shell, 'pointermove', {
    pointerId: 303,
    x: 230,
    y: 320,
    shiftKey: true,
    altKey: true,
  });
  dispatchPointer(shell, 'pointerup', {
    pointerId: 303,
    x: 240,
    y: 310,
    shiftKey: false,
    altKey: true,
  });

  expect(commits).toEqual([
    { tool: 'frame', bounds: { x: 40, y: 50, width: 400, height: 300 } },
    { tool: 'ellipse', bounds: { x: 160, y: 290, width: 80, height: 20 } },
  ]);
});

test('discards creation on Escape, pointercancel, tool switch, and authoring loss', () => {
  const commits: unknown[] = [];
  const shell = new EditorShell(1440, 900, {
    createInBounds: (tool, bounds) => {
      commits.push({ tool, bounds });
      return { ok: true, value: editorSnapshot() };
    },
  });
  dispatchShortcut(shell, 'R');

  dispatchPointer(shell, 'pointerdown', { pointerId: 304, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 304, x: 80, y: 90 });
  expect(dispatchShortcut(shell, 'Escape').propagationStopped).toBe(true);
  dispatchPointer(shell, 'pointerup', { pointerId: 304, x: 80, y: 90 });
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 305, x: 10, y: 20 });
  dispatchPointer(shell, 'pointercancel', { pointerId: 305, x: 30, y: 40 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 306, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 306, x: 30, y: 40 });
  dispatchShortcut(shell, 'O');
  dispatchPointer(shell, 'pointerup', { pointerId: 306, x: 30, y: 40 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 307, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 307, x: 30, y: 40 });
  shell.resize(390, 900);
  dispatchPointer(shell, 'pointerup', { pointerId: 307, x: 30, y: 40 });

  expect(commits).toEqual([]);
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });
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
  const fileBar = childById(shell, 'brings-file-bar');

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
  fileBar.dispatchEvent(
    new VectoJSEvent('keydown', fileBar, {
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

test('closes and quarantines an update discard without consuming a later inactive Escape', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  let areaCalls = 0;
  let dirtyCalls = 0;
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    proposeAreaSelection(start, rect, mode) {
      areaCalls += 1;
      return areaCalls === 1
        ? state.ports.proposeAreaSelection(start, rect, mode)
        : { ok: false, error: { code: 'test.area-terminal', path: '/area' } };
    },
    reportInteractionError: (error) => errors.push(error),
  });
  (shell as unknown as { _scene: Readonly<{ markDirty: () => void }> })._scene = {
    markDirty: () => {
      dirtyCalls += 1;
    },
  };

  dispatchPointer(shell, 'pointerdown', { pointerId: 41, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 41, x: 30, y: 50 });
  const preview = recordingRenderer();
  shell.render(preview.renderer);
  expect(
    preview.calls.some(
      (call) =>
        call.method === 'roundRect' &&
        JSON.stringify(call.args.slice(0, 5)) === JSON.stringify([10, 20, 20, 30, 0]),
    ),
  ).toBe(true);

  dispatchPointer(shell, 'pointermove', { pointerId: 41, x: 40, y: 60 });
  const cleared = recordingRenderer();
  shell.render(cleared.renderer);
  expect(
    cleared.calls.some(
      (call) =>
        call.method === 'roundRect' &&
        JSON.stringify(call.args.slice(0, 5)) === JSON.stringify([10, 20, 30, 40, 0]),
    ),
  ).toBe(false);
  expect(errors).toEqual([{ code: 'test.area-terminal', path: '/area' }]);
  expect(dirtyCalls).toBe(2);

  let prevented = 0;
  const canvas = childById(shell, 'brings-canvas-region');
  const escape = new VectoJSEvent('keydown', canvas, {
    key: 'Escape',
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      prevented += 1;
    },
  });
  canvas.dispatchEvent(escape);
  dispatchPointer(shell, 'pointermove', { pointerId: 41, x: 80, y: 90 });

  expect(prevented).toBe(0);
  expect(escape.propagationStopped).toBe(false);
  expect(errors).toHaveLength(1);
  expect(dirtyCalls).toBe(2);

  dispatchPointer(shell, 'pointerdown', { pointerId: 42, x: 4, y: 6 });
  dispatchPointer(shell, 'pointerup', { pointerId: 42, x: 4, y: 6 });
  expect(state.commits).toHaveLength(1);
  expect(dirtyCalls).toBe(3);
  dispatchPointer(shell, 'pointerup', { pointerId: 41, x: 80, y: 90 });
  expect(errors).toHaveLength(1);
  expect(state.commits).toHaveLength(1);
  expect(dirtyCalls).toBe(3);
});

test('rejects missing pre-session coordinates once and releases the id on its raw terminal', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  const canvas = childById(shell, 'brings-canvas-region');
  canvas.dispatchEvent(
    new VectoJSEvent('pointerdown', canvas, {
      pointerId: 51,
      button: 0,
    }),
  );
  canvas.dispatchEvent(new VectoJSEvent('pointermove', canvas, { pointerId: 51, button: 0 }));
  canvas.dispatchEvent(new VectoJSEvent('pointerup', canvas, { pointerId: 51, button: 0 }));

  expect(errors).toEqual([{ code: 'interaction.coordinate-invalid', path: '/viewport/x' }]);
  dispatchPointer(shell, 'pointerdown', { pointerId: 51, x: 5, y: 7 });
  dispatchPointer(shell, 'pointerup', { pointerId: 51, x: 5, y: 7 });
  expect(state.commits).toHaveLength(1);
});

test('terminates a mid-session non-finite coordinate once and leaves other pointers routable', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 53, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 53, x: 30, y: 40 });
  dispatchPointer(shell, 'pointermove', { pointerId: 53, x: Number.NaN, y: 50 });
  dispatchPointer(shell, 'pointermove', { pointerId: 53, x: 60, y: 70 });

  expect(errors).toEqual([{ code: 'interaction.coordinate-invalid', path: '/viewport/x' }]);
  dispatchPointer(shell, 'pointerdown', { pointerId: 54, x: 4, y: 6 });
  dispatchPointer(shell, 'pointerup', { pointerId: 54, x: 4, y: 6 });
  expect(state.commits).toHaveLength(1);
  dispatchPointer(shell, 'pointerup', { pointerId: 53, x: 60, y: 70 });
  expect(errors).toHaveLength(1);
  expect(state.commits).toHaveLength(1);
});

test('discards an owner pointercancel preview and immediately permits id reuse', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);
  dispatchPointer(shell, 'pointerdown', { pointerId: 55, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 55, x: 30, y: 40 });
  dispatchPointer(shell, 'pointercancel', { pointerId: 55, x: 30, y: 40 });
  const recording = recordingRenderer();
  shell.render(recording.renderer);

  expect(
    recording.calls.some(
      (call) =>
        call.method === 'roundRect' &&
        JSON.stringify(call.args.slice(0, 5)) === JSON.stringify([10, 20, 20, 20, 0]),
    ),
  ).toBe(false);
  expect(state.commits).toEqual([]);
  dispatchPointer(shell, 'pointerdown', { pointerId: 55, x: 5, y: 7 });
  dispatchPointer(shell, 'pointerup', { pointerId: 55, x: 5, y: 7 });
  expect(state.commits).toHaveLength(1);
});

test('prohibits narrow-screen pointerdown from beginning a selection session', () => {
  const state = selectionPorts();
  let begins = 0;
  const shell = new EditorShell(390, 600, {
    ...state.ports,
    beginSelectionInteraction: () => {
      begins += 1;
      return state.start;
    },
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 57, x: 10, y: 20 });
  dispatchPointer(shell, 'pointerup', { pointerId: 57, x: 10, y: 20 });

  expect(begins).toBe(0);
  expect(state.pointCalls).toEqual([]);
  expect(state.commits).toEqual([]);
});

test('yields inactive Escape without preventing, stopping, or calling an editor port', () => {
  let portCalls = 0;
  let prevented = 0;
  const shell = new EditorShell(1440, 900, {
    runHistory: () => {
      portCalls += 1;
      return { ok: false, error: { code: 'test.history', path: '/' } };
    },
    deleteSelection: () => {
      portCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
    reportInteractionError: () => {
      portCalls += 1;
    },
  });
  const canvas = childById(shell, 'brings-canvas-region');
  const event = new VectoJSEvent('keydown', canvas, {
    key: 'Escape',
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      prevented += 1;
    },
  });
  canvas.dispatchEvent(event);

  expect(portCalls).toBe(0);
  expect(prevented).toBe(0);
  expect(event.propagationStopped).toBe(false);
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

test('exposes fresh idle, pending, marquee, and terminal interaction diagnostics', () => {
  const state = selectionPorts();
  const shell = new EditorShell(1440, 900, state.ports);

  expect(shell.interactionSnapshot()).toEqual({
    phase: 'idle',
    terminalEffect: null,
    pointerId: null,
    shiftKey: null,
    start: null,
    current: null,
    visual: null,
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 59, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 59, x: 13.9, y: 20, shiftKey: true });
  const pending = shell.interactionSnapshot();
  expect(pending).toMatchObject({
    phase: 'pending',
    terminalEffect: null,
    pointerId: 59,
    shiftKey: true,
    start: { viewport: { x: 10, y: 20 }, page: { x: 10, y: 20 } },
    current: { viewport: { y: 20 }, page: { y: 20 } },
    visual: null,
  });
  expect(pending.current?.viewport.x).toBeCloseTo(13.9, 10);
  expect(pending.current?.page.x).toBeCloseTo(13.9, 10);

  dispatchPointer(shell, 'pointermove', { pointerId: 59, x: 14, y: 20, shiftKey: true });
  const marquee = shell.interactionSnapshot();
  expect(marquee).toMatchObject({
    phase: 'marquee',
    terminalEffect: null,
    current: { viewport: { x: 14, y: 20 } },
    visual: {
      selection: { nodeIds: [first], activeNodeId: first },
      marquee: { x: 10, y: 20, width: 4, height: 0 },
      movementDelta: null,
    },
  });
  expect(Object.isFrozen(marquee)).toBe(true);
  expect(Object.isFrozen(marquee.current)).toBe(true);
  expect(Object.isFrozen(marquee.visual)).toBe(true);
  expect(Object.isFrozen(marquee.visual?.selection.nodeIds)).toBe(true);
  expect(JSON.parse(JSON.stringify(marquee))).toEqual(marquee);

  dispatchPointer(shell, 'pointerup', { pointerId: 59, x: 14, y: 20, shiftKey: true });
  const terminal = shell.interactionSnapshot();
  const terminalAgain = shell.interactionSnapshot();
  expect(terminal).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit-selection',
    pointerId: 59,
    current: { viewport: { x: 14, y: 20 } },
    visual: null,
  });
  expect(terminal).not.toBe(terminalAgain);
  expect(terminal.start).not.toBe(terminalAgain.start);
  expect(terminal.current).not.toBe(terminalAgain.current);
});

test('contains a native pointer getter throw and quarantines a known id until raw terminal', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  const canvas = childById(shell, 'brings-canvas-region');
  const invalid = new VectoJSEvent(
    'pointerdown',
    canvas,
    {
      pointerId: 61,
      get button() {
        throw new Error('hostile native getter');
      },
    },
    true,
    { x: canvas.x + 10, y: canvas.y + 20 },
  );

  expect(() => canvas.dispatchEvent(invalid)).not.toThrow();
  dispatchPointer(shell, 'pointermove', { pointerId: 61, x: 30, y: 40 });
  expect(errors).toEqual([{ code: 'interaction.pointer-invalid', path: '/nativeEvent/button' }]);
  expect(state.pointCalls).toEqual([]);

  dispatchPointer(shell, 'pointerup', { pointerId: 61, x: 30, y: 40 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 61, x: 5, y: 7 });
  dispatchPointer(shell, 'pointerup', { pointerId: 61, x: 5, y: 7 });
  expect(state.commits).toHaveLength(1);
  expect(errors).toHaveLength(1);
});

test('reports an unreadable pointer id once without quarantining an unknown stream', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  const canvas = childById(shell, 'brings-canvas-region');
  const invalid = new VectoJSEvent('pointerdown', canvas, {
    get pointerId() {
      throw new Error('unreadable pointer id');
    },
  });

  expect(() => canvas.dispatchEvent(invalid)).not.toThrow();
  expect(errors).toEqual([{ code: 'interaction.pointer-invalid', path: '/nativeEvent/pointerId' }]);

  dispatchPointer(shell, 'pointerdown', { pointerId: 63, x: 5, y: 7 });
  dispatchPointer(shell, 'pointerup', { pointerId: 63, x: 5, y: 7 });
  expect(state.commits).toHaveLength(1);
  expect(errors).toHaveLength(1);
});

test('terminally discards a live session when a later native getter throws', () => {
  const state = selectionPorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  let dirtyCalls = 0;
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  (shell as unknown as { _scene: Readonly<{ markDirty: () => void }> })._scene = {
    markDirty: () => {
      dirtyCalls += 1;
    },
  };
  dispatchPointer(shell, 'pointerdown', { pointerId: 65, x: 10, y: 20 });
  dispatchPointer(shell, 'pointermove', { pointerId: 65, x: 30, y: 40 });
  const canvas = childById(shell, 'brings-canvas-region');
  const invalid = new VectoJSEvent(
    'pointermove',
    canvas,
    {
      pointerId: 65,
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      get metaKey() {
        throw new Error('lost native state');
      },
    },
    true,
    { x: canvas.x + 40, y: canvas.y + 50 },
  );

  expect(() => canvas.dispatchEvent(invalid)).not.toThrow();
  dispatchPointer(shell, 'pointermove', { pointerId: 65, x: 60, y: 70 });

  expect(errors).toEqual([{ code: 'interaction.pointer-invalid', path: '/nativeEvent/metaKey' }]);
  expect(state.commits).toEqual([]);
  expect(dirtyCalls).toBe(2);

  dispatchPointer(shell, 'pointerup', { pointerId: 65, x: 60, y: 70 });
  dispatchPointer(shell, 'pointerdown', { pointerId: 65, x: 4, y: 6 });
  dispatchPointer(shell, 'pointerup', { pointerId: 65, x: 4, y: 6 });
  expect(state.commits).toHaveLength(1);
  expect(errors).toHaveLength(1);
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
  expect(movementRecording.paintedRects).toContainEqual({
    matrix: [1, 0, 0, 1, 368, 198],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
  expect(movementRecording.paintedRects).toContainEqual({
    matrix: [1, 0, 0, 1, 378, 210],
    args: [0, 0, 20, 16, [0, 0, 0, 0]],
  });
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
      JSON.stringify(call.args.slice(0, 4)) === JSON.stringify([-2, -2, 104, 84]),
  );
  const panelIndex = marqueeRecording.calls.findLastIndex(
    (call) => call.method === 'roundRect' && call.args[1] === 48,
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

test('paints finite page-space alignment guides after content and before selection handles', () => {
  const guides = Object.freeze([
    alignmentGuide('x', 204, 80, 260),
    alignmentGuide('y', 176, 64, 240),
    alignmentGuide('x', Number.NaN, 0, 100),
  ]);
  const state = resizePorts({ guides });
  const shell = new EditorShell(1440, 900, state.ports);

  dispatchPointer(shell, 'pointerdown', { pointerId: 71, x: 200, y: 200 });
  dispatchPointer(shell, 'pointermove', { pointerId: 71, x: 210, y: 210 });

  expect(shell.interactionSnapshot().visual?.guides).toEqual(guides);
  const recording = recordingRenderer();
  shell.render(recording.renderer);
  const verticalIndex = recording.calls.findIndex(
    (call) => call.method === 'moveTo' && call.args[0] === 204 && call.args[1] === 80,
  );
  const horizontalIndex = recording.calls.findIndex(
    (call) => call.method === 'moveTo' && call.args[0] === 64 && call.args[1] === 176,
  );
  const resizeOutlineIndex = recording.calls.findLastIndex(
    (call) => call.method === 'roundRect' && call.args[2] === 8 && call.args[3] === 8,
  );

  expect(verticalIndex).toBeGreaterThan(-1);
  expect(recording.calls.slice(verticalIndex, verticalIndex + 3)).toEqual([
    { method: 'moveTo', args: [204, 80] },
    { method: 'lineTo', args: [204, 260] },
    { method: 'stroke', args: ['#2563eb', 1] },
  ]);
  expect(horizontalIndex).toBeGreaterThan(verticalIndex);
  expect(recording.calls.slice(horizontalIndex, horizontalIndex + 3)).toEqual([
    { method: 'moveTo', args: [64, 176] },
    { method: 'lineTo', args: [240, 176] },
    { method: 'stroke', args: ['#2563eb', 1] },
  ]);
  expect(resizeOutlineIndex).toBeGreaterThan(horizontalIndex);
  expect(recording.calls.filter((call) => call.method === 'lineTo')).toHaveLength(2);
});

test('clears alignment guide painting after an unsnapped preview and cancellation', () => {
  const start = interactionStart([first]);
  let guides: readonly AlignmentGuide[] = Object.freeze([alignmentGuide('x', 204, 80, 260)]);
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => editorSnapshot([first]),
    beginSelectionInteraction: () => start,
    proposePointSelection: () => ({
      ok: true,
      value: { ownerId: first, proposal: proposal(start, [first]) },
    }),
    proposeMove: (_captured, selection, delta) => ({
      ok: true,
      value: Object.freeze({
        token: selection.token,
        selection: selection.selection,
        rawDelta: Object.freeze({ ...delta }),
        delta: Object.freeze({ ...delta }),
        guides,
      }),
    }),
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 72, x: 120, y: 140 });
  dispatchPointer(shell, 'pointermove', { pointerId: 72, x: 130, y: 150 });
  const snapped = recordingRenderer();
  shell.render(snapped.renderer);
  expect(snapped.calls.some((call) => call.method === 'lineTo')).toBe(true);

  guides = Object.freeze([]);
  dispatchPointer(shell, 'pointermove', { pointerId: 72, x: 140, y: 160 });
  const unsnapped = recordingRenderer();
  shell.render(unsnapped.renderer);
  expect(shell.interactionSnapshot().visual?.guides ?? []).toEqual([]);
  expect(unsnapped.calls.some((call) => call.method === 'lineTo')).toBe(false);

  guides = Object.freeze([alignmentGuide('y', 176, 64, 240)]);
  dispatchPointer(shell, 'pointermove', { pointerId: 72, x: 130, y: 150 });
  dispatchPointer(shell, 'pointercancel', { pointerId: 72, x: 130, y: 150 });
  const canceled = recordingRenderer();
  shell.render(canceled.renderer);
  expect(shell.interactionSnapshot().visual).toBeNull();
  expect(canceled.calls.some((call) => call.method === 'lineTo')).toBe(false);
});

test('discards snapped move and resize previews before switching tools', () => {
  const guides = Object.freeze([alignmentGuide('x', 204, 80, 260)]);
  const moveStart = interactionStart([first]);
  let moveCommits = 0;
  const moveShell = new EditorShell(1440, 900, {
    documentSnapshot: () => editorSnapshot([first]),
    beginSelectionInteraction: () => moveStart,
    proposePointSelection: () => ({
      ok: true,
      value: { ownerId: first, proposal: proposal(moveStart, [first]) },
    }),
    proposeMove: (_captured, selection, delta) => ({
      ok: true,
      value: Object.freeze({
        token: selection.token,
        selection: selection.selection,
        rawDelta: Object.freeze({ ...delta }),
        delta: Object.freeze({ ...delta }),
        guides,
      }),
    }),
    commitMove: () => {
      moveCommits += 1;
      return { ok: true, value: editorSnapshot([first]) };
    },
  });

  dispatchPointer(moveShell, 'pointerdown', { pointerId: 73, x: 120, y: 140 });
  dispatchPointer(moveShell, 'pointermove', { pointerId: 73, x: 130, y: 150 });
  expect(moveShell.interactionSnapshot().visual?.guides).toEqual(guides);
  const frameTool = childById(moveShell, 'brings-frame-tool');
  frameTool.dispatchEvent(new VectoJSEvent('pointerdown', frameTool));

  expect(moveShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect(frameTool.getA11yAttributes()).toEqual({
    role: 'button',
    label: 'Frame tool selected',
  });
  const moved = recordingRenderer();
  moveShell.render(moved.renderer);
  expect(moved.calls.some((call) => call.method === 'lineTo')).toBe(false);
  dispatchPointer(moveShell, 'pointerup', { pointerId: 73, x: 130, y: 150 });
  expect(moveCommits).toBe(0);

  const resizeState = resizePorts({ guides });
  const resizeShell = new EditorShell(1440, 900, resizeState.ports);
  dispatchPointer(resizeShell, 'pointerdown', { pointerId: 74, x: 200, y: 200 });
  dispatchPointer(resizeShell, 'pointermove', { pointerId: 74, x: 220, y: 220 });
  expect(resizeShell.interactionSnapshot().visual?.guides).toEqual(guides);
  const rectangleTool = childById(resizeShell, 'brings-rectangle-tool');
  rectangleTool.dispatchEvent(new VectoJSEvent('pointerdown', rectangleTool));

  expect(resizeShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect(rectangleTool.getA11yAttributes()).toEqual({
    role: 'button',
    label: 'Rectangle tool selected',
  });
  const resized = recordingRenderer();
  resizeShell.render(resized.renderer);
  expect(resized.calls.some((call) => call.method === 'lineTo')).toBe(false);
  dispatchPointer(resizeShell, 'pointerup', { pointerId: 74, x: 220, y: 220 });
  expect(resizeState.commits).toEqual([]);
});

test('renders axis-aligned node scale instead of dropping durable affine terms', () => {
  const snapshot = editorSnapshot([first]);
  const scaled: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first ? { ...node, transform: [2, 0, 0, 1.5, 100, 120] } : node,
      ),
    },
  };
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => scaled });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.calls).toContainEqual({ method: 'translate', args: [100, 120] });
  expect(recording.calls).toContainEqual({ method: 'scale', args: [2, 1.5] });
  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 1.5, 348, 168],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
});

test('renders and outlines Ellipse nodes through renderer-independent cubic paths', () => {
  const base = editorSnapshot([second]);
  const snapshot: EditorSnapshot = {
    ...base,
    document: {
      ...base.document,
      nodes: base.document.nodes.map((node) =>
        node.id === second
          ? {
              id: node.id,
              name: 'Ellipse',
              parentId: node.parentId,
              visible: true,
              locked: false,
              opacity: 1,
              transform: node.transform,
              type: 'ellipse',
              width: 20,
              height: 16,
              fill: { type: 'solid', r: 0.18, g: 0.45, b: 0.95, a: 1 },
              stroke: null,
            }
          : node,
      ),
    },
  };
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => snapshot });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.calls.filter((call) => call.method === 'bezierCurveTo')).toHaveLength(8);
  expect(recording.calls).toContainEqual({ method: 'moveTo', args: [10, 0] });
  expect(recording.calls).toContainEqual({ method: 'moveTo', args: [10, -2] });
  expect(recording.calls.some((call) => call.method === 'fill')).toBe(true);
  expect(recording.calls).toContainEqual({ method: 'stroke', args: ['#2563eb', 2] });
});

test('composes scaled descendants and keeps selected movement in page space', () => {
  const snapshot = editorSnapshot([first]);
  const scaled: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first
          ? { ...node, transform: [2, 0, 0, 1.5, 100, 120] }
          : { ...node, transform: [3, 0, 0, 4, 10, 12] },
      ),
    },
  };
  const start = interactionStart([first]);
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => scaled,
    beginSelectionInteraction: () => start,
    proposePointSelection: () => ({
      ok: true,
      value: { ownerId: first, proposal: proposal(start, [first]) },
    }),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 71, x: 100, y: 120 });
  dispatchPointer(shell, 'pointermove', { pointerId: 71, x: 120, y: 150 });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 1.5, 368, 198],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
  expect(recording.paintedRects).toContainEqual({
    matrix: [6, 0, 0, 6, 388, 216],
    args: [0, 0, 20, 16, [0, 0, 0, 0]],
  });
});

test('preserves signed axis scale for anchor-crossing previews', () => {
  const snapshot = editorSnapshot([first]);
  const mirrored: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first ? { ...node, transform: [-2, 0, 0, -1.5, 100, 120] } : node,
      ),
    },
  };
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => mirrored });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.paintedRects).toContainEqual({
    matrix: [-2, 0, 0, -1.5, 348, 168],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
});

test('clips scaled frame descendants and composes container opacity', () => {
  const snapshot = editorSnapshot();
  const nested: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first
          ? {
              ...node,
              opacity: 0.5,
              clipChildren: true,
              transform: [2, 0, 0, 2, 100, 120],
            }
          : { ...node, opacity: 0.5 },
      ),
    },
  };
  const shell = new EditorShell(1440, 900, { documentSnapshot: () => nested });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.calls).toContainEqual({ method: 'clip', args: [0, 0, 100, 80] });
  expect(
    recording.calls.filter((call) => call.method === 'setGlobalAlpha').map((call) => call.args),
  ).toEqual(expect.arrayContaining([[0.5], [0.25]]));
});

test('reports unsupported and overflowing transform branches once', () => {
  const snapshot = editorSnapshot();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const unsupported: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first ? { ...node, transform: [1, 0.25, 0, 1, 100, 120] } : node,
      ),
    },
  };
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => unsupported,
    reportInteractionError: (error) => errors.push(error),
  });
  const firstRender = recordingRenderer();

  shell.render(firstRender.renderer);
  shell.render(recordingRenderer().renderer);

  expect(errors).toEqual([{ code: 'render.transform-unsupported', path: '/nodes/0/transform' }]);
  expect(firstRender.paintedRects.some((entry) => entry.args[2] === 100)).toBe(false);

  const overflowing: EditorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      nodes: snapshot.document.nodes.map((node) =>
        node.id === first
          ? { ...node, transform: [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 100, 120] }
          : { ...node, transform: [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 10, 12] },
      ),
    },
  };
  const overflowErrors: Array<Readonly<{ code: string; path: string }>> = [];
  const overflowShell = new EditorShell(1440, 900, {
    documentSnapshot: () => overflowing,
    reportInteractionError: (error) => overflowErrors.push(error),
  });
  overflowShell.render(recordingRenderer().renderer);
  expect(overflowErrors).toContainEqual({
    code: 'render.transform-overflow',
    path: '/nodes/1/transform',
  });
});

test('draws Core aggregate bounds and eight 8px handles in frozen Core order', () => {
  const state = resizePorts();
  const shell = new EditorShell(1440, 900, state.ports);
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  const handleRects = recording.paintedRects.filter(
    ({ args }) => args[2] === 8 && args[3] === 8 && args[4] === 0,
  );
  expect(handleRects.map(({ args }) => [Number(args[0]) + 4, Number(args[1]) + 4])).toEqual(
    resizeHandles.map(({ point }) => [point.x, point.y]),
  );
  expect(handleRects.every(({ matrix }) => JSON.stringify(matrix) === '[1,0,0,1,248,48]')).toBe(
    true,
  );

  const outlineIndex = recording.calls.findIndex(
    ({ method, args }) =>
      method === 'roundRect' && JSON.stringify(args.slice(0, 4)) === '[-2,-2,104,84]',
  );
  const aggregateIndex = recording.calls.findIndex(
    ({ method, args }) =>
      method === 'roundRect' && JSON.stringify(args.slice(0, 5)) === '[100,120,100,80,0]',
  );
  const firstHandleIndex = recording.calls.findIndex(
    ({ method, args }) =>
      method === 'roundRect' && JSON.stringify(args.slice(0, 5)) === '[96,116,8,8,0]',
  );
  expect(aggregateIndex).toBeGreaterThan(outlineIndex);
  expect(firstHandleIndex).toBeGreaterThan(aggregateIndex);
  expect(recording.calls.filter(({ method }) => method === 'save')).toHaveLength(
    recording.calls.filter(({ method }) => method === 'restore').length,
  );
});

test('uses inclusive 20px handle hit regions, nearest-center arbitration, and Core tie order', () => {
  for (const [index, entry] of resizeHandles.entries()) {
    const state = resizePorts();
    const shell = new EditorShell(1440, 900, state.ports);
    const offset = index % 2 === 0 ? -10 : 10;
    dispatchPointer(shell, 'pointerdown', {
      pointerId: 800 + index,
      x: entry.point.x + offset,
      y: entry.point.y - offset,
    });
    expect(shell.interactionSnapshot()).toMatchObject({
      phase: 'resizing',
      handle: entry.handle,
    });
  }

  const overlap = resizeStart(
    resizeHandles.map((entry) =>
      entry.handle === 'north-west' || entry.handle === 'north'
        ? { handle: entry.handle, point: { x: 100, y: 120 } }
        : entry,
    ),
  );
  const tied = resizePorts({ start: overlap });
  const tiedShell = new EditorShell(1440, 900, tied.ports);
  dispatchPointer(tiedShell, 'pointerdown', { pointerId: 81, x: 100, y: 120, altKey: true });
  expect(tiedShell.interactionSnapshot()).toMatchObject({
    phase: 'resizing',
    pointerId: 81,
    handle: 'north-west',
    altKey: true,
  });

  const edge = resizePorts();
  const edgeShell = new EditorShell(1440, 900, edge.ports);
  dispatchPointer(edgeShell, 'pointerdown', { pointerId: 82, x: 90, y: 110 });
  expect(edgeShell.interactionSnapshot()).toMatchObject({
    phase: 'resizing',
    handle: 'north-west',
  });

  const selection = selectionPorts();
  let resizeBegins = 0;
  const missShell = new EditorShell(1440, 900, {
    ...selection.ports,
    beginResizeInteraction: () => {
      resizeBegins += 1;
      return { ok: true, value: resizeStart() };
    },
  });
  dispatchPointer(missShell, 'pointerdown', { pointerId: 83, x: 89.9, y: 109.9 });
  dispatchPointer(missShell, 'pointerup', { pointerId: 83, x: 89.9, y: 109.9 });
  expect(resizeBegins).toBe(1);
  expect(selection.pointCalls).toHaveLength(1);
  expect(selection.commits).toHaveLength(1);
});

test('prioritizes an Alt resize hit while preserving unsupported Alt behavior on a miss', () => {
  const hit = resizePorts();
  const hitShell = new EditorShell(1440, 900, hit.ports);
  dispatchPointer(hitShell, 'pointerdown', {
    pointerId: 84,
    x: 200,
    y: 200,
    altKey: true,
  });
  dispatchPointer(hitShell, 'pointermove', {
    pointerId: 84,
    x: 240,
    y: 230,
    altKey: true,
  });
  expect(hit.samples).toHaveLength(1);
  expect(hit.samples[0]).toMatchObject({ handle: 'south-east', fromCenter: true });

  const miss = selectionPorts();
  const missShell = new EditorShell(1440, 900, {
    ...miss.ports,
    beginResizeInteraction: () => ({ ok: true, value: resizeStart() }),
  });
  dispatchPointer(missShell, 'pointerdown', {
    pointerId: 85,
    x: 40,
    y: 40,
    altKey: true,
  });
  dispatchPointer(missShell, 'pointerup', {
    pointerId: 85,
    x: 40,
    y: 40,
    altKey: true,
  });
  expect(miss.pointCalls).toEqual([]);
  expect(miss.commits).toEqual([]);
});

test('routes only the resize owner and commits the last displayed modifier sample', () => {
  const state = resizePorts();
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    reportInteractionError: (error) => errors.push(error),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 86, x: 200, y: 200 });

  const canvas = childById(shell, 'brings-canvas-region');
  let foreignReads = 0;
  canvas.dispatchEvent(
    new VectoJSEvent(
      'pointermove',
      canvas,
      {
        pointerId: 999,
        get button() {
          foreignReads += 1;
          throw new Error('foreign button must stay unread');
        },
        get shiftKey() {
          foreignReads += 1;
          throw new Error('foreign shift must stay unread');
        },
      },
      true,
      { x: canvas.x + 220, y: canvas.y + 220 },
    ),
  );
  dispatchPointer(shell, 'pointermove', {
    pointerId: 86,
    x: 230,
    y: 220,
    shiftKey: true,
  });
  dispatchPointer(shell, 'pointerup', {
    pointerId: 86,
    x: 240,
    y: 230,
    altKey: true,
  });

  expect(foreignReads).toBe(0);
  expect(errors).toEqual([]);
  expect(
    state.samples.map(({ preserveAspectRatio, fromCenter }) => [preserveAspectRatio, fromCenter]),
  ).toEqual([[true, false]]);
  expect(state.commits).toEqual([state.proposals[0]]);
  dispatchPointer(shell, 'pointerup', { pointerId: 86, x: 250, y: 240 });
  expect(state.commits).toHaveLength(1);
});

test('discards resize on pointercancel, Escape, and a narrow transition with late-event quarantine', () => {
  const pointerCancelled = resizePorts();
  const pointerShell = new EditorShell(1440, 900, pointerCancelled.ports);
  dispatchPointer(pointerShell, 'pointerdown', { pointerId: 87, x: 200, y: 200 });
  dispatchPointer(pointerShell, 'pointermove', { pointerId: 87, x: 220, y: 220 });
  dispatchPointer(pointerShell, 'pointercancel', { pointerId: 87, x: 220, y: 220 });
  expect(pointerShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    handle: 'south-east',
  });
  expect(pointerCancelled.commits).toEqual([]);

  const escaped = resizePorts();
  const escapeShell = new EditorShell(1440, 900, escaped.ports);
  dispatchPointer(escapeShell, 'pointerdown', { pointerId: 88, x: 200, y: 200 });
  const canvas = childById(escapeShell, 'brings-canvas-region');
  const escape = new VectoJSEvent('keydown', canvas, { key: 'Escape' });
  canvas.dispatchEvent(escape);
  expect(escape.propagationStopped).toBe(true);
  expect(escapeShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });

  const narrowed = resizePorts();
  const narrowShell = new EditorShell(700, 600, narrowed.ports);
  dispatchPointer(narrowShell, 'pointerdown', { pointerId: 89, x: 200, y: 200 });
  dispatchPointer(narrowShell, 'pointermove', { pointerId: 89, x: 240, y: 230 });
  narrowShell.resize(390, 600);
  expect(narrowShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });
  dispatchPointer(narrowShell, 'pointerup', { pointerId: 89, x: 240, y: 230 });
  expect(narrowed.commits).toEqual([]);
  const recording = recordingRenderer();
  narrowShell.render(recording.renderer);
  expect(recording.paintedRects.some(({ args }) => args[2] === 8 && args[3] === 8)).toBe(false);
});

test('contains malformed owner samples and re-entrant begin/propose ports without stale effects', () => {
  const errors: Array<Readonly<{ code: string; path: string }>> = [];
  const state = resizePorts();
  let shell!: EditorShell;
  let reenteredBegin = false;
  shell = new EditorShell(1440, 900, {
    ...state.ports,
    beginResizeInteraction: () => {
      if (!reenteredBegin) {
        reenteredBegin = true;
        dispatchPointer(shell, 'pointerdown', { pointerId: 91, x: 200, y: 200 });
      }
      return { ok: true, value: state.start };
    },
    reportInteractionError: (error) => errors.push(error),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 90, x: 200, y: 200 });
  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'resizing', pointerId: 91 });

  const canvas = childById(shell, 'brings-canvas-region');
  const malformed = new VectoJSEvent(
    'pointermove',
    canvas,
    {
      pointerId: 91,
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      get metaKey() {
        throw new Error('lost native state');
      },
    },
    true,
    { x: canvas.x + 230, y: canvas.y + 230 },
  );
  expect(() => canvas.dispatchEvent(malformed)).not.toThrow();
  expect(errors).toEqual([{ code: 'interaction.pointer-invalid', path: '/nativeEvent/metaKey' }]);
  expect(shell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });

  const proposalState = resizePorts();
  let proposalShell!: EditorShell;
  proposalShell = new EditorShell(1440, 900, {
    ...proposalState.ports,
    proposeResize: (value) => {
      const proposalCanvas = childById(proposalShell, 'brings-canvas-region');
      proposalCanvas.dispatchEvent(new VectoJSEvent('keydown', proposalCanvas, { key: 'Escape' }));
      return { ok: true, value: resizeProposal(value.start, value.input) };
    },
  });
  dispatchPointer(proposalShell, 'pointerdown', { pointerId: 92, x: 200, y: 200 });
  dispatchPointer(proposalShell, 'pointermove', { pointerId: 92, x: 230, y: 230 });
  expect(proposalShell.interactionSnapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });
  expect(proposalState.commits).toEqual([]);
});

test('does not let a re-entrant resize commit overwrite a newly routed owner', () => {
  const state = resizePorts();
  let shell!: EditorShell;
  shell = new EditorShell(1440, 900, {
    ...state.ports,
    commitResize: (proposal) => {
      state.commits.push(proposal);
      dispatchPointer(shell, 'pointerdown', { pointerId: 98, x: 200, y: 200 });
      return { ok: true, value: editorSnapshot([first]) };
    },
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 97, x: 200, y: 200 });
  dispatchPointer(shell, 'pointermove', { pointerId: 97, x: 240, y: 230 });
  dispatchPointer(shell, 'pointerup', { pointerId: 97, x: 240, y: 230 });

  expect(state.commits).toHaveLength(1);
  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'resizing', pointerId: 98 });
  dispatchPointer(shell, 'pointerup', { pointerId: 97, x: 250, y: 240 });
  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'resizing', pointerId: 98 });
});

test('renders a page-space resize delta once at the normalized selected root and descendants', () => {
  const state = resizePorts();
  const shell = new EditorShell(1440, 900, state.ports);
  dispatchPointer(shell, 'pointerdown', { pointerId: 93, x: 200, y: 200 });
  dispatchPointer(shell, 'pointermove', { pointerId: 93, x: 240, y: 230 });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 3, 348, 168],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 3, 368, 204],
    args: [0, 0, 20, 16, [0, 0, 0, 0]],
  });
  expect(recording.calls.filter(({ method }) => method === 'save')).toHaveLength(
    recording.calls.filter(({ method }) => method === 'restore').length,
  );
});

test('preserves negative resize scales and matches the exact post-commit visual matrix', () => {
  const negative = Object.freeze([-1, 0, 0, -1, 300, 320]) as Matrix;
  let committed = false;
  const before = editorSnapshot([first]);
  const after: EditorSnapshot = {
    ...before,
    document: {
      ...before.document,
      revision: 5,
      nodes: before.document.nodes.map((node) =>
        node.id === first ? { ...node, transform: [-1, 0, 0, -1, 200, 200] } : node,
      ),
    },
  };
  const state = resizePorts({ delta: negative, snapshot: () => (committed ? after : before) });
  const shell = new EditorShell(1440, 900, {
    ...state.ports,
    commitResize: (proposal) => {
      state.commits.push(proposal);
      committed = true;
      return { ok: true, value: after };
    },
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 94, x: 200, y: 200 });
  dispatchPointer(shell, 'pointermove', { pointerId: 94, x: 80, y: 80 });
  const preview = recordingRenderer();
  shell.render(preview.renderer);
  const previewRoot = preview.paintedRects.find(({ args }) => args[2] === 100 && args[3] === 80);
  expect(previewRoot?.matrix).toEqual([-1, 0, 0, -1, 448, 248]);

  dispatchPointer(shell, 'pointerup', { pointerId: 94, x: 80, y: 80 });
  const durable = recordingRenderer();
  shell.render(durable.renderer);
  const durableRoot = durable.paintedRects.find(({ args }) => args[2] === 100 && args[3] === 80);
  expect(durableRoot?.matrix).toEqual(previewRoot?.matrix);
  expect(state.commits).toHaveLength(1);
});

test('suppresses unsupported resize shear and composed overflow with stable deduplicated errors', () => {
  const cases = [
    {
      delta: Object.freeze([1, 0.25, 0, 1, 0, 0]) as Matrix,
      code: 'render.transform-unsupported',
    },
    {
      delta: Object.freeze([Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 0, 0]) as Matrix,
      code: 'render.transform-overflow',
    },
  ] as const;

  for (const fixture of cases) {
    const errors: Array<Readonly<{ code: string; path: string }>> = [];
    const state = resizePorts({ delta: fixture.delta });
    const shell = new EditorShell(1440, 900, {
      ...state.ports,
      reportInteractionError: (error) => errors.push(error),
    });
    dispatchPointer(shell, 'pointerdown', { pointerId: 95, x: 200, y: 200 });
    dispatchPointer(shell, 'pointermove', { pointerId: 95, x: 240, y: 230 });
    const firstRender = recordingRenderer();
    shell.render(firstRender.renderer);
    shell.render(recordingRenderer().renderer);

    expect(errors).toEqual([{ code: fixture.code, path: '/nodes/0/transform' }]);
    expect(firstRender.paintedRects.some(({ args }) => args[2] === 100 && args[3] === 80)).toBe(
      false,
    );
    expect(firstRender.calls.filter(({ method }) => method === 'save')).toHaveLength(
      firstRender.calls.filter(({ method }) => method === 'restore').length,
    );
  }
});

test('exposes fresh detached frozen resizing diagnostics with modifiers and Core geometry', () => {
  const state = resizePorts();
  const shell = new EditorShell(1440, 900, state.ports);
  dispatchPointer(shell, 'pointerdown', { pointerId: 96, x: 200, y: 200, altKey: true });
  dispatchPointer(shell, 'pointermove', {
    pointerId: 96,
    x: 240,
    y: 230,
    shiftKey: true,
    altKey: false,
  });

  const snapshot = shell.interactionSnapshot();
  const again = shell.interactionSnapshot();
  expect(snapshot).toMatchObject({
    phase: 'resizing',
    terminalEffect: null,
    pointerId: 96,
    handle: 'south-east',
    shiftKey: true,
    altKey: false,
    start: null,
    current: null,
    resizeStart: { x: 200, y: 200 },
    resizeCurrent: { x: 240, y: 230 },
    anchor: { x: 100, y: 120 },
    bounds: { minX: 100, minY: 120, maxX: 300, maxY: 360 },
  });
  expect(snapshot).not.toBe(again);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen('bounds' in snapshot ? snapshot.bounds : null)).toBe(true);
  expect(Object.isFrozen('anchor' in snapshot ? snapshot.anchor : null)).toBe(true);
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
});

test('captures every caller-owned resize-start accessor exactly once before retaining it', () => {
  const source = resizeStart();
  const reads = new Map<string, number>();
  const read = <T>(name: string, value: T): T => {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    return value;
  };
  const handles = source.handles.map((entry, index) => ({
    get handle() {
      return read(`handles.${index}.handle`, entry.handle);
    },
    get point() {
      return {
        get x() {
          return read(`handles.${index}.point.x`, entry.point.x);
        },
        get y() {
          return read(`handles.${index}.point.y`, entry.point.y);
        },
      };
    },
  })) as readonly ResizeHandlePosition[];
  const getterStart = {
    get token() {
      return read('token', source.token);
    },
    get selection() {
      return read('selection', source.selection);
    },
    get bounds() {
      return read('bounds', source.bounds);
    },
    get handles() {
      return read('handles', handles);
    },
  } as ResizeInteractionStart;
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => editorSnapshot([first]),
    beginResizeInteraction: () => ({ ok: true, value: getterStart }),
  });

  dispatchPointer(shell, 'pointerdown', { pointerId: 101, x: 200, y: 200 });

  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'resizing', pointerId: 101 });
  expect([...reads.values()].every((count) => count === 1)).toBe(true);
});

test('never rereads or retains a mutable resize start after pointerdown', () => {
  const source = resizeStart();
  const mutableBounds = { ...source.bounds };
  const mutableHandles = source.handles.map((entry) => ({
    handle: entry.handle,
    point: { ...entry.point },
  }));
  let handlesReads = 0;
  let armed = false;
  let shell!: EditorShell;
  const callerStart = {
    token: source.token,
    selection: source.selection,
    bounds: mutableBounds,
    get handles() {
      handlesReads += 1;
      if (armed) {
        const canvas = childById(shell, 'brings-canvas-region');
        canvas.dispatchEvent(new VectoJSEvent('keydown', canvas, { key: 'Escape' }));
      }
      return mutableHandles;
    },
  } as ResizeInteractionStart;
  shell = new EditorShell(1440, 900, {
    documentSnapshot: () => editorSnapshot([first]),
    beginResizeInteraction: () => ({ ok: true, value: callerStart }),
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 102, x: 200, y: 200 });
  armed = true;
  mutableBounds.minX = -999;
  mutableHandles[0]!.point.x = -999;
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(handlesReads).toBe(1);
  expect(shell.interactionSnapshot()).toMatchObject({ phase: 'resizing', pointerId: 102 });
  expect(
    recording.calls.some(
      ({ method, args }) =>
        method === 'roundRect' && JSON.stringify(args.slice(0, 5)) === '[96,116,8,8,0]',
    ),
  ).toBe(true);
  expect(
    recording.calls.some(({ method, args }) => method === 'roundRect' && Number(args[0]) === -1003),
  ).toBe(false);
});

test('applies resize preview only to authoritative command roots and their descendants', () => {
  const before = editorSnapshot([first, fourth]);
  const document: EditorSnapshot = {
    ...before,
    document: {
      ...before.document,
      pages: [{ ...before.document.pages[0]!, rootNodeIds: [first, third, fourth] }],
      nodes: [
        ...before.document.nodes,
        {
          id: third,
          name: 'Command root',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 300, 100],
          type: 'rectangle',
          width: 30,
          height: 20,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid', r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
        {
          id: fourth,
          name: 'Selected sibling outside command',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 400, 100],
          type: 'rectangle',
          width: 40,
          height: 20,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid', r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
      ],
    },
  };
  const start = resizeStart();
  const delta = Object.freeze([2, 0, 0, 2, -100, -120]) as Matrix;
  const shell = new EditorShell(1440, 900, {
    documentSnapshot: () => document,
    beginResizeInteraction: () => ({ ok: true, value: start }),
    proposeResize: ({ input }) => {
      const base = resizeProposal(start, input, delta);
      return {
        ok: true,
        value: Object.freeze({
          ...base,
          selection: Object.freeze({
            nodeIds: Object.freeze([first, fourth]),
            activeNodeId: fourth,
          }),
          resize: Object.freeze({
            ...base.resize,
            command: Object.freeze({
              ...base.resize.command,
              nodeIds: Object.freeze([first, third]),
            }),
          }),
        }),
      };
    },
  });
  dispatchPointer(shell, 'pointerdown', { pointerId: 103, x: 200, y: 200 });
  dispatchPointer(shell, 'pointermove', { pointerId: 103, x: 240, y: 230 });
  const recording = recordingRenderer();

  shell.render(recording.renderer);

  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 2, 348, 168],
    args: [0, 0, 100, 80, [0, 0, 0, 0]],
  });
  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 2, 368, 192],
    args: [0, 0, 20, 16, [0, 0, 0, 0]],
  });
  expect(recording.paintedRects).toContainEqual({
    matrix: [2, 0, 0, 2, 748, 128],
    args: [0, 0, 30, 20, [0, 0, 0, 0]],
  });
  expect(recording.paintedRects).toContainEqual({
    matrix: [1, 0, 0, 1, 648, 148],
    args: [0, 0, 40, 20, [0, 0, 0, 0]],
  });
});
