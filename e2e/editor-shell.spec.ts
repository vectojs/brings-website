import { expect, test, type Page } from '@playwright/test';

type BrowserDebugSnapshot = Readonly<{
  document: Readonly<{
    revision: number;
    nodes: readonly Readonly<{
      id: string;
      type: string;
      parentId: string | null;
      transform: readonly number[];
      width?: number;
      height?: number;
    }>[];
  }>;
  selection: Readonly<{ nodeIds: readonly string[]; activeNodeId: string | null }>;
  undoDepth: number;
  redoDepth: number;
}>;

type BrowserInteraction = Readonly<{
  phase: 'idle' | 'pending' | 'marquee' | 'moving' | 'resizing' | 'terminal';
  terminalEffect: 'commit-selection' | 'commit-move' | 'commit-resize' | 'discard' | null;
  pointerId: number | null;
  shiftKey: boolean | null;
  altKey?: boolean | null;
  handle?:
    'north-west' | 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west';
  start: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }> | null;
  current: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }> | null;
  resizeStart?: Readonly<{ x: number; y: number }>;
  resizeCurrent?: Readonly<{ x: number; y: number }>;
  anchor?: Readonly<{ x: number; y: number }> | null;
  bounds?: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
  visual: Readonly<{
    selection: Readonly<{ nodeIds: readonly string[]; activeNodeId: string | null }>;
    marquee: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    movementDelta: Readonly<{ x: number; y: number }> | null;
    guides?: readonly Readonly<{
      axis: 'x' | 'y';
      sourceAnchor: 'min' | 'center' | 'max';
      targetAnchor: 'min' | 'center' | 'max';
      targetNodeId: string;
      coordinate: number;
      minExtent: number;
      maxExtent: number;
    }>[];
    resize?: Readonly<{
      handle: NonNullable<BrowserInteraction['handle']>;
      anchor: Readonly<{ x: number; y: number }>;
      scaleX: number;
      scaleY: number;
      bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
      command: Readonly<{
        kind: 'apply-transform-delta';
        nodeIds: readonly string[];
        delta: readonly number[];
      }>;
    }>;
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

async function projectedPoint(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
): Promise<Readonly<{ x: number; y: number }>> {
  const bounds = await page.getByRole('region', { name: 'Design canvas' }).boundingBox();
  if (bounds === null) throw new Error('Design canvas is not projected.');
  return { x: bounds.x + point.x, y: bounds.y + point.y };
}

async function createAndSelectFrame(
  page: Page,
  position: Readonly<{ x: number; y: number }>,
): Promise<Readonly<{ id: string; transform: readonly number[] }>> {
  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position });
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: position.x + 40, y: position.y + 40 } });
  const snapshot = await readDebug(page);
  const selected = snapshot.snapshot.document.nodes.find(
    (node) => node.id === snapshot.snapshot.selection.activeNodeId,
  );
  if (selected === undefined) throw new Error('The created Frame was not selected.');
  return selected;
}

async function createTwoFramesAndSelectFirst(
  page: Page,
  firstPosition: Readonly<{ x: number; y: number }>,
  secondPosition: Readonly<{ x: number; y: number }>,
): Promise<
  readonly [
    Readonly<{ id: string; transform: readonly number[] }>,
    Readonly<{ id: string; transform: readonly number[] }>,
  ]
> {
  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: firstPosition });
  await canvas.click({ position: secondPosition });
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: firstPosition.x + 40, y: firstPosition.y + 40 } });
  const snapshot = await readDebug(page);
  const frames = snapshot.snapshot.document.nodes.filter((node) => node.type === 'frame');
  if (frames.length !== 2 || frames[0] === undefined || frames[1] === undefined) {
    throw new Error('Two Frames were not created in canonical page order.');
  }
  if (snapshot.snapshot.selection.activeNodeId !== frames[0].id) {
    throw new Error('The first Frame was not selected.');
  }
  return [frames[0], frames[1]];
}

function expectNumbersClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, expectedValue] of expected.entries()) {
    expect(actual?.[index]).toBeCloseTo(expectedValue, 10);
  }
}

