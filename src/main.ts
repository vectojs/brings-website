import { Scene } from '@vectojs/core';
import { EditorShell } from './view/EditorShell';

type HeadlessDevtools = typeof import('@vectojs/devtools/headless');
type SceneAudit = ReturnType<HeadlessDevtools['auditScene']>;

declare global {
  interface Window {
    __brings?: {
      scene: Scene;
      shell: EditorShell;
      audit: () => SceneAudit;
      trace: () => readonly import('@vectojs/devtools/headless').EventTraceEntry[];
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#brings-canvas');
const root = document.querySelector<HTMLElement>('#brings-root');

if (!canvas || !root) throw new Error('Brings requires its VectoJS root and canvas.');

const scene = new Scene(canvas, { disableWindowResize: true });
scene.renderMode = 'onDemand';
const shell = new EditorShell(1, 1);
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
        audit: () => auditScene(scene),
        trace: () => trace.entries,
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
