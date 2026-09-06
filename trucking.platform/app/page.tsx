"use client";

import { useEffect, useRef, useState } from "react";
import { emptySnapshot, summarize, type LoadStatus } from "../lib/dashboard";
import { useFleet } from "../lib/use-fleet";
import { fleetAlerts, driverStatus, DRIVER_STATUS_VALUES } from "../lib/fleet";
import { useFuel } from "../lib/use-fuel";
import { summarizeFuel } from "../lib/fuel";
import { useLoads } from "../lib/use-loads";
import { toDashboardLoad, summarizeLoads } from "../lib/loads";
import { money, dateLabel, today } from "../lib/format";
import { translate, type Lang } from "../lib/i18n";
import FleetModule from "./fleet-module";
import FuelModule from "./fuel-module";
import LoadsModule from "./loads-module";

const statuses: LoadStatus[] = ['Programado','Cargando','En tránsito','Entregada','Cancelada','Reemplazada'];
const nav = [
  {name:'Cargas',id:'cargas',icon:'01'},
  {name:'Choferes y Flota',id:'choferes',icon:'02'},
  {name:'Combustible y Gastos',id:'combustible',icon:'03'},
  {name:'Contabilidad y Pagos',id:'finanzas',icon:'04'},
  {name:'Reportes',id:'reportes',icon:'05'},
  {name:'Chat',id:'comunicacion',icon:'06'},
  {name:'Usuarios y Permisos',id:'usuarios',icon:'07'},
];
function currentWeek() {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}
function weekEnd(start: string) { const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+7); return date.toISOString().slice(0,10); }