function multiplyAffine(left: readonly number[], right: readonly number[]): readonly number[] {
  return [
    (left[0] ?? 0) * (right[0] ?? 0) + (left[2] ?? 0) * (right[1] ?? 0),
    (left[1] ?? 0) * (right[0] ?? 0) + (left[3] ?? 0) * (right[1] ?? 0),
    (left[0] ?? 0) * (right[2] ?? 0) + (left[2] ?? 0) * (right[3] ?? 0),
    (left[1] ?? 0) * (right[2] ?? 0) + (left[3] ?? 0) * (right[3] ?? 0),
    (left[0] ?? 0) * (right[4] ?? 0) + (left[2] ?? 0) * (right[5] ?? 0) + (left[4] ?? 0),
    (left[1] ?? 0) * (right[4] ?? 0) + (left[3] ?? 0) * (right[5] ?? 0) + (left[5] ?? 0),
  ];
}

/**
 * Reads the black-box canvas raster around one handle. The 8px handle currently
 * has a 7px white fill span and a 9px span after its centered 1px stroke.
 */
async function readResizeHandleLogicalGeometry(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
): Promise<Readonly<{ fillSpan: number; paintedSpan: number }> | null> {
  return page.locator('canvas').evaluate((element, { x, y }) => {
    if (!(element instanceof HTMLCanvasElement)) return null;
    const context = element.getContext('2d');
    if (context === null) return null;
    const dpr = window.devicePixelRatio;
    const sampleY = Math.round(y * dpr);
    const background = context.getImageData(Math.round((x + 12) * dpr), sampleY, 1, 1).data;
    const differs = (sampleX: number): boolean => {
      const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
      return [0, 1, 2].some(
        (channel) => Math.abs((pixel[channel] ?? 0) - (background[channel] ?? 0)) > 8,
      );
    };
    const center = Math.round(x * dpr);
    const filled = (sampleX: number): boolean => {
      const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
      return [0, 1, 2].every((channel) => (pixel[channel] ?? 0) > 250);
    };
    const centerSpan = (matches: (sampleX: number) => boolean): number => {
      if (!matches(center)) return 0;
      const limit = Math.round(12 * dpr);
      let minimum = center;
      let maximum = center;
      while (center - minimum < limit && matches(minimum - 1)) minimum -= 1;
      while (maximum - center < limit && matches(maximum + 1)) maximum += 1;
      return (maximum - minimum + 1) / dpr;
    };
    return {
      fillSpan: centerSpan(filled),
      paintedSpan: centerSpan(differs),
    };
  }, point);
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

  await page.getByRole('button', { name: /Frame/ }).click();
  await page.mouse.click((bounds.x + 100) * pageScale, (bounds.y + 120) * pageScale);
  await page.getByRole('button', { name: /Select/ }).click();
  await page.mouse.click((bounds.x + 140) * pageScale, (bounds.y + 160) * pageScale);
  await expect.poll(async () => (await readDebug(page)).snapshot.selection.nodeIds.length).toBe(1);
  const readHandleRaster = () =>
    readResizeHandleLogicalGeometry(page, {
      x: bounds.x + 500,
      y: bounds.y + 423,
    });
  // A centered 1px stroke yields a 7px fill and 9px painted span around an 8px handle.
  await expect.poll(async () => (await readHandleRaster())?.fillSpan ?? 0).toBeCloseTo(7, 0);
  await expect.poll(async () => (await readHandleRaster())?.paintedSpan ?? 0).toBeCloseTo(9, 0);

  const resizeAt = async (offset: number): Promise<void> => {
    await page.mouse.move((bounds.x + 500 + offset) * pageScale, (bounds.y + 420) * pageScale);
    await page.mouse.down();
  };
  await resizeAt(9.9);
  const inclusiveHit = await readDebug(page);
  expect(inclusiveHit.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'south-east',
  });
  expect(inclusiveHit.interaction.resizeStart?.x).toBeCloseTo(509.9, 3);
  expect(inclusiveHit.interaction.resizeStart?.y).toBeCloseTo(420, 3);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await resizeAt(10.1);
  expect((await readDebug(page)).interaction.phase).toBe('pending');
  await page.mouse.up();

  await page.getByRole('button', { name: /Frame/ }).click();
  await page.mouse.click((bounds.x + 600) * pageScale, (bounds.y + 120) * pageScale);
  await page.getByRole('button', { name: /Select/ }).click();
  await page.mouse.click((bounds.x + 140) * pageScale, (bounds.y + 160) * pageScale);
  await page.mouse.move((bounds.x + 140) * pageScale, (bounds.y + 160) * pageScale);
  await page.mouse.down();
  await page.mouse.move((bounds.x + 236) * pageScale, (bounds.y + 160) * pageScale, {
    steps: 4,
  });
  const snapped = await readDebug(page);
  expect(snapped.interaction.phase).toBe('moving');
  expect(snapped.interaction.visual?.movementDelta?.x).toBeCloseTo(100, 3);
  expect(snapped.interaction.visual?.movementDelta?.y).toBeCloseTo(0, 3);
  const xGuide = snapped.interaction.visual?.guides?.find((guide) => guide.axis === 'x');
  expect(xGuide?.coordinate).toBeCloseTo(600, 3);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readDebug(page)).interaction.visual).toBeNull();
  await cdp.detach();
});

