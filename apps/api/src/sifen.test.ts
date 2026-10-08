import test from 'node:test';
import assert from 'node:assert/strict';
import { cdcOf, responseState, safeNumber } from './sifen';

test('SIFEN solo marca aprobado ante respuesta de aprobación', async()=>{
  assert.equal((await responseState('<r><dCodRes>0260</dCodRes><dMsgRes>Documento aprobado</dMsgRes></r>')).state,'aprobado');
  assert.equal((await responseState('<r><dCodRes>0300</dCodRes><dMsgRes>Rechazado</dMsgRes></r>')).state,'rechazado');
  assert.equal((await responseState('<r><dCodRes>0100</dCodRes><dMsgRes>En proceso</dMsgRes></r>')).state,'pendiente');
  assert.equal((await responseState('sin respuesta XML')).state,'pendiente');
});
test('extrae CDC de 44 dígitos y rechaza importes inseguros',()=>{
  const cdc='01234567890123456789012345678901234567890123';
  assert.equal(cdcOf(`<rDE><DE Id="${cdc}"></DE></rDE>`),cdc);
  assert.equal(cdcOf('<DE Id="123"></DE>'),null);
  assert.equal(safeNumber('150000'),150000);
  assert.throws(()=>safeNumber('9007199254740993'));
});