export default function Home() {
  const [activeModule,setActiveModule] = useState<string|null>(null);
  const [week,setWeek] = useState('');
  const [filter,setFilter] = useState('Por revisar');
  const [fleetTab,setFleetTab] = useState<'drivers'|'trucks'|'trailers'|'assignments'|'actividad'>('drivers');
  const lang: Lang = 'es';
  const t = (es:string) => translate(lang,es);
  const fleet = useFleet();
  const fuel = useFuel();
  const loadsCtl = useLoads();
  const fleetReady = fleet.ready;
  const data = {
    ...emptySnapshot,
    connected: loadsCtl.ready,
    loads: loadsCtl.state.loads.map(toDashboardLoad),
    drivers: fleet.state.drivers.filter(d=>['Mario','Owner Operators'].includes(d.group)).map(d=>({id:d.id,name:d.name,status:driverStatus(d)})),
    alerts: fleet.ready ? fleetAlerts(fleet.state,today()) : [],
    activity: fleet.state.events.map(e=>({id:e.id,at:e.at,actor:e.actor,detail:e.detail})),
  };
  const start = week || currentWeek();
  const summary = summarize(data,start,weekEnd(start));
  const fuelSummary = summarizeFuel(fuel.state,start,weekEnd(start));
  const loadsSummary = summarizeLoads(loadsCtl.state,start,weekEnd(start));
  const value = (n:number, currency=false) => data.connected ? currency ? money(n) : n : '—';
  const alerts = [...data.alerts.map(a=>({...a, onClick:()=>openFleet('drivers')})),
    ...summary.official.filter(l=>l.missingPod).map(l=>({id:`pod-${l.id}`,title:'Falta POD',detail:`${l.id} · Documento de entrega pendiente`,onClick:()=>viewLoads('Activas')})),
    ...summary.official.filter(l=>['Cancelada','Reemplazada'].includes(l.status)).map(l=>({id:`cancel-${l.id}`,title:`Carga ${l.status.toLowerCase()}`,detail:`${l.id}${l.replacedBy ? ` · Relacionada con ${l.replacedBy}` : ''}`,onClick:()=>viewLoads(l.status)})),
    ...summary.payments.map(p=>({id:`payment-${p.id}`,title:'Pago pendiente',detail:`${p.id} · ${p.direction} ${money(p.amount-p.paid)} · Vence ${p.due}`,onClick:()=>go('pagos')}))];
  const moduleNames: Record<string,string> = { dashboard: 'Dashboard', ...Object.fromEntries(nav.map(item=>[item.id,item.name])) };
  const metricCards = [
    {label:'Cargas activas',amount:summary.active.length,hint:'Oficiales, aún en operación',action:()=>viewLoads('Activas')},
    {label:'Pagos pendientes',amount:summary.payments.length,hint:'Por cobrar y por pagar',action:()=>go('pagos')},
    {label:'Choferes activos',amount:data.drivers.filter(d=>d.status!=='Inactivo').length,hint:'Incluye servicio, descanso y disponibles',action:()=>openFleet('drivers')},
  ];
  const maxMetric = Math.max(1,...metricCards.map(c=>c.amount));

  // --- Cajón de navegación (drawer): se abre arrastrando desde el borde izquierdo
  // (mouse o dedo, vía Pointer Events) o tocando el botón. Antes era un sidebar
  // siempre visible; ahora es un overlay oculto por defecto en cualquier tamaño de pantalla.
  const [drawerOpen,setDrawerOpen] = useState(false);
  const [dragOffset,setDragOffset] = useState<number|null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const dragInfo = useRef<{startX:number;width:number;wasOpen:boolean}|null>(null);
  const dragOffsetRef = useRef<number|null>(null);
  function setOffset(v:number|null) { dragOffsetRef.current=v; setDragOffset(v); }
  function beginDrag(clientX:number, wasOpen:boolean) {
    const width = drawerRef.current?.offsetWidth || 300;
    dragInfo.current = {startX:clientX,width,wasOpen};
    setOffset(wasOpen?0:-width);
  }
  function onEdgePointerDown(e:React.PointerEvent) { if(drawerOpen) return; beginDrag(e.clientX,false); }
  function onDrawerPointerDown(e:React.PointerEvent) { beginDrag(e.clientX,true); }
  useEffect(()=>{
    function move(e:PointerEvent) {
      const info=dragInfo.current; if(!info) return;
      const delta=e.clientX-info.startX;
      const base=info.wasOpen?0:-info.width;
      setOffset(Math.min(0,Math.max(-info.width,base+delta)));
    }
    function up() {
      const info=dragInfo.current; if(!info) return;
      const off=dragOffsetRef.current ?? (info.wasOpen?0:-info.width);
      setDrawerOpen(off > -info.width*0.6);
      dragInfo.current=null; setOffset(null);
    }
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
    return ()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);};
  },[]);

  // --- Navegación con pila propia en memoria: cada módulo visitado queda
  // registrado aquí, así el botón "Atrás" funciona de verdad. No usamos
  // window.history: en este entorno history.back() dispara una recarga
  // completa de página (se confirmó vía Network: un GET / real), lo que
  // reiniciaba todo el estado de React (incluyendo el idioma). Una pila
  // propia nunca recarga la página.
  const [backStack,setBackStack] = useState<(string|null)[]>([]);
  function navigateTo(target:string|null) {
    setBackStack(prev=>activeModule===null?prev:[...prev,activeModule]);
    setActiveModule(target); setDrawerOpen(false);
  }
  function goBack() {
    setBackStack(prev=>{
      if(!prev.length) return prev;
      setActiveModule(prev[prev.length-1]);
      return prev.slice(0,-1);
    });
  }

  function go(id:string) {
    const target = id==='pagos'?'finanzas':['alertas','actividad'].includes(id)?'dashboard':id;
    navigateTo(target);
    requestAnimationFrame(()=>{
      const element = document.getElementById(['alertas','actividad'].includes(id)?id:'main-content');
      element?.scrollIntoView({behavior:'instant',block:'start'});
      element?.focus({preventScroll:true});
    });
  }
  function viewLoads(next:string) {setFilter(next); go('cargas');}
  function openFleet(tab:typeof fleetTab='drivers') {setFleetTab(tab); go('choferes');}
  const unavailable = t('Pendiente de conexión. Aquí aparecerá la información del módulo correspondiente.');
  return <main className="shell">
    <a className="skipLink" href="#main-content">{t('Saltar al contenido')}</a>

    <div className="edgeZone" onPointerDown={onEdgePointerDown} aria-hidden="true" />
    {activeModule!==null && <button className={`drawerTab ${drawerOpen?'isOpen':''}`} aria-expanded={drawerOpen} aria-controls="main-navigation" onClick={()=>setDrawerOpen(o=>!o)}>
      <span aria-hidden="true">{drawerOpen?'✕':'☰'}</span><span className="srOnly">{drawerOpen?t('Cerrar menú'):t('Abrir menú')}</span>
    </button>}
    {(drawerOpen||dragOffset!==null) && <div className={`drawerBackdrop ${drawerOpen?'isOpen':''}`} onClick={()=>setDrawerOpen(false)} />}
    <aside ref={drawerRef} className={`drawer ${drawerOpen?'open':''}`} style={dragOffset!==null?{transform:`translateX(${dragOffset}px)`,transition:'none'}:undefined} onPointerDown={onDrawerPointerDown}>
      <button className="brand brandButton" onClick={()=>navigateTo('dashboard')}><div className="brandMark">M&A</div><div><strong>M&A King</strong><span>TRUCK SERVICE</span></div></button>
      <div className="workspaceLabel">{t('OPERACIONES')}</div>
      <nav id="main-navigation" className="navList" aria-label={t('Navegación principal')}>{nav.map(item=><button key={item.id} className={`navItem ${activeModule===item.id?'active':''}`} aria-current={activeModule===item.id?'page':undefined} onClick={()=>go(item.id)}><span className="navIcon" aria-hidden="true">{item.icon}</span>{t(item.name)}</button>)}</nav>
      <div className="sidebarBottom"><div className="userRow"><div className="avatar">AT</div><div><strong>Adianez Tang</strong><span>{t('Panel principal')}</span></div></div></div>
    </aside>

    {activeModule===null ? <section className="landingHero" id="main-content" tabIndex={-1}>
      <div className="landingHeroInner">
        <p className="eyebrow">{t('TRUCK SERVICE · PANEL PRINCIPAL')}</p>
        <h1>M&amp;A KING</h1>
        <p className="heroGreeting">{t('Hola, Adianez Tang')}</p>
        <p className="subtitle">{t('Tus cargas, tu equipo y tus números en un solo lugar.')}</p>
        <button className="heroCta" onClick={()=>navigateTo('dashboard')}>{t('START')}</button>
        <p className="heroHint">{t('Desliza desde el borde izquierdo para abrir el menú.')}</p>
      </div>
    </section> : <section className="content" id="main-content" tabIndex={-1} key={activeModule}>
      <header className="topbar">
        <button className="backButton" onClick={goBack} disabled={!backStack.length} aria-label={t('Atrás')}>{t('← Atrás')}</button>
        <div className="breadcrumb"><span>trucking.platform</span><b>/</b><strong>{t(moduleNames[activeModule])}</strong></div>
        <button className="exitButton" onClick={()=>{window.close();navigateTo(null);}} aria-label={t('Salir del sistema')} title={t('Salir del sistema')}>✕</button>
      </header>
      {activeModule==='dashboard' ? <>
      <div className="pageIntro">
        <span className="pageIntroTag">{t('TRUCK SERVICE')}</span>
        <div className="sourceNotice pageIntroNotice" role="status"><div><strong>{fleet.ready?t('Flota conectada'):t('Cargando registros de flota')}</strong><p>{t('Choferes, Cargas y Combustible ya usan datos reales. Contabilidad y Reportes siguen pendientes de conexión.')}</p></div></div>
      </div>
      <button className="reviewBanner" onClick={()=>viewLoads('Por revisar')}><div><span className="eyebrow">{t('TU APROBACIÓN ES NECESARIA')}</span><h2>{t('Cargas por revisar')}</h2><p>{t('La IA prepara. Tú revisas y confirmas antes de que sean oficiales.')}</p></div><div className="reviewNumber">{value(summary.review.length)}<span>{t('Revisar cargas →')}</span></div></button>
      <div className="metricsGrid">{metricCards.map(card=>{
        const shown = card.label==='Choferes activos' ? (fleetReady?card.amount:null) : (data.connected?card.amount:null);
        const pct = shown===null ? 30 : Math.max(12,Math.round((card.amount/maxMetric)*100));
        return <button className="metricCard" key={card.label} onClick={card.action}>
          <div className="metricTop">{t(card.label)}<span aria-hidden="true">↗</span></div>
          <strong>{shown===null?'—':shown}</strong>
          <div className="metricBarTrack"><div className="metricBarFill" style={{height:`${pct}%`}}/></div>
          <div className="metricDelta"><em>{t(card.hint)}</em></div>
        </button>;
      })}</div>
      <section className="panel sectionSpace" id="cargas" tabIndex={-1}>
        <div className="panelHeader"><div><h2>{t('Estado de cargas')}</h2><p>{t('Toca un estado para verlo en Cargas.')}</p></div></div>
        <div className="statusGrid">{statuses.map(status=><button key={status} onClick={()=>viewLoads(status)}><strong>{value(summary.official.filter(l=>l.status===status).length)}</strong><span>{status==='Programado'?t('Próximas a recoger'):t(status)}</span></button>)}</div>
      </section>
      <div className="bottomGrid">
        <section className="panel" id="choferes" tabIndex={-1}><div className="panelHeader"><div><h2>{t('Estado de choferes')}</h2><p>{t('Activo no significa disponible para una carga.')}</p></div></div><div className="driverSummary">{DRIVER_STATUS_VALUES.map(s=><div key={s}><strong>{fleetReady?data.drivers.filter(d=>d.status===s).length:'—'}</strong><span>{t(s)}</span></div>)}</div>{data.drivers.length?<div className="panelLinkWrap"><button className="selectButton" onClick={()=>openFleet('drivers')}>{t('Ver todos los choferes →')}</button></div>:<p className="emptyState">{fleetReady?t('Todavía no hay choferes registrados.'):unavailable}</p>}</section>
        <section className="panel" id="alertas" tabIndex={-1}><div className="panelHeader"><div><h2>{t('Requiere atención')}</h2><p>{t('Documentos de equipo, POD, cancelaciones y pagos.')}</p></div><span className="alertCount">{fleetReady?alerts.length:'—'}</span></div>{alerts.length?<div className="attentionScroll"><ul className="plainList">{alerts.map(a=><li key={a.id}><button className="alertLine" onClick={a.onClick}><strong>{a.title}</strong><span>{a.detail}</span></button></li>)}</ul></div>:<p className="emptyState">{fleetReady?t('No hay alertas de flota. Las demás fuentes están pendientes.'):unavailable}</p>}</section>
      </div>
      <section className="panel sectionSpace" id="finanzas" tabIndex={-1}><div className="panelHeader"><div><h2>{t('Resumen financiero')}</h2><p>{t('Semana desde')} {start} · USD · America/Chicago</p></div><label className="filterLabel">{t('Semana desde')}<input type="date" value={start} onChange={e=>setWeek(e.target.value)}/></label></div><div className="financeGrid">
        <div><span>{t('Total bruto')}</span><strong>{loadsCtl.ready?money(loadsSummary.gross):'—'}</strong></div>
        <div><span>{t('Fuel')}</span><strong>{fuel.ready?money(fuelSummary.fuel):'—'}</strong></div>
        <div><span>{t('Non-Fuel')}</span><strong>{fuel.ready?money(fuelSummary.nonFuel):'—'}</strong></div>
        <div><span>{t('Otros gastos')}</span><strong>{fuel.ready?money(fuelSummary.expenseTotal):'—'}</strong></div>
        <div><span>{t('Salarios')}</span><strong>—</strong></div>
        <div className="profit"><span>{t('Ganancia estimada')}</span><strong>—</strong><small>{t('Pendiente de reglas contables completas')}</small></div>
      </div><p className="detailNote financeNote">{t('El bruto no equivale a dinero cobrado. Los seguros, el 6%, descuentos y ajustes se integrarán desde contabilidad antes de mostrar una ganancia. Las cargas pendientes no generan ingresos oficiales.')}</p></section>
      <section className="panel sectionSpace" id="pagos" tabIndex={-1}><div className="panelHeader"><div><h2>{t('Pagos pendientes')}</h2><p>{t('Saldos abiertos de todos los períodos, después de pagos parciales.')}</p></div></div><div className="driverSummary"><div><span>{t('Por cobrar')}</span><strong>{value(summary.receivable,true)}</strong></div><div><span>{t('Por pagar')}</span><strong>{value(summary.payable,true)}</strong></div></div>{summary.payments.length?<ul className="plainList">{summary.payments.map(p=><li key={p.id}><strong>{p.id} · {p.direction}</strong><span>{money(p.amount-p.paid)} · {t('Vence')} {p.due}</span></li>)}</ul>:<p className="emptyState">{data.connected?t('No hay pagos pendientes.'):unavailable}</p>}</section>
      <section className="panel sectionSpace" id="actividad" tabIndex={-1}><div className="panelHeader"><div><h2>{t('Actividad reciente')}</h2><p>{t('Quién hizo cada cambio y cuándo.')}</p></div></div>{data.activity.length?<><div className="activityScroll"><ol className="plainList">{[...data.activity].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,20).map(a=><li key={a.id} className="alertLine"><strong>{a.detail}</strong><span>{dateLabel(a.at)} · {a.actor}</span></li>)}</ol></div><div className="panelLinkWrap"><button className="selectButton" onClick={()=>openFleet('actividad')}>{t('Ver toda la actividad →')}</button></div></>:<p className="emptyState">{fleetReady?t('Todavía no hay actividad de flota.'):unavailable}</p>}</section>
      <section className="sectionSpace" id="accesos" tabIndex={-1}><h2>{t('Accesos rápidos')}</h2><div className="quickGrid">{[{label:'Revisar cargas',id:'cargas',filter:'Por revisar'},{label:'Cargas activas',id:'cargas',filter:'Activas'},{label:'Choferes',id:'choferes'},{label:'Pagos pendientes',id:'pagos'},{label:'Resumen financiero',id:'finanzas'},{label:'Alertas e historial',id:'actividad'}].map(a=><button className="selectButton" key={a.label} onClick={()=>a.filter?viewLoads(a.filter):a.id==='choferes'?openFleet('drivers'):go(a.id)}>{t(a.label)} →</button>)}</div><p className="emptyState integrationNote">{t('Mensajería, combustible, contabilidad completa y gestión de cargas: pendientes de integración. Los accesos abren cada módulo en el panel derecho.')}</p></section>
      </> : <div className="moduleView">
        <p className="eyebrow">{t('MÓDULO')} {nav.find(item=>item.id===activeModule)?.icon} · M&A KING</p>
        <h1>{t(moduleNames[activeModule])}</h1>
        {activeModule==='cargas' ? <LoadsModule loads={loadsCtl} fleet={fleet} lang={lang} t={t} initialFilter={filter}/> : activeModule==='choferes' ? <FleetModule fleet={fleet} loads={data.loads} onOpenLoads={()=>go('cargas')} lang={lang} t={t} initialTab={fleetTab}/> : activeModule==='combustible' ? <FuelModule fuel={fuel} fleet={fleet} lang={lang} t={t}/> : <section className="panel sectionSpace"><div className="panelHeader"><div><h2>{t('Espacio del módulo')}</h2><p>{t('La navegación está lista. Las funciones de este módulo están pendientes de desarrollo.')}</p></div></div><p className="emptyState">{t(({finanzas:'Aquí se administrarán ingresos, pagos, deducciones y liquidaciones.',reportes:'Aquí se generarán y consultarán los reportes ya procesados de la compañía: semanales por chofer, cantidad y total de cargas, bruto, descuento del 6%, salario, combustible, non-fuel, seguro y ganancia final — además de reportes por grupo y el resumen semanal general.',comunicacion:'Mensajería interna de la compañía: conversaciones individuales y grupales, texto, notas de voz, fotos y archivos, con notificaciones de mensajes nuevos.',usuarios:'Aquí se configurarán usuarios, roles y permisos.'} as Record<string,string>)[activeModule])}</p></section>}
        <button className="selectButton sectionSpace" onClick={()=>go('dashboard')}>{t('← Volver al Dashboard')}</button>
      </div>}
    </section>}