test('snaps a move with page-space guides, one history entry, and reversible cleanup', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const [firstFrame, secondFrame] = await createTwoFramesAndSelectFirst(
    page,
    { x: 100, y: 120 },
    { x: 600, y: 120 },
  );
  const before = (await readDebug(page)).snapshot;
  const start = await projectedPoint(page, { x: 140, y: 160 });
  const near = await projectedPoint(page, { x: 236, y: 160 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(near.x, near.y, { steps: 4 });

  const preview = await readDebug(page);
  expect(preview.interaction).toMatchObject({
    phase: 'moving',
    visual: {
      selection: { nodeIds: [firstFrame.id], activeNodeId: firstFrame.id },
      movementDelta: { x: 100, y: 0 },
      guides: expect.arrayContaining([
        expect.objectContaining({
          axis: 'x',
          sourceAnchor: 'max',
          targetAnchor: 'min',
          targetNodeId: secondFrame.id,
          coordinate: secondFrame.transform[4],
          minExtent: Math.min(firstFrame.transform[5] ?? 0, secondFrame.transform[5] ?? 0),
          maxExtent: Math.max(firstFrame.transform[5] ?? 0, secondFrame.transform[5] ?? 0) + 300,
        }),
        expect.objectContaining({
          axis: 'y',
          targetNodeId: secondFrame.id,
          coordinate: secondFrame.transform[5],
          minExtent: (firstFrame.transform[4] ?? 0) + 100,
          maxExtent: (secondFrame.transform[4] ?? 0) + 400,
        }),
      ]),
    },
  });
  // The displayed source starts at its durable x plus the snapped movement delta.
  const displayedSourceMinX =
    (firstFrame.transform[4] ?? 0) + (preview.interaction.visual?.movementDelta?.x ?? 0);
  expect(displayedSourceMinX).toBeCloseTo((firstFrame.transform[4] ?? 0) + 100, 10);
  expect(preview.snapshot).toEqual(before);
  expect(
    await page.evaluate(() => {
      const visual = Reflect.get(window, '__brings').interaction().visual;
      return {
        guides: Object.isFrozen(visual.guides),
        firstGuide: Object.isFrozen(visual.guides[0]),
      };
    }),
  ).toEqual({ guides: true, firstGuide: true });

  await page.mouse.up();
  const committed = await readDebug(page);
  expect(
    committed.snapshot.document.nodes.find((node) => node.id === firstFrame.id)?.transform,
  ).toEqual([1, 0, 0, 1, (firstFrame.transform[4] ?? 0) + 100, firstFrame.transform[5]]);
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    undoDepth: before.undoDepth + 1,
    redoDepth: 0,
  });

  await page.keyboard.press('Control+z');
  const undone = await readDebug(page);
  expect(
    undone.snapshot.document.nodes.find((node) => node.id === firstFrame.id)?.transform,
  ).toEqual(firstFrame.transform);
  await page.keyboard.press('Control+Shift+z');
  const redone = await readDebug(page);
  expect(
    redone.snapshot.document.nodes.find((node) => node.id === firstFrame.id)?.transform,
  ).toEqual([1, 0, 0, 1, (firstFrame.transform[4] ?? 0) + 100, firstFrame.transform[5]]);

  const movedStart = await projectedPoint(page, { x: 240, y: 160 });
  await page.mouse.move(movedStart.x, movedStart.y);
  await page.mouse.down();
  await page.mouse.move(movedStart.x + 5, movedStart.y);
  expect((await readDebug(page)).interaction.visual?.guides?.length).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readDebug(page)).interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });

  await page.mouse.move(movedStart.x, movedStart.y);
  await page.mouse.down();
  await page.mouse.move(movedStart.x + 5, movedStart.y);
  const active = await readDebug(page);
  expect(active.interaction.visual?.guides?.length).toBeGreaterThan(0);
  const pointerId = active.interaction.pointerId;
  if (pointerId === null) throw new Error('The snapped move has no pointer owner.');
  await page.getByRole('region', { name: 'Design canvas' }).evaluate(
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
    { x: movedStart.x + 5, y: movedStart.y, pointerId },
  );
  await page.mouse.up();
  expect((await readDebug(page)).interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect((await readDebug(page)).snapshot).toEqual(redone.snapshot);
});

