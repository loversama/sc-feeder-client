/** Dev tool: fake Star Citizen telemetry server on 127.0.0.1:2942 (or argv[2]) streaming a looping flight. */
import * as grpc from '@grpc/grpc-js';
import { loadTelemetryRoot, TELEMETRY_PACKAGE, TELEMETRY_SERVICE } from '../../electron/modules/telemetry/telemetry-client';
const root = loadTelemetryRoot();
const T = (n: string) => root.lookupType(`${TELEMETRY_PACKAGE}.${n}`);
const req = T('TelemetryStreamRequest');
const res = T('TelemetryStreamResponse');
const port = Number(process.argv[2] ?? 2942);
let tick = 0;
function frame(): any {
  tick++;
  const phase = Math.floor(tick / 60) % 4; // ~3.5 s per phase at 17 fps
  const inShip = phase !== 0;
  const f: any = {
    actor: {
      vitals: { health: { current: 90 - (phase === 3 ? 70 : 0), max: 100 }, oxygen: { current: 80, max: 100 }, heart_rate: 70 + phase * 10 },
      state: { locomotion: inShip ? 'ACTOR_LOCOMOTION_STATE_SEATED' : 'ACTOR_LOCOMOTION_STATE_ON_FOOT', crew_role: inShip ? 'ACTOR_CREW_ROLE_PILOT' : undefined, seat_name: inShip ? 'Seat_Pilot' : '', uec_balance: 100000 + phase },
      environment: { breathable_atmosphere: !inShip },
    },
  };
  if (inShip) {
    f.vehicle = { state: { name: 'AEGS Gladius', class_name: 'AEGS_Gladius', manufacturer: 'Aegis Dynamics', type: 'VEHICLE_TYPE_SPACESHIP', health: phase === 3 ? 0.6 : 1,
      flight: { state: { is_landed: phase === 1, gear: phase === 1 ? 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_DEPLOYED' : 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_RETRACTED' }, instruments: { speed: phase === 1 ? 0 : 180 + (tick % 40), hydrogen_fuel: 0.8 } },
      shields: { level: phase === 3 ? 0 : 0.9 }, master_mode: { mode: phase === 2 ? 'VEHICLE_MASTER_MODE_SCM' : 'VEHICLE_MASTER_MODE_NAVIGATION' } } };
    f.weapons = { preset_name: 'All', countermeasures: [{ type: 'COUNTERMEASURE_TYPE_DECOY', amount: 10 - (phase === 3 ? 2 : 0) }] };
  }
  if (tick % 60 === 1) f.events = { events: [{ type: inShip ? 'GAME_EVENT_TYPE_ACTOR_ENTER_SEAT' : 'GAME_EVENT_TYPE_ACTOR_LEAVE_SEAT' }] };
  return f;
}
const server = new grpc.Server();
server.addService(
  { TelemetryStream: { path: `/${TELEMETRY_SERVICE}/TelemetryStream`, requestStream: false, responseStream: true,
      requestSerialize: (o: any) => Buffer.from(req.encode(req.fromObject(o)).finish()), requestDeserialize: (b: Buffer) => req.toObject(req.decode(b)),
      responseSerialize: (o: any) => Buffer.from(res.encode(res.fromObject(o)).finish()), responseDeserialize: (b: Buffer) => res.toObject(res.decode(b)) } } as any,
  { TelemetryStream: (call: grpc.ServerWritableStream<any, any>) => {
      console.log('client connected');
      const t = setInterval(() => call.write(frame()), 59);
      call.on('cancelled', () => { clearInterval(t); console.log('client disconnected'); });
    } },
);
server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err, p) => { if (err) throw err; console.log(`fake SC telemetry on 127.0.0.1:${p}`); });
