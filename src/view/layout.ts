export interface EditorLayout {
  toolbarHeight: 56;
  leftPanel: { mode: 'visible' | 'drawer'; width: number };
  rightPanel: { mode: 'visible' | 'drawer'; width: number };
  viewport: { x: number; y: number; width: number; height: number };
}

export function resolveEditorLayout(width: number, height: number): EditorLayout {
  const toolbarHeight = 56 as const;
  const leftWidth = 240;
  const rightWidth = 296;
  const viewportHeight = Math.max(0, height - toolbarHeight);

  if (width >= 1200) {
    return {
      toolbarHeight,
      leftPanel: { mode: 'visible', width: leftWidth },
      rightPanel: { mode: 'visible', width: rightWidth },
      viewport: {
        x: leftWidth,
        y: toolbarHeight,
        width: Math.max(0, width - leftWidth - rightWidth),
        height: viewportHeight,
      },
    };
  }

  if (width >= 768) {
    return {
      toolbarHeight,
      leftPanel: { mode: 'visible', width: leftWidth },
      rightPanel: { mode: 'drawer', width: rightWidth },
      viewport: {
        x: leftWidth,
        y: toolbarHeight,
        width: Math.max(0, width - leftWidth),
        height: viewportHeight,
      },
    };
  }

  return {
    toolbarHeight,
    leftPanel: { mode: 'drawer', width: leftWidth },
    rightPanel: { mode: 'drawer', width: rightWidth },
    viewport: { x: 0, y: toolbarHeight, width, height: viewportHeight },
  };
}
