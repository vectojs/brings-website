import { expect, test, type Page } from '@playwright/test';

type BrowserDebugSnapshot = Readonly<{
  document: Readonly<{
    revision: number;
    nodes: readonly Readonly<{
      id: string;
      type: string;
      transform: readonly number[];
    }>[];
  }>;
  selection: Readonly<{ nodeIds: readonly string[]; activeNodeId: string | null }>;
  undoDepth: number;
  redoDepth: number;
}>;

type BrowserInteraction = Readonly<{
  phase: 'idle' | 'pending' | 'marquee' | 'moving' | 'terminal';
  terminalEffect: 'commit-selection' | 'commit-move' | 'discard' | null;
  pointerId: number | null;
  shiftKey: boolean | null;
  start: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }> | null;
  current: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }> | null;
  visual: Readonly<{
    selection: Readonly<{ nodeIds: readonly string[]; activeNodeId: string | null }>;
    marquee: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    movementDelta: Readonly<{ x: number; y: number }> | null;
  }> | null;
}>;

type BrowserTraceEntry = Readonly<{
  type: string;
  key?: string | null;
  targetId?: string | null;
  defaultPrevented: boolean;
}>;

type BrowserDebugApi = Readonly<{
  snapshot: () => BrowserDebugSnapshot;
  interaction: () => BrowserInteraction;
  interactionErrors: () => readonly Readonly<{ code: string; path: string }>[];
  trace: () => readonly BrowserTraceEntry[];
}>;

async function readDebug(page: Page): Promise<
  Readonly<{
    snapshot: BrowserDebugSnapshot;
    interaction: BrowserInteraction;
    interactionErrors: readonly Readonly<{ code: string; path: string }>[];
    trace: readonly BrowserTraceEntry[];
  }>
> {
  return page.evaluate(() => {
    const debug = Reflect.get(window, '__brings') as BrowserDebugApi;
    return {
      snapshot: debug.snapshot(),
      interaction: debug.interaction(),
      interactionErrors: debug.interactionErrors(),
      trace: debug.trace(),
    };
  });
}

test('projects one named Brings application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('application', { name: 'Brings design editor' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Layers' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Design canvas' })).toBeVisible();
});

test('loads the headless DevTools model only for debug sessions', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Reflect.has(window, '__brings'))).toBe(false);

  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, '__brings')))
    .toBe('object');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => { document: { revision: number; pages: readonly { name: string }[] } };
        };
        const snapshot = debug.snapshot();
        return { revision: snapshot.document.revision, pageName: snapshot.document.pages[0]?.name };
      }),
    )
    .toEqual({ revision: 0, pageName: 'Page 1' });
});

test('does not project closed compact drawers over the design canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  await expect(page.getByRole('group', { name: 'Properties' })).toHaveCount(0);
  const findings = await page.evaluate(() => {
    const debug = Reflect.get(window, '__brings') as { audit: () => unknown[] };
    return debug.audit();
  });
  expect(findings).toEqual([]);
});

test('creates a Frame and nested Rectangle through canvas-native tools', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  await page.getByRole('button', { name: /Frame/ }).click();
  await page.getByRole('region', { name: 'Design canvas' }).click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await page.getByRole('region', { name: 'Design canvas' }).click({ position: { x: 220, y: 204 } });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: {
              revision: number;
              nodes: readonly { type: string; parentId: string | null }[];
            };
          };
        };
        return debug.snapshot().document;
      }),
    )
    .toMatchObject({
      revision: 2,
      nodes: [
        { type: 'frame', parentId: null },
        { type: 'rectangle', parentId: expect.any(String) },
      ],
    });
});

test('selects the frontmost shape from the canvas without changing document history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: { revision: number; nodes: readonly { id: string; type: string }[] };
            selection: { nodeIds: readonly string[]; activeNodeId: string | null };
            undoDepth: number;
          };
        };
        const snapshot = debug.snapshot();
        const selectedNode = snapshot.document.nodes.find(
          (node) => node.id === snapshot.selection.activeNodeId,
        );
        return {
          revision: snapshot.document.revision,
          undoDepth: snapshot.undoDepth,
          selectedType: selectedNode?.type ?? null,
          selectedCount: snapshot.selection.nodeIds.length,
        };
      }),
    )
    .toEqual({ revision: 2, undoDepth: 2, selectedType: 'rectangle', selectedCount: 1 });
});