test('snaps east resize with dynamic Shift and Alt samples and clears on pointer cancellation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const [firstFrame, secondFrame] = await createTwoFramesAndSelectFirst(
    page,
    { x: 100, y: 120 },
    { x: 600, y: 120 },
  );
  const before = (await readDebug(page)).snapshot;
  const east = await projectedPoint(page, { x: 500, y: 270 });
  await page.mouse.move(east.x, east.y);
  await page.mouse.down();
  await page.mouse.move(east.x + 96, east.y);

  const plain = await readDebug(page);
  expect(plain.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'east',
    shiftKey: false,
    altKey: false,
    visual: {
      guides: [
        expect.objectContaining({
          axis: 'x',
          targetNodeId: secondFrame.id,
          coordinate: 600,
        }),
      ],
      resize: { bounds: { minX: 100, maxX: 600 } },
    },
  });

  await page.keyboard.down('Shift');
  await page.mouse.move(east.x + 95, east.y);
  const shifted = await readDebug(page);
  expect(shifted.interaction).toMatchObject({
    shiftKey: true,
    altKey: false,
    visual: { guides: [expect.objectContaining({ axis: 'x', coordinate: 600 })] },
  });
  expect(shifted.interaction.visual?.resize?.scaleX).toBeCloseTo(
    shifted.interaction.visual?.resize?.scaleY ?? Number.NaN,
    10,
  );

  await page.keyboard.down('Alt');
  await page.keyboard.up('Shift');
  await page.mouse.move(east.x + 94, east.y);
  const centered = await readDebug(page);
  expect(centered.interaction).toMatchObject({
    shiftKey: false,
    altKey: true,
    visual: { guides: [expect.objectContaining({ axis: 'x', coordinate: 600 })] },
  });
  await page.keyboard.up('Alt');
  await page.mouse.move(east.x + 96, east.y);
  const finalPreview = await readDebug(page);
  const finalDelta = finalPreview.interaction.visual?.resize?.command.delta;
  if (finalDelta === undefined) throw new Error('The snapped east resize has no proposal.');
  await page.mouse.up();

  const committed = await readDebug(page);
  expectNumbersClose(
    committed.snapshot.document.nodes.find((node) => node.id === firstFrame.id)?.transform,
    multiplyAffine(finalDelta, firstFrame.transform),
  );
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    undoDepth: before.undoDepth + 1,
  });
  await page.keyboard.press('Control+z');
  expect(
    (await readDebug(page)).snapshot.document.nodes.find((node) => node.id === firstFrame.id)
      ?.transform,
  ).toEqual(firstFrame.transform);

  await page.mouse.move(east.x, east.y);
  await page.mouse.down();
  await page.mouse.move(east.x + 96, east.y);
  const active = await readDebug(page);
  expect(active.interaction.visual?.guides?.length).toBeGreaterThan(0);
  const pointerId = active.interaction.pointerId;
  if (pointerId === null) throw new Error('The snapped resize has no pointer owner.');
  await page.getByRole('region', { name: 'Design canvas' }).evaluate(
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
    { x: east.x + 96, y: east.y, pointerId },
  );
  await page.mouse.up();
  expect((await readDebug(page)).interaction.visual).toBeNull();
});

test('snaps a south-east resize on both axes and replays the exact proposal', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const [firstFrame, secondFrame] = await createTwoFramesAndSelectFirst(
    page,
    { x: 100, y: 120 },
    { x: 600, y: 500 },
  );
  const before = (await readDebug(page)).snapshot;
  const corner = await projectedPoint(page, { x: 500, y: 420 });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 96, corner.y + 76, { steps: 4 });

  const preview = await readDebug(page);
  expect(preview.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'south-east',
    visual: {
      resize: { bounds: { minX: 100, minY: 120, maxX: 600, maxY: 500 } },
      guides: expect.arrayContaining([
        expect.objectContaining({
          axis: 'x',
          targetNodeId: secondFrame.id,
          coordinate: 600,
        }),
        expect.objectContaining({
          axis: 'y',
          targetNodeId: secondFrame.id,
          coordinate: 500,
        }),
      ]),
    },
  });
  const delta = preview.interaction.visual?.resize?.command.delta;
  if (delta === undefined) throw new Error('The snapped corner resize has no proposal.');
  await page.mouse.up();

  const committed = await readDebug(page);
  const committedTransform = committed.snapshot.document.nodes.find(
    (node) => node.id === firstFrame.id,
  )?.transform;
  expectNumbersClose(committedTransform, multiplyAffine(delta, firstFrame.transform));
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    undoDepth: before.undoDepth + 1,
    redoDepth: 0,
  });
  await page.keyboard.press('Control+z');
  expect(
    (await readDebug(page)).snapshot.document.nodes.find((node) => node.id === firstFrame.id)
      ?.transform,
  ).toEqual(firstFrame.transform);
  await page.keyboard.press('Control+Shift+z');
  expectNumbersClose(
    (await readDebug(page)).snapshot.document.nodes.find((node) => node.id === firstFrame.id)
      ?.transform,
    committedTransform ?? [],
  );
});

