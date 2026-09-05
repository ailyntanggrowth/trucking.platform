"use client";
import {useCallback,useEffect,useState} from 'react';
import {applyFleetAction,emptyFleet,type FleetAction,type FleetState} from './fleet';
function database():Promise<IDBDatabase> {return new Promise((resolve,reject)=>{const request=indexedDB.open('ma-king-fleet-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('fleet');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('No se pudo abrir el almacenamiento local.'));request.onblocked=()=>reject(new Error('Cierra otras pestañas para abrir el almacenamiento local.'));});}
async function access(action?:FleetAction,expectedRevision?:number):Promise<FleetState> {
  const db=await database(); try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('fleet',action?'readwrite':'readonly'), store=tx.objectStore('fleet'); let result:FleetState=emptyFleet, failure:Error|undefined;
    const request=store.get('company');request.onsuccess=()=>{try{const current=request.result as FleetState|undefined;if(current&&current.schema!==1)throw new Error('Esta versión no puede leer el archivo de flota.');result=current||structuredClone(emptyFleet);if(action){if(result.revision!==expectedRevision)throw new Error('Los datos cambiaron en otra pestaña. Cierra el formulario, actualiza y vuelve a intentarlo.');result=applyFleetAction(result,action,new Date().toISOString(),crypto.randomUUID());store.put(result,'company');}}catch(error){failure=error as Error;tx.abort();}};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||new Error('No se pudo guardar. Comprueba el espacio disponible y vuelve a intentarlo.'));tx.onabort=()=>reject(failure||new Error('No se guardaron los cambios.'));
  });}finally{db.close();}
}
export function useFleet() {
  const [state,setState]=useState<FleetState>(emptyFleet),[ready,setReady]=useState(false),[error,setError]=useState('');
  const refresh=useCallback(async()=>{try{const next=await access();setState(s=>next.revision>=s.revision?next:s);setReady(true);setError('');}catch(e){setError((e as Error).message);setReady(false);}},[]);
  useEffect(()=>{void refresh();const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('ma-king-fleet'):null;if(channel)channel.onmessage=()=>void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{channel?.close();window.removeEventListener('focus',focus);};},[refresh]);
  const commit=async(action:FleetAction,revision=state.revision)=>{if(!ready)throw new Error('El almacenamiento local no está disponible.');const next=await access(action,revision);setState(next);if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('ma-king-fleet');channel.postMessage('updated');channel.close();}return next;};
  return {state,ready,error,refresh,commit};
}
export type FleetController=ReturnType<typeof useFleet>;
