import test from 'node:test';
import assert from 'node:assert/strict';
import { isMcpConfirmation, mcpConfirmationAnswer } from '../src/runtime/elicitation.ts';

const request = {
  serverName: 'cua_repl', mode: 'form', message: 'Allow Computer Use to use "Chrome"?',
  requestedSchema: {type: 'object', properties: {}},
  _meta: {persist: ['session', 'always'], connector_id: 'computer-use'},
};
test('native app permission is an explicit one-request MCP confirmation', () => {
  assert.equal(isMcpConfirmation('mcpServer/elicitation/request', request), true);
  assert.deepEqual(mcpConfirmationAnswer(request, 'accept'), {action: 'accept', content: {}});
  assert.deepEqual(mcpConfirmationAnswer(request, 'decline'), {action: 'decline'});
  assert.throws(() => mcpConfirmationAnswer(request, 'always'), /Invalid approval/);
});
test('input forms and URLs cannot be approved as empty confirmations', () => {
  for (const invalid of [
    {...request, mode: 'url', url: 'https://example.com'},
    {...request, requestedSchema: {type: 'object', properties: {password: {type: 'string'}}}},
    {...request, requestedSchema: {type: 'object', required: ['answer']}},
    {...request, requestedSchema: null},
  ]) assert.throws(() => mcpConfirmationAnswer(invalid, 'accept'), /supported answer form/);
});
