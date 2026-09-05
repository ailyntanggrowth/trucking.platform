"use client";
import {useCallback,useEffect,useState} from 'react';
import {emptyFleet,type FleetAction,type FleetState} from './fleet';
import {commitFleetAction,commitDocumentAction,getFleetState} from './fleet-actions';

export function useFleet() {
  const [state,setState]=useState<FleetState>(emptyFleet),[ready,setReady]=useState(false),[error,setError]=useState('');
  const refresh=useCallback(async()=>{try{const next=await getFleetState();setState(s=>next.revision>=s.revision?next:s);setReady(true);setError('');}catch(e){setError((e as Error).message);setReady(false);}},[]);
  useEffect(()=>{void refresh();const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('ma-king-fleet'):null;if(channel)channel.onmessage=()=>void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{channel?.close();window.removeEventListener('focus',focus);};},[refresh]);
  const commit=async(action:FleetAction,revision=state.revision)=>{
    if(!ready)throw new Error('Supabase no está disponible.');
    let next:FleetState;
    if(action.type==='document'){
      const fields=new FormData();
      fields.set('ownerKind',action.record.ownerKind);fields.set('ownerId',action.record.ownerId);
      fields.set('documentType',action.record.type);fields.set('issued',action.record.issued);
      fields.set('expires',action.record.expires);fields.set('notes',action.record.notes);
      fields.set('file',action.record.file,action.record.filename);
      next=await commitDocumentAction(fields,revision);
    } else {
      next=await commitFleetAction(action,revision);
    }
    setState(next);
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('ma-king-fleet');channel.postMessage('updated');channel.close();}
    return next;
  };
  return {state,ready,error,refresh,commit};
}
export type FleetController=ReturnType<typeof useFleet>;
