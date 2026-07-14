import type { BringsError } from '@vectojs/brings-core';

const INTERACTION_ERROR_CAPACITY = 100;

function snapshotError(error: BringsError): BringsError {
  const code = error.code;
  const path = error.path;
  return Object.freeze({ code, path });
}

export type InteractionErrorDiagnostics = Readonly<{
  report: (error: BringsError) => void;
  read: () => readonly BringsError[];
}>;

/** Own a bounded diagnostic buffer without inspecting production-only failures. */
export function createInteractionErrorDiagnostics(enabled: boolean): InteractionErrorDiagnostics {
  const errors: BringsError[] | null = enabled ? [] : null;
  return Object.freeze({
    report(error: BringsError): void {
      if (errors === null) return;
      errors.push(snapshotError(error));
      if (errors.length > INTERACTION_ERROR_CAPACITY) {
        errors.splice(0, errors.length - INTERACTION_ERROR_CAPACITY);
      }
    },
    read(): readonly BringsError[] {
      return Object.freeze(errors?.map(snapshotError) ?? []);
    },
  });
}
