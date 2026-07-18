import { Scene } from '@vectojs/core';
import { createInteractionErrorDiagnostics } from './debug/interactionDiagnostics';
import { BringsEditorController } from './editor/BringsEditorController';
import { EditorShell, type EditorInteractionSnapshot } from './view/EditorShell';

type HeadlessDevtools = typeof import('@vectojs/devtools/headless');
type SceneAudit = ReturnType<HeadlessDevtools['auditScene']>;

declare global {
  interface Window {
    __brings?: {
      scene: Scene;
      shell: EditorShell;
      snapshot: () => import('@vectojs/brings-core').EditorSnapshot;
      audit: () => SceneAudit;
      trace: () => readonly import('@vectojs/devtools/headless').EventTraceEntry[];
      interaction: () => EditorInteractionSnapshot;
      camera: () => ReturnType<EditorShell['cameraSnapshot']>;
      contextMenu: () => ReturnType<EditorShell['contextMenuSnapshot']>;
      interactionErrors: () => readonly import('@vectojs/brings-core').BringsError[];
      undo: () => import('@vectojs/brings-core').Result<
        import('@vectojs/brings-core').EditorSnapshot
      >;
      redo: () => import('@vectojs/brings-core').Result<
        import('@vectojs/brings-core').EditorSnapshot
      >;
      deleteSelection: () => import('@vectojs/brings-core').Result<
        import('@vectojs/brings-core').EditorSnapshot
      >;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#brings-canvas');
const root = document.querySelector<HTMLElement>('#brings-root');

if (!canvas || !root) throw new Error('Brings requires its VectoJS root and canvas.');

const debugMode = new URLSearchParams(window.location.search).has('debug');
const interactionErrors = createInteractionErrorDiagnostics(debugMode);
const scene = new Scene(canvas, { disableWindowResize: true });
scene.renderMode = 'onDemand';
const editor = new BringsEditorController(() => crypto.randomUUID());
const shell = new EditorShell(1, 1, {
  documentSnapshot: () => editor.snapshot(),
  selectAt: (x, y) => editor.selectAt(x, y),
  selectAll: () => editor.selectAll(),
  selectLayer: (nodeIds, activeNodeId) => editor.setLayerSelection(nodeIds, activeNodeId),
  setLayerVisibility: (nodeId) => editor.toggleLayerVisibility(nodeId),
  setSelectionProperties: (patch) => editor.setSelectionProperties(patch),
  createAt: (tool, x, y) => {
    switch (tool) {
      case 'frame':
        return editor.createFrameAt(x, y);
      case 'rectangle':
        return editor.createRectangleAt(x, y);
      case 'ellipse':
        return editor.createEllipseAt(x, y);
      case 'text':
        return editor.createTextAt(x, y);
    }
  },
  createInBounds: (tool, bounds) => {
    switch (tool) {
      case 'frame':
        return editor.createFrameInBounds(bounds);
      case 'rectangle':
        return editor.createRectangleInBounds(bounds);
      case 'ellipse':
        return editor.createEllipseInBounds(bounds);
    }
  },
  beginSelectionInteraction: () => editor.beginSelectionInteraction(),
  proposePointSelection: (start, point, mode) =>
    editor.proposePointSelection({ start, point, mode }),
  proposeAreaSelection: (start, rect, mode) => editor.proposeAreaSelection({ start, rect, mode }),
  proposeMove: (start, proposal, delta) => editor.proposeMove({ start, proposal, delta }),
  commitSelection: (proposal) => editor.commitSelection(proposal),
  commitMove: (input) => editor.commitMove(input),
  beginResizeInteraction: () => editor.beginResizeInteraction(),
  proposeResize: (input) => editor.proposeResize(input),
  commitResize: (proposal) => editor.commitResize(proposal),
  reportInteractionError: (error) => interactionErrors.report(error),
  runHistory: (action) => (action === 'undo' ? editor.undo() : editor.redo()),
  deleteSelection: () => editor.deleteSelection(),
  groupSelection: () => editor.groupSelection(),
  ungroupSelection: () => editor.ungroupSelection(),
  arrangeSelection: (action) => editor.arrangeSelection(action),
});
scene.add(shell);

const resize = (): void => {
  const { width, height } = root.getBoundingClientRect();
  shell.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  scene.resize(shell.width, shell.height);
  scene.markDirty();
};

const observer = new ResizeObserver(resize);
observer.observe(root);
resize();
scene.start();

// Core routes the secondary pointer through VectoJS; this capture listener only
// suppresses the browser-owned menu after the canvas-native command surface opens.
const preventNativeContextMenu = (event: Event): void => event.preventDefault();
root.addEventListener('contextmenu', preventNativeContextMenu, { capture: true });

let destroyed = false;
let destroyDebug = (): void => {};

if (debugMode) {
  void import('@vectojs/devtools/headless')
    .then(({ auditScene, createEventTrace }) => {
      if (destroyed) return;

      const trace = createEventTrace(scene, { capacity: 100 });
      const debug = {
        scene,
        shell,
        snapshot: () => editor.snapshot(),
        audit: () =>
          auditScene(scene, {
            ignoreOverlap: (left, right) => {
              const pair = new Set([left.id, right.id]);
              if (pair.has('brings-canvas-region') && pair.has('brings-tool-dock')) return true;
              return pair.has('brings-file-bar-surface') || pair.has('brings-tool-dock-surface');
            },
          }),
        trace: () => trace.entries,
        interaction: () => shell.interactionSnapshot(),
        camera: () => shell.cameraSnapshot(),
        contextMenu: () => shell.contextMenuSnapshot(),
        interactionErrors: () => interactionErrors.read(),
        undo: () => {
          const result = editor.undo();
          if (result.ok) scene.markDirty();
          return result;
        },
        redo: () => {
          const result = editor.redo();
          if (result.ok) scene.markDirty();
          return result;
        },
        deleteSelection: () => {
          const result = editor.deleteSelection();
          if (result.ok) scene.markDirty();
          return result;
        },
      };
      window.__brings = debug;
      destroyDebug = (): void => {
        trace.destroy();
        if (window.__brings === debug) delete window.__brings;
      };
    })
    .catch((error: unknown) => {
      console.error('Brings debug model failed to load.', error);
    });
}

window.addEventListener(
  'beforeunload',
  () => {
    destroyed = true;
    destroyDebug();
    observer.disconnect();
    root.removeEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    scene.destroy();
  },
  { once: true },
);
