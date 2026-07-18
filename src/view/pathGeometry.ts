import { orderPathNetwork, type PathNetwork, type Result } from '@vectojs/brings-core';
import type { IRenderer } from '@vectojs/core';

export type AppendedPathGeometry = Readonly<{
  componentCount: number;
  closedComponentCount: number;
}>;

function samePoint(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Append one validated Core Path network through the renderer-neutral path seam. */
export function appendPathNetwork(
  renderer: IRenderer,
  network: PathNetwork,
  path = '/network',
): Result<AppendedPathGeometry> {
  const ordered = orderPathNetwork(network, path);
  if (!ordered.ok) return ordered;
  renderer.beginPath();
  let closedComponentCount = 0;
  for (const component of ordered.value) {
    const first = component.cubics[0];
    renderer.moveTo(first.start.x, first.start.y);
    for (const cubic of component.cubics) {
      if (samePoint(cubic.start, cubic.startControl) && samePoint(cubic.end, cubic.endControl)) {
        renderer.lineTo(cubic.end.x, cubic.end.y);
      } else {
        renderer.bezierCurveTo(
          cubic.startControl.x,
          cubic.startControl.y,
          cubic.endControl.x,
          cubic.endControl.y,
          cubic.end.x,
          cubic.end.y,
        );
      }
    }
    if (component.closed) {
      closedComponentCount += 1;
      renderer.closePath();
    }
  }
  return {
    ok: true,
    value: Object.freeze({
      componentCount: ordered.value.length,
      closedComponentCount,
    }),
  };
}
