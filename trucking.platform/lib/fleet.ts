export type EntityKind = 'drivers' | 'trucks' | 'trailers';
export type Availability = 'Disponible' | 'En servicio' | 'Descanso';
export const AVAILABILITY_VALUES: Availability[] = ['Disponible','En servicio','Descanso'];
export const DRIVER_STATUS_VALUES: (Availability|'Inactivo')[] = [...AVAILABILITY_VALUES,'Inactivo'];
export type EquipmentStatus = 'Disponible' | 'En mantenimiento' | 'Fuera de servicio' | 'Inactivo';
export type Driver = { id:string; name:string; phone:string; email:string; group:string; active:boolean; availability:Availability; notes:string };
// Un chofer inactivo se muestra como 'Inactivo' sin importar su disponibilidad guardada.
// Antes esta regla se repetía en app/page.tsx y app/fleet-module.tsx por separado.
export const driverStatus = (driver:Driver):Availability|'Inactivo' => driver.active ? driver.availability : 'Inactivo';
export type Equipment = { id:string; unit:string; vin:string; plate:string; plateState:string; year:string; make:string; model:string; type:string; status:EquipmentStatus; notes:string };
export type Assignment = { id:string; driverId:string; truckId:string; trailerId:string; startedAt:string; endedAt?:string; reason:string; endReason?:string };
export type FleetDocument = { id:string; ownerKind:EntityKind; ownerId:string; type:string; issued:string; expires:string; reviewed:boolean; notes:string; filename:string; file:Blob; sizeBytes?:number; uploadedAt:string; reviewedAt?:string };
export type FleetEvent = { id:string; at:string; actor:string; entityIds:string[]; detail:string; before:unknown; after:unknown };
export type FleetState = { schema:1; revision:number; drivers:Driver[]; trucks:Equipment[]; trailers:Equipment[]; assignments:Assignment[]; documents:FleetDocument[]; events:FleetEvent[]; warningDays:number };
export const emptyFleet: FleetState = {schema:1,revision:0,drivers:[],trucks:[],trailers:[],assignments:[],documents:[],events:[],warningDays:30};
export type FleetAction =
  | {type:'driver'; record:Driver; reason:string}
  | {type:'equipment'; kind:'trucks'|'trailers'; record:Equipment; reason:string}
  | {type:'assign'; driverId:string; truckId:string; trailerId:string; reason:string}
  | {type:'end'; id:string; reason:string}
  | {type:'document'; record:Omit<FleetDocument,'id'|'uploadedAt'|'reviewedAt'>}
  | {type:'reviewDocument'; id:string; reviewed:boolean; reason:string}
  | {type:'warningDays'; days:number}
  | {type:'delete'; kind:EntityKind; id:string; reason:string}
  | {type:'deleteDocument'; id:string; reason:string};
