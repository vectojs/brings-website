import { expect, test } from 'bun:test';
import { createInteractionErrorDiagnostics } from '../src/debug/interactionDiagnostics';

test('keeps only one hundred detached frozen debug interaction errors', () => {
  const diagnostics = createInteractionErrorDiagnostics(true);
  let code = 'test.source';
  let path = '/source';
  let codeReads = 0;
  let pathReads = 0;
  diagnostics.report({
    get code() {
      codeReads += 1;
      return code;
    },
    get path() {
      pathReads += 1;
      return path;
    },
  });
  code = 'test.mutated';
  path = '/mutated';
  for (let index = 1; index <= 100; index += 1) {
    diagnostics.report({ code: `test.${index}`, path: `/errors/${index}` });
  }

  const firstRead = diagnostics.read();
  const secondRead = diagnostics.read();
  expect(codeReads).toBe(1);
  expect(pathReads).toBe(1);
  expect(firstRead).toHaveLength(100);
  expect(firstRead[0]).toEqual({ code: 'test.1', path: '/errors/1' });
  expect(firstRead.at(-1)).toEqual({ code: 'test.100', path: '/errors/100' });
  expect(firstRead).not.toBe(secondRead);
  expect(firstRead[0]).not.toBe(secondRead[0]);
  expect(Object.isFrozen(firstRead)).toBe(true);
  expect(firstRead.every(Object.isFrozen)).toBe(true);
  expect(JSON.parse(JSON.stringify(firstRead))).toEqual(firstRead);
});

test('does not inspect or retain errors when debug mode is disabled', () => {
  const diagnostics = createInteractionErrorDiagnostics(false);
  let reads = 0;

  diagnostics.report({
    get code() {
      reads += 1;
      return 'test.production';
    },
    get path() {
      reads += 1;
      return '/production';
    },
  });

  expect(reads).toBe(0);
  expect(diagnostics.read()).toEqual([]);
  expect(Object.isFrozen(diagnostics.read())).toBe(true);
});