test('commits one drag command, preserves selection, and undoes the translation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await page.getByRole('button', { name: /Select/ }).click();

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Design canvas is not projected.');
  await page.mouse.move(bounds.x + 220, bounds.y + 204);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 250, bounds.y + 224, { steps: 4 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => { document: { revision: number }; undoDepth: number };
        };
        const snapshot = debug.snapshot();
        return { revision: snapshot.document.revision, undoDepth: snapshot.undoDepth };
      }),
    )
    .toEqual({ revision: 2, undoDepth: 2 });
  await page.mouse.up();

  const readState = () =>
    page.evaluate(() => {
      const debug = Reflect.get(window, '__brings') as {
        snapshot: () => {
          document: {
            revision: number;
            nodes: readonly { id: string; type: string; transform: readonly number[] }[];
          };
          selection: { nodeIds: readonly string[]; activeNodeId: string | null };
          undoDepth: number;
          redoDepth: number;
        };
      };
      const snapshot = debug.snapshot();
      const rectangle = snapshot.document.nodes.find((node) => node.type === 'rectangle');
      return {
        revision: snapshot.document.revision,
        transform: rectangle?.transform,
        selected: snapshot.selection.activeNodeId === rectangle?.id,
        undoDepth: snapshot.undoDepth,
        redoDepth: snapshot.redoDepth,
      };
    });

  await expect.poll(readState).toEqual({
    revision: 3,
    transform: [1, 0, 0, 1, 70, 60],
    selected: true,
    undoDepth: 3,
    redoDepth: 0,
  });

  await expect(canvas).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect.poll(readState).toEqual({
    revision: 4,
    transform: [1, 0, 0, 1, 40, 40],
    selected: true,
    undoDepth: 2,
    redoDepth: 1,
  });

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(readState).toEqual({
    revision: 5,
    transform: [1, 0, 0, 1, 70, 60],
    selected: true,
    undoDepth: 3,
    redoDepth: 0,
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          trace: () => readonly {
            type: string;
            key: string | null;
            targetId: string | null;
            defaultPrevented: boolean;
          }[];
        };
        return debug
          .trace()
          .filter((entry) => entry.type === 'keydown' && entry.key?.toLowerCase() === 'z')
          .slice(-2)
          .map((entry) => ({
            targetId: entry.targetId,
            defaultPrevented: entry.defaultPrevented,
          }));
      }),
    )
    .toEqual([
      { targetId: 'brings-canvas-region', defaultPrevented: true },
      { targetId: 'brings-canvas-region', defaultPrevented: true },
    ]);
});

test('deletes the selected Rectangle atomically and restores it through undo and redo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await expect(canvas).toBeFocused();

  const readState = () =>
    page.evaluate(() => {
      const debug = Reflect.get(window, '__brings') as {
        snapshot: () => {
          document: { revision: number; nodes: readonly { id: string; type: string }[] };
          selection: { nodeIds: readonly string[]; activeNodeId: string | null };
          undoDepth: number;
          redoDepth: number;
        };
      };
      const snapshot = debug.snapshot();
      const selectedNode = snapshot.document.nodes.find(
        (node) => node.id === snapshot.selection.activeNodeId,
      );
      return {
        revision: snapshot.document.revision,
        nodeTypes: snapshot.document.nodes.map((node) => node.type),
        selectedType: selectedNode?.type ?? null,
        selectedCount: snapshot.selection.nodeIds.length,
        undoDepth: snapshot.undoDepth,
        redoDepth: snapshot.redoDepth,
      };
    });

  await page.keyboard.press('Delete');
  await expect.poll(readState).toEqual({
    revision: 3,
    nodeTypes: ['frame'],
    selectedType: null,
    selectedCount: 0,
    undoDepth: 3,
    redoDepth: 0,
  });

  await page.keyboard.press('Control+z');
  await expect.poll(readState).toEqual({
    revision: 4,
    nodeTypes: ['frame', 'rectangle'],
    selectedType: 'rectangle',
    selectedCount: 1,
    undoDepth: 2,
    redoDepth: 1,
  });

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(readState).toEqual({
    revision: 5,
    nodeTypes: ['frame'],
    selectedType: null,
    selectedCount: 0,
    undoDepth: 3,
    redoDepth: 0,
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          trace: () => readonly {
            type: string;
            source: string;
            key?: string;
            targetId?: string;
            defaultPrevented: boolean;
          }[];
        };
        return debug
          .trace()
          .filter(
            (entry) =>
              entry.type === 'keydown' && ['delete', 'z'].includes(entry.key?.toLowerCase() ?? ''),
          )
          .map((entry) => ({
            key: entry.key?.toLowerCase(),
            source: entry.source,
            targetId: entry.targetId,
            defaultPrevented: entry.defaultPrevented,
          }));
      }),
    )
    .toEqual([
      {
        key: 'delete',
        source: 'a11y',
        targetId: 'brings-canvas-region',
        defaultPrevented: true,
      },
      {
        key: 'z',
        source: 'a11y',
        targetId: 'brings-canvas-region',
        defaultPrevented: true,
      },
      {
        key: 'z',
        source: 'a11y',
        targetId: 'brings-canvas-region',
        defaultPrevented: true,
      },
    ]);
});