const requireValue = (condition:unknown, message:string) => {if(!condition) throw new Error(message);};
const clean = (s:string) => s.trim().toLocaleLowerCase('en-US');
export function assignmentFor(state:FleetState, kind:EntityKind, id:string) {return state.assignments.find(a=>!a.endedAt && (kind==='drivers'?a.driverId===id:kind==='trucks'?a.truckId===id:a.trailerId===id));}
export function entityName(state:FleetState, kind:EntityKind, id:string) {return kind==='drivers'?state.drivers.find(d=>d.id===id)?.name:state[kind].find(e=>e.id===id)?.unit;}
export function applyFleetAction(original:FleetState, action:FleetAction, now:string, id:string):FleetState {
  const state = structuredClone(original);
  let before:unknown = null, after:unknown = null, detail='', entityIds:string[]=[];
  if(action.type==='driver') {
    const record={...action.record}; Object.keys(record).forEach(key=>{const k=key as keyof Driver;if(typeof record[k]==='string') (record as unknown as Record<string,unknown>)[k]=(record[k] as string).trim();});
    requireValue(record.id && record.name,'Escribe el nombre del chofer.');
    requireValue(AVAILABILITY_VALUES.includes(record.availability),'Disponibilidad inválida.');
    requireValue(!record.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email),'Revisa el correo electrónico.');
    requireValue(!state.drivers.some(d=>d.id!==record.id&&clean(d.name)===clean(record.name)),'Ya existe un chofer con ese nombre. Revisa su perfil antes de duplicarlo.');
    requireValue(!state.drivers.some(d=>d.id!==record.id&&record.email&&clean(d.email)===clean(record.email)),'Ese correo ya pertenece a otro chofer.');
    const old=state.drivers.find(d=>d.id===record.id); before=old||null;
    requireValue(!old||action.reason.trim(),'Escribe el motivo del cambio.');
    requireValue(!assignmentFor(state,'drivers',record.id)||record.active,'Finaliza la asignación antes de inactivar al chofer.');
    state.drivers=old?state.drivers.map(d=>d.id===record.id?record:d):[...state.drivers,record];
    entityIds=[record.id]; after=record; detail=`${old?'Actualizó':'Registró'} chofer ${record.name}${old?`: ${action.reason.trim()}`:''}`;
  } else if(action.type==='equipment') {
    const record={...action.record}; Object.keys(record).forEach(key=>{const k=key as keyof Equipment; record[k]=record[k].trim() as never;});
    record.vin=record.vin.toUpperCase(); record.unit=record.unit.toUpperCase(); record.plate=record.plate.toUpperCase();
    requireValue(record.id&&record.unit,'Escribe el número de unidad.');
    requireValue(['Disponible','En mantenimiento','Fuera de servicio','Inactivo'].includes(record.status),'Estado inválido.');
    requireValue(!record.vin||/^[A-HJ-NPR-Z0-9]{17}$/.test(record.vin),'El VIN debe tener 17 caracteres válidos (sin I, O ni Q).');
    requireValue(!record.year||/^\d{4}$/.test(record.year)&&Number(record.year)>=1900&&Number(record.year)<=new Date(now).getFullYear()+2,'Revisa el año de la unidad.');
    requireValue(!state[action.kind].some(e=>e.id!==record.id&&clean(e.unit)===clean(record.unit)),'Ya existe esa unidad.');
    requireValue(![...state.trucks,...state.trailers].some(e=>e.id!==record.id&&record.vin&&e.vin===record.vin),'Ese VIN ya está registrado.');
    requireValue(![...state.trucks,...state.trailers].some(e=>e.id!==record.id&&record.plate&&record.plateState&&e.plate===record.plate&&clean(e.plateState)===clean(record.plateState)),'Esa placa y estado ya están registrados.');
    const old=state[action.kind].find(e=>e.id===record.id); before=old||null;
    requireValue(!old||action.reason.trim(),'Escribe el motivo del cambio.');
    requireValue(!assignmentFor(state,action.kind,record.id)||record.status==='Disponible','Finaliza la asignación antes de retirar el equipo de servicio.');
    state[action.kind]=old?state[action.kind].map(e=>e.id===record.id?record:e):[...state[action.kind],record];
    entityIds=[record.id]; after=record; detail=`${old?'Actualizó':'Registró'} ${action.kind==='trucks'?'camión':'trailer'} ${record.unit}${old?`: ${action.reason.trim()}`:''}`;
  } else if(action.type==='assign') {
    const driver=state.drivers.find(d=>d.id===action.driverId), truck=state.trucks.find(e=>e.id===action.truckId), trailer=state.trailers.find(e=>e.id===action.trailerId);
    requireValue(driver?.active,'Selecciona un chofer activo.'); requireValue(driver?.availability!=='Descanso','El chofer está en descanso. Actualiza su disponibilidad antes de asignarlo.');
    requireValue(truck?.status==='Disponible','Selecciona un camión disponible.');
    requireValue(!action.trailerId||trailer?.status==='Disponible','El trailer no está disponible.');
    const old=assignmentFor(state,'drivers',action.driverId);
    requireValue(!old||old.truckId!==action.truckId||old.trailerId!==action.trailerId,'Esa asignación ya está activa.');
    requireValue(!state.assignments.some(a=>!a.endedAt&&a.driverId!==action.driverId&&(a.truckId===action.truckId||action.trailerId&&a.trailerId===action.trailerId)),'El camión o trailer ya está asignado a otro chofer.');
    requireValue(action.reason.trim(),'Escribe el motivo de la asignación.');
    if(old) {before={...old}; old.endedAt=now; old.endReason=action.reason.trim();}
    const assignment:Assignment={id,driverId:action.driverId,truckId:action.truckId,trailerId:action.trailerId,startedAt:now,reason:action.reason.trim()};
    state.assignments.push(assignment); after=assignment; entityIds=[action.driverId,action.truckId,action.trailerId,old?.truckId||'',old?.trailerId||''].filter(Boolean);
    detail=`${old?'Cambió':'Creó'} asignación de ${driver!.name} a ${truck!.unit}${trailer?` / ${trailer.unit}`:''}: ${action.reason.trim()}`;
  } else if(action.type==='end') {
    const assignment=state.assignments.find(a=>a.id===action.id); requireValue(assignment&&!assignment.endedAt,'Esta asignación ya no está activa.'); requireValue(action.reason.trim(),'Escribe el motivo de finalización.');
    before={...assignment!}; assignment!.endedAt=now; assignment!.endReason=action.reason.trim(); after={...assignment!}; entityIds=[assignment!.driverId,assignment!.truckId,assignment!.trailerId].filter(Boolean); detail=`Finalizó asignación: ${action.reason.trim()}`;
  } else if(action.type==='document') {
    const d=action.record;
    requireValue(entityName(state,d.ownerKind,d.ownerId),'El perfil no existe.'); requireValue(d.type.trim(),'Indica el tipo de documento.');
    requireValue(d.file instanceof Blob&&d.file.size>0&&d.file.size<=5*1024*1024,'Selecciona un archivo de hasta 5 MB.');
    requireValue(['application/pdf','image/jpeg','image/png','image/webp'].includes(d.file.type),'Usa PDF, JPG, PNG o WebP.');
    requireValue(!d.expires||!d.issued||d.expires>=d.issued,'El vencimiento no puede ser anterior a la emisión.');
    const document={...d,id,reviewed:false,uploadedAt:now}; state.documents.push(document); entityIds=[d.ownerId]; after={type:d.type,filename:d.filename,issued:d.issued,expires:d.expires}; detail=`Recibió documento ${d.type} de ${entityName(state,d.ownerKind,d.ownerId)}; pendiente de revisión`;
  } else if(action.type==='reviewDocument') {
    const d=state.documents.find(d=>d.id===action.id); requireValue(d,'No se encontró el documento.'); requireValue(action.reason.trim(),'Escribe una nota de revisión.'); before={reviewed:d!.reviewed,reviewedAt:d!.reviewedAt}; d!.reviewed=action.reviewed; d!.reviewedAt=action.reviewed?now:undefined; after={reviewed:d!.reviewed,reviewedAt:d!.reviewedAt}; entityIds=[d!.ownerId]; detail=`${action.reviewed?'Revisó':'Devolvió a revisión'} ${d!.type}: ${action.reason.trim()}`;
  } else if(action.type==='delete') {
    const record=action.kind==='drivers'?state.drivers.find(d=>d.id===action.id):state[action.kind].find(e=>e.id===action.id);
    requireValue(record,'No se encontró el registro.');
    requireValue(action.reason.trim(),'Escribe el motivo de la eliminación.');
    requireValue(!assignmentFor(state,action.kind,action.id),'Finaliza la asignación antes de eliminar este registro.');
    before=record; after=null;
    if(action.kind==='drivers') state.drivers=state.drivers.filter(d=>d.id!==action.id);
    else if(action.kind==='trucks') state.trucks=state.trucks.filter(e=>e.id!==action.id);
    else state.trailers=state.trailers.filter(e=>e.id!==action.id);
    state.documents=state.documents.filter(d=>!(d.ownerKind===action.kind&&d.ownerId===action.id));
    entityIds=[action.id];
    detail=`Eliminó ${action.kind==='drivers'?'chofer':action.kind==='trucks'?'camión':'trailer'} ${action.kind==='drivers'?(record as Driver).name:(record as Equipment).unit}: ${action.reason.trim()}`;
  } else if(action.type==='deleteDocument') {
    const d=state.documents.find(d=>d.id===action.id);
    requireValue(d,'No se encontró el documento.');
    requireValue(action.reason.trim(),'Escribe el motivo de la eliminación.');
    before=d; after=null;
    state.documents=state.documents.filter(x=>x.id!==action.id);
    entityIds=[d!.ownerId];
    detail=`Eliminó documento ${d!.type} de ${entityName(state,d!.ownerKind,d!.ownerId)}: ${action.reason.trim()}`;
  } else {requireValue(Number.isInteger(action.days)&&action.days>=0&&action.days<=365,'El aviso debe estar entre 0 y 365 días.'); before=state.warningDays; state.warningDays=action.days; after=action.days; detail=`Cambió aviso de vencimientos a ${action.days} días`;}
  state.revision++; state.events.unshift({id:`event-${id}`,at:now,actor:'Usuario local · sin cuenta autenticada',entityIds,detail,before,after}); return state;
}
export function documentStatus(d:FleetDocument,today:string) {return d.expires&&d.expires<today?'Vencido':d.reviewed?'Revisado':'Pendiente de revisión';}
export function fleetAlerts(state:FleetState,today:string) {
  const limit=new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate()+state.warningDays); const until=limit.toISOString().slice(0,10);
  const alerts:{id:string;title:string;detail:string}[]=[];
  state.documents.forEach(d=>{const name=entityName(state,d.ownerKind,d.ownerId)||'Perfil'; if(d.expires&&d.expires<=until) alerts.push({id:`expiry-${d.id}`,title:d.expires<today?'Documento vencido':'Documento próximo a vencer',detail:`${name} · ${d.type} · ${d.expires}`}); if(!d.reviewed) alerts.push({id:`review-${d.id}`,title:'Documento por revisar',detail:`${name} · ${d.type}`});});
  (['drivers','trucks','trailers'] as EntityKind[]).forEach(kind=>state[kind].forEach(record=>{
    const active=kind==='drivers'?(record as Driver).active:(record as Equipment).status!=='Inactivo'; if(!active)return;
    const required=kind==='drivers'?['Licencia']:kind==='trucks'?['Registro','Seguro']:['Registro'];
    required.forEach(type=>{if(!state.documents.some(d=>d.ownerId===record.id&&d.ownerKind===kind&&d.type===type)) alerts.push({id:`missing-${record.id}-${type}`,title:'Documento faltante',detail:`${entityName(state,kind,record.id)} · ${type}`});});
    if(kind!=='drivers'&&['En mantenimiento','Fuera de servicio'].includes((record as Equipment).status)) alerts.push({id:`service-${record.id}`,title:(record as Equipment).status,detail:entityName(state,kind,record.id)||''});
  })); return alerts;
}
