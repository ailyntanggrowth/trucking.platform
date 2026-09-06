"use client";
import {useState,type FormEvent} from 'react';
import {assignmentFor,documentStatus,entityName,fleetAlerts,type EntityKind,type Driver,type Equipment,type FleetAction,type FleetDocument} from '../lib/fleet';
import type {FleetController} from '../lib/use-fleet';
import {getFleetDocumentUrl} from '../lib/fleet-actions';
import {dateLabel as dateTime, today} from '../lib/format';
import type {Lang} from '../lib/i18n';
import type {Load} from '../lib/dashboard';
import {User,CheckCircle2,Truck,AlertTriangle} from 'lucide-react';
import styles from './fleet.module.css';

const titles={drivers:'Choferes',trucks:'Camiones',trailers:'Trailers',assignments:'Asignaciones',actividad:'Actividad'};
type Tab=keyof typeof titles;
type Editor={type:'entity'|'assignment'|'document'|'end'|'review'|'deleteEntity'|'deleteDocument';kind:EntityKind;id:string;revision:number};
const kindLabel=(kind:EntityKind)=>kind==='drivers'?'chofer':kind==='trucks'?'camión':'trailer';
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
export default function FleetModule({fleet,loads,onOpenLoads,lang,t,initialTab}:{fleet:FleetController;loads:Load[];onOpenLoads:()=>void;lang:Lang;t:(es:string)=>string;initialTab?:Tab}) {
  const {state,ready}=fleet;
  const [tab,setTab]=useState<Tab>(initialTab||'drivers'),[query,setQuery]=useState(''),[filter,setFilter]=useState('Todos');
  const [selected,setSelected]=useState<{kind:EntityKind;id:string}|null>(null),[editor,setEditor]=useState<Editor|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [chosenDriver,setChosenDriver]=useState('');
  const [page,setPage]=useState(1); const pageSize=5;
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
      if(editor.type==='entity'&&editor.kind==='drivers')action={type:'driver',reason:text('reason'),record:{id:editor.id||crypto.randomUUID(),name:text('name'),phone:text('phone'),email:text('email'),group:text('group'),active:text('active')==='true',availability:text('availability') as Driver['availability'],notes:text('notes'),cardAlias:text('cardAlias')}};
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
  const changeTab=(next:Tab)=>{setTab(next);setSelected(null);setEditor(null);setQuery('');setFilter('Todos');setError('');setNotice('');setPage(1);};
  const statusOf=(kind:EntityKind,id:string)=>{if(kind==='drivers'){const d=state.drivers.find(d=>d.id===id)!;return d.active?d.availability:'Inactivo';}const e=state[kind].find(e=>e.id===id)!;return assignmentFor(state,kind,id)?'Asignado':e.status;};
  const records=tab==='assignments'||tab==='actividad'?[]:state[tab].filter(r=>{const search=tab==='drivers'?`${(r as Driver).name} ${(r as Driver).phone} ${(r as Driver).email} ${(r as Driver).group}`:`${(r as Equipment).unit} ${(r as Equipment).vin} ${(r as Equipment).plate} ${(r as Equipment).make}`;return search.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(filter==='Todos'||statusOf(tab,r.id)===filter);});
  const pageCount=Math.max(1,Math.ceil(records.length/pageSize));
  const pageSafe=Math.min(page,pageCount);
  const pageRecords=records.slice((pageSafe-1)*pageSize,pageSafe*pageSize);
  const assignmentsSorted=[...state.assignments].reverse();
  const assignmentPageCount=Math.max(1,Math.ceil(assignmentsSorted.length/pageSize));
  const assignmentPageSafe=Math.min(page,assignmentPageCount);
  const assignmentPageRows=assignmentsSorted.slice((assignmentPageSafe-1)*pageSize,assignmentPageSafe*pageSize);
  const selectedAssignment=selected?assignmentFor(state,selected.kind,selected.id):undefined;
  const relevantAssignments=selected?state.assignments.filter(a=>selected.kind==='drivers'?a.driverId===selected.id:selected.kind==='trucks'?a.truckId===selected.id:a.trailerId===selected.id):[];
  const currentForForm=state.assignments.find(a=>!a.endedAt&&a.driverId===chosenDriver);
  const editorTitle=editor?.type==='entity'?`${editor.id?t('Editar'):t('Agregar')} ${t(kindLabel(editor.kind))}`:editor?.type==='assignment'?t('Asignar o cambiar equipo'):editor?.type==='document'?t('+ Agregar documento').replace('+ ',''):editor?.type==='review'?t('Revisar documento'):editor?.type==='deleteEntity'?`${t('Eliminar')} ${t(kindLabel(editor.kind))}`:editor?.type==='deleteDocument'?t('Eliminar documento'):t('Finalizar asignación');
  return <div className={styles.fleet}>
    <div className={styles.localNotice}><strong>M&A KING</strong><p>{t('Los datos y archivos se guardan en Supabase y se sincronizan entre dispositivos. Usuarios y permisos compartidos están pendientes.')}</p><button disabled={!ready} onClick={()=>exportBackup(state)}>{t('Exportar respaldo (JSON + archivos)')}</button></div>
    {fleet.error&&<div role="alert" className={styles.error}>{fleet.error} <button onClick={()=>void fleet.refresh()}>{t('Reintentar')}</button></div>}
    {!ready&&!fleet.error&&<p role="status">{t('Abriendo los registros de flota…')}</p>}
    <div className={styles.statCards}>
      <button className={styles.statCard} data-tone="blue" onClick={()=>changeTab('drivers')}><span className={styles.statIcon} aria-hidden="true"><User size={16}/></span><span className={styles.statLabel}>{t('Choferes activos')}</span><strong>{ready?state.drivers.filter(d=>d.active).length:'—'}</strong></button>
      <button className={styles.statCard} data-tone="green" onClick={()=>changeTab('drivers')}><span className={styles.statIcon} aria-hidden="true"><CheckCircle2 size={16}/></span><span className={styles.statLabel}>{t('Choferes disponibles')}</span><strong>{ready?state.drivers.filter(d=>d.active&&d.availability==='Disponible'&&!assignmentFor(state,'drivers',d.id)).length:'—'}</strong></button>
      <button className={styles.statCard} data-tone="amber" onClick={()=>changeTab('trucks')}><span className={styles.statIcon} aria-hidden="true"><Truck size={16}/></span><span className={styles.statLabel}>{t('Camiones disponibles')}</span><strong>{ready?state.trucks.filter(e=>e.status==='Disponible'&&!assignmentFor(state,'trucks',e.id)).length:'—'}</strong></button>
      <button className={styles.statCard} data-tone="red" onClick={()=>changeTab('trucks')}><span className={styles.statIcon} aria-hidden="true"><AlertTriangle size={16}/></span><span className={styles.statLabel}>{t('Equipo no operativo')}</span><strong>{ready?[...state.trucks,...state.trailers].filter(e=>['En mantenimiento','Fuera de servicio'].includes(e.status)).length:'—'}</strong></button>
    </div>
    <nav className={styles.tabs} aria-label={t('Secciones de flota')}>{(Object.keys(titles) as Tab[]).map(tabKey=><button key={tabKey} aria-pressed={tab===tabKey} onClick={()=>changeTab(tabKey)}>{t(titles[tabKey])} <span>{tabKey==='assignments'?activeAssignments.length:tabKey==='actividad'?state.events.length:state[tabKey].length}</span></button>)}</nav>
    {notice&&<p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.toolbar}><h2>{t(titles[tab])}</h2>{tab!=='actividad'&&<button className={styles.primary} disabled={!ready||busy} onClick={()=>open(tab==='assignments'?'assignment':'entity',tab==='assignments'?'drivers':tab)}>{tab==='assignments'?t('+ Nueva asignación'):`${t('+ Agregar')} ${t(kindLabel(tab as EntityKind))}`}</button>}</div>
    {editor&&<form id="fleet-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.kind}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {editor.type==='entity'&&<div className={styles.fields}>
        {editor.kind==='drivers'?<>
          <label>{t('Nombre completo *')}<input name="name" required maxLength={150} defaultValue={existingDriver?.name}/></label>
          <label>{t('Teléfono')}<input name="phone" type="tel" maxLength={40} defaultValue={existingDriver?.phone}/></label>
          <label>{t('Correo electrónico')}<input name="email" type="email" maxLength={150} defaultValue={existingDriver?.email}/></label>
          <label>{t('Grupo / compañía operativa')}<input name="group" maxLength={100} defaultValue={existingDriver?.group||'M&A KING'}/></label>
          <label>{t('Alias en tarjeta de combustible')}<input name="cardAlias" maxLength={100} placeholder={t('Ej. si en Mudflap aparece con otro nombre')} defaultValue={existingDriver?.cardAlias}/></label>
          <label>{t('Estado del perfil')}<select name="active" defaultValue={existingDriver?.active===false?'false':'true'}><option value="true">{t('Activo')}</option><option value="false">{t('Inactivo')}</option></select></label>
          <label>{t('Disponibilidad')}<select name="availability" defaultValue={existingDriver?.availability||'Disponible'}>{['Disponible','En servicio','Descanso'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
        </>:<>
          <label>{t('Número de unidad *')}<input name="unit" required maxLength={50} defaultValue={existingEquipment?.unit}/></label>
          <label>{t('VIN')}<input name="vin" minLength={17} maxLength={17} defaultValue={existingEquipment?.vin}/></label>
          <label>{t('Placa')}<input name="plate" maxLength={30} defaultValue={existingEquipment?.plate}/></label>
          <label>{t('Estado de registro')}<input name="plateState" maxLength={50} defaultValue={existingEquipment?.plateState}/></label>
          <label>{t('Año')}<input name="year" type="number" min="1900" max={new Date().getFullYear()+2} defaultValue={existingEquipment?.year}/></label>
          <label>{t('Marca')}<input name="make" maxLength={80} defaultValue={existingEquipment?.make}/></label>
          <label>{t('Modelo')}<input name="model" maxLength={80} defaultValue={existingEquipment?.model}/></label>
          <label>{t('Tipo')} {editor.kind==='trailers'?t('de trailer'):t('de camión')}<input name="equipmentType" maxLength={80} defaultValue={existingEquipment?.type}/></label>
          <label>{t('Estado operativo')}<select name="status" defaultValue={existingEquipment?.status||'Disponible'}>{['Disponible','En mantenimiento','Fuera de servicio','Inactivo'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
        </>}
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editRecord?.notes}/></label>
        {editor.id&&<label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500}/></label>}
      </div>}
      {editor.type==='assignment'&&<><p>{t('Un cambio cierra la asignación anterior y conserva su historial. No modifica cargas anteriores ni aprueba nuevas cargas.')}</p><div className={styles.fields}>
        <label>{t('Chofer *')}<select name="driverId" required value={chosenDriver} onChange={e=>setChosenDriver(e.target.value)}><option value="">{t('Selecciona un chofer')}</option>{state.drivers.filter(d=>d.active).map(d=><option key={d.id} value={d.id} disabled={d.availability==='Descanso'}>{d.name}{d.availability==='Descanso'?` ${t('· En descanso')}`:''}</option>)}</select></label>
        <label>{t('Camión *')}<select key={`truck-${chosenDriver}`} name="truckId" required defaultValue={currentForForm?.truckId||''}><option value="">{t('Selecciona un camión')}</option>{state.trucks.map(e=>{const a=assignmentFor(state,'trucks',e.id);const blocked=e.status!=='Disponible'||Boolean(a&&a.driverId!==chosenDriver);return <option key={e.id} value={e.id} disabled={blocked}>{e.unit}{blocked?` ${t('· No disponible')}`:''}</option>;})}</select></label>
        <label>{t('Trailer')}<select key={`trailer-${chosenDriver}`} name="trailerId" defaultValue={currentForForm?.trailerId||''}><option value="">{t('Sin trailer')}</option>{state.trailers.map(e=>{const a=assignmentFor(state,'trailers',e.id);const blocked=e.status!=='Disponible'||Boolean(a&&a.driverId!==chosenDriver);return <option key={e.id} value={e.id} disabled={blocked}>{e.unit}{blocked?` ${t('· No disponible')}`:''}</option>;})}</select></label>
        <label className={styles.wide}>{t('Motivo de la asignación o cambio *')}<input name="reason" required maxLength={500}/></label>
      </div></>}
      {editor.type==='end'&&<><p>{t('El equipo quedará libre. La asignación anterior seguirá en el historial.')}</p><label>{t('Motivo de finalización *')}<input name="reason" required maxLength={500}/></label></>}
      {editor.type==='document'&&<><p>{t('Perfil:')||'Perfil:'} {entityName(state,editor.kind,editor.id)}. {t('El archivo se registra como recibido, pendiente de revisión.')}</p><div className={styles.fields}>
        <label>{t('Tipo *')}<select name="documentType">{['Licencia','Registro','Seguro','Inspección','Otro'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Archivo *')}<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required/><small>{t('PDF o imagen · Hasta 5 MB')}</small></label>
        <label>{t('Fecha de emisión')}<input name="issued" type="date"/></label><label>{t('Vencimiento')}<input name="expires" type="date"/></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" maxLength={3000}/></label>
      </div></>}
      {editor.type==='review'&&<><p>{t('Descarga y comprueba el documento antes de marcarlo como revisado.')}</p><label>{t('Resultado')}<select name="reviewed"><option value="true">{t('Revisado por mí')}</option><option value="false">{t('Pendiente de revisión')}</option></select></label><label>{t('Nota de revisión *')}<textarea name="reason" required maxLength={500}/></label></>}
      {editor.type==='deleteEntity'&&<><p>{t('Esta acción elimina el registro por completo, no solo lo desactiva. También se borran sus documentos y su historial de asignaciones. El evento de auditoría queda guardado igual.')}</p><label>{t('Motivo de la eliminación *')}<input name="reason" required maxLength={500}/></label></>}
      {editor.type==='deleteDocument'&&<><p>{t('Esta acción elimina el documento y su archivo por completo. El evento de auditoría queda guardado igual.')}</p><label>{t('Motivo de la eliminación *')}<input name="reason" required maxLength={500}/></label></>}
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy?t('Guardando…'):t('Guardar')}</button><button type="button" disabled={busy} onClick={()=>{setEditor(null);setError('');}}>{t('Cancelar')}</button></div>
    </form>}
    {tab==='actividad'?<section className={styles.profile}>{state.events.length?<ul>{[...state.events].sort((a,b)=>b.at.localeCompare(a.at)).map(e=><li key={e.id}>{dateTime(e.at)} — {e.detail} · {e.actor}</li>)}</ul>:<p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>:tab!=='assignments'?<>
      <div className={styles.filters}><label>{t('Buscar')} {t(titles[tab]).toLowerCase()}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='drivers'?t('Nombre, teléfono o correo'):t('Unidad, VIN o placa')}/></label><label>{t('Filtrar estado')}<select value={filter} onChange={e=>setFilter(e.target.value)}>{(tab==='drivers'?['Todos','Disponible','En servicio','Descanso','Inactivo']:['Todos','Disponible','Asignado','En mantenimiento','Fuera de servicio','Inactivo']).map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label></div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead><tr><th>{tab==='drivers'?t('Chofer'):t('Unidad')}</th><th>{tab==='drivers'?t('Contacto'):t('Marca / Modelo')}</th><th>{t('Estado')}</th><th>{t('Asignación')}</th><th aria-hidden="true"></th></tr></thead>
          <tbody>{pageRecords.map(r=><tr key={r.id} className={selected?.id===r.id?styles.selected:''}>
            <td><strong>{tab==='drivers'?(r as Driver).name:(r as Equipment).unit}</strong></td>
            <td className={styles.tableSub}>{tab==='drivers'?(r as Driver).phone||t('Teléfono pendiente'):`${(r as Equipment).make} ${(r as Equipment).model}`.trim()||t('Marca y modelo pendientes')}</td>
            <td><span className={styles.badge}>{t(statusOf(tab,r.id))}</span></td>
            <td className={styles.tableSub}>{assignmentFor(state,tab,r.id)?t('Con equipo asignado'):t('Sin asignación activa')}</td>
            <td><button onClick={()=>{setSelected({kind:tab,id:r.id});setEditor(null);}}>{t('Ver ficha →')}</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {ready&&!records.length&&<p className={styles.empty}>{query||filter!=='Todos'?t('No hay resultados con estos filtros.'):`${t('Todavía no hay')||''} ${t(titles[tab]).toLowerCase()}. ${t('Usa el botón Agregar para comenzar.')}`}</p>}
      {records.length>0&&<div className={styles.pagination}>
        <span>{t('Mostrando')} {(pageSafe-1)*pageSize+1}–{Math.min(pageSafe*pageSize,records.length)} {t('de')} {records.length}</span>
        <div className={styles.pageButtons}>
          <button disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} aria-label={t('Anterior')}>‹</button>
          {Array.from({length:pageCount},(_,i)=>i+1).map(n=><button key={n} aria-pressed={pageSafe===n} onClick={()=>setPage(n)}>{n}</button>)}
          <button disabled={pageSafe>=pageCount} onClick={()=>setPage(p=>Math.min(pageCount,p+1))} aria-label={t('Siguiente')}>›</button>
        </div>
      </div>}
    </>:<><p>{t('Asignaciones activas')||'Asignaciones activas'}: {activeAssignments.length}. {t('Las finalizadas se conservan abajo.')}</p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead><tr><th>{t('Chofer')}</th><th>{t('Camión / Trailer')}</th><th>{t('Estado')}</th><th>{t('Inicio → Fin')}</th><th aria-hidden="true"></th></tr></thead>
          <tbody>{assignmentPageRows.map(a=><tr key={a.id}>
            <td><strong>{entityName(state,'drivers',a.driverId)}</strong></td>
            <td className={styles.tableSub}>{entityName(state,'trucks',a.truckId)}{a.trailerId?` · ${entityName(state,'trailers',a.trailerId)}`:''}</td>
            <td><span className={styles.badge}>{a.endedAt?t('Finalizada'):t('Activa')}</span></td>
            <td className={styles.tableSub}>{dateTime(a.startedAt)}{a.endedAt?` → ${dateTime(a.endedAt)}`:''}</td>
            <td>{!a.endedAt&&<div className={styles.actions}><button onClick={()=>open('assignment','drivers',a.driverId)}>{t('Cambiar')}</button><button onClick={()=>open('end','drivers',a.id)}>{t('Finalizar')}</button></div>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!state.assignments.length&&<p className={styles.empty}>{t('Agrega un chofer y un camión para crear tu primera asignación.')}</p>}
      {state.assignments.length>0&&<div className={styles.pagination}>
        <span>{t('Mostrando')} {(assignmentPageSafe-1)*pageSize+1}–{Math.min(assignmentPageSafe*pageSize,assignmentsSorted.length)} {t('de')} {assignmentsSorted.length}</span>
        <div className={styles.pageButtons}>
          <button disabled={assignmentPageSafe<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} aria-label={t('Anterior')}>‹</button>
          {Array.from({length:assignmentPageCount},(_,i)=>i+1).map(n=><button key={n} aria-pressed={assignmentPageSafe===n} onClick={()=>setPage(n)}>{n}</button>)}
          <button disabled={assignmentPageSafe>=assignmentPageCount} onClick={()=>setPage(p=>Math.min(assignmentPageCount,p+1))} aria-label={t('Siguiente')}>›</button>
        </div>
      </div>}
    </>}
    {selected&&record&&tab!=='assignments'&&tab!=='actividad'&&<section className={styles.profile}>
      <div className={styles.toolbar}><h2>{t('Ficha:')} {entityName(state,selected.kind,selected.id)}</h2><button onClick={()=>open('entity',selected.kind,selected.id)}>{t('Editar ficha')}</button><button onClick={()=>{if(window.confirm(t('¿Eliminar este registro por completo? No se puede deshacer.')))open('deleteEntity',selected.kind,selected.id);}}>{t('Eliminar')} {t(kindLabel(selected.kind))}</button></div>
      <dl className={styles.fields}>
        {(selected.kind==='drivers'?[['Nombre',(record as Driver).name],['Teléfono',(record as Driver).phone],['Correo',(record as Driver).email],['Grupo',(record as Driver).group],['Alias en tarjeta de combustible',(record as Driver).cardAlias],['Estado',(record as Driver).active?'Activo':'Inactivo'],['Disponibilidad',(record as Driver).availability]]:[['Unidad',(record as Equipment).unit],['VIN',(record as Equipment).vin],['Placa',(record as Equipment).plate],['Estado de registro',(record as Equipment).plateState],['Año',(record as Equipment).year],['Marca',(record as Equipment).make],['Modelo',(record as Equipment).model],['Tipo',(record as Equipment).type],['Estado',statusOf(selected.kind,record.id)]]).map(([label,v])=><div key={label}><dt>{t(label)}</dt><dd>{(v&&t(String(v)))||t('Pendiente de completar')}</dd></div>)}
      </dl><p><b>{t('Notas:')}</b> {record.notes||t('Sin notas')}</p>
      <h3>{t('Equipo y asignación actual')}</h3>{selectedAssignment?<p>{entityName(state,'drivers',selectedAssignment.driverId)} · {entityName(state,'trucks',selectedAssignment.truckId)} · {selectedAssignment.trailerId?entityName(state,'trailers',selectedAssignment.trailerId):t('Sin trailer')}</p>:<p>{t('Sin asignación activa.')}</p>}
      <div className={styles.actions}>{selected.kind==='drivers'&&<button onClick={()=>open('assignment','drivers',selected.id)}>{t('Asignar / cambiar equipo')}</button>}{selectedAssignment&&<button onClick={()=>open('end','drivers',selectedAssignment.id)}>{t('Finalizar asignación')}</button>}</div>
      <h3>{t('Documentos')}</h3><button onClick={()=>open('document',selected.kind,selected.id)}>{t('+ Agregar documento')}</button>
      {state.documents.filter(d=>d.ownerKind===selected.kind&&d.ownerId===selected.id).map(d=><div key={d.id} className={styles.document}><div><strong>{t(d.type)} · {t(documentStatus(d,today()))}</strong><p>{d.filename} · {Math.ceil((d.sizeBytes??0)/1024)} KB</p><small>{t('Recibido:')} {dateTime(d.uploadedAt)}{d.issued&&` · ${t('Emisión:')} ${d.issued}`}{d.expires?` · ${t('Vence')}: ${d.expires}`:` · ${t('Sin vencimiento indicado')}`}</small>{d.reviewedAt&&<small>{t('Revisado:')} {dateTime(d.reviewedAt)}</small>}<p>{d.notes}</p></div><div className={styles.actions}><button onClick={()=>void download(d)}>{t('Descargar')}</button><button onClick={()=>open('review',selected.kind,d.id)}>{t('Revisar')}</button><button onClick={()=>{if(window.confirm(t('¿Eliminar este documento por completo? No se puede deshacer.')))open('deleteDocument',selected.kind,d.id);}}>{t('Eliminar')}</button></div></div>)}
      {!state.documents.some(d=>d.ownerId===selected.id)&&<p className={styles.empty}>{t('No se han recibido documentos para este perfil.')}</p>}
      <h3>{t('Historial de asignaciones')}</h3>{relevantAssignments.length?<ul>{[...relevantAssignments].reverse().map(a=><li key={a.id}>{dateTime(a.startedAt)} — {entityName(state,'drivers',a.driverId)} / {entityName(state,'trucks',a.truckId)} / {a.trailerId?entityName(state,'trailers',a.trailerId):t('Sin trailer')} · {a.endedAt?`${t('Finalizada')} ${dateTime(a.endedAt)}`:t('Activa')} · {a.reason}{a.endReason&&` · ${a.endReason}`}</li>)}</ul>:<p>{t('Sin asignaciones anteriores.')}</p>}
      {/* NOTA DE ARQUITECTURA (documentación, no ejecutar todavía): este filtrado de cargas
          por chofer es dominio de Módulo 2 (Cargas y Operaciones), no de Flota. Hoy vive aquí
          porque `loads` siempre llega vacío (emptySnapshot.loads desde app/page.tsx). Cuando
          Módulo 2 tenga datos reales, esto debe volverse un link a Cargas y Operaciones
          filtrado por chofer, no lógica de filtrado propia dentro de este módulo. */}
      {selected.kind==='drivers'&&<><h3>{t('Cargas y actividad relacionada')}</h3>{loads.filter(l=>l.driverId===selected.id).map(l=><p key={l.id}>{l.id} · {l.route} · {l.approval==='Aprobada'?l.status:t('Pendiente de aprobación')}</p>)}<p>{t('La gestión de cargas, combustible, pagos y liquidaciones está pendiente de conexión. No se copian cifras de ejemplo a este perfil.')}</p><button onClick={onOpenLoads}>{t('Abrir Cargas →')}</button></>}
      <h3>{t('Historial de cambios')}</h3>{state.events.filter(e=>e.entityIds.includes(selected.id)).map(e=><details key={e.id} className={styles.history}><summary>{e.detail}<small>{dateTime(e.at)} · {e.actor}</small></summary><div className={styles.fields}><div><b>{t('Anterior')}</b><pre>{JSON.stringify(e.before,null,2)}</pre></div><div><b>{t('Nuevo')}</b><pre>{JSON.stringify(e.after,null,2)}</pre></div></div></details>)}
    </section>}
    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Alertas de flota')} <span className={styles.badge}>{alerts.length}</span></h2></div><form className={styles.actions} onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;setBusy(true);try{await fleet.commit({type:'warningDays',days:Number(new FormData(form).get('days'))});setNotice('Plazo de aviso guardado.');setError('');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><label>{t('Avisar con días de anticipación')}<input name="days" type="number" min="0" max="365" required defaultValue={state.warningDays} key={state.warningDays}/></label><button disabled={!ready||busy}>{t('Guardar plazo')}</button></form>{!editor&&error&&<p role="alert" className={styles.error}>{error}</p>}<p>{t('Documentos esperados: licencia para choferes, registro y seguro para camiones, registro para trailers.')}</p>{alerts.length?<ul className={styles.alerts}>{alerts.map(a=><li key={a.id}><strong>{t(a.title)}</strong><span>{a.detail}</span></li>)}</ul>:<p className={styles.empty}>{t('No hay alertas de flota.')}</p>}</section>
  </div>;
}
