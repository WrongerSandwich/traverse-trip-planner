// TODO: consider also extracting translateTools() once both adapters share a common output format

export function findTool(tools, name) {
  return tools?.find(t => (t.kind === 'anthropic-native' ? t.spec.name : t.name) === name);
}
