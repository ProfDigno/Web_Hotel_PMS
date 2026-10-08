import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/sale-result.js', import.meta.url), 'utf8');

function harness(fetchImpl) {
  const timers = [];
  const document = {
    activeElement: null,
    body: { children: [], appendChild(element) { this.children.push(element); } },
    createElement() { return new Element(); },
    addEventListener() {},
    querySelectorAll() { return this.formButtons || []; },
  };
  class Element {
    constructor(textContent = '') { this.textContent = textContent; this.children = []; this.listeners = {}; }
    setAttribute() {}
    appendChild(element) { this.children.push(element); }
    remove() { document.body.children = document.body.children.filter(item => item !== this); }
    focus() { document.activeElement = this; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    click() { this.listeners.click?.(); }
    set innerHTML(value) { this.html = value; }
    querySelector(selector) {
      if (!this.controls) this.controls = new Map();
      if (!this.controls.has(selector)) this.controls.set(selector, new Button());
      return this.controls.get(selector);
    }
  }
  class Button extends Element { disabled = false; }
  const window = {
    fetch: fetchImpl,
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
  };
  runInNewContext(source, { window, document, Request, HTMLButtonElement: Button, URL, Error });
  return { window, document, timers, Button, dialog: () => document.body.children[0]?.children[0] };
}

test('la venta muestra carga y éxito sin repetir el envío', async () => {
  let resolveFetch;
  let requests = 0;
  const app = harness(() => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); });
  const pending = app.window.fetch('/api/ventas', { method: 'POST' });
  assert.match(app.dialog().html, /Registrando venta/);
  resolveFetch({ ok: true });
  await pending;
  assert.match(app.dialog().html, /Venta registrada/);
  assert.equal(requests, 1);
  app.timers.at(-1)();
  assert.equal(app.dialog(), undefined);
});

test('el error conserva el formulario y reintenta desde su botón', async () => {
  let requests = 0;
  const app = harness(async () => {
    requests++;
    return { ok: false, status: 422, clone: () => ({ json: async () => ({ message: 'Stock insuficiente' }) }) };
  });
  let retries = 0;
  const save = new app.Button('Guardar');
  save.addEventListener('click', () => { retries++; });
  app.document.formButtons = [new app.Button('Cancelar'), save];
  app.document.activeElement = save;
  await app.window.fetch('/api/ventas', { method: 'POST' });
  assert.match(app.dialog().html, /No se pudo completar la operación/);
  assert.equal(app.dialog().querySelector('[role="alert"]').textContent, 'Stock insuficiente');
  app.dialog().querySelector('.primary-button').click();
  assert.equal(retries, 1);
  assert.equal(requests, 1);
  assert.equal(app.dialog(), undefined);
});

test('otras solicitudes no muestran el emergente', async () => {
  const app = harness(async () => ({ ok: true }));
  await app.window.fetch('/api/ventas/productos', { method: 'GET' });
  assert.equal(app.dialog(), undefined);
});