test('prevents Backspace on an empty canvas without changing document history', async ({
  page,
}) => {
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await canvas.focus();
  await expect(canvas).toBeFocused();

  const before = await page.evaluate(() => {
    const debug = Reflect.get(window, '__brings') as {
      snapshot: () => {
        document: { revision: number };
        undoDepth: number;
        redoDepth: number;
      };
    };
    const snapshot = debug.snapshot();
    return {
      revision: snapshot.document.revision,
      undoDepth: snapshot.undoDepth,
      redoDepth: snapshot.redoDepth,
    };
  });

  await page.keyboard.press('Backspace');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: { revision: number };
            undoDepth: number;
            redoDepth: number;
          };
          trace: () => readonly {
            type: string;
            source: string;
            key?: string;
            targetId?: string;
            defaultPrevented: boolean;
          }[];
        };
        const snapshot = debug.snapshot();
        const entry = debug
          .trace()
          .findLast(
            (candidate) =>
              candidate.type === 'keydown' && candidate.key?.toLowerCase() === 'backspace',
          );
        return {
          state: {
            revision: snapshot.document.revision,
            undoDepth: snapshot.undoDepth,
            redoDepth: snapshot.redoDepth,
          },
          trace: entry
            ? {
                source: entry.source,
                targetId: entry.targetId,
                defaultPrevented: entry.defaultPrevented,
              }
            : null,
        };
      }),
    )
    .toEqual({
      state: before,
      trace: {
        source: 'a11y',
        targetId: 'brings-canvas-region',
        defaultPrevented: true,
      },
    });
});

test('rolls back a canceled drag and exposes its terminal DevTools trace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await page.getByRole('button', { name: /Select/ }).click();

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Design canvas is not projected.');
  await page.mouse.move(bounds.x + 220, bounds.y + 204);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 260, bounds.y + 234, { steps: 4 });
  const ownerPointerId = (await readDebug(page)).interaction.pointerId;
  if (ownerPointerId === null) throw new Error('The active drag has no owner pointer.');
  await canvas.evaluate(
    (element, point) => {
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          pointerId: point.pointerId,
        }),
      );
    },
    { x: bounds.x + 260, y: bounds.y + 234, pointerId: ownerPointerId },
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: {
              revision: number;
              nodes: readonly { type: string; transform: readonly number[] }[];
            };
            undoDepth: number;
          };
          trace: () => readonly { type: string; targetId: string | null }[];
        };
        const snapshot = debug.snapshot();
        const rectangle = snapshot.document.nodes.find((node) => node.type === 'rectangle');
        return {
          revision: snapshot.document.revision,
          transform: rectangle?.transform,
          undoDepth: snapshot.undoDepth,
          canceled: debug
            .trace()
            .some(
              (entry) =>
                entry.type === 'pointercancel' && entry.targetId === 'brings-canvas-region',
            ),
        };
      }),
    )
    .toEqual({
      revision: 2,
      transform: [1, 0, 0, 1, 40, 40],
      undoDepth: 2,
      canceled: true,
    });
});