<style jsx>{`

                :global(*) { box-sizing: border-box; }
                :global(html) { color-scheme: light; }
                :global(body) { margin: 0; background: linear-gradient(160deg,#150a0e 0%,#341722 32%,#4a1420 58%,#1c0d13 100%) fixed, radial-gradient(ellipse at 20% 0%, rgba(255,255,255,.10), transparent 55%) fixed; color: #30282A; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; }
                button { font: inherit; cursor: pointer; min-height: 44px; transition: background .15s; }
                button:focus-visible, .skipLink:focus-visible { outline: 3px solid #A85C6A; outline-offset: 4px; }
                .skipLink { position: fixed; top: -100px; left: 16px; z-index: 60; background: white; color: #6B1F2B; padding: 12px; }
                .skipLink:focus { top: 12px; }
                .shell { min-height: 100vh; }
                .srOnly { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }

                .edgeZone { position:fixed; top:0; left:0; width:20px; height:100vh; z-index:40; touch-action:none; }
                .drawerTab { position:fixed; top:18px; left:0; z-index:50; background:#6B1F2B; color:white; border:1px solid #A85C6A; border-left:0; border-radius:0 10px 10px 0; width:44px; height:44px; padding:0; display:grid; place-items:center; font-size:18px; box-shadow:2px 2px 10px #4A142022; transition:left 320ms cubic-bezier(.16,1,.3,1), background 220ms ease; }
                .drawerTab.isOpen { left:calc(min(300px,86vw) - 1px); }
                .drawerBackdrop { position:fixed; inset:0; background:rgba(20,8,12,.45); z-index:45; opacity:0; transition:opacity 280ms ease; }
                .drawerBackdrop.isOpen { opacity:1; }
                .drawer { position:fixed; top:0; left:0; height:100vh; width:min(300px,86vw); z-index:48; background:#4A1420; color:#EBD5DA; padding:30px 16px 24px; display:flex; flex-direction:column; overflow-y:auto; touch-action:none; transform:translateX(calc(-100% - 24px)); transition:transform 320ms cubic-bezier(.16,1,.3,1); box-shadow:6px 0 24px #4A142030; }
                .drawer.open { transform:translateX(0); }
                .brandButton { border:0; width:100%; cursor:pointer; }
                .brand { display: flex; gap: 12px; align-items: center; padding: 0 8px 40px; color: white; text-align:left; background:transparent; }
                .brandMark { flex: 0 0 44px; height: 44px; background: #6B1F2B; border: 1px solid #A85C6A; border-radius: 12px; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
                .brand strong, .brand span { display: block; }.brand strong { font-size: 20px; }.brand span { font-size: 11px; letter-spacing: 1.5px; color: #EBD5DA; }
                .workspaceLabel { color: #D8B7BF; font-size: 12px; letter-spacing: 1.5px; font-weight: 700; padding: 0 12px 12px; }
                .navList { display: grid; gap: 6px; }.navItem { border: 1px solid transparent; background: transparent; color: #EBD5DA; min-height: 48px; border-radius: 8px; text-align: left; padding: 10px 12px; display: flex; align-items: center; gap: 12px; font-size: 15px; white-space:normal; transition:background 220ms ease, color 220ms ease, border-color 220ms ease, transform 180ms ease; }.navItem:hover { background: #6B1F2B; color: white; }.navItem.active { background:#C5A46D; color:#3A2E14; border-color:#C5A46D; font-weight:700; box-shadow:0 2px 10px rgba(0,0,0,.2); }.navIcon { width: 20px; text-align: center; font-size: 13px !important; flex-shrink:0; }
                .sidebarBottom { margin-top: auto; padding-top: 40px; }.userRow { border-top: 1px solid #8F4F5B; padding-top: 20px; display: flex; align-items: center; gap: 10px; }.userRow strong, .userRow span { display: block; }.userRow strong { font-size: 14px; color: white; }.userRow span { font-size: 13px; color: #EBD5DA; }.avatar { background: #EBD5DA; color: #4A1420; flex: 0 0 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; }

                .content { max-width: 1920px; margin: 0 auto; padding: 0 clamp(20px, 3vw, 48px) 40px; animation:enterPanel 320ms ease-out; }
                .moduleView { padding-top:28px; }.moduleView>h1 { color:#fff; font-size:30px; margin:8px 0 12px; }.moduleView>.filterLabel { max-width:360px; }.moduleView .eyebrow { color:#E8B8C4; }
                .topbar { min-height: 80px; border-bottom: 1px solid rgba(255,255,255,.18); display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-left:56px; }.breadcrumb { color: #D8B7BF; font-size: 14px; display: flex; gap: 10px; flex-wrap: wrap; }.breadcrumb b { font-weight: 400; color:#D8B7BF; }.breadcrumb strong { color: #fff; }
                .backButton { border:0; background:transparent; color:#F0DEE3; font-size:14px; font-weight:700; padding:8px 10px; border-radius:8px; transition:background 180ms ease, color 180ms ease; }.backButton:disabled { color:#8F6B73; }
                .pageIntro { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 32px 0 24px; }.eyebrow { color: #6B1F2B; font-size: 12px; font-weight: 700; letter-spacing: 1.2px; margin: 0 0 10px; }.pageIntro h1 { margin: 0; font-size: clamp(26px, 2.3vw, 36px); line-height: 1.2; letter-spacing: -.8px; color: #4A1420; }.pageIntro h1 span { color: #8F4F5B; }.subtitle { color: #4A4640; font-size: 16px; margin: 10px 0 0; }
                .metricsGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 320px)); justify-content: center; gap: 22px; }.metricCard { background: white; padding: 26px; border: 1px solid #E3DADD; border-top: 3px solid #6B1F2B; border-radius: 12px; min-width: 0; text-align:left; }.metricTop { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #4A4640; font-size: 15px; font-weight: 700; }.metricCard > strong { display: block; margin: 14px 0 10px; color: #4A1420; font-size: 38px; line-height: 1.2; letter-spacing: -.6px; }.metricDelta { font-size: 15px; font-weight: 700; color: #6B1F2B; }.metricDelta em { display: inline-block; font-style: normal; font-weight: 400; color: #4A4640; }
                .metricBarTrack { height:56px; width:100%; background:#F7F5F3; border-radius:8px; display:flex; align-items:flex-end; overflow:hidden; margin:2px 0 12px; }.metricBarFill { width:100%; min-height:6px; border-radius:8px 8px 0 0; background:linear-gradient(180deg,#C5A46D,#6B1F2B); transition:height 500ms ease; }
                .panel { min-width: 0; background: #fff; border: 1px solid #E3DADD; border-radius: 12px; box-shadow: 0 3px 14px #4A142004; }.panelHeader { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 22px; }.panelHeader h2 { margin: 0; color: #4A1420; font-size: 20px; line-height: 1.3; }.panelHeader p { margin: 6px 0 0; color: #4A4640; font-size: 14px; }.textButton { border: 0; background: transparent; color: #6B1F2B; font-size: 14px; font-weight: 700; padding: 8px; border-radius:8px; transition:background 180ms ease; }.textButton:hover { background: #F5EBED; }.exitButton { border: 1px solid #E3DADD; background: #fff; color: #6B1F2B; font-size: 18px; font-weight: 700; width: 40px; height: 40px; min-height:40px; padding: 0; border-radius: 50%; display:grid; place-items:center; transition:background 180ms ease, border-color 180ms ease; }.exitButton:hover { background: #F5EBED; border-color:#C5A46D; }
                .alertCount { background: #F5EBED; color: #6B1F2B; border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
                .bottomGrid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; margin-top: 20px; }.selectButton { border: 1px solid #D6C6CB; color: #4A4640; background: white; border-radius: 8px; font-size: 14px; padding: 8px 12px; transition:background 200ms ease, border-color 200ms ease, color 200ms ease, transform 180ms ease; }.selectButton[aria-pressed=true] { background:#C5A46D; border-color:#C5A46D; color:#3A2E14; font-weight:700; }
                @media (max-width: 1200px) { .bottomGrid { grid-template-columns: 1fr; } }
                @media (max-width: 1000px) { .pageIntro { flex-wrap: wrap; } }
                @media (max-width: 760px) { .content { padding: 0 16px 28px; }.topbar { min-height: 64px; padding-left:52px; }.pageIntro { align-items: stretch; gap: 20px; flex-direction: column; padding: 24px 0; }.pageIntro h1 { font-size: 28px; }.eyebrow { font-size: 12px; letter-spacing: .7px; }.metricsGrid { gap: 8px; }.metricCard { padding: 10px; }.metricCard > strong { font-size: 20px; margin:6px 0 4px; }.metricTop { font-size:11px; }.metricDelta { font-size:11px; }.metricDelta em { display: block; }.metricBarTrack { height:32px; margin:4px 0 6px; }.panelHeader { padding: 18px 16px; } }
                @media (max-width: 380px) { .metricCard { padding: 8px; }.metricTop span { display:none; } }

                .metricCard { text-align:left; }.sectionSpace { margin-top:24px; scroll-margin-top:20px; }
                h2 { color:#fff; font-size:22px; }.sourceNotice { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:18px; border:1px solid #E3DADD; background:#fff; border-radius:12px; margin-bottom:20px; }.sourceNotice p { margin:4px 0 0; font-size:14px; color:#4A4640; }.sourceNotice button { flex-shrink:0; }
                .reviewBanner { display:flex; width:100%; align-items:center; justify-content:space-between; gap:24px; padding:26px; background:#6B1F2B; color:white; border:0; border-radius:14px; text-align:left; margin-bottom:24px; }.reviewBanner h2 { color:white; margin:8px 0; font-size:26px; }.reviewBanner p { margin:0; color:#F0DEE3; }.reviewBanner .eyebrow { color:#F0DEE3; }.reviewNumber { font-size:48px; font-weight:700; min-width:140px; }.reviewNumber span { display:block; font-size:15px; }
                .filterLabel { display:grid; gap:5px; font-size:14px; color:#4A4640; }select,input { font:inherit; min-height:44px; max-width:100%; padding:8px 12px; border:1px solid #D6C6CB; border-radius:8px; background:white; color:#4A1420; }select:focus-visible,input:focus-visible,summary:focus-visible { outline:3px solid #A85C6A; outline-offset:3px; }
                .statusGrid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; padding:0 22px 22px; }.statusGrid button { border:1px solid #E3DADD; border-radius:10px; padding:12px; background:#F7F5F3; color:#4A1420; transition:background 200ms ease, border-color 200ms ease, transform 180ms ease, box-shadow 200ms ease; }.statusGrid strong { display:block; font-size:26px; }.statusGrid span { font-size:14px; }
                .emptyState { color:#4A4640; padding:0 22px 22px; margin:8px 0 0; font-size:15px; }.detailNote { grid-column:1/-1; font-size:14px; color:#4A4640; background:#F7F5F3; padding:14px; border-radius:8px; }.financeNote { margin:0 22px 22px; }
                .panelLinkWrap { padding:0 22px 22px; }
                .driverSummary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.driverSummary div { padding:14px; border-radius:10px; background:#F7F5F3; }.driverSummary strong,.driverSummary span { display:block; }.driverSummary strong { font-size:24px; color:#4A1420; overflow-wrap:anywhere; }.driverSummary span { font-size:14px; color:#4A4640; }.plainList { list-style:none; padding:0 22px 16px; margin:0; }.plainList li { border-top:1px solid #E3DADD; display:flex; justify-content:space-between; gap:12px; padding:16px 0; font-size:15px; }.plainList span { color:#4A4640; }.plainList .alertLine { display:grid; gap:5px; }.plainList li button.alertLine { all:unset; display:grid; gap:5px; width:100%; min-height:0; cursor:pointer; }.plainList li button.alertLine:hover strong { color:#6B1F2B; }.activityScroll { max-height:400px; overflow-y:auto; }.activityScroll .plainList { padding-bottom:4px; }.attentionScroll { max-height:210px; overflow-y:auto; }.attentionScroll .plainList { padding-bottom:4px; }
                .financeGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.financeGrid>div { border:1px solid #E3DADD; border-radius:10px; padding:18px; }.financeGrid span,.financeGrid strong,.financeGrid small { display:block; }.financeGrid span { color:#4A4640; font-size:14px; }.financeGrid strong { font-size:28px; color:#4A1420; margin-top:6px; overflow-wrap:anywhere; }.financeGrid small { color:#4A4640; margin-top:6px; }.profit { background:#F5EBED; }.quickGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.quickGrid button { text-align:left; min-height:52px; }.integrationNote { padding:0; margin-top:16px; }
                @media(max-width:1200px) { .statusGrid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
                @media(max-width:760px) { .sourceNotice { align-items:stretch; flex-direction:column; }.reviewBanner { align-items:flex-start; flex-direction:column; padding:20px; gap:16px; }.reviewNumber { font-size:38px; }.reviewNumber span { display:inline; margin-left:18px; }.financeGrid,.quickGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }.statusGrid { padding:0 16px 16px; grid-template-columns:repeat(2,minmax(0,1fr)); }.plainList,.driverSummary,.financeGrid,.panelLinkWrap { padding-left:16px; padding-right:16px; }.plainList li { flex-wrap:wrap; }.financeGrid strong { font-size:23px; }.filterLabel { width:100%; }.financeNote { margin:0 16px 16px; } }
                @media(max-width:380px) { .financeGrid,.quickGrid,.driverSummary { grid-template-columns:1fr; }.reviewNumber span { display:block; margin:0; } }

                @keyframes enterPanel { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                @keyframes flipCard { 0% { transform:rotateY(0deg); } 100% { transform:rotateY(360deg); } }
                .pageIntro, .sourceNotice, .reviewBanner, .metricCard, .bottomGrid, .sectionSpace { animation:enterPanel 420ms ease-out backwards; }
                .sourceNotice { animation-delay:40ms; }.reviewBanner { animation-delay:80ms; }
                .metricCard:nth-child(1) { animation-delay:120ms; }.metricCard:nth-child(2) { animation-delay:170ms; }.metricCard:nth-child(3) { animation-delay:220ms; }
                .metricsGrid { perspective:900px; }
                .metricCard { position:relative; }
                button { transition:background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 180ms ease, color 200ms ease; }
                button:active { transform:scale(.985); }
                @media(hover:hover) and (pointer:fine) {
                  .quickGrid button:hover { transform:translateY(-3px) scale(1.03); border-color:#C5A46D; box-shadow:0 10px 24px #4A142018; z-index:1; }
                  .metricCard:hover { animation:flipCard 650ms ease-in-out; border-color:#C5A46D; box-shadow:0 16px 32px #4A142024; z-index:2; }
                  .reviewBanner:hover { transform:translateY(-2px) scale(1.01); background:#4A1420; box-shadow:0 8px 22px #4A142022; }
                  .heroCta:hover { background:#fff; transform:scale(1.04); }
                  .drawerTab:hover { background:#4A1420; transform:scale(1.08); }
                  .navItem:hover { transform:scale(1.03); }
                  .statusGrid button:hover { transform:scale(1.05); border-color:#C5A46D; box-shadow:0 6px 16px #4A142014; z-index:1; }
                  .selectButton:hover:not([aria-pressed=true]) { transform:scale(1.05); border-color:#C5A46D; box-shadow:0 6px 14px #4A142012; }
                  .backButton:hover { background:#F5EBED; }
                }
                button:active { background-color:#C5A46D22; }
                @media(prefers-reduced-motion:reduce) {
                  *, *::before, *::after { animation:none !important; transition:none !important; }
                  button:hover, button:active { transform:none !important; }
                }

                .pageIntro { position:relative; isolation:isolate; overflow:hidden; min-height:420px; margin:24px 0; padding:32px; border-radius:16px; background:#24171D; }
                .pageIntro::before { content:""; position:absolute; inset:0; z-index:-2; background:url('/driver-night.png') center 42% / cover no-repeat; }
                .pageIntro::after { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(180deg,rgba(20,10,14,.05) 0%,rgba(20,10,14,.1) 70%,rgba(20,10,14,.55) 100%); }
                .pageIntroTag { position:absolute; top:20px; right:24px; color:#F1CDD5; font-size:12px; font-weight:700; letter-spacing:1.2px; background:rgba(0,0,0,.35); padding:7px 14px; border-radius:20px; }
                .pageIntroNotice { position:absolute; left:50%; top:50%; right:auto; bottom:auto; transform:translate(-50%,-50%); margin:0; background:transparent; border:0; padding:0; flex-direction:column; text-align:center; gap:14px; max-width:min(560px,80%); }
                .pageIntroNotice strong { color:#fff; font-size:22px; text-shadow:0 2px 10px rgba(0,0,0,.65); }.pageIntroNotice p { color:#F1CDD5; text-shadow:0 1px 6px rgba(0,0,0,.65); }
                @media(max-width:760px) { .pageIntro { min-height:280px; padding:24px; justify-content:flex-start; }.pageIntro::before { background-position:70% 30%; }.pageIntroTag { top:16px; right:16px; font-size:11px; padding:6px 12px; }.pageIntroNotice strong { font-size:18px; } }

                .pageIntro h1 { font-size:clamp(32px,4vw,52px); font-weight:800; letter-spacing:1px; line-height:1.08; }
                @media(max-width:760px) { .pageIntro h1 { font-size:34px; }.pageIntro .eyebrow { font-size:12px; letter-spacing:.6px; } }

                /* Pantalla de bienvenida a pantalla completa (antes de elegir un módulo) */
                .landingHero { position:relative; isolation:isolate; min-height:100dvh; display:flex; align-items:center; padding:0 clamp(24px,6vw,72px); }
                .landingHero::before { content:""; position:absolute; inset:0; z-index:-2; background:url('/truck-dusk.png') center 59% / cover no-repeat; }
                .landingHero::after { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg,rgba(32,13,22,.95) 0%,rgba(40,15,24,.85) 42%,rgba(40,15,24,.25) 75%,rgba(40,15,24,.08) 100%); }
                .landingHeroInner { max-width:640px; animation:enterPanel 520ms ease-out; }
                .landingHeroInner .eyebrow { color:#F1CDD5; }
                .landingHeroInner h1 { color:#fff; font-size:clamp(40px,6vw,72px); font-weight:800; letter-spacing:1px; line-height:1.05; margin:0; }
                .landingHeroInner .heroGreeting { color:white; font-size:20px; margin:18px 0 0; }
                .landingHeroInner .subtitle { color:#F4E9ED; font-size:16px; margin-top:8px; }
                .heroCta { margin-top:32px; border:0; background:#EBD5DA; color:#4A1420; padding:14px 26px; border-radius:12px; font-weight:700; font-size:16px; box-shadow:0 8px 24px rgba(0,0,0,.2); transition:background 200ms ease, transform 180ms ease; }
                .heroHint { color:#D8B7BF; font-size:13px; margin-top:18px; }
                @media(max-width:760px) { .landingHero { padding:0 20px 64px; align-items:flex-end; } .landingHero::before { background-position:76% 64%; } .landingHeroInner h1 { font-size:44px; } }
`}</style>
</main>;
}