test('previews and commits one Core-backed corner resize through the projected canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const frame = await createAndSelectFrame(page, { x: 100, y: 120 });
  const before = (await readDebug(page)).snapshot;
  const handle = await projectedPoint(page, { x: 500, y: 420 });
  const destination = await projectedPoint(page, { x: 540, y: 450 });

  await page.mouse.move(handle.x, handle.y);
  const traceBeforeResize = (await readDebug(page)).trace.length;
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 4 });

  const preview = await readDebug(page);
  expect(preview.interaction).toMatchObject({
    phase: 'resizing',
    terminalEffect: null,
    handle: 'south-east',
    shiftKey: false,
    altKey: false,
    resizeStart: { x: 500, y: 420 },
    resizeCurrent: { x: 540, y: 450 },
    anchor: { x: 100, y: 120 },
    visual: {
      selection: { nodeIds: [frame.id], activeNodeId: frame.id },
      resize: {
        handle: 'south-east',
        anchor: { x: 100, y: 120 },
        command: { kind: 'apply-transform-delta', nodeIds: [frame.id] },
      },
    },
  });
  for (const bounds of [preview.interaction.bounds, preview.interaction.visual?.resize?.bounds]) {
    expect(bounds?.minX).toBeCloseTo(100, 10);
    expect(bounds?.minY).toBeCloseTo(120, 10);
    expect(bounds?.maxX).toBeCloseTo(540, 10);
    expect(bounds?.maxY).toBeCloseTo(450, 10);
  }
  expect(preview.snapshot).toEqual(before);
  const resizeTrace = preview.trace
    .slice(traceBeforeResize)
    .filter((entry) => entry.type === 'pointerdown' || entry.type === 'pointermove');
  expect(resizeTrace[0]).toMatchObject({
    type: 'pointerdown',
    targetId: 'brings-canvas-region',
  });
  expect(resizeTrace.filter((entry) => entry.type === 'pointermove')).not.toHaveLength(0);
  expect(resizeTrace.every((entry) => entry.targetId === 'brings-canvas-region')).toBe(true);

  const delta = preview.interaction.visual?.resize?.command.delta;
  expect(delta).toHaveLength(6);
  await page.mouse.up();

  const committed = await readDebug(page);
  const committedFrame = committed.snapshot.document.nodes.find((node) => node.id === frame.id);
  expect(committed.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit-resize',
    visual: null,
  });
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    selection: before.selection,
    undoDepth: before.undoDepth + 1,
    redoDepth: 0,
  });
  expectNumbersClose(committedFrame?.transform, [1.1, 0, 0, 1.1, 100, 120]);
  expectNumbersClose(delta, [1.1, 0, 0, 1.1, -10, -12]);

  await page.keyboard.press('Control+z');
  const undone = await readDebug(page);
  expectNumbersClose(
    undone.snapshot.document.nodes.find((node) => node.id === frame.id)?.transform,
    frame.transform,
  );
  expect(undone.snapshot).toMatchObject({
    document: { revision: before.document.revision + 2 },
    selection: before.selection,
    undoDepth: before.undoDepth,
    redoDepth: 1,
  });

  await page.keyboard.press('Control+Shift+z');
  const redone = await readDebug(page);
  expectNumbersClose(
    redone.snapshot.document.nodes.find((node) => node.id === frame.id)?.transform,
    committedFrame?.transform ?? [],
  );
  expect(redone.snapshot).toMatchObject({
    document: { revision: before.document.revision + 3 },
    selection: before.selection,
    undoDepth: before.undoDepth + 1,
    redoDepth: 0,
  });

  const frozen = await page.evaluate(() => {
    const interaction = Reflect.get(window, '__brings').interaction();
    return {
      interaction: Object.isFrozen(interaction),
      bounds: Object.isFrozen(interaction.bounds),
      json: JSON.parse(JSON.stringify(interaction)),
    };
  });
  expect(frozen.interaction).toBe(true);
  expect(frozen.bounds).toBe(true);
  expect(frozen.json).toEqual(redone.interaction);
});

