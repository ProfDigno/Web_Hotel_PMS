import test from 'node:test';
import assert from 'node:assert/strict';
import { isCheckoutOverdue, roomVisualState } from '../src/RoomAppearance';

const occupied = { en_casa: true, fecha_salida: '2026-10-04', hora_checkout: '12:00', estado_limpieza: 'limpia' };

test('el check-out vence al llegar a la hora de Paraguay', () => {
  assert.equal(isCheckoutOverdue(occupied, new Date('2026-10-04T14:59:00Z')), false);
  assert.equal(isCheckoutOverdue(occupied, new Date('2026-10-04T15:00:00Z')), true);
  assert.equal(isCheckoutOverdue(occupied, new Date('2026-10-04T15:01:00Z')), true);
});

test('fecha pasada, fecha futura y huésped que ya salió', () => {
  assert.equal(roomVisualState(occupied, new Date('2026-10-05T12:00:00Z')), 'overdue');
  assert.equal(roomVisualState({ ...occupied, fecha_salida: '2026-10-05' }, new Date('2026-10-04T15:00:00Z')), 'occupied');
  assert.equal(roomVisualState({ ...occupied, en_casa: false }, new Date('2026-10-05T15:00:00Z')), 'available');
});

test('sin horario se conserva el color y una habitación fuera de servicio mantiene prioridad', () => {
  assert.equal(roomVisualState({ ...occupied, hora_checkout: null }, new Date('2026-10-05T15:00:00Z')), 'occupied');
  assert.equal(roomVisualState({ ...occupied, fuera_servicio: true }, new Date('2026-10-05T15:00:00Z')), 'out-of-service');
});
