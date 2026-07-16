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

/** Validate one page point produced by a camera transform before Core consumes it. */
export function editorPagePoint(x: number, y: number): Result<EditorPagePoint> {
  if (!Number.isFinite(x)) return failure('/page/x');
  if (!Number.isFinite(y)) return failure('/page/y');
  return success(Object.freeze({ x, y }) as EditorPagePoint);
}

/** Convert a validated viewport point through the current identity viewport transform. */
export function viewportToPagePoint(point: ViewportPoint): Result<EditorPagePoint> {
  return editorPagePoint(point.x, point.y);
}

/** Normalize two page points into a positive-size page rectangle. */
export function pageRectBetween(
  start: EditorPagePoint,
  current: EditorPagePoint,
): Result<EditorPageRect> {
  const startX = start.x;
  const startY = start.y;
  const currentX = current.x;
  const currentY = current.y;
  if (![startX, startY, currentX, currentY].every(Number.isFinite)) return failure('/rect');
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const width = Math.max(startX, currentX) - x;
  const height = Math.max(startY, currentY) - y;
  if (![x, y, width, height].every(Number.isFinite)) return failure('/rect');
  return success(Object.freeze({ x, y, width, height }) as EditorPageRect);
}

/** Derive one page-space translation from the interaction start to its current point. */
export function pageDeltaBetween(
  start: EditorPagePoint,
  current: EditorPagePoint,
): Result<PageDelta> {
  const startX = start.x;
  const startY = start.y;
  const currentX = current.x;
  const currentY = current.y;
  if (![startX, startY, currentX, currentY].every(Number.isFinite)) return failure('/delta');
  const x = currentX - startX;
  const y = currentY - startY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return failure('/delta');
  return success(Object.freeze({ x, y }) as PageDelta);
}
