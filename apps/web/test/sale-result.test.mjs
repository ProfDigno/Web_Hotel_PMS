import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const output = await build({
  entryPoints: [fileURLToPath(new URL('../src/action-result.tsx', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  jsxDev: false,
  plugins: [{
    name: 'dialog-harness',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react\/jsx-runtime|\.\/ActionResultDialog|\.\/request-id)$/ }, args => ({ path: args.path, namespace: 'harness' }));
      builder.onLoad({ filter: /.*/, namespace: 'harness' }, args => {
        if (args.path === 'react') return { contents: 'export const useSyncExternalStore = (subscribe, snapshot) => { subscribe(() => {}); return snapshot(); };', loader: 'js' };
        if (args.path === 'react/jsx-runtime') return { contents: 'export const jsx = (type, props) => type(props); export const jsxs = jsx;', loader: 'js' };
        if (args.path === './request-id') return { contents: 'export const requestId = () => "test-request-id";', loader: 'js' };
        return { contents: 'export const ActionResultDialog = props => props;', loader: 'js' };
      });
    },
  }],
});

function freshModule() {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('la venta muestra carga y éxito sin repetir el envío', async () => {
  const app = freshModule();
  app.ActionResultHost();
  let finish;
  let requests = 0;
  const send = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const pending = app.performMutation('/api/ventas', 'POST', '{}', send);
  assert.equal(app.ActionResultHost().state, 'loading');
  assert.match(app.ActionResultHost().loadingTitle, /Registrando venta/);
  assert.equal(app.performMutation('/api/ventas', 'POST', '{}', send), pending);
  assert.equal(requests, 1);
  finish({ id: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.ActionResultHost().state, 'success');
  assert.match(app.ActionResultHost().successTitle, /Venta registrada/);
  app.ActionResultHost().onSuccessDone();
  assert.deepEqual(await pending, { id: 1 });
  assert.equal(app.ActionResultHost().state, 'idle');
});

test('el error permite reintentar la misma operación', async () => {
  const app = freshModule();
  app.ActionResultHost();
  let requests = 0;
  const pending = app.performMutation('/api/ventas', 'POST', '{}', async () => {
    requests++;
    if (requests === 1) throw new Error('Stock insuficiente');
    return { id: 2 };
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.ActionResultHost().state, 'error');
  assert.equal(app.ActionResultHost().errorMessage, 'Stock insuficiente');
  app.ActionResultHost().onRetry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.equal(app.ActionResultHost().state, 'success');
  app.ActionResultHost().onSuccessDone();
  assert.deepEqual(await pending, { id: 2 });
});
