export interface EditorLayout {
  fileBarHeight: 48;
  leftPanel: { mode: 'visible' | 'drawer'; width: number };
  rightPanel: { mode: 'visible' | 'drawer'; width: number };
  viewport: { x: number; y: number; width: number; height: number };
  toolDock: {
    mode: 'authoring' | 'navigation';
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function resolveEditorLayout(width: number, height: number): EditorLayout {
  // All chrome geometry stays in logical scene pixels so DPR and browser zoom
  // cannot change panel breakpoints or move the dock outside its viewport.
  const fileBarHeight = 48 as const;
  const leftWidth = 248;
  const rightWidth = 280;
  const viewportHeight = Math.max(0, height - fileBarHeight);

  const finish = (
    leftPanel: EditorLayout['leftPanel'],
    rightPanel: EditorLayout['rightPanel'],
    viewport: EditorLayout['viewport'],
  ): EditorLayout => {
    const mode = width >= 600 ? 'authoring' : 'navigation';
    const requestedWidth = mode === 'authoring' ? 448 : 208;
    const availableWidth = Math.max(0, viewport.width - 24);
    const dockWidth = viewport.height >= 64 ? Math.min(requestedWidth, availableWidth) : 0;
    const dockHeight = dockWidth > 0 ? 48 : 0;
    return {
      fileBarHeight,
      leftPanel,
      rightPanel,
      viewport,
      toolDock: {
        mode,
        x:
          dockWidth === 0 ? viewport.x : viewport.x + Math.max(0, (viewport.width - dockWidth) / 2),
        y: viewport.y + Math.max(0, viewport.height - 68),
        width: dockWidth,
        height: dockHeight,
      },
    };
  };

  if (width >= 1200) {
    return finish(
      { mode: 'visible', width: leftWidth },
      { mode: 'visible', width: rightWidth },
      {
        x: leftWidth,
        y: fileBarHeight,
        width: Math.max(0, width - leftWidth - rightWidth),
        height: viewportHeight,
      },
    );
  }

  if (width >= 768) {
    return finish(
      { mode: 'visible', width: leftWidth },
      { mode: 'drawer', width: rightWidth },
      {
        x: leftWidth,
        y: fileBarHeight,
        width: Math.max(0, width - leftWidth),
        height: viewportHeight,
      },
    );
  }

  return finish(
    { mode: 'drawer', width: leftWidth },
    { mode: 'drawer', width: rightWidth },
    { x: 0, y: fileBarHeight, width, height: viewportHeight },
  );
}
