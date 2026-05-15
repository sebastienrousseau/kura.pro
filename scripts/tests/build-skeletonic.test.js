import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, FILES } from '../build-skeletonic.mjs';

describe('build-skeletonic', () => {
  let tmpRoot;
  let srcDir;
  let outDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-skel-'));
    srcDir = path.join(tmpRoot, 'src/core');
    outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(srcDir, { recursive: true });
    // Synthesize the two files build() expects under the src root.
    fs.writeFileSync(path.join(srcDir, 'skeletonic.min.css'), '/*sk core*/');
    fs.writeFileSync(path.join(srcDir, 'skeletonic-ui.min.css'), '/*sk ui*/');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('copies the expected file list', () => {
    const log = [];
    const result = build({
      srcDir: path.join(tmpRoot, 'src'),
      outDir,
      version: '9.9.9',
      log: (msg) => log.push(msg),
    });

    expect(result.version).toBe('9.9.9');
    expect(result.files).toEqual(FILES.map(([, to]) => to));
    expect(fs.readFileSync(path.join(outDir, 'skeletonic.min.css'), 'utf8')).toBe('/*sk core*/');
    expect(fs.readFileSync(path.join(outDir, 'skeletonic-ui.min.css'), 'utf8')).toBe('/*sk ui*/');
    expect(fs.readFileSync(path.join(outDir, 'VERSION'), 'utf8')).toBe(
      '@sebastienrousseau/skeletonic-stylus 9.9.9\n',
    );
    expect(log).toHaveLength(3);
    expect(log[2]).toBe('vendor: pinned to v9.9.9');
  });

  it('creates the output directory when it does not exist', () => {
    const deepOut = path.join(tmpRoot, 'nested', 'deeper', 'still');
    build({
      srcDir: path.join(tmpRoot, 'src'),
      outDir: deepOut,
      version: '1.0.0',
      log: () => {},
    });
    expect(fs.existsSync(path.join(deepOut, 'VERSION'))).toBe(true);
  });

  it('defaults the log argument to console.log without throwing', () => {
    // Drive the default-argument branch — we only care that the call
    // succeeds; the actual console output is irrelevant here.
    expect(() =>
      build({
        srcDir: path.join(tmpRoot, 'src'),
        outDir,
        version: '0.0.1',
      }),
    ).not.toThrow();
  });

  it('throws when a source file is missing', () => {
    fs.rmSync(path.join(srcDir, 'skeletonic.min.css'));
    expect(() =>
      build({
        srcDir: path.join(tmpRoot, 'src'),
        outDir,
        version: '1.0.0',
        log: () => {},
      }),
    ).toThrow();
  });

  it('FILES export is the source-of-truth file list', () => {
    expect(FILES).toEqual([
      ['core/skeletonic.min.css', 'skeletonic.min.css'],
      ['core/skeletonic-ui.min.css', 'skeletonic-ui.min.css'],
    ]);
  });
});
