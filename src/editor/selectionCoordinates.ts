import type { Result } from '@vectojs/brings-core';

declare const viewportPointBrand: unique symbol;
declare const editorPagePointBrand: unique symbol;
declare const editorPageRectBrand: unique symbol;
declare const pageDeltaBrand: unique symbol;

/** A VectoJS logical point measured in the Design canvas viewport. */
export type ViewportPoint = Readonly<{
  x: number;
  y: number;
  readonly [viewportPointBrand]: 'viewport-point';
}>;

/** A point measured in the editor's durable page coordinate space. */
export type EditorPagePoint = Readonly<{
  x: number;
  y: number;
  readonly [editorPagePointBrand]: 'editor-page-point';
}>;

/** A normalized rectangle measured in the editor's durable page space. */
export type EditorPageRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  readonly [editorPageRectBrand]: 'editor-page-rect';
}>;

/** A translation delta measured in the editor's durable page space. */
export type PageDelta = Readonly<{
  x: number;
  y: number;
  readonly [pageDeltaBrand]: 'page-delta';
}>;

function failure(path: string): Result<never> {
  return {
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path },
  };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Validate one logical Design-viewport point before interaction state owns it. */
export function viewportPoint(x: number, y: number): Result<ViewportPoint> {
  if (!Number.isFinite(x)) return failure('/viewport/x');
  if (!Number.isFinite(y)) return failure('/viewport/y');
  return success(Object.freeze({ x, y }) as ViewportPoint);
}

/** Convert a validated viewport point through the current identity viewport transform. */
export function viewportToPagePoint(point: ViewportPoint): Result<EditorPagePoint> {
  if (!Number.isFinite(point.x)) return failure('/page/x');
  if (!Number.isFinite(point.y)) return failure('/page/y');
  return success(Object.freeze({ x: point.x, y: point.y }) as EditorPagePoint);
}

/** Normalize two page points into a positive-size page rectangle. */
export function pageRectBetween(
  start: EditorPagePoint,
  current: EditorPagePoint,
): Result<EditorPageRect> {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.max(start.x, current.x) - x;
  const height = Math.max(start.y, current.y) - y;
  if (![x, y, width, height].every(Number.isFinite)) return failure('/rect');
  return success(Object.freeze({ x, y, width, height }) as EditorPageRect);
}

/** Derive one page-space translation from the interaction start to its current point. */
export function pageDeltaBetween(
  start: EditorPagePoint,
  current: EditorPagePoint,
): Result<PageDelta> {
  const x = current.x - start.x;
  const y = current.y - start.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return failure('/delta');
  return success(Object.freeze({ x, y }) as PageDelta);
}
