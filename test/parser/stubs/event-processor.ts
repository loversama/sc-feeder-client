import { emitted } from './stubs';
export const processKillEvent = async (event: any, _silent: boolean, level = 0) => { emitted.push({ event, level }); };
export const addOrUpdateEvent = async () => ({ isNew: true });
export const correlateDeathWithDestruction = async () => {};
export const formatKillEventDescription = () => '';
export const determineDeathType = () => 'Unknown';
export const getKillEvents = () => [];
export const getGlobalKillEvents = () => [];
export const clearEvents = () => {};