test('samples edge-resize Shift and Alt modifiers dynamically', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const frame = await createAndSelectFrame(page, { x: 100, y: 120 });
  const before = (await readDebug(page)).snapshot;
  const north = await projectedPoint(page, { x: 300, y: 120 });
  await page.mouse.move(north.x, north.y);
  await page.mouse.down();
  await page.mouse.move(north.x, north.y - 30);

  const unconstrained = await readDebug(page);
  expect(unconstrained.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'north',
    shiftKey: false,
    altKey: false,
    anchor: { x: 300, y: 420 },
  });
  expect(unconstrained.interaction.visual?.resize?.scaleX).toBeCloseTo(1, 10);
  expect(unconstrained.interaction.visual?.resize?.scaleY).toBeGreaterThan(1);

  await page.keyboard.down('Shift');
  await page.mouse.move(north.x, north.y - 31);
  const aspect = await readDebug(page);
  expect(aspect.interaction).toMatchObject({ shiftKey: true, altKey: false });
  expect(aspect.interaction.visual?.resize?.scaleX).toBeCloseTo(
    aspect.interaction.visual?.resize?.scaleY ?? Number.NaN,
    10,
  );

  await page.keyboard.down('Alt');
  await page.mouse.move(north.x, north.y - 32);
  const centeredAspect = await readDebug(page);
  expect(centeredAspect.interaction).toMatchObject({
    shiftKey: true,
    altKey: true,
    anchor: { x: 300, y: 270 },
  });
  expect(centeredAspect.interaction.visual?.resize?.scaleX).toBeCloseTo(
    centeredAspect.interaction.visual?.resize?.scaleY ?? Number.NaN,
    10,
  );

  await page.keyboard.up('Shift');
  await page.mouse.move(north.x, north.y - 33);
  const centered = await readDebug(page);
  expect(centered.interaction).toMatchObject({ shiftKey: false, altKey: true });
  expect(centered.interaction.visual?.resize?.scaleX).toBeCloseTo(1, 10);
  expect(centered.interaction.visual?.resize?.scaleY).toBeGreaterThan(
    unconstrained.interaction.visual?.resize?.scaleY ?? Number.POSITIVE_INFINITY,
  );

  await page.keyboard.down('Shift');
  await page.mouse.move(north.x, north.y - 34);
  const finalPreview = await readDebug(page);
  const finalResize = finalPreview.interaction.visual?.resize;
  const finalDelta = finalResize?.command.delta;
  expect(finalPreview.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'north',
    shiftKey: true,
    altKey: true,
    resizeStart: { x: 300, y: 120 },
    resizeCurrent: { x: 300, y: 86 },
    anchor: { x: 300, y: 270 },
    visual: {
      selection: { nodeIds: [frame.id], activeNodeId: frame.id },
      resize: {
        handle: 'north',
        anchor: { x: 300, y: 270 },
        command: { kind: 'apply-transform-delta', nodeIds: [frame.id] },
      },
    },
  });
  expect(finalResize?.scaleX).toBeCloseTo(finalResize?.scaleY ?? Number.NaN, 10);
  expect(finalResize?.scaleX).toBeGreaterThan(1);
  for (const bounds of [finalPreview.interaction.bounds, finalResize?.bounds]) {
    expect(bounds?.minX).toBeCloseTo(54.6666666667, 8);
    expect(bounds?.minY).toBeCloseTo(86, 8);
    expect(bounds?.maxX).toBeCloseTo(545.3333333333, 8);
    expect(bounds?.maxY).toBeCloseTo(454, 8);
  }
  expect(finalPreview.snapshot).toEqual(before);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');

  const committed = await readDebug(page);
  expect(committed.interaction.terminalEffect).toBe('commit-resize');
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    selection: { nodeIds: [frame.id], activeNodeId: frame.id },
    undoDepth: before.undoDepth + 1,
  });
  if (finalDelta === undefined) throw new Error('Final edge resize did not expose its command.');
  expectNumbersClose(
    committed.snapshot.document.nodes.find((node) => node.id === frame.id)?.transform,
    multiplyAffine(finalDelta, frame.transform),
  );
});

