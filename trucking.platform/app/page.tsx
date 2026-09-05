"use client";

import { useEffect, useRef, useState } from "react";
import { emptySnapshot, summarize, type LoadStatus } from "../lib/dashboard";
import { demoSnapshot } from "../lib/dashboard-demo";
import { useFleet } from "../lib/use-fleet";
import { fleetAlerts, driverStatus, DRIVER_STATUS_VALUES } from "../lib/fleet";
import { money, dateLabel, today } from "../lib/format";
import FleetModule from "./fleet-module";

const statuses: LoadStatus[] = ['Programado','Cargando','En tránsito','Entregada','Cancelada','Reemplazada'];
const nav = [
  {name:'Dashboard',id:'dashboard',icon:'01'},
  {name:'Cargas y Operaciones',id:'cargas',icon:'02'},
  {name:'Choferes y Flota',id:'choferes',icon:'03'},
  {name:'Combustible y Gastos',id:'combustible',icon:'04'},
  {name:'Contabilidad y Pagos',id:'finanzas',icon:'05'},
  {name:'Reportes',id:'reportes',icon:'06'},
  {name:'Comunicación',id:'comunicacion',icon:'07'},
  {name:'Usuarios y Permisos',id:'usuarios',icon:'08'},
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
  const [demo,setDemo] = useState(false);
  const [week,setWeek] = useState('');
  const [filter,setFilter] = useState('Activas');
  const fleet = useFleet();
  const fleetReady = demo || fleet.ready;
  const data = demo ? demoSnapshot : {
    ...emptySnapshot,
    drivers: fleet.state.drivers.map(d=>({id:d.id,name:d.name,status:driverStatus(d)})),
    alerts: fleet.ready ? fleetAlerts(fleet.state,today()) : [],
    activity: fleet.state.events.map(e=>({id:e.id,at:e.at,actor:e.actor,detail:e.detail})),
  };
  const start = week || (demo ? '2026-08-31' : currentWeek());
  const summary = summarize(data,start,weekEnd(start));
  const value = (n:number, currency=false) => data.connected ? currency ? money(n) : n : '—';
  const shownLoads = filter === 'Por revisar' ? summary.review : filter === 'Activas' ? summary.active : filter === 'Todas' ? data.loads : summary.official.filter(l=>l.status===filter);
  const alerts = [...data.alerts,
    ...summary.review.map(l=>({id:`review-${l.id}`,title:'Carga por revisar',detail:`${l.id} · ${l.source} · Requiere aprobación humana`})),
    ...summary.official.filter(l=>l.missingPod).map(l=>({id:`pod-${l.id}`,title:'Falta POD',detail:`${l.id} · Documento de entrega pendiente`})),
    ...summary.official.filter(l=>['Cancelada','Reemplazada'].includes(l.status)).map(l=>({id:`cancel-${l.id}`,title:`Carga ${l.status.toLowerCase()}`,detail:`${l.id}${l.replacedBy ? ` · Relacionada con ${l.replacedBy}` : ''}`})),
    ...summary.payments.map(p=>({id:`payment-${p.id}`,title:'Pago pendiente',detail:`${p.id} · ${p.direction} ${money(p.amount-p.paid)} · Vence ${p.due}`}))];
  const moduleNames: Record<string,string> = Object.fromEntries(nav.map(item=>[item.id,item.name]));
  const metricCards = [
    {label:'Cargas activas',amount:summary.active.length,hint:'Oficiales, aún en operación',action:()=>viewLoads('Activas')},
    {label:'En tránsito',amount:summary.official.filter(l=>l.status==='En tránsito').length,hint:'Parte de las cargas activas',action:()=>viewLoads('En tránsito')},
    {label:'Pagos pendientes',amount:summary.payments.length,hint:'Por cobrar y por pagar',action:()=>go('pagos')},
    {label:'Choferes activos',amount:data.drivers.filter(d=>d.status!=='Inactivo').length,hint:'Incluye servicio, descanso y disponibles',action:()=>go('choferes')},
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

  function go(id:string) {
    const target = id==='pagos'?'finanzas':['alertas','actividad'].includes(id)?'dashboard':id;
    setActiveModule(target); setDrawerOpen(false);
    requestAnimationFrame(()=>{
      const element = document.getElementById(['alertas','actividad'].includes(id)?id:'main-content');
      element?.scrollIntoView({behavior:'instant',block:'start'});
      element?.focus({preventScroll:true});
    });
  }
  function viewLoads(next:string) {setFilter(next); go('cargas');}
  const unavailable = 'Pendiente de conexión. Aquí aparecerá la información del módulo correspondiente.';
  return <main className="shell">
    <a className="skipLink" href="#main-content">Saltar al contenido</a>

    <div className="edgeZone" onPointerDown={onEdgePointerDown} aria-hidden="true" />
    <button className={`drawerTab ${drawerOpen?'isOpen':''}`} aria-expanded={drawerOpen} aria-controls="main-navigation" onClick={()=>setDrawerOpen(o=>!o)}>
      <span aria-hidden="true">{drawerOpen?'✕':'☰'}</span><span className="srOnly">{drawerOpen?'Cerrar menú':'Abrir menú'}</span>
    </button>
    {(drawerOpen||dragOffset!==null) && <div className={`drawerBackdrop ${drawerOpen?'isOpen':''}`} onClick={()=>setDrawerOpen(false)} />}
    <aside ref={drawerRef} className={`drawer ${drawerOpen?'open':''}`} style={dragOffset!==null?{transform:`translateX(${dragOffset}px)`,transition:'none'}:undefined} onPointerDown={onDrawerPointerDown}>
      <button className="brand brandButton" onClick={()=>{setActiveModule(null);setDrawerOpen(false);}}><div className="brandMark">M&A</div><div><strong>M&A King</strong><span>TRUCK SERVICE</span></div></button>
      <div className="workspaceLabel">OPERACIONES</div>
      <nav id="main-navigation" className="navList" aria-label="Navegación principal">{nav.map(item=><button key={item.id} className={`navItem ${activeModule===item.id?'active':''}`} aria-current={activeModule===item.id?'page':undefined} onClick={()=>go(item.id)}><span className="navIcon" aria-hidden="true">{item.icon}</span>{item.name}</button>)}</nav>
      <div className="sidebarBottom"><div className="userRow"><div className="avatar">AT</div><div><strong>Adianez Tang</strong><span>Panel principal</span></div></div></div>
    </aside>

    {activeModule===null ? <section className="landingHero" id="main-content" tabIndex={-1}>
      <div className="landingHeroInner">
        <p className="eyebrow">TRUCK SERVICE · PANEL PRINCIPAL</p>
        <h1>M&amp;A KING</h1>
        <p className="heroGreeting">Hola, Adianez Tang</p>
        <p className="subtitle">Tus cargas, tu equipo y tus números en un solo lugar.</p>
        <button className="heroCta" onClick={()=>setDrawerOpen(true)}>☰ Ver módulos</button>
        <p className="heroHint">Desliza desde el borde izquierdo, o toca el botón, para abrir el menú.</p>
      </div>
    </section> : <section className="content" id="main-content" tabIndex={-1} key={activeModule}>
      <header className="topbar"><div className="breadcrumb"><span>trucking.platform</span><b>/</b><strong>{moduleNames[activeModule]}</strong></div><button className="textButton" onClick={()=>go('alertas')}>Alertas {fleetReady?`(${alerts.length})`:''}</button></header>
      {activeModule==='dashboard' ? <>
      <div className="pageIntro"><div><p className="eyebrow">TRUCK SERVICE</p><h1>M&amp;A KING</h1></div></div>
      <div className={`sourceNotice ${demo?'exampleNotice':''}`} role="status"><div><strong>{demo?'Vista de ejemplo · No son datos de tu compañía':fleet.ready?'Flota conectada':'Cargando registros de flota'}</strong><p>{demo?'Los ejemplos no se guardan ni permiten aprobar cargas reales.':'Choferes, alertas e historial provienen del Módulo 3. Cargas y finanzas siguen pendientes de conexión.'}</p></div><button className="selectButton" aria-pressed={demo} onClick={()=>{setDemo(!demo);setWeek('');setFilter('Activas');}}>{demo?'Salir del ejemplo':'Ver ejemplo'}</button></div>
      <button className="reviewBanner" onClick={()=>viewLoads('Por revisar')}><div><span className="eyebrow">TU APROBACIÓN ES NECESARIA</span><h2>Cargas por revisar</h2><p>La IA prepara. Tú revisas y confirmas antes de que sean oficiales.</p></div><div className="reviewNumber">{value(summary.review.length)}<span>Revisar cargas →</span></div></button>
      <div className="metricsGrid">{metricCards.map(card=>{
        const shown = card.label==='Choferes activos' ? (fleetReady?card.amount:null) : (data.connected?card.amount:null);
        const pct = shown===null ? 30 : Math.max(12,Math.round((card.amount/maxMetric)*100));
        return <button className="metricCard" key={card.label} onClick={card.action}>
          <div className="metricTop">{card.label}<span aria-hidden="true">↗</span></div>
          <strong>{shown===null?'—':shown}</strong>
          <div className="metricBarTrack"><div className="metricBarFill" style={{height:`${pct}%`}}/></div>
          <div className="metricDelta"><em>{card.hint}</em></div>
        </button>;
      })}</div>
      <section className="panel sectionSpace" id="cargas" tabIndex={-1}>
        <div className="panelHeader"><div><h2>Resumen de cargas</h2><p>Estado actual · Las pendientes están separadas de las oficiales.</p></div><label className="filterLabel">Mostrar<select value={filter} onChange={e=>setFilter(e.target.value)}>{['Activas','Por revisar','Todas',...statuses].map(s=><option key={s}>{s}</option>)}</select></label></div>
        <div className="statusGrid">{statuses.map(status=><button key={status} aria-pressed={filter===status} onClick={()=>setFilter(status)}><strong>{value(summary.official.filter(l=>l.status===status).length)}</strong><span>{status==='Programado'?'Próximas a recoger':status}</span></button>)}</div>
        {shownLoads.length ? <div className="loadList" key={`${demo}-${filter}`}>{shownLoads.map(load=><details key={load.id} className="loadRow"><summary><span><strong>{load.id}</strong><span className="cellMuted">{load.route}</span></span><span className="status statusTransit">{summary.review.includes(load)?'Por revisar':load.status}</span><span className="detailToggle"><span className="closedLabel">Ver detalle</span><span className="openLabel">Cerrar detalle</span> <span className="detailArrow" aria-hidden="true">↓</span></span></summary><div className="loadDetails"><p><b>Chofer:</b> {data.drivers.find(d=>d.id===load.driverId)?.name||'Sin asignar'}</p><p><b>Unidad:</b> {load.truck}</p><p><b>Fecha prevista:</b> {dateLabel(load.eta)}</p><p><b>Broker:</b> {load.broker||'Pendiente de completar'}</p><p><b>Precio:</b> {load.amount===undefined?'Pendiente de completar':money(load.amount)}</p><p><b>Preparada por:</b> {load.source}</p><p><b>Aprobación:</b> {load.approvedBy?`${load.approvedBy} · ${dateLabel(load.approvedAt!)}`:'Pendiente de aprobación humana'}</p>{load.replacedBy&&<p><b>Carga relacionada:</b> {load.replacedBy}</p>}<p className="detailNote">{demo?'Registro de ejemplo. ':''}Aprobar, corregir o rechazar corresponde a Cargas y Operaciones, pendiente de integración. Este panel no confirma cargas.</p></div></details>)}</div>:<p className="emptyState">{data.connected?'No hay cargas en este estado.':unavailable}</p>}
      </section>
      <div className="bottomGrid">
        <section className="panel" id="choferes" tabIndex={-1}><div className="panelHeader"><div><h2>Estado de choferes</h2><p>Activo no significa disponible para una carga.</p></div></div><div className="driverSummary">{DRIVER_STATUS_VALUES.map(s=><div key={s}><strong>{fleetReady?data.drivers.filter(d=>d.status===s).length:'—'}</strong><span>{s}</span></div>)}</div>{data.drivers.length?<div className="panelLinkWrap"><button className="selectButton" onClick={()=>go('choferes')}>Ver todos los choferes →</button></div>:<p className="emptyState">{fleetReady?'Todavía no hay choferes registrados.':unavailable}</p>}</section>
        <section className="panel" id="alertas" tabIndex={-1}><div className="panelHeader"><div><h2>Requiere atención</h2><p>Revisión, documentos, pagos y operación.</p></div><span className="alertCount">{fleetReady?alerts.length:'—'}</span></div>{alerts.length?<ul className="plainList">{alerts.map(a=><li key={a.id} className="alertLine"><strong>{a.title}</strong><span>{a.detail}</span></li>)}</ul>:<p className="emptyState">{fleetReady?'No hay alertas de flota. Las demás fuentes están pendientes.':unavailable}</p>}</section>
      </div>
      <section className="panel sectionSpace" id="finanzas" tabIndex={-1}><div className="panelHeader"><div><h2>Resumen financiero</h2><p>Semana desde {start} · USD · Zona horaria de Chicago</p></div><label className="filterLabel">Semana desde<input type="date" value={start} onChange={e=>setWeek(e.target.value)}/></label></div><div className="financeGrid">{[['Total bruto',summary.gross],['Fuel',summary.fuel],['Non-Fuel',summary.nonFuel],['Salarios',summary.salaries]].map(([label,n])=><div key={label}><span>{label}</span><strong>{value(Number(n),true)}</strong></div>)}<div><span>Otros gastos y ajustes</span><strong>—</strong></div><div className="profit"><span>Ganancia estimada</span><strong>—</strong><small>Pendiente de reglas contables completas</small></div></div><p className="detailNote financeNote">El bruto no equivale a dinero cobrado. Los seguros, el 6%, descuentos y ajustes se integrarán desde contabilidad antes de mostrar una ganancia. Las cargas pendientes no generan ingresos oficiales.</p></section>
      <section className="panel sectionSpace" id="pagos" tabIndex={-1}><div className="panelHeader"><div><h2>Pagos pendientes</h2><p>Saldos abiertos de todos los períodos, después de pagos parciales.</p></div></div><div className="driverSummary"><div><span>Por cobrar</span><strong>{value(summary.receivable,true)}</strong></div><div><span>Por pagar</span><strong>{value(summary.payable,true)}</strong></div></div>{summary.payments.length?<ul className="plainList">{summary.payments.map(p=><li key={p.id}><strong>{p.id} · {p.direction}</strong><span>{money(p.amount-p.paid)} · Vence {p.due}</span></li>)}</ul>:<p className="emptyState">{data.connected?'No hay pagos pendientes.':unavailable}</p>}</section>
      <section className="panel sectionSpace" id="actividad" tabIndex={-1}><div className="panelHeader"><div><h2>Actividad reciente</h2><p>Quién hizo cada cambio y cuándo.</p></div></div>{data.activity.length?<ol className="plainList">{[...data.activity].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,10).map(a=><li key={a.id} className="alertLine"><strong>{a.detail}</strong><span>{dateLabel(a.at)} · {a.actor}</span></li>)}</ol>:<p className="emptyState">{fleetReady?'Todavía no hay actividad de flota.':unavailable}</p>}</section>
      <section className="sectionSpace" id="accesos" tabIndex={-1}><h2>Accesos rápidos</h2><div className="quickGrid">{[{label:'Revisar cargas',id:'cargas',filter:'Por revisar'},{label:'Cargas activas',id:'cargas',filter:'Activas'},{label:'Choferes',id:'choferes'},{label:'Pagos pendientes',id:'pagos'},{label:'Resumen financiero',id:'finanzas'},{label:'Alertas e historial',id:'actividad'}].map(a=><button className="selectButton" key={a.label} onClick={()=>a.filter?viewLoads(a.filter):go(a.id)}>{a.label} →</button>)}</div><p className="emptyState integrationNote">Mensajería, combustible, contabilidad completa y gestión de cargas: pendientes de integración. Los accesos abren cada módulo en el panel derecho.</p></section>
      </> : <div className="moduleView">
        <p className="eyebrow">MÓDULO {nav.find(item=>item.id===activeModule)?.icon} · M&A KING</p>
        <h1>{moduleNames[activeModule]}</h1>
        {activeModule==='cargas' ? <>
          <p>Revisión y seguimiento de las cargas de la compañía.</p>
          <div className="sourceNotice"><div><strong>{demo?'Vista de ejemplo':'Módulo en preparación'}</strong><p>La gestión y aprobación de cargas todavía no están conectadas. La IA prepara; la aprobación final es humana.</p></div><button className="selectButton" onClick={()=>setDemo(!demo)}>{demo?'Salir del ejemplo':'Ver ejemplo'}</button></div>
          <label className="filterLabel">Mostrar cargas<select value={filter} onChange={e=>setFilter(e.target.value)}>{['Activas','Por revisar','Todas',...statuses].map(s=><option key={s}>{s}</option>)}</select></label>
          <section className="panel sectionSpace"><div className="panelHeader"><h2>{filter==='Por revisar'?'Cargas por revisar':'Listado de cargas'}</h2><span>{data.connected?shownLoads.length:'—'}</span></div>
          {shownLoads.length?shownLoads.map(load=><details className="loadRow" key={load.id}><summary><span><strong>{load.id}</strong><span className="cellMuted">{load.route}</span></span><span className="status statusTransit">{summary.review.includes(load)?'Por revisar':load.status}</span></summary><div className="loadDetails"><p><b>Chofer:</b> {data.drivers.find(d=>d.id===load.driverId)?.name||'Sin asignar'}</p><p><b>Unidad:</b> {load.truck}</p><p><b>Broker:</b> {load.broker||'Pendiente'}</p><p><b>Precio:</b> {load.amount===undefined?'Pendiente':money(load.amount)}</p><p><b>Fecha prevista:</b> {dateLabel(load.eta)}</p><p><b>Aprobación:</b> {load.approval}</p>{load.replacedBy&&<p><b>Reemplazo:</b> {load.replacedBy}</p>}</div></details>):<p className="emptyState">{data.connected?'No hay cargas en este estado.':'Aquí aparecerán tus cargas cuando se conecte el registro operativo.'}</p>}</section>
        </> : activeModule==='choferes' ? <FleetModule fleet={fleet} loads={emptySnapshot.loads} onOpenLoads={()=>go('cargas')}/> : <section className="panel sectionSpace"><div className="panelHeader"><div><h2>Espacio del módulo</h2><p>La navegación está lista. Las funciones de este módulo están pendientes de desarrollo.</p></div></div><p className="emptyState">{({choferes:'Aquí se organizarán los choferes, camiones, trailers y asignaciones.',combustible:'Aquí se registrarán Fuel, Non-Fuel y gastos operativos.',finanzas:'Aquí se administrarán ingresos, pagos, deducciones y liquidaciones.',reportes:'Aquí se consultarán reportes basados en los datos de los demás módulos.',comunicacion:'Aquí estarán las conversaciones y documentos de la operación.',usuarios:'Aquí se configurarán usuarios, roles y permisos.'} as Record<string,string>)[activeModule]}</p></section>}
        <button className="selectButton sectionSpace" onClick={()=>go('dashboard')}>← Volver al Dashboard</button>
      </div>}
    </section>}

<style jsx>{`

                :global(*) { box-sizing: border-box; }
                :global(html) { color-scheme: light; }
                :global(body) { margin: 0; background: #F7F5F3; color: #30282A; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; }
                button { font: inherit; cursor: pointer; min-height: 44px; transition: background .15s; }
                button:focus-visible, .skipLink:focus-visible { outline: 3px solid #A85C6A; outline-offset: 4px; }
                .skipLink { position: fixed; top: -100px; left: 16px; z-index: 60; background: white; color: #6B1F2B; padding: 12px; }
                .skipLink:focus { top: 12px; }
                .shell { min-height: 100vh; }
                .srOnly { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }

                .edgeZone { position:fixed; top:0; left:0; width:20px; height:100vh; z-index:40; touch-action:none; }
                .drawerTab { position:fixed; top:18px; left:0; z-index:50; background:#6B1F2B; color:white; border:1px solid #A85C6A; border-left:0; border-radius:0 10px 10px 0; width:44px; height:44px; padding:0; display:grid; place-items:center; font-size:18px; box-shadow:2px 2px 10px #4A142022; transition:left 320ms cubic-bezier(.16,1,.3,1); }
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
                .navList { display: grid; gap: 6px; }.navItem { border: 0; background: transparent; color: #EBD5DA; min-height: 48px; border-radius: 8px; text-align: left; padding: 10px 12px; display: flex; align-items: center; gap: 12px; font-size: 15px; white-space:normal; }.navItem:hover, .navItem.active { background: #6B1F2B; color: white; }.navItem.active { box-shadow: inset 3px 0 #E5B7C2; }.navIcon { width: 20px; text-align: center; font-size: 13px !important; flex-shrink:0; }
                .sidebarBottom { margin-top: auto; padding-top: 40px; }.userRow { border-top: 1px solid #8F4F5B; padding-top: 20px; display: flex; align-items: center; gap: 10px; }.userRow strong, .userRow span { display: block; }.userRow strong { font-size: 14px; color: white; }.userRow span { font-size: 13px; color: #EBD5DA; }.avatar { background: #EBD5DA; color: #4A1420; flex: 0 0 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; }

                .content { max-width: 1920px; margin: 0 auto; padding: 0 clamp(20px, 3vw, 48px) 40px; animation:enterPanel 320ms ease-out; }
                .moduleView { padding-top:28px; }.moduleView>h1 { color:#4A1420; font-size:30px; margin:8px 0 12px; }.moduleView>.filterLabel { max-width:360px; }
                .topbar { min-height: 80px; border-bottom: 1px solid #E3DADD; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-left:56px; }.breadcrumb { color: #6D6064; font-size: 14px; display: flex; gap: 10px; flex-wrap: wrap; }.breadcrumb b { font-weight: 400; }.breadcrumb strong { color: #4A1420; }
                .pageIntro { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 32px 0 24px; }.eyebrow { color: #6B1F2B; font-size: 12px; font-weight: 700; letter-spacing: 1.2px; margin: 0 0 10px; }.pageIntro h1 { margin: 0; font-size: clamp(26px, 2.3vw, 36px); line-height: 1.2; letter-spacing: -.8px; color: #4A1420; }.pageIntro h1 span { color: #8F4F5B; }.subtitle { color: #6D6064; font-size: 16px; margin: 10px 0 0; }
                .metricsGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }.metricCard { background: white; padding: 20px; border: 1px solid #E3DADD; border-top: 3px solid #6B1F2B; border-radius: 12px; min-width: 0; text-align:left; }.metricTop { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #6D6064; font-size: 14px; font-weight: 700; }.metricCard > strong { display: block; margin: 12px 0 8px; color: #4A1420; font-size: 32px; line-height: 1.2; letter-spacing: -.6px; }.metricDelta { font-size: 14px; font-weight: 700; color: #6B1F2B; }.metricDelta em { display: inline-block; font-style: normal; font-weight: 400; color: #6D6064; }
                .metricBarTrack { height:56px; width:100%; background:#F7F5F3; border-radius:8px; display:flex; align-items:flex-end; overflow:hidden; margin:2px 0 12px; }.metricBarFill { width:100%; min-height:6px; border-radius:8px 8px 0 0; background:linear-gradient(180deg,#A85C6A,#6B1F2B); transition:height 500ms ease; }
                .panel { min-width: 0; background: #fff; border: 1px solid #E3DADD; border-radius: 12px; box-shadow: 0 3px 14px #4A142004; }.panelHeader { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 22px; }.panelHeader h2 { margin: 0; color: #4A1420; font-size: 20px; line-height: 1.3; }.panelHeader p { margin: 6px 0 0; color: #6D6064; font-size: 14px; }.textButton { border: 0; background: transparent; color: #6B1F2B; font-size: 14px; font-weight: 700; padding: 8px; }.textButton:hover { background: #F5EBED; border-radius: 8px; }.cellMuted { display: block; color: #6D6064; font-size: 13px; margin-top: 5px; }.status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; border-radius: 8px; padding: 5px 8px; }.statusTransit { color: #6B1F2B; background: #F5EBED; }
                .alertCount { background: #F5EBED; color: #6B1F2B; border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
                .bottomGrid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; margin-top: 20px; }.selectButton { border: 1px solid #D6C6CB; color: #554A4E; background: white; border-radius: 8px; font-size: 14px; padding: 8px 12px; }
                @media (max-width: 1200px) { .bottomGrid { grid-template-columns: 1fr; } }
                @media (max-width: 1000px) { .pageIntro { flex-wrap: wrap; } }
                @media (max-width: 760px) { .content { padding: 0 16px 28px; }.topbar { min-height: 64px; padding-left:52px; }.pageIntro { align-items: stretch; gap: 20px; flex-direction: column; padding: 24px 0; }.pageIntro h1 { font-size: 28px; }.eyebrow { font-size: 12px; letter-spacing: .7px; }.metricsGrid { gap: 8px; }.metricCard { padding: 10px; }.metricCard > strong { font-size: 20px; margin:6px 0 4px; }.metricTop { font-size:11px; }.metricDelta { font-size:11px; }.metricDelta em { display: block; }.metricBarTrack { height:32px; margin:4px 0 6px; }.panelHeader { padding: 18px 16px; } }
                @media (max-width: 380px) { .metricCard { padding: 8px; }.metricTop span { display:none; } }

                .metricCard { text-align:left; }.sectionSpace { margin-top:24px; scroll-margin-top:20px; }
                h2 { color:#4A1420; font-size:22px; }.sourceNotice { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:18px; border:1px solid #E3DADD; background:#fff; border-radius:12px; margin-bottom:20px; }.sourceNotice p { margin:4px 0 0; font-size:14px; color:#6D6064; }.sourceNotice button { flex-shrink:0; }.exampleNotice { background:#fff7e8; border-color:#D7B676; }
                .reviewBanner { display:flex; width:100%; align-items:center; justify-content:space-between; gap:24px; padding:26px; background:#6B1F2B; color:white; border:0; border-radius:14px; text-align:left; margin-bottom:24px; }.reviewBanner h2 { color:white; margin:8px 0; font-size:26px; }.reviewBanner p { margin:0; color:#F0DEE3; }.reviewBanner .eyebrow { color:#F0DEE3; }.reviewNumber { font-size:48px; font-weight:700; min-width:140px; }.reviewNumber span { display:block; font-size:15px; }
                .filterLabel { display:grid; gap:5px; font-size:14px; color:#554A4E; }select,input { font:inherit; min-height:44px; max-width:100%; padding:8px 12px; border:1px solid #D6C6CB; border-radius:8px; background:white; color:#4A1420; }select:focus-visible,input:focus-visible,summary:focus-visible { outline:3px solid #A85C6A; outline-offset:3px; }
                .statusGrid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; padding:0 22px 22px; }.statusGrid button { border:1px solid #E3DADD; border-radius:10px; padding:12px; background:#F7F5F3; color:#4A1420; }.statusGrid button[aria-pressed=true] { background:#F5EBED; border-color:#6B1F2B; }.statusGrid strong { display:block; font-size:26px; }.statusGrid span { font-size:14px; }
                .emptyState { color:#6D6064; padding:0 22px 22px; margin:8px 0 0; font-size:15px; }.loadRow { border-top:1px solid #E3DADD; }.loadRow summary { cursor:pointer; padding:20px 22px; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; }.loadRow summary>span:first-child { flex:1; }.loadDetails { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px 20px; padding:0 22px 20px; overflow-wrap:anywhere; }.loadDetails p { margin:8px 0; }.detailNote { grid-column:1/-1; font-size:14px; color:#6D6064; background:#F7F5F3; padding:14px; border-radius:8px; }.financeNote { margin:0 22px 22px; }
                .panelLinkWrap { padding:0 22px 22px; }
                .driverSummary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.driverSummary div { padding:14px; border-radius:10px; background:#F7F5F3; }.driverSummary strong,.driverSummary span { display:block; }.driverSummary strong { font-size:24px; color:#4A1420; overflow-wrap:anywhere; }.driverSummary span { font-size:14px; color:#6D6064; }.plainList { list-style:none; padding:0 22px 16px; margin:0; }.plainList li { border-top:1px solid #E3DADD; display:flex; justify-content:space-between; gap:12px; padding:16px 0; font-size:15px; }.plainList span { color:#6D6064; }.plainList .alertLine { display:grid; gap:5px; }
                .financeGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.financeGrid>div { border:1px solid #E3DADD; border-radius:10px; padding:18px; }.financeGrid span,.financeGrid strong,.financeGrid small { display:block; }.financeGrid span { color:#6D6064; font-size:14px; }.financeGrid strong { font-size:28px; color:#4A1420; margin-top:6px; overflow-wrap:anywhere; }.financeGrid small { color:#6D6064; margin-top:6px; }.profit { background:#F5EBED; }.quickGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.quickGrid button { text-align:left; min-height:52px; }.integrationNote { padding:0; margin-top:16px; }
                @media(max-width:1200px) { .statusGrid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
                @media(max-width:760px) { .sourceNotice { align-items:stretch; flex-direction:column; }.reviewBanner { align-items:flex-start; flex-direction:column; padding:20px; gap:16px; }.reviewNumber { font-size:38px; }.reviewNumber span { display:inline; margin-left:18px; }.financeGrid,.quickGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }.loadRow summary { flex-wrap:wrap; padding:18px 16px; }.loadRow summary>span:first-child { flex-basis:100%; }.loadDetails { grid-template-columns:1fr; padding:0 16px 16px; }.statusGrid { padding:0 16px 16px; grid-template-columns:repeat(2,minmax(0,1fr)); }.plainList,.driverSummary,.financeGrid,.panelLinkWrap { padding-left:16px; padding-right:16px; }.plainList li { flex-wrap:wrap; }.financeGrid strong { font-size:23px; }.filterLabel { width:100%; }.financeNote { margin:0 16px 16px; } }
                @media(max-width:380px) { .financeGrid,.quickGrid,.driverSummary { grid-template-columns:1fr; }.reviewNumber span { display:block; margin:0; } }

                @keyframes enterPanel { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                @keyframes revealDetail { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
                @keyframes flipCard { 0% { transform:rotateY(0deg); } 100% { transform:rotateY(360deg); } }
                .pageIntro, .sourceNotice, .reviewBanner, .metricCard, .bottomGrid, .sectionSpace { animation:enterPanel 420ms ease-out backwards; }
                .sourceNotice { animation-delay:40ms; }.reviewBanner { animation-delay:80ms; }
                .metricCard:nth-child(1) { animation-delay:120ms; }.metricCard:nth-child(2) { animation-delay:170ms; }.metricCard:nth-child(3) { animation-delay:220ms; }.metricCard:nth-child(4) { animation-delay:270ms; }
                .metricsGrid { perspective:900px; }
                .metricCard { position:relative; }
                button, .loadRow summary { transition:background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease; }
                .loadList { animation:enterPanel 240ms ease-out; }
                .loadRow[open] .loadDetails { animation:revealDetail 240ms ease-out; }
                .detailToggle { color:#6D6064; font-size:14px; }.detailArrow { display:inline-block; transition:transform 220ms ease; }
                .openLabel { display:none; }.loadRow[open] .closedLabel { display:none; }.loadRow[open] .openLabel { display:inline; }.loadRow[open] .detailArrow { transform:rotate(180deg); }
                .loadRow[open] summary { background:#F5EBED; }
                button:active { transform:scale(.985); }
                @media(hover:hover) and (pointer:fine) {
                  .quickGrid button:hover { transform:translateY(-3px) scale(1.03); border-color:#A85C6A; box-shadow:0 10px 24px #4A142018; z-index:1; }
                  .metricCard:hover { animation:flipCard 650ms ease-in-out; border-color:#A85C6A; box-shadow:0 16px 32px #4A142024; z-index:2; }
                  .reviewBanner:hover { transform:translateY(-2px) scale(1.01); background:#4A1420; box-shadow:0 8px 22px #4A142022; }
                  .loadRow summary:hover { background:#F7F5F3; }
                  .heroCta:hover { background:#fff; transform:scale(1.04); }
                  .drawerTab:hover { background:#4A1420; transform:scale(1.08); }
                  .navItem:hover { transform:scale(1.03); }
                  .statusGrid button:hover { transform:scale(1.05); border-color:#A85C6A; box-shadow:0 6px 16px #4A142014; z-index:1; }
                  .selectButton:hover { transform:scale(1.05); border-color:#A85C6A; box-shadow:0 6px 14px #4A142012; }
                }
                @media(prefers-reduced-motion:reduce) {
                  *, *::before, *::after { animation:none !important; transition:none !important; }
                  button:hover, button:active { transform:none !important; }
                }

                .pageIntro { position:relative; isolation:isolate; overflow:hidden; min-height:280px; margin:24px 0; padding:32px; border-radius:16px; background:#24171D; }
                .pageIntro::before { content:""; position:absolute; inset:0; z-index:-2; background:url('/truck-dusk.png') center 59% / cover no-repeat; }
                .pageIntro::after { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg,rgba(32,13,22,.94) 0%,rgba(40,15,24,.82) 38%,rgba(40,15,24,.18) 70%,rgba(40,15,24,.05) 100%); }
                .pageIntro>div { max-width:52%; }.pageIntro h1 { color:#fff; }.pageIntro h1 span { color:#E5B7C2; }.pageIntro .eyebrow { color:#F1CDD5; }.pageIntro .subtitle { color:#F4E9ED; }
                @media(max-width:1000px) and (min-width:761px) { .pageIntro>div { max-width:65%; } }
                @media(max-width:760px) { .pageIntro { min-height:360px; padding:24px; justify-content:flex-start; }.pageIntro>div { max-width:100%; }.pageIntro::before { background-position:76% 64%; }.pageIntro::after { background:linear-gradient(180deg,rgba(32,13,22,.96) 0%,rgba(32,13,22,.83) 38%,rgba(32,13,22,.18) 67%,rgba(32,13,22,.08) 100%); }.pageIntro h1 { font-size:27px; }.pageIntro .subtitle { max-width:300px; } }

                .pageIntro h1 { font-size:clamp(36px,4.5vw,64px); font-weight:800; letter-spacing:1px; line-height:1.08; }.heroGreeting { color:white; font-size:18px; margin:16px 0 0; }.pageIntro .subtitle { font-size:15px; margin-top:6px; }
                @media(max-width:760px) { .pageIntro h1 { font-size:38px; }.pageIntro .eyebrow { font-size:12px; letter-spacing:.6px; }.heroGreeting { margin-top:12px; } }

                /* Pantalla de bienvenida a pantalla completa (antes de elegir un módulo) */
                .landingHero { position:relative; isolation:isolate; min-height:100dvh; display:flex; align-items:center; padding:0 clamp(24px,6vw,72px); }
                .landingHero::before { content:""; position:absolute; inset:0; z-index:-2; background:url('/truck-dusk.png') center 59% / cover no-repeat; }
                .landingHero::after { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg,rgba(32,13,22,.95) 0%,rgba(40,15,24,.85) 42%,rgba(40,15,24,.25) 75%,rgba(40,15,24,.08) 100%); }
                .landingHeroInner { max-width:640px; animation:enterPanel 520ms ease-out; }
                .landingHeroInner .eyebrow { color:#F1CDD5; }
                .landingHeroInner h1 { color:#fff; font-size:clamp(40px,6vw,72px); font-weight:800; letter-spacing:1px; line-height:1.05; margin:0; }
                .landingHeroInner .heroGreeting { color:white; font-size:20px; margin:18px 0 0; }
                .landingHeroInner .subtitle { color:#F4E9ED; font-size:16px; margin-top:8px; }
                .heroCta { margin-top:32px; border:0; background:#EBD5DA; color:#4A1420; padding:14px 26px; border-radius:12px; font-weight:700; font-size:16px; box-shadow:0 8px 24px rgba(0,0,0,.2); }
                .heroHint { color:#D8B7BF; font-size:13px; margin-top:14px; }
                @media(max-width:760px) { .landingHero { padding:0 20px 64px; align-items:flex-end; } .landingHero::before { background-position:76% 64%; } .landingHeroInner h1 { font-size:44px; } }
`}</style>
</main>;
}