test('completes intersection marquee, Shift composition, movement, and rollback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  for (const position of [
    { x: 50, y: 100 },
    { x: 500, y: 100 },
    { x: 950, y: 100 },
  ]) {
    await canvas.click({ position });
  }
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.focus();

  const created = await readDebug(page);
  const frames = created.snapshot.document.nodes.filter((node) => node.type === 'frame');
  expect(frames).toHaveLength(3);
  const [firstFrame, secondFrame, thirdFrame] = frames;
  if (firstFrame === undefined || secondFrame === undefined || thirdFrame === undefined) {
    throw new Error('Three top-level Frames were not created.');
  }
  const selectionOnlyBaseline = {
    revision: created.snapshot.document.revision,
    undoDepth: created.snapshot.undoDepth,
    redoDepth: created.snapshot.redoDepth,
  };
  expect(selectionOnlyBaseline).toEqual({ revision: 3, undoDepth: 3, redoDepth: 0 });

  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Design canvas is not projected.');
  const global = (point: Readonly<{ x: number; y: number }>) => ({
    x: bounds.x + point.x,
    y: bounds.y + point.y,
  });

  const reverseStart = global({ x: 920, y: 430 });
  const reverseEnd = global({ x: 30, y: 70 });
  const traceBeforeMarquee = created.trace.length;
  await page.mouse.move(reverseStart.x, reverseStart.y);
  await page.mouse.down();
  await page.mouse.move(reverseEnd.x, reverseEnd.y, { steps: 5 });

  const marquee = await readDebug(page);
  expect(marquee.interaction).toMatchObject({
    phase: 'marquee',
    terminalEffect: null,
    shiftKey: false,
    start: {
      viewport: { x: 920, y: 430 },
      page: { x: 920, y: 430 },
    },
    current: {
      viewport: { x: 30, y: 70 },
      page: { x: 30, y: 70 },
    },
    visual: {
      selection: { nodeIds: [firstFrame.id, secondFrame.id] },
      marquee: { x: 30, y: 70, width: 890, height: 360 },
      movementDelta: null,
    },
  });
  expect(marquee.snapshot.selection.nodeIds).toEqual([]);
  await page.mouse.up();

  const selectedPair = await readDebug(page);
  expect({
    revision: selectedPair.snapshot.document.revision,
    undoDepth: selectedPair.snapshot.undoDepth,
    redoDepth: selectedPair.snapshot.redoDepth,
  }).toEqual(selectionOnlyBaseline);
  expect(selectedPair.snapshot.selection.nodeIds).toEqual([firstFrame.id, secondFrame.id]);
  expect(selectedPair.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit-selection',
    visual: null,
  });
  expect(
    selectedPair.trace
      .slice(traceBeforeMarquee)
      .filter((entry) => entry.type === 'pointerup' && entry.targetId === 'brings-canvas-region'),
  ).toHaveLength(1);

  const committedInteraction = selectedPair.interaction;
  const committedSnapshot = selectedPair.snapshot;
  await canvas.evaluate(
    (element, input) => {
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: input.x,
          clientY: input.y,
          pointerId: input.pointerId,
        }),
      );
    },
    {
      x: reverseEnd.x,
      y: reverseEnd.y,
      pointerId: selectedPair.interaction.pointerId ?? 1,
    },
  );
  const afterLateTerminal = await readDebug(page);
  expect(afterLateTerminal.interaction).toEqual(committedInteraction);
  expect(afterLateTerminal.snapshot).toEqual(committedSnapshot);
  expect(
    afterLateTerminal.trace
      .slice(traceBeforeMarquee)
      .filter((entry) => entry.type === 'pointerup' && entry.targetId === 'brings-canvas-region')
      .map((entry) => entry.defaultPrevented),
  ).toEqual([true, false]);

  const additiveStart = global({ x: 1400, y: 430 });
  const additiveEnd = global({ x: 930, y: 70 });
  await page.mouse.move(additiveStart.x, additiveStart.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(additiveEnd.x, additiveEnd.y, { steps: 5 });
  const additivePreview = await readDebug(page);
  expect(additivePreview.interaction).toMatchObject({
    phase: 'marquee',
    shiftKey: true,
    start: { viewport: { x: 1400, y: 430 } },
    current: { viewport: { x: 930, y: 70 } },
    visual: {
      selection: { nodeIds: [firstFrame.id, secondFrame.id, thirdFrame.id] },
      marquee: { x: 930, y: 70, width: 470, height: 360 },
    },
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const selectedAll = await readDebug(page);
  expect(selectedAll.snapshot.selection.nodeIds).toEqual([
    firstFrame.id,
    secondFrame.id,
    thirdFrame.id,
  ]);
  expect({
    revision: selectedAll.snapshot.document.revision,
    undoDepth: selectedAll.snapshot.undoDepth,
    redoDepth: selectedAll.snapshot.redoDepth,
  }).toEqual(selectionOnlyBaseline);

  await canvas.click({ position: { x: 1000, y: 150 }, modifiers: ['Shift'] });
  const toggled = await readDebug(page);
  expect(toggled.snapshot.selection.nodeIds).toEqual([firstFrame.id, secondFrame.id]);
  expect({
    revision: toggled.snapshot.document.revision,
    undoDepth: toggled.snapshot.undoDepth,
    redoDepth: toggled.snapshot.redoDepth,
  }).toEqual(selectionOnlyBaseline);

  const moveStart = global({ x: 100, y: 150 });
  const moveEnd = global({ x: 130, y: 175 });
  await page.mouse.move(moveStart.x, moveStart.y);
  await page.mouse.down();
  await page.mouse.move(moveEnd.x, moveEnd.y, { steps: 4 });
  const movePreview = await readDebug(page);
  expect(movePreview.interaction).toMatchObject({
    phase: 'moving',
    visual: {
      selection: { nodeIds: [firstFrame.id, secondFrame.id] },
      marquee: null,
      movementDelta: { x: 30, y: 25 },
    },
  });
  await page.mouse.up();

  const moved = await readDebug(page);
  const movedFrames = moved.snapshot.document.nodes.filter((node) => node.type === 'frame');
  expect(movedFrames.map((node) => node.transform)).toEqual([
    [1, 0, 0, 1, 80, 125],
    [1, 0, 0, 1, 530, 125],
    [1, 0, 0, 1, 950, 100],
  ]);
  expect(moved.snapshot.selection.nodeIds).toEqual([firstFrame.id, secondFrame.id]);
  expect({
    revision: moved.snapshot.document.revision,
    undoDepth: moved.snapshot.undoDepth,
    redoDepth: moved.snapshot.redoDepth,
  }).toEqual({ revision: 4, undoDepth: 4, redoDepth: 0 });
  expect(moved.interaction.terminalEffect).toBe('commit-move');

  const durableBeforeCancel = moved.snapshot;
  const escapeStart = global({ x: 130, y: 175 });
  await page.mouse.move(escapeStart.x, escapeStart.y);
  await page.mouse.down();
  await page.mouse.move(escapeStart.x + 45, escapeStart.y + 30, { steps: 3 });
  expect((await readDebug(page)).interaction.phase).toBe('moving');
  const traceBeforeEscape = (await readDebug(page)).trace.length;
  await page.keyboard.press('Escape');
  const escaped = await readDebug(page);
  expect(escaped.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect(escaped.snapshot).toEqual(durableBeforeCancel);
  await page.mouse.up();
  const afterEscapeLateUp = await readDebug(page);
  expect(afterEscapeLateUp.snapshot).toEqual(durableBeforeCancel);
  expect(afterEscapeLateUp.interaction).toEqual(escaped.interaction);
  expect(
    afterEscapeLateUp.trace
      .slice(traceBeforeEscape)
      .filter(
        (entry) =>
          (entry.type === 'keydown' && entry.key === 'Escape') || entry.type === 'pointerup',
      )
      .map((entry) => ({ type: entry.type, defaultPrevented: entry.defaultPrevented })),
  ).toEqual([
    { type: 'keydown', defaultPrevented: true },
    { type: 'pointerup', defaultPrevented: false },
  ]);

  const cancelStart = global({ x: 580, y: 175 });
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x + 35, cancelStart.y + 25, { steps: 3 });
  const activeBeforeCancel = await readDebug(page);
  expect(activeBeforeCancel.interaction.phase).toBe('moving');
  const ownerPointerId = activeBeforeCancel.interaction.pointerId;
  if (ownerPointerId === null) throw new Error('The active gesture has no owner pointer.');
  const traceBeforeCancel = activeBeforeCancel.trace.length;
  await canvas.evaluate(
    (element, input) => {
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          clientX: input.x,
          clientY: input.y,
          pointerId: input.pointerId,
        }),
      );
    },
    { x: cancelStart.x + 35, y: cancelStart.y + 25, pointerId: ownerPointerId },
  );
  const canceled = await readDebug(page);
  expect(canceled.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect(canceled.snapshot).toEqual(durableBeforeCancel);
  await page.mouse.up();
  const afterCancelLateUp = await readDebug(page);
  expect(afterCancelLateUp.snapshot).toEqual(durableBeforeCancel);
  expect(afterCancelLateUp.interaction).toEqual(canceled.interaction);
  expect(
    afterCancelLateUp.trace
      .slice(traceBeforeCancel)
      .filter(
        (entry) =>
          ['pointercancel', 'pointerup'].includes(entry.type) &&
          entry.targetId === 'brings-canvas-region',
      )
      .map((entry) => ({ type: entry.type, defaultPrevented: entry.defaultPrevented })),
  ).toEqual([
    { type: 'pointercancel', defaultPrevented: true },
    { type: 'pointerup', defaultPrevented: false },
  ]);
  expect(afterCancelLateUp.interactionErrors).toEqual([]);

  const frozen = await page.evaluate(() => {
    const debug = Reflect.get(window, '__brings') as BrowserDebugApi;
    const interaction = debug.interaction();
    const errors = debug.interactionErrors();
    return {
      interaction: Object.isFrozen(interaction),
      start: Object.isFrozen(interaction.start),
      current: Object.isFrozen(interaction.current),
      errors: Object.isFrozen(errors),
    };
  });
  expect(frozen).toEqual({ interaction: true, start: true, current: true, errors: true });
});