test('commits signed anchor crossing with the exact last preview matrix', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const frame = await createAndSelectFrame(page, { x: 100, y: 120 });
  const before = (await readDebug(page)).snapshot;
  const northWest = await projectedPoint(page, { x: 100, y: 120 });
  const crossed = await projectedPoint(page, { x: 540, y: 470 });
  await page.mouse.move(northWest.x, northWest.y);
  await page.mouse.down();
  await page.mouse.move(crossed.x, crossed.y, { steps: 4 });

  const preview = await readDebug(page);
  const resize = preview.interaction.visual?.resize;
  expect(preview.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'north-west',
    anchor: { x: 500, y: 420 },
  });
  expect(resize?.scaleX).toBeLessThan(0);
  expect(resize?.scaleY).toBeLessThan(0);
  expect(preview.snapshot).toEqual(before);
  const delta = resize?.command.delta;
  if (delta === undefined) throw new Error('Signed resize did not expose its preview command.');
  const expected = multiplyAffine(delta, frame.transform);

  await page.mouse.up();
  const committed = await readDebug(page);
  expect(committed.interaction.terminalEffect).toBe('commit-resize');
  expectNumbersClose(
    committed.snapshot.document.nodes.find((node) => node.id === frame.id)?.transform,
    expected,
  );
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    selection: before.selection,
    undoDepth: before.undoDepth + 1,
  });
});

test('resizes an aggregate selection as one undo entry without touching its sibling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  for (const position of [
    { x: 50, y: 100 },
    { x: 550, y: 100 },
    { x: 1050, y: 100 },
  ]) {
    await canvas.click({ position });
  }
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: 100, y: 150 } });
  await canvas.click({ position: { x: 600, y: 150 }, modifiers: ['Shift'] });

  const before = (await readDebug(page)).snapshot;
  const [firstId, secondId] = before.selection.nodeIds;
  if (firstId === undefined || secondId === undefined) {
    throw new Error('Two Frames were not selected for aggregate resize.');
  }
  const sibling = before.document.nodes.find(
    (node) => node.type === 'frame' && !before.selection.nodeIds.includes(node.id),
  );
  if (sibling === undefined) throw new Error('The unselected sibling Frame was not created.');
  const selectedBefore = before.document.nodes.filter((node) =>
    before.selection.nodeIds.includes(node.id),
  );
  const southEast = await projectedPoint(page, { x: 950, y: 400 });
  const destination = await projectedPoint(page, { x: 1000, y: 430 });
  await page.mouse.move(southEast.x, southEast.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 4 });

  const preview = await readDebug(page);
  expect(preview.interaction).toMatchObject({
    phase: 'resizing',
    handle: 'south-east',
    visual: {
      selection: { nodeIds: [firstId, secondId], activeNodeId: secondId },
      resize: { command: { nodeIds: [firstId, secondId] } },
    },
  });
  expect(preview.snapshot).toEqual(before);
  const delta = preview.interaction.visual?.resize?.command.delta;
  if (delta === undefined) throw new Error('Aggregate resize did not expose its command.');
  await page.mouse.up();

  const committed = await readDebug(page);
  expect(committed.snapshot).toMatchObject({
    document: { revision: before.document.revision + 1 },
    selection: before.selection,
    undoDepth: before.undoDepth + 1,
    redoDepth: 0,
  });
  for (const node of selectedBefore) {
    expectNumbersClose(
      committed.snapshot.document.nodes.find((candidate) => candidate.id === node.id)?.transform,
      multiplyAffine(delta, node.transform),
    );
  }
  expect(committed.snapshot.document.nodes.find((node) => node.id === sibling.id)).toEqual(sibling);

  await page.keyboard.press('Control+z');
  const undone = await readDebug(page);
  expect(undone.snapshot.document.nodes).toEqual(before.document.nodes);
  expect(undone.snapshot).toMatchObject({
    selection: before.selection,
    undoDepth: before.undoDepth,
    redoDepth: 1,
  });
});

