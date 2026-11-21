export const resolveEntityName = (name: string) => ({
  category: name.includes('_PU_AI_') ? 'npc' : 'ship',
  displayName: name,
});
export const getEntityName = (name: string) => name;
export const isNpcEntity = (name: string) => name.includes('_PU_AI_');