test('keeps the logical threshold stable under high DPR and CDP page scale', async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-high-dpr', 'Chromium CDP coverage.');
  await page.setViewportSize({ width: 1600, height: 900 });
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('A viewport is required for the CDP metric override.');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: false,
    // CDP page scale validates coordinate stability; it is not browser Ctrl+/- semantic zoom.
    scale: 0.9,
  });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await canvas.focus();
  await expect(canvas).toBeFocused();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Design canvas is not projected.');
  const pageScale = 0.9;
  const start = {
    x: (bounds.x + 100) * pageScale,
    y: (bounds.y + 100) * pageScale,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3.9 * pageScale, start.y);

  const pending = await readDebug(page);
  expect(pending.interaction.phase).toBe('pending');
  expect(pending.interaction.start?.viewport.x).toBeCloseTo(100, 3);
  expect(pending.interaction.current?.viewport.x).toBeCloseTo(103.9, 3);
  expect(
    (pending.interaction.current?.viewport.x ?? 0) - (pending.interaction.start?.viewport.x ?? 0),
  ).toBeCloseTo(3.9, 3);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

  await page.mouse.up();
  const clickTerminal = await readDebug(page);
  expect(clickTerminal.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit-selection',
    visual: null,
  });

  const thresholdStart = {
    x: (bounds.x + 200) * pageScale,
    y: (bounds.y + 100) * pageScale,
  };
  await page.mouse.move(thresholdStart.x, thresholdStart.y);
  await page.mouse.down();
  await page.mouse.move(thresholdStart.x + 4 * pageScale, thresholdStart.y);
  const threshold = await readDebug(page);
  expect(threshold.interaction.phase).toBe('marquee');
  expect(threshold.interaction.start?.viewport.x).toBeCloseTo(200, 3);
  expect(threshold.interaction.start?.viewport.y).toBeCloseTo(100, 3);
  expect(threshold.interaction.start?.page.x).toBeCloseTo(200, 3);
  expect(threshold.interaction.current?.viewport.x).toBeCloseTo(204, 3);
  expect(threshold.interaction.current?.page.x).toBeCloseTo(204, 3);
  expect(threshold.interaction.visual?.marquee?.x).toBeCloseTo(200, 3);
  expect(threshold.interaction.visual?.marquee?.y).toBeCloseTo(100, 3);
  expect(threshold.interaction.visual?.marquee?.width).toBeCloseTo(4, 3);
  expect(threshold.interaction.visual?.marquee?.height).toBeCloseTo(0, 3);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readDebug(page)).interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  await cdp.detach();
});
