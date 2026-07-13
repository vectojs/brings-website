import { Scene } from '@vectojs/core';
import { BringsEditorController } from './editor/BringsEditorController';
import { EditorShell } from './view/EditorShell';

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
      undo: () => import('@vectojs/brings-core').Result<
        import('@vectojs/brings-core').EditorSnapshot
      >;
      redo: () => import('@vectojs/brings-core').Result<
        import('@vectojs/brings-core').EditorSnapshot
      >;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#brings-canvas');
const root = document.querySelector<HTMLElement>('#brings-root');

if (!canvas || !root) throw new Error('Brings requires its VectoJS root and canvas.');

const scene = new Scene(canvas, { disableWindowResize: true });
scene.renderMode = 'onDemand';
const editor = new BringsEditorController(() => crypto.randomUUID());
const shell = new EditorShell(
  1,
  1,
  () => editor.snapshot(),
  (tool, x, y) => (tool === 'frame' ? editor.createFrameAt(x, y) : editor.createRectangleAt(x, y)),
  (x, y) => editor.selectAt(x, y),
  (deltaX, deltaY) => editor.moveSelectionBy(deltaX, deltaY),
  (action) => (action === 'undo' ? editor.undo() : editor.redo()),
);
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

let destroyed = false;
let destroyDebug = (): void => {};

if (new URLSearchParams(window.location.search).has('debug')) {
  void import('@vectojs/devtools/headless')
    .then(({ auditScene, createEventTrace }) => {
      if (destroyed) return;

      const trace = createEventTrace(scene, { capacity: 100 });
      const debug = {
        scene,
        shell,
        snapshot: () => editor.snapshot(),
        audit: () => auditScene(scene),
        trace: () => trace.entries,
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
    scene.destroy();
  },
  { once: true },
);
