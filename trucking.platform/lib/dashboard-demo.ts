import type { Snapshot } from './dashboard';
// Isolated examples, never used as company records or saved to a browser/database.
export const demoSnapshot: Snapshot = {
  connected: true,
  drivers: [
    {id:'d1',name:'Marcus Johnson',status:'En servicio'}, {id:'d2',name:'Sarah Williams',status:'En servicio'},
    {id:'d3',name:'James Carter',status:'Disponible'}, {id:'d4',name:'Robert Davis',status:'Descanso'},
  ],
  loads: [
    {id:'TR-2084',route:'Dallas, TX → Phoenix, AZ',driverId:'d1',truck:'MK-104 · Volvo VNL',status:'En tránsito',eta:'2026-09-04T16:40:00-05:00',source:'Manual',approval:'Aprobada',approvedBy:'Administración (ejemplo)',approvedAt:'2026-09-03T10:00:00-05:00',amount:4200,broker:'Broker de ejemplo'},
    {id:'TR-2083',route:'Houston, TX → Atlanta, GA',driverId:'d2',truck:'MK-118 · Freightliner',status:'Cargando',eta:'2026-09-04T18:15:00-05:00',source:'Manual',approval:'Aprobada',approvedBy:'Administración (ejemplo)',approvedAt:'2026-09-03T10:00:00-05:00',amount:3800},
    {id:'TR-2082',route:'El Paso, TX → Denver, CO',driverId:'d3',truck:'MK-096 · Kenworth',status:'Programado',eta:'2026-09-05T07:30:00-05:00',source:'IA',approval:'Pendiente',amount:2900},
    {id:'TR-2081',route:'Austin, TX → San Antonio, TX',driverId:'d4',truck:'MK-121 · Peterbilt',status:'Entregada',eta:'2026-09-02T14:05:00-05:00',source:'Manual',approval:'Aprobada',approvedBy:'Administración (ejemplo)',approvedAt:'2026-09-01T10:00:00-05:00',amount:1600,missingPod:true},
    {id:'TR-2085',route:'Laredo, TX → Nashville, TN',truck:'Sin asignar',status:'Programado',eta:'2026-09-05T10:00:00-05:00',source:'IA',approval:'Pendiente'},
    {id:'TR-2080',route:'Dallas, TX → Houston, TX',truck:'MK-104',status:'Cancelada',eta:'2026-09-01T10:00:00-05:00',source:'Manual',approval:'Aprobada',approvedBy:'Administración (ejemplo)',approvedAt:'2026-08-31T10:00:00-05:00',replacedBy:'TR-2084'},
  ],
  ledger: [
    {id:'l1',loadId:'TR-2081',date:'2026-09-02',kind:'Ingreso',amount:1600},
    {id:'l2',loadId:'TR-2080',date:'2026-09-01',kind:'TONU',amount:250},
    {id:'l3',date:'2026-09-03',kind:'Fuel',amount:420},
    {id:'l4',date:'2026-09-03',kind:'Non-Fuel',amount:65},
    {id:'l5',date:'2026-09-03',kind:'Salarios',amount:550},
  ],
  payments:[{id:'INV-4821',loadId:'TR-2081',direction:'Cobrar',amount:1600,paid:400,due:'2026-09-05'}],
  alerts:[{id:'a1',title:'Servicio próximo',detail:'MK-104 · Cambio de aceite en 320 mi'}, {id:'a2',title:'Documento por vencer',detail:'Licencia · Robert Davis · 8 sep 2026'}],
  activity:[
    {id:'e1',at:'2026-09-04T15:45:00-05:00',actor:'IA (ejemplo)',detail:'Preparó TR-2085 para revisión; aún no es oficial.'},
    {id:'e2',at:'2026-09-03T10:00:00-05:00',actor:'Administración (ejemplo)',detail:'Aprobó TR-2084.'},
    {id:'e3',at:'2026-09-01T09:00:00-05:00',actor:'Despacho (ejemplo)',detail:'Canceló TR-2080 y la relacionó con TR-2084.'},
  ],
};