test('discards resize on Escape, pointercancel, and a narrow responsive transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  await createAndSelectFrame(page, { x: 100, y: 120 });
  const durable = (await readDebug(page)).snapshot;
  let southEast = await projectedPoint(page, { x: 500, y: 420 });
  let destination = await projectedPoint(page, { x: 540, y: 450 });

  await page.mouse.move(southEast.x, southEast.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 3 });
  const traceBeforeEscape = (await readDebug(page)).trace.length;
  await page.keyboard.press('Escape');
  const escaped = await readDebug(page);
  expect(escaped.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
    visual: null,
  });
  expect(escaped.snapshot).toEqual(durable);
  const escapedPointerId = escaped.interaction.pointerId;
  if (escapedPointerId === null) throw new Error('The escaped resize has no pointer identifier.');
  const traceBeforeQuarantinedDown = escaped.trace.length;
  await page.getByRole('region', { name: 'Design canvas' }).evaluate(
    (element, input) => {
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: input.x,
          clientY: input.y,
          pointerId: input.pointerId,
        }),
      );
    },
    { x: southEast.x, y: southEast.y, pointerId: escapedPointerId },
  );
  await expect
    .poll(async () =>
      (await readDebug(page)).trace
        .slice(traceBeforeQuarantinedDown)
        .filter((entry) => entry.type === 'pointerdown')
        .map((entry) => ({ type: entry.type, targetId: entry.targetId })),
    )
    .toEqual([{ type: 'pointerdown', targetId: 'brings-canvas-region' }]);
  const afterLateDown = await readDebug(page);
  expect(afterLateDown.interaction).toEqual(escaped.interaction);
  expect(afterLateDown.snapshot).toEqual(durable);
  await page.mouse.up();
  const afterEscape = await readDebug(page);
  expect(afterEscape.snapshot).toEqual(durable);
  expect(
    afterEscape.trace
      .slice(traceBeforeEscape)
      .filter((entry) => entry.type === 'keydown' || entry.type === 'pointerup')
      .map((entry) => ({ type: entry.type, defaultPrevented: entry.defaultPrevented })),
  ).toEqual([
    { type: 'keydown', defaultPrevented: true },
    { type: 'pointerup', defaultPrevented: false },
  ]);

  await page.mouse.move(southEast.x, southEast.y);
  await page.mouse.down();
  expect((await readDebug(page)).interaction.phase).toBe('resizing');
  await page.mouse.move(destination.x, destination.y, { steps: 3 });
  const active = await readDebug(page);
  const pointerId = active.interaction.pointerId;
  if (pointerId === null) throw new Error('The resize session has no owner pointer.');
  const traceBeforeCancel = active.trace.length;
  await page.getByRole('region', { name: 'Design canvas' }).evaluate(
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
    { x: destination.x, y: destination.y, pointerId },
  );
  expect((await readDebug(page)).snapshot).toEqual(durable);
  await page.mouse.up();
  const afterCancel = await readDebug(page);
  expect(afterCancel.interaction).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'discard',
  });
  expect(afterCancel.snapshot).toEqual(durable);
  expect(
    afterCancel.trace
      .slice(traceBeforeCancel)
      .filter((entry) => entry.type === 'pointercancel' || entry.type === 'pointerup')
      .map((entry) => ({ type: entry.type, defaultPrevented: entry.defaultPrevented })),
  ).toEqual([
    { type: 'pointercancel', defaultPrevented: true },
    { type: 'pointerup', defaultPrevented: false },
  ]);

  // The mouse reuses its pointer identifier only after the quarantined terminal event.
  await page.mouse.move(southEast.x, southEast.y);
  await page.mouse.down();
  expect((await readDebug(page)).interaction).toMatchObject({ phase: 'resizing', pointerId });
  await page.mouse.move(destination.x, destination.y, { steps: 2 });

  await page.setViewportSize({ width: 500, height: 900 });
  await expect
    .poll(async () => (await readDebug(page)).interaction)
    .toMatchObject({ phase: 'terminal', terminalEffect: 'discard', visual: null });
  expect((await readDebug(page)).snapshot).toEqual(durable);
  await page.mouse.up();

  const northWestNarrow = await projectedPoint(page, { x: 100, y: 120 });
  await page.mouse.move(northWestNarrow.x, northWestNarrow.y);
  await page.mouse.down();
  expect((await readDebug(page)).interaction.phase).not.toBe('resizing');
  await page.mouse.up();
  expect((await readDebug(page)).snapshot).toEqual(durable);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('group', { name: 'Properties' })).toBeVisible();
  southEast = await projectedPoint(page, { x: 500, y: 420 });
  await page.mouse.move(southEast.x, southEast.y);
  await page.mouse.down();
  await expect.poll(async () => (await readDebug(page)).interaction.phase).toBe('resizing');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readDebug(page)).snapshot).toEqual(durable);
});
