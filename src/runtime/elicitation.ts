/** Only confirmations without input fields can use the Allow/Decline buttons. */
export function isMcpConfirmation(method: string, params: Record<string, any>): boolean {
  if (method !== 'mcpServer/elicitation/request' || !['form', 'openai/form', 'openaiForm'].includes(params.mode)) return false;
  const schema = params.requestedSchema;
  return typeof params.message === 'string' && !!schema && schema.type === 'object' &&
    (!schema.properties || Object.keys(schema.properties).length === 0) &&
    (!schema.required || (Array.isArray(schema.required) && schema.required.length === 0));
}

export function mcpConfirmationAnswer(params: Record<string, any>, decision: unknown) {
  if (!isMcpConfirmation('mcpServer/elicitation/request', params))
    throw new Error('This input request needs a supported answer form.');
  if (decision !== 'accept' && decision !== 'decline') throw new Error('Invalid approval decision');
  // Approve only this request. Never persist an app-access grant implicitly.
  return decision === 'accept' ? {action: 'accept', content: {}} : {action: 'decline'};
}
