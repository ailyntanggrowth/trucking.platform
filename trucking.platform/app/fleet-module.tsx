"use client";
import {useState,type FormEvent} from 'react';
import {assignmentFor,documentStatus,entityName,fleetAlerts,type EntityKind,type Driver,type Equipment,type FleetAction,type FleetDocument} from '../lib/fleet';
import type {FleetController} from '../lib/use-fleet';
import {getFleetDocumentUrl} from '../lib/fleet-actions';
import type {Load} from '../lib/dashboard';
import styles from './fleet.module.css';

const titles={drivers:'Choferes',trucks:'Camiones',trailers:'Trailers',assignments:'Asignaciones'};
type Tab=keyof typeof titles;
type Editor={type:'entity'|'assignment'|'document'|'end'|'review'|'deleteEntity'|'deleteDocument';kind:EntityKind;id:string;revision:number};
const dateTime=(s:string)=>new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const today=()=>new Date().toLocaleDateString('en-CA');
async function download(document:FleetDocument){const url=await getFleetDocumentUrl(document.id);const a=window.document.createElement('a');a.href=url;a.download=document.filename;a.click();}
function exportBackup(state:FleetController['state']){
  const payload={schema:state.schema,revision:state.revision,warningDays:state.warningDays,drivers:state.drivers,trucks:state.trucks,trailers:state.trailers,assignments:state.assignments,documents:state.documents.map(({file,...meta})=>meta),events:state.events};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=window.document.createElement('a');
  a.href=url;a.download=`fleet-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  state.documents.forEach((d,i)=>setTimeout(async()=>{
    const fileUrl=await getFleetDocumentUrl(d.id);const a2=window.document.createElement('a');
    a2.href=fileUrl;a2.download=`${d.id}__${d.filename}`;a2.click();
  },i*300));
}
export default function FleetModule({fleet,loads,onOpenLoads}:{fleet:FleetController;loads:Load[];onOpenLoads:()=>void}) {
  const {state,ready}=fleet;
  const [tab,setTab]=useState<Tab>('drivers'),[query,setQuery]=useState(''),[filter,setFilter]=useState('Todos');
  const [selected,setSelected]=useState<{kind:EntityKind;id:string}|null>(null),[editor,setEditor]=useState<Editor|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [chosenDriver,setChosenDriver]=useState('');
  const alerts=fleetAlerts(state,today());
  const activeAssignments=state.assignments.filter(a=>!a.endedAt);
  const record=selected?(selected.kind==='drivers'?state.drivers.find(d=>d.id===selected.id):state[selected.kind].find(e=>e.id===selected.id)):undefined;
  const editRecord=editor?.type==='entity'?(editor.kind==='drivers'?state.drivers.find(d=>d.id===editor.id):state[editor.kind].find(e=>e.id===editor.id)):undefined;
  const existingDriver=editRecord as Driver|undefined, existingEquipment=editRecord as Equipment|undefined;
  function open(type:Editor['type'],kind:EntityKind='drivers',id=''){setError('');setNotice('');setEditor({type,kind,id,revision:state.revision});if(type==='assignment')setChosenDriver(kind==='drivers'?id:'');requestAnimationFrame(()=>document.getElementById('fleet-editor')?.scrollIntoView({block:'start',behavior:'instant'}));}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!editor||busy)return;const fields=new FormData(event.currentTarget);const text=(key:string)=>String(fields.get(key)||'').trim();let action:FleetAction;
    setError('');setBusy(true);
    try {
      if(editor.type==='entity'&&editor.kind==='drivers')action={type:'driver',reason:text('reason'),record:{id:editor.id||crypto.randomUUID(),name:text('name'),phone:text('phone'),email:text('email'),group:text('group'),active:text('active')==='true',availability:text('availability') as Driver['availability'],notes:text('notes')}};
      else if(editor.type==='entity')action={type:'equipment',kind:editor.kind as 'trucks'|'trailers',reason:text('reason'),record:{id:editor.id||crypto.randomUUID(),unit:text('unit'),vin:text('vin'),plate:text('plate'),plateState:text('plateState'),year:text('year'),make:text('make'),model:text('model'),type:text('equipmentType'),status:text('status') as Equipment['status'],notes:text('notes')}};
      else if(editor.type==='assignment') action={type:'assign',driverId:text('driverId'),truckId:text('truckId'),trailerId:text('trailerId'),reason:text('reason')};
      else if(editor.type==='end')action={type:'end',id:editor.id,reason:text('reason')};
      else if(editor.type==='review')action={type:'reviewDocument',id:editor.id,reviewed:text('reviewed')==='true',reason:text('reason')};
      else if(editor.type==='deleteEntity')action={type:'delete',kind:editor.kind,id:editor.id,reason:text('reason')};
      else if(editor.type==='deleteDocument')action={type:'deleteDocument',id:editor.id,reason:text('reason')};
      else {const file=fields.get('file') as File;action={type:'document',record:{ownerKind:editor.kind,ownerId:editor.id,type:text('documentType'),issued:text('issued'),expires:text('expires'),reviewed:false,notes:text('notes'),filename:file.name,file}};}
      const next=await fleet.commit(action,editor.revision);
      if(action.type==='driver')setSelected({kind:'drivers',id:action.record.id});
      if(action.type==='equipment')setSelected({kind:action.kind,id:action.record.id});
      if(action.type==='delete')setSelected(null);
      setEditor(null);setNotice(next.events[0].detail);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const changeTab=(next:Tab)=>{setTab(next);setSelected(null);setEditor(null);setQuery('');setFilter('Todos');setError('');setNotice('');};
  const statusOf=(kind:EntityKind,id:string)=>{if(kind==='drivers'){const d=state.drivers.find(d=>d.id===id)!;return d.active?d.availability:'Inactivo';}const e=state[kind].find(e=>e.id===id)!;return assignmentFor(state,kind,id)?'Asignado':e.status;};
  const records=tab==='assignments'?[]:state[tab].filter(r=>{const search=tab==='drivers'?`${(r as Driver).name} ${(r as Driver).phone} ${(r as Driver).email} ${(r as Driver).group}`:`${(r as Equipment).unit} ${(r as Equipment).vin} ${(r as Equipment).plate} ${(r as Equipment).make}`;return search.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(filter==='Todos'||statusOf(tab,r.id)===filter);});
  const selectedAssignment=selected?assignmentFor(state,selected.kind,selected.id):undefined;
  const relevantAssignments=selected?state.assignments.filter(a=>selected.kind==='drivers'?a.driverId===selected.id:selected.kind==='trucks'?a.truckId===selected.id:a.trailerId===selected.id):[];
  const currentForForm=state.assignments.find(a=>!a.endedAt&&a.driverId===chosenDriver);
  const editorTitle=editor?.type==='entity'?`${editor.id?'Editar':'Agregar'} ${editor.kind==='drivers'?'chofer':editor.kind==='trucks'?'camión':'trailer'}`:editor?.type==='assignment'?'Asignar o cambiar equipo':editor?.type==='document'?'Agregar documento':editor?.type==='review'?'Revisar documento':editor?.type==='deleteEntity'?`Eliminar ${editor.kind==='drivers'?'chofer':editor.kind==='trucks'?'camión':'trailer'}`:editor?.type==='deleteDocument'?'Eliminar documento':'Finalizar asignación';
  return <div className={styles.fleet}>
    <div className={styles.localNotice}><strong>M&A KING</strong><p>Los datos y archivos se guardan en Supabase y se sincronizan entre dispositivos. Usuarios y permisos compartidos están pendientes.</p><button disabled={!ready} onClick={()=>exportBackup(state)}>Exportar respaldo (JSON + archivos)</button></div>
    {fleet.error&&<div role="alert" className={styles.error}>{fleet.error} <button onClick={()=>void fleet.refresh()}>Reintentar</button></div>}
    {!ready&&!fleet.error&&<p role="status">Abriendo los registros de flota…</p>}
    <div className={styles.metrics}>
      <div><span>Choferes activos</span><strong>{ready?state.drivers.filter(d=>d.active).length:'—'}</strong></div>
      <div><span>Choferes disponibles</span><strong>{ready?state.drivers.filter(d=>d.active&&d.availability==='Disponible'&&!assignmentFor(state,'drivers',d.id)).length:'—'}</strong></div>
      <div><span>Camiones disponibles</span><strong>{ready?state.trucks.filter(e=>e.status==='Disponible'&&!assignmentFor(state,'trucks',e.id)).length:'—'}</strong></div>
      <div><span>Equipo no operativo</span><strong>{ready?[...state.trucks,...state.trailers].filter(e=>['En mantenimiento','Fuera de servicio'].includes(e.status)).length:'—'}</strong></div>
    </div>
    <nav className={styles.tabs} aria-label="Secciones de flota">{(Object.keys(titles) as Tab[]).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>changeTab(t)}>{titles[t]} <span>{t==='assignments'?activeAssignments.length:state[t].length}</span></button>)}</nav>
    {notice&&<p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.toolbar}><h2>{titles[tab]}</h2><button className={styles.primary} disabled={!ready||busy} onClick={()=>open(tab==='assignments'?'assignment':'entity',tab==='assignments'?'drivers':tab)}>{tab==='assignments'?'+ Nueva asignación':`+ Agregar ${tab==='drivers'?'chofer':tab==='trucks'?'camión':'trailer'}`}</button></div>
    {editor&&<form id="fleet-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.kind}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {editor.type==='entity'&&<div className={styles.fields}>
        {editor.kind==='drivers'?<>
          <label>Nombre completo *<input name="name" required maxLength={150} defaultValue={existingDriver?.name}/></label>
          <label>Teléfono<input name="phone" type="tel" maxLength={40} defaultValue={existingDriver?.phone}/></label>
          <label>Correo electrónico<input name="email" type="email" maxLength={150} defaultValue={existingDriver?.email}/></label>
          <label>Grupo / compañía operativa<input name="group" maxLength={100} defaultValue={existingDriver?.group||'M&A KING'}/></label>
          <label>Estado del perfil<select name="active" defaultValue={existingDriver?.active===false?'false':'true'}><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
          <label>Disponibilidad<select name="availability" defaultValue={existingDriver?.availability||'Disponible'}>{['Disponible','En servicio','Descanso'].map(s=><option key={s}>{s}</option>)}</select></label>
        </>:<>
          <label>Número de unidad *<input name="unit" required maxLength={50} defaultValue={existingEquipment?.unit}/></label>
          <label>VIN<input name="vin" minLength={17} maxLength={17} defaultValue={existingEquipment?.vin}/></label>
          <label>Placa<input name="plate" maxLength={30} defaultValue={existingEquipment?.plate}/></label>
          <label>Estado de registro<input name="plateState" maxLength={50} defaultValue={existingEquipment?.plateState}/></label>
          <label>Año<input name="year" type="number" min="1900" max={new Date().getFullYear()+2} defaultValue={existingEquipment?.year}/></label>
          <label>Marca<input name="make" maxLength={80} defaultValue={existingEquipment?.make}/></label>
          <label>Modelo<input name="model" maxLength={80} defaultValue={existingEquipment?.model}/></label>
          <label>Tipo {editor.kind==='trailers'?'de trailer':'de camión'}<input name="equipmentType" maxLength={80} defaultValue={existingEquipment?.type}/></label>
          <label>Estado operativo<select name="status" defaultValue={existingEquipment?.status||'Disponible'}>{['Disponible','En mantenimiento','Fuera de servicio','Inactivo'].map(s=><option key={s}>{s}</option>)}</select></label>
        </>}
        <label className={styles.wide}>Notas<textarea name="notes" rows={3} maxLength={3000} defaultValue={editRecord?.notes}/></label>
        {editor.id&&<label className={styles.wide}>Motivo del cambio *<input name="reason" required maxLength={500}/></label>}
      </div>}
      {editor.type==='assignment'&&<><p>Un cambio cierra la asignación anterior y conserva su historial. No modifica cargas anteriores ni aprueba nuevas cargas.</p><div className={styles.fields}>
        <label>Chofer *<select name="driverId" required value={chosenDriver} onChange={e=>setChosenDriver(e.target.value)}><option value="">Selecciona un chofer</option>{state.drivers.filter(d=>d.active).map(d=><option key={d.id} value={d.id} disabled={d.availability==='Descanso'}>{d.name}{d.availability==='Descanso'?' · En descanso':''}</option>)}</select></label>
        <label>Camión *<select key={`truck-${chosenDriver}`} name="truckId" required defaultValue={currentForForm?.truckId||''}><option value="">Selecciona un camión</option>{state.trucks.map(e=>{const a=assignmentFor(state,'trucks',e.id);const blocked=e.status!=='Disponible'||Boolean(a&&a.driverId!==chosenDriver);return <option key={e.id} value={e.id} disabled={blocked}>{e.unit}{blocked?' · No disponible':''}</option>;})}</select></label>
        <label>Trailer<select key={`trailer-${chosenDriver}`} name="trailerId" defaultValue={currentForForm?.trailerId||''}><option value="">Sin trailer</option>{state.trailers.map(e=>{const a=assignmentFor(state,'trailers',e.id);const blocked=e.status!=='Disponible'||Boolean(a&&a.driverId!==chosenDriver);return <option key={e.id} value={e.id} disabled={blocked}>{e.unit}{blocked?' · No disponible':''}</option>;})}</select></label>
        <label className={styles.wide}>Motivo de la asignación o cambio *<input name="reason" required maxLength={500}/></label>
      </div></>}
      {editor.type==='end'&&<><p>El equipo quedará libre. La asignación anterior seguirá en el historial.</p><label>Motivo de finalización *<input name="reason" required maxLength={500}/></label></>}
      {editor.type==='document'&&<><p>Perfil: {entityName(state,editor.kind,editor.id)}. El archivo se registra como recibido, pendiente de revisión.</p><div className={styles.fields}>
        <label>Tipo *<select name="documentType">{['Licencia','Registro','Seguro','Inspección','Otro'].map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Archivo *<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required/><small>PDF o imagen · Hasta 5 MB</small></label>
        <label>Fecha de emisión<input name="issued" type="date"/></label><label>Vencimiento<input name="expires" type="date"/></label>
        <label className={styles.wide}>Notas<textarea name="notes" maxLength={3000}/></label>
      </div></>}
      {editor.type==='review'&&<><p>Descarga y comprueba el documento antes de marcarlo como revisado.</p><label>Resultado<select name="reviewed"><option value="true">Revisado por mí</option><option value="false">Pendiente de revisión</option></select></label><label>Nota de revisión *<textarea name="reason" required maxLength={500}/></label></>}
      {editor.type==='deleteEntity'&&<><p>Esta acción elimina el registro por completo, no solo lo desactiva. También se borran sus documentos y su historial de asignaciones. El evento de auditoría queda guardado igual.</p><label>Motivo de la eliminación *<input name="reason" required maxLength={500}/></label></>}
      {editor.type==='deleteDocument'&&<><p>Esta acción elimina el documento y su archivo por completo. El evento de auditoría queda guardado igual.</p><label>Motivo de la eliminación *<input name="reason" required maxLength={500}/></label></>}
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy?'Guardando…':'Guardar'}</button><button type="button" disabled={busy} onClick={()=>{setEditor(null);setError('');}}>Cancelar</button></div>
    </form>}
    {tab!=='assignments'?<>
      <div className={styles.filters}><label>Buscar {titles[tab].toLowerCase()}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='drivers'?'Nombre, teléfono o correo':'Unidad, VIN o placa'}/></label><label>Filtrar estado<select value={filter} onChange={e=>setFilter(e.target.value)}>{(tab==='drivers'?['Todos','Disponible','En servicio','Descanso','Inactivo']:['Todos','Disponible','Asignado','En mantenimiento','Fuera de servicio','Inactivo']).map(s=><option key={s}>{s}</option>)}</select></label></div>
      <div className={styles.cards}>{records.map(r=><button className={`${styles.card} ${selected?.id===r.id?styles.selected:''}`} key={r.id} onClick={()=>{setSelected({kind:tab,id:r.id});setEditor(null);}}><span className={styles.badge}>{statusOf(tab,r.id)}</span><strong>{tab==='drivers'?(r as Driver).name:(r as Equipment).unit}</strong><span>{tab==='drivers'?(r as Driver).phone||'Teléfono pendiente':`${(r as Equipment).make} ${(r as Equipment).model}`.trim()||'Marca y modelo pendientes'}</span><span>{assignmentFor(state,tab,r.id)?'Con equipo asignado':'Sin asignación activa'}</span><b>Ver ficha →</b></button>)}</div>
      {ready&&!records.length&&<p className={styles.empty}>{query||filter!=='Todos'?'No hay resultados con estos filtros.':`Todavía no hay ${titles[tab].toLowerCase()}. Usa el botón Agregar para comenzar.`}</p>}
    </>:<><p>Asignaciones activas: {activeAssignments.length}. Las finalizadas se conservan abajo.</p><div className={styles.cards}>{[...state.assignments].reverse().map(a=><article className={styles.card} key={a.id}><span className={styles.badge}>{a.endedAt?'Finalizada':'Activa'}</span><strong>{entityName(state,'drivers',a.driverId)}</strong><p>Camión {entityName(state,'trucks',a.truckId)} · Trailer {a.trailerId?entityName(state,'trailers',a.trailerId):'Sin trailer'}</p><small>Inicio: {dateTime(a.startedAt)}</small>{a.endedAt&&<small>Fin: {dateTime(a.endedAt)}</small>}<p>{a.reason}{a.endReason&&` · Finalización: ${a.endReason}`}</p>{!a.endedAt&&<div className={styles.actions}><button onClick={()=>open('assignment','drivers',a.driverId)}>Cambiar equipo</button><button onClick={()=>open('end','drivers',a.id)}>Finalizar</button></div>}</article>)}</div>{!state.assignments.length&&<p className={styles.empty}>Agrega un chofer y un camión para crear tu primera asignación.</p>}</>}
    {selected&&record&&tab!=='assignments'&&<section className={styles.profile}>
      <div className={styles.toolbar}><h2>Ficha: {entityName(state,selected.kind,selected.id)}</h2><button onClick={()=>open('entity',selected.kind,selected.id)}>Editar ficha</button><button onClick={()=>{if(window.confirm('¿Eliminar este registro por completo? No se puede deshacer.'))open('deleteEntity',selected.kind,selected.id);}}>Eliminar {selected.kind==='drivers'?'chofer':selected.kind==='trucks'?'camión':'trailer'}</button></div>
      <dl className={styles.fields}>
        {(selected.kind==='drivers'?[['Nombre',(record as Driver).name],['Teléfono',(record as Driver).phone],['Correo',(record as Driver).email],['Grupo',(record as Driver).group],['Estado',(record as Driver).active?'Activo':'Inactivo'],['Disponibilidad',(record as Driver).availability]]:[['Unidad',(record as Equipment).unit],['VIN',(record as Equipment).vin],['Placa',(record as Equipment).plate],['Estado de registro',(record as Equipment).plateState],['Año',(record as Equipment).year],['Marca',(record as Equipment).make],['Modelo',(record as Equipment).model],['Tipo',(record as Equipment).type],['Estado',statusOf(selected.kind,record.id)]]).map(([label,v])=><div key={label}><dt>{label}</dt><dd>{v||'Pendiente de completar'}</dd></div>)}
      </dl><p><b>Notas:</b> {record.notes||'Sin notas'}</p>
      <h3>Equipo y asignación actual</h3>{selectedAssignment?<p>{entityName(state,'drivers',selectedAssignment.driverId)} · {entityName(state,'trucks',selectedAssignment.truckId)} · {selectedAssignment.trailerId?entityName(state,'trailers',selectedAssignment.trailerId):'Sin trailer'}</p>:<p>Sin asignación activa.</p>}
      <div className={styles.actions}>{selected.kind==='drivers'&&<button onClick={()=>open('assignment','drivers',selected.id)}>Asignar / cambiar equipo</button>}{selectedAssignment&&<button onClick={()=>open('end','drivers',selectedAssignment.id)}>Finalizar asignación</button>}</div>
      <h3>Documentos</h3><button onClick={()=>open('document',selected.kind,selected.id)}>+ Agregar documento</button>
      {state.documents.filter(d=>d.ownerKind===selected.kind&&d.ownerId===selected.id).map(d=><div key={d.id} className={styles.document}><div><strong>{d.type} · {documentStatus(d,today())}</strong><p>{d.filename} · {Math.ceil((d.sizeBytes??0)/1024)} KB</p><small>Recibido: {dateTime(d.uploadedAt)}{d.issued&&` · Emisión: ${d.issued}`}{d.expires?` · Vence: ${d.expires}`:' · Sin vencimiento indicado'}</small>{d.reviewedAt&&<small>Revisado: {dateTime(d.reviewedAt)}</small>}<p>{d.notes}</p></div><div className={styles.actions}><button onClick={()=>void download(d)}>Descargar</button><button onClick={()=>open('review',selected.kind,d.id)}>Revisar</button><button onClick={()=>{if(window.confirm('¿Eliminar este documento por completo? No se puede deshacer.'))open('deleteDocument',selected.kind,d.id);}}>Eliminar</button></div></div>)}
      {!state.documents.some(d=>d.ownerId===selected.id)&&<p className={styles.empty}>No se han recibido documentos para este perfil.</p>}
      <h3>Historial de asignaciones</h3>{relevantAssignments.length?<ul>{[...relevantAssignments].reverse().map(a=><li key={a.id}>{dateTime(a.startedAt)} — {entityName(state,'drivers',a.driverId)} / {entityName(state,'trucks',a.truckId)} / {a.trailerId?entityName(state,'trailers',a.trailerId):'Sin trailer'} · {a.endedAt?`Finalizada ${dateTime(a.endedAt)}`:'Activa'} · {a.reason}{a.endReason&&` · ${a.endReason}`}</li>)}</ul>:<p>Sin asignaciones anteriores.</p>}
      {selected.kind==='drivers'&&<><h3>Cargas y actividad relacionada</h3>{loads.filter(l=>l.driverId===selected.id).map(l=><p key={l.id}>{l.id} · {l.route} · {l.approval==='Aprobada'?l.status:'Pendiente de aprobación'}</p>)}<p>La gestión de cargas, combustible, pagos y liquidaciones está pendiente de conexión. No se copian cifras de ejemplo a este perfil.</p><button onClick={onOpenLoads}>Abrir Cargas y Operaciones →</button></>}
      <h3>Historial de cambios</h3>{state.events.filter(e=>e.entityIds.includes(selected.id)).map(e=><details key={e.id} className={styles.history}><summary>{e.detail}<small>{dateTime(e.at)} · {e.actor}</small></summary><div className={styles.fields}><div><b>Anterior</b><pre>{JSON.stringify(e.before,null,2)}</pre></div><div><b>Nuevo</b><pre>{JSON.stringify(e.after,null,2)}</pre></div></div></details>)}
    </section>}
    <section className={styles.profile}><div className={styles.toolbar}><h2>Alertas de flota <span className={styles.badge}>{alerts.length}</span></h2></div><form className={styles.actions} onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;setBusy(true);try{await fleet.commit({type:'warningDays',days:Number(new FormData(form).get('days'))});setNotice('Plazo de aviso guardado.');setError('');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><label>Avisar con días de anticipación<input name="days" type="number" min="0" max="365" required defaultValue={state.warningDays} key={state.warningDays}/></label><button disabled={!ready||busy}>Guardar plazo</button></form>{!editor&&error&&<p role="alert" className={styles.error}>{error}</p>}<p>Documentos esperados: licencia para choferes, registro y seguro para camiones, registro para trailers.</p>{alerts.length?<ul className={styles.alerts}>{alerts.map(a=><li key={a.id}><strong>{a.title}</strong><span>{a.detail}</span></li>)}</ul>:<p className={styles.empty}>No hay alertas de flota.</p>}</section>
  </div>;
}
