const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real TypeScript helpers without adding a test runner dependency.
function load(relative, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, ...globals });
  return exports;
}

const { validateFrameEvents } = load('lib/vlm/shared.ts');
const scene = { timestamp: '00:00', description: 'A person is seated in a chair.', isDangerous: false };

test('valid observations retain their danger classification', () => {
  assert.equal(validateFrameEvents([scene])[0].description, scene.description);
  assert.equal(validateFrameEvents([{ ...scene, isDangerous: true }])[0].isDangerous, true);
});

test('rejects screenshot-style repetitive model output', () => {
  assert.throws(() => validateFrameEvents([{ ...scene,
    description: 'A man is seated. ' + 'wayles lundar, '.repeat(12),
  }]), /repetitive/);
});

test('rejects malformed output instead of reporting it as safe', () => {
  for (const value of [undefined, [], [null], [{ ...scene, isDangerous: 'false' }],
    [{ ...scene, description: '' }], [{ ...scene, description: 'x'.repeat(401) }]]) {
    assert.throws(() => validateFrameEvents(value));
  }
});

function speechFixture({ failStart = false } = {}) {
  const instances = [];
  const timers = new Map();
  const state = { active: false, error: null, final: '', interim: '' };
  let nextTimer = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() { if (failStart) throw new Error('denied'); }
    abort() { this.aborted = true; }
  }
  const { createSpeechTranscriber } = load('lib/realtime-speech.ts', {
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  });
  const controller = createSpeechTranscriber(Recognition, {
    onActive: value => state.active = value,
    onError: value => state.error = value,
    onTranscript: (final, interim) => Object.assign(state, { final, interim }),
  }, 'en-US');
  const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
  return { controller, state, instances, timers, result };
}

test('only reports transcribing after the service starts; shows interim words without duplication', () => {
  const f = speechFixture();
  f.controller.start();
  assert.equal(f.state.active, false);
  const r = f.instances[0];
  r.onstart();
  assert.equal(f.state.active, true);
  r.onresult({ results: [f.result('hello', false)] });
  assert.equal(f.state.interim, 'hello');
  r.onresult({ results: [f.result('hello', true), f.result('world', false)] });
  r.onresult({ results: [f.result('hello', true), f.result('world', true)] });
  assert.equal(f.state.final, 'hello world');
  assert.equal(f.state.interim, '');
});

test('restarts after a speech-service end and preserves committed text', () => {
  const f = speechFixture();
  f.controller.start();
  f.instances[0].onresult({ results: [f.result('first', true)] });
  f.instances[0].onend();
  assert.equal(f.state.active, false);
  assert.equal(f.timers.size, 1);
  [...f.timers.values()][0]();
  f.instances[1].onresult({ results: [f.result('second', true)] });
  assert.equal(f.state.final, 'first second');
});

test('permission and network errors stop the indicator and do not retry indefinitely', () => {
  for (const error of ['not-allowed', 'network', 'audio-capture']) {
    const f = speechFixture();
    f.controller.start();
    f.instances[0].onstart();
    f.instances[0].onerror({ error });
    f.instances[0].onend();
    assert.equal(f.state.active, false);
    assert.ok(f.state.error);
    assert.equal(f.timers.size, 0);
  }
});

test('stop cancels pending restart; a new recording does not accept old transcript events', () => {
  const f = speechFixture();
  f.controller.start();
  const staleResult = f.instances[0].onresult;
  f.instances[0].onend();
  f.controller.stop();
  assert.equal(f.timers.size, 0);
  f.controller.start();
  staleResult({ results: [f.result('old session', true)] });
  assert.equal(f.state.final, '');
  f.controller.stop();
  assert.equal(f.instances[1].aborted, true);
});

test('a synchronous start failure produces an actionable error', () => {
  const f = speechFixture({ failStart: true });
  assert.doesNotThrow(() => f.controller.start());
  assert.equal(f.state.active, false);
  assert.match(f.state.error, /could not start/);
});
