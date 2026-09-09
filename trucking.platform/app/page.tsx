"use client";

import { useEffect, useRef, useState } from "react";
import { useFleet } from "../lib/use-fleet";
import { useFuel } from "../lib/use-fuel";
import { useLoads } from "../lib/use-loads";
import { useMyLoads } from "../lib/use-my-loads";
import { toDashboardLoad, isOfficial, isActive } from "../lib/loads";
import { isCargoDriver } from "../lib/fleet";
import { useSettlements } from "../lib/use-settlements";
import { useAuth } from "../lib/use-auth";
import { useChat } from "../lib/use-chat";
import { money, today } from "../lib/format";
import { translate, type Lang } from "../lib/i18n";
import { Truck, MessageCircle, DollarSign, Users, Fuel as FuelIcon, FileText, BarChart3, ChevronRight, LogOut } from "lucide-react";
import CargasFlotaModule from "./cargas-flota-module";
import FuelModule from "./fuel-module";
import SettlementsModule from "./settlements-module";
import ReportsModule from "./reports-module";
import UsersModule from "./users-module";
import ChatModule from "./chat-module";
import MyLoadsModule from "./my-loads-module";
import MyInvoiceModule from "./my-invoice-module";
import AuthGate from "./auth-gate";

// Cargas y Choferes y Flota se fusionaron en una sola entrada de menú (pedido
// directo de la dueña) — ver app/cargas-flota-module.tsx. "Mis Cargas" y
// "Mi Invoice" son módulos aparte (no la misma pantalla con datos filtrados
// visualmente) — cada uno pide sus propios datos ya acotados del servidor.
const nav = [
  {name:'Cargas',id:'cargas',icon:'01'},
  {name:'Combustible y Gastos',id:'combustible',icon:'02'},
  {name:'Contabilidad y Pagos',id:'finanzas',icon:'03'},
  {name:'Reportes',id:'reportes',icon:'04'},
  {name:'Chat',id:'comunicacion',icon:'05'},
  {name:'Usuarios y Permisos',id:'usuarios',icon:'06'},
  {name:'Dispatcher',id:'miinvoice',icon:'07'},
  {name:'Mis Cargas',id:'miscargas',icon:'01'},
];
const navIcons: Record<string, typeof Truck> = { cargas: Truck, combustible: FuelIcon, finanzas: FileText, reportes: BarChart3, comunicacion: MessageCircle, usuarios: Users, miinvoice: DollarSign, miscargas: Truck };
// Saludo de bienvenida (pedido explícito): nombre fijo de la marca, no el
// nombre de la cuenta que inició sesión.
const WELCOME_NAME = 'MARIOYANE';

export default function Home() {
  const [activeModule,setActiveModule] = useState<string|null>(null);
  const lang: Lang = 'es';
  const t = (es:string) => translate(lang,es);
  const auth = useAuth();
  const role = auth.profile?.role;
  const isDriver = role === 'driver';
  const canSeeFleet = role !== 'dispatcher' && !isDriver;
  // No hay Dashboard: la dueña lo eliminó por sentirse repetido con lo que ya
  // muestran los módulos (Cargas, Contabilidad, Reportes). "Casa" es Cargas
  // para el staff; para un chofer, Mis Cargas (nunca ve el módulo completo).
  const homeModule = isDriver ? 'miscargas' : 'cargas';
  const fleet = useFleet();
  const fuel = useFuel();
  const loadsCtl = useLoads();
  const myLoads = useMyLoads(auth.accessToken);
  const settlementsCtl = useSettlements();
  const chat = useChat(auth.accessToken);
  // FleetModule todavía usa esto para "Cargas y actividad relacionada" por chofer.
  const dashboardLoads = loadsCtl.state.loads.map(toDashboardLoad);
  // Estadísticas reales del banner de bienvenida (spec del rediseño: "no
  // inventes los números" — si el módulo dueño de ese dato aún no cargó, 0).
  const officialLoads = loadsCtl.state.loads.filter(isOfficial);
  const activeLoadsCount = loadsCtl.ready ? officialLoads.filter(isActive).length : 0;
  const monthKey = today().slice(0, 7);
  // Ingresos del mes = solo lo que YA salió pagado por Summar este mes
  // (pedido explícito) — no lo agendado/recogido, que puede seguir sin
  // cobrarse.
  const monthlyRevenue = loadsCtl.ready ? officialLoads.filter(l => l.paymentStatus === 'Pagada' && l.paidAt.startsWith(monthKey)).reduce((s, l) => s + l.amount, 0) : 0;
  const activeDriversCount = fleet.ready ? fleet.state.drivers.filter(d => d.active && isCargoDriver(d) && (d.group === 'Mario' || d.group === 'Owner Operators' || d.group === 'Lázaro')).length : 0;
  const transactionsCount = fuel.ready ? fuel.state.transactions.length : 0;
  // Un chofer no ve ingresos ni cifras de la compañía en el banner — solo lo suyo.
  const myActiveLoadsCount = myLoads.ready ? myLoads.loads.filter(isOfficial).filter(isActive).length : 0;
  const myTotalLoadsCount = myLoads.ready ? myLoads.loads.filter(isOfficial).length : 0;
  const moduleNames: Record<string,string> = Object.fromEntries(nav.map(item=>[item.id, isDriver && item.id==='comunicacion' ? 'Mi Chat' : item.name]));
  // Cada rol ve solo los módulos que le tocan — 'owner' y 'admin' ven lo
  // mismo (se ven idénticos en toda la interfaz, incluyendo Usuarios y
  // Permisos) — si por cualquier vía activeModule queda en un módulo que el
  // rol actual no puede ver, este efecto lo corrige solo.
  const moduleAccessByRole: Record<string,string[]> = {
    owner: ['cargas','combustible','finanzas','reportes','comunicacion','usuarios','miinvoice'],
    admin: ['cargas','combustible','finanzas','reportes','comunicacion','usuarios','miinvoice'],
    dispatcher: ['cargas','comunicacion','miinvoice'],
    driver: ['miscargas','comunicacion'],
  };
  const allowedModules = role ? (moduleAccessByRole[role] || ['cargas']) : ['cargas'];
  const visibleNav = nav.filter(item=>allowedModules.includes(item.id)).map(item=>isDriver && item.id==='comunicacion' ? {...item,name:'Mi Chat'} : item);
  useEffect(() => {
    if (auth.status!=='ready' || !activeModule) return;
    if (!allowedModules.includes(activeModule)) setActiveModule(homeModule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, activeModule, allowedModules.join(','), homeModule]);

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
    navigateTo(id);
    requestAnimationFrame(()=>{
      const element = document.getElementById('main-content');
      element?.scrollIntoView({behavior:'instant',block:'start'});
      element?.focus({preventScroll:true});
    });
  }
  return <AuthGate auth={auth} lang={lang} t={t}><main className="shell">
    <a className="skipLink" href="#main-content">{t('Saltar al contenido')}</a>

    <div className="edgeZone" onPointerDown={onEdgePointerDown} aria-hidden="true" />
    {(drawerOpen||dragOffset!==null) && <div className={`drawerBackdrop ${drawerOpen?'isOpen':''}`} onClick={()=>setDrawerOpen(false)} />}
    <aside ref={drawerRef} className={`drawer ${drawerOpen?'open':''}`} style={dragOffset!==null?{transform:`translateX(${dragOffset}px)`,transition:'none'}:undefined} onPointerDown={onDrawerPointerDown}>
      <button className="brand brandButton" onClick={()=>navigateTo(homeModule)}><div className="brandMark">M&A</div><div><strong>M&A King</strong><span>TRUCKING SERVICE</span></div></button>
      <div className="workspaceLabel">{t('OPERACIONES')}</div>
      <nav id="main-navigation" className="navList" aria-label={t('Navegación principal')}>{visibleNav.map(item=>{ const Icon = navIcons[item.id]; return <button key={item.id} className={`navItem ${activeModule===item.id?'active':''}`} aria-current={activeModule===item.id?'page':undefined} onClick={()=>go(item.id)}><span className="navIconWrap" aria-hidden="true"><Icon size={18}/></span><span className="navItemLabel">{t(item.name)}</span><ChevronRight size={16} className="navChevron" aria-hidden="true"/></button>; })}</nav>
      <div className="sidebarBottom">
        <div className="footerBrand">
          <div className="footerBrandMark">M&amp;A</div>
          <div><strong>M&amp;A King</strong><span>{t('TRUCKING SERVICE')}</span></div>
        </div>
        <p className="footerTagline">{t('DISCIPLINA EN CADA MILLA')}</p>
        <button className="signOutBtn" onClick={()=>void auth.signOut()}><LogOut size={16}/> {t('Cerrar sesión')}</button>
      </div>
    </aside>

    {activeModule===null ? <section className="landingHero" id="main-content" tabIndex={-1}>
      <div className="landingHeroInner">
        <p className="eyebrow">{t('TRUCK SERVICE · PANEL PRINCIPAL')}</p>
        <h1>M&amp;A KING</h1>
        <p className="heroGreeting">{t('Hola,')} {WELCOME_NAME}</p>
        <p className="subtitle">{t('Tus cargas, tu equipo y tus números en un solo lugar.')}</p>
        <button className="heroCta" onClick={()=>navigateTo(homeModule)}>{t('START')}</button>
        <p className="heroHint">{t('Desliza desde el borde izquierdo para abrir el menú.')}</p>
      </div>
    </section> : <section className="content" id="main-content" tabIndex={-1} key={activeModule}>
      {activeModule===homeModule && <header className="mainNav">
        <span className="navBrand" aria-hidden="true">
          <Truck size={26} strokeWidth={1.75} className="navBrandIcon"/>
          <span className="navBrandText"><strong>M&amp;A <span className="navBrandKing">KING</span></strong><span>TRUCKING SERVICE</span></span>
        </span>
        <div className="navSpacer"/>
      </header>}
      {activeModule===homeModule && <section className="heroBanner">
        <div className="heroBannerText">
          <h1>{t('Bienvenido,')} {WELCOME_NAME} 👋</h1>
          <p>{t('Todo en movimiento, siempre hacia adelante.')}</p>
        </div>
        <div className="heroStats">
          {isDriver ? <>
            <div className="heroStat"><Truck size={16}/><div><strong>{myActiveLoadsCount}</strong><span>{t('Cargas activas')}</span></div></div>
            <div className="heroStat"><Truck size={16}/><div><strong>{myTotalLoadsCount}</strong><span>{t('Total de mis cargas')}</span></div></div>
          </> : <>
            <div className="heroStat"><Truck size={16}/><div><strong>{activeLoadsCount}</strong><span>{t('Cargas activas')}</span></div></div>
            <div className="heroStat"><DollarSign size={16}/><div><strong>{money(monthlyRevenue)}</strong><span>{t('Ingresos (Mes)')}</span></div></div>
            <div className="heroStat"><Users size={16}/><div><strong>{activeDriversCount}</strong><span>{t('Choferes')}</span></div></div>
            <div className="heroStat"><FuelIcon size={16}/><div><strong>{transactionsCount}</strong><span>{t('Transacciones')}</span></div></div>
          </>}
        </div>
        <span className="heroBannerTag" aria-hidden="true">Keep Trucking</span>
      </section>}
      <nav className="miniNav" aria-label={t('Acceso rápido')}>
        <button className={`miniNavItem ${activeModule===homeModule?'active':''}`} onClick={()=>go(homeModule)}>{t('Inicio')}</button>
        <div className="navSpacer"/>
        <span className="dateBadge">📅 {new Intl.DateTimeFormat('es',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date(`${today()}T12:00:00Z`))}</span>
      </nav>
      <div className="moduleView">
        <div className="moduleHero">
          <div className="moduleHeroText">
            <p className="eyebrow">{t('MÓDULO')} {nav.find(item=>item.id===activeModule)?.icon} · M&A KING</p>
            <h1>{t(moduleNames[activeModule])}</h1>
            <p className="moduleHeroSubtitle">{t(({cargas:'Gestiona todas las cargas de la compañía y tu flota en un solo lugar.',combustible:'Combustible y gastos de la operación.',finanzas:'Ingresos, pagos, deducciones y liquidaciones.',reportes:'Reportes procesados de la compañía.',comunicacion:'Mensajería interna de la compañía.',usuarios:'Usuarios, roles y permisos.'} as Record<string,string>)[activeModule] || '')}</p>
          </div>
          <div className="moduleHeroImage" aria-hidden="true" />
          <span className="moduleHeroTag" aria-hidden="true">More<br/>Than Trucks<br/>A Family</span>
        </div>
        {activeModule==='cargas' ? <CargasFlotaModule loads={loadsCtl} fleet={fleet} dashboardLoads={dashboardLoads} canSeeFleet={canSeeFleet} lang={lang} t={t}/> : activeModule==='combustible' ? <FuelModule fuel={fuel} fleet={fleet} lang={lang} t={t}/> : activeModule==='finanzas' ? <SettlementsModule settlements={settlementsCtl} loads={loadsCtl} fuel={fuel} fleet={fleet} lang={lang} t={t}/> : activeModule==='reportes' ? <ReportsModule settlements={settlementsCtl} loads={loadsCtl} fuel={fuel} fleet={fleet} lang={lang} t={t}/> : activeModule==='usuarios' ? <UsersModule auth={auth} lang={lang} t={t}/> : activeModule==='comunicacion' ? <ChatModule chat={chat} myId={auth.profile?.id || ''} canStartConversations={!isDriver} lang={lang} t={t}/> : activeModule==='miscargas' ? <MyLoadsModule myLoads={myLoads} lang={lang} t={t}/> : activeModule==='miinvoice' ? <MyInvoiceModule settlements={settlementsCtl} loads={loadsCtl} fleet={fleet} lang={lang} t={t}/> : <section className="panel sectionSpace"><div className="panelHeader"><div><h2>{t('Espacio del módulo')}</h2><p>{t('La navegación está lista. Las funciones de este módulo están pendientes de desarrollo.')}</p></div></div></section>}
      </div>
    </section>}

<style jsx>{`

                :global(*) { box-sizing: border-box; }
                :global(html) { color-scheme: light; }
                :global(body) { margin: 0; background: #F7F8FA; color: #30282A; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; }
                :global(body)::before { content:""; position:fixed; inset:0; z-index:-1; background:linear-gradient(180deg, rgba(247,248,250,.91), rgba(247,248,250,.96)), url('/truck-dusk.png') center 30% / cover no-repeat; }
                button { font: inherit; cursor: pointer; min-height: 44px; transition: background .15s; }
                button:focus-visible, .skipLink:focus-visible { outline: 3px solid #A85C6A; outline-offset: 4px; }
                .skipLink { position: fixed; top: -100px; left: 16px; z-index: 60; background: white; color: #8B102A; padding: 12px; }
                .skipLink:focus { top: 12px; }
                .shell { min-height: 100vh; }
                .srOnly { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }

                .edgeZone { position:fixed; top:0; left:0; width:20px; height:100vh; z-index:40; touch-action:none; }
                .drawerBackdrop { position:fixed; inset:0; background:rgba(20,8,12,.45); z-index:45; opacity:0; transition:opacity 280ms ease; }
                .drawerBackdrop.isOpen { opacity:1; }
                .drawer { position:fixed; top:0; left:0; height:100vh; width:min(300px,86vw); z-index:48; background:#11151B; color:#EBD5DA; padding:30px 16px 24px; display:flex; flex-direction:column; overflow-y:auto; touch-action:none; transform:translateX(calc(-100% - 24px)); transition:transform 320ms cubic-bezier(.16,1,.3,1); box-shadow:6px 0 24px #11151B30; }
                .drawer.open { transform:translateX(0); }
                .brandButton { border:0; width:100%; cursor:pointer; }
                .brand { display: flex; gap: 12px; align-items: center; padding: 0 8px 40px; color: white; text-align:left; background:transparent; }
                .brandMark { flex: 0 0 44px; height: 44px; background: #8B102A; border: 1px solid #A85C6A; border-radius: 12px; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
                .brand strong, .brand span { display: block; }.brand strong { font-size: 20px; }.brand span { font-size: 11px; letter-spacing: 1.5px; color: #EBD5DA; }
                .workspaceLabel { color: #D8B7BF; font-size: 12px; letter-spacing: 1.5px; font-weight: 700; padding: 0 12px 12px; }
                .navList { display: grid; gap: 6px; }.navItem { border: 1px solid transparent; background: transparent; color: #EBD5DA; min-height: 52px; border-radius: 10px; text-align: left; padding: 10px 14px; display: flex; align-items: center; gap: 12px; font-size: 15px; white-space:normal; transition:background 220ms ease, color 220ms ease, border-color 220ms ease, transform 180ms ease; }.navItem:hover { background: #8B102A; color: white; }.navItem.active { background:#C5A46D; color:#3A2E14; border-color:#C5A46D; font-weight:700; box-shadow:0 2px 10px rgba(0,0,0,.2); }
                .navIconWrap { flex-shrink:0; display:grid; place-items:center; color:#C5A46D; }.navItem.active .navIconWrap { color:#3A2E14; }
                .navItemLabel { flex:1; }
                .navChevron { flex-shrink:0; opacity:.6; }
                .sidebarBottom { margin-top: auto; padding-top: 32px; display:grid; gap:14px; }
                .footerBrand { display:flex; align-items:center; gap:10px; border-top:1px solid #8F4F5B; padding-top:20px; }
                .footerBrandMark { flex:0 0 40px; height:40px; border-radius:50%; border:1.5px solid #C5A46D; color:#C5A46D; display:grid; place-items:center; font-size:12px; font-weight:800; }
                .footerBrand strong { display:block; font-size:14px; color:white; }.footerBrand span { display:block; font-size:10px; color:#D8B7BF; letter-spacing:1.5px; margin-top:1px; }
                .footerTagline { margin:0; font-size:11px; letter-spacing:2px; color:#D8B7BF; padding-bottom:6px; border-bottom:2px solid #8B102A; display:inline-block; }
                .signOutBtn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06); color:#fff; border-radius:10px; font-weight:700; font-size:14px; }
                .signOutBtn:hover { background:rgba(255,255,255,.14); }

                .content { max-width: 1920px; margin: 0 auto; padding: 0 clamp(20px, 3vw, 48px) 40px; animation:enterPanel 320ms ease-out; }
                @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap');
                .moduleView { padding-top:28px; }.moduleView>.filterLabel { max-width:360px; }
                .moduleHero { position:relative; overflow:hidden; display:flex; align-items:stretch; gap:18px; background:#F7F8FA; border:1px solid #E9DCD4; border-radius:14px; margin-bottom:18px; min-height:100px; }
                .moduleHeroText { flex:1 1 auto; min-width:0; padding:18px 0 18px 22px; align-self:center; }
                .moduleHero h1 { margin:4px 0 6px; font-size:24px; color:#11151B; }
                .moduleHeroSubtitle { margin:0; color:#59616D; font-size:13px; max-width:480px; }
                .moduleHeroImage { position:relative; isolation:isolate; flex:0 0 clamp(140px,22%,240px); background:url('/truck-dusk.png') center 55% / cover no-repeat; filter:grayscale(1); opacity:.3; }
                .moduleHeroImage::before { content:""; position:absolute; inset:0; z-index:1; background:linear-gradient(90deg,#F7F8FA 0%,rgba(247,248,250,0) 30%); }
                .moduleHeroTag { flex:0 0 auto; align-self:center; font-family:'Dancing Script',cursive; font-size:16px; color:#9AA1AB; text-align:right; line-height:1.2; padding-right:22px; }
                @media(max-width:760px) { .moduleHero { flex-direction:column; min-height:0; }.moduleHeroText { padding:16px 16px 0; }.moduleHero h1 { font-size:20px; }.moduleHeroImage { flex-basis:80px; }.moduleHeroTag { display:none; } }
                .dateBadge { border:1px solid #E3DADD; border-radius:16px; padding:5px 12px; font-size:12px; color:#59616D; font-weight:600; white-space:nowrap; }
                .mainNav { display:flex; align-items:center; gap:14px; min-height:68px; padding:14px clamp(20px,3vw,48px); background:linear-gradient(120deg,#11151B 0%,#4A1420 55%,#11151B 100%); }
                .navMenuBtn { flex:0 0 auto; width:38px; height:38px; min-height:38px; padding:0; background:#8B102A; color:#fff; border:0; border-radius:10px; display:grid; place-items:center; }
                .navBrand { display:flex; align-items:center; gap:10px; }
                .navBrandIcon { color:#C5A46D; }
                .navBrandText { display:flex; flex-direction:column; line-height:1.25; white-space:nowrap; }.navBrandText strong { font-size:17px; color:#fff; letter-spacing:.3px; font-weight:800; }.navBrandKing { color:#C5A46D; }.navBrandSubtitle { font-size:9px; color:#D8B7BF; letter-spacing:2.5px; font-weight:700; margin-top:1px; }
                .navIconBtn { position:relative; flex:0 0 auto; width:38px; height:38px; min-height:38px; padding:0; background:rgba(255,255,255,.08); color:#fff; border:1px solid rgba(255,255,255,.15); border-radius:50%; display:grid; place-items:center; }
                .navIconBtn:hover { background:rgba(255,255,255,.18); }
                .navIconBadge { position:absolute; top:-4px; right:-4px; background:#C0392B; color:#fff; font-size:10px; font-weight:700; min-width:17px; height:17px; border-radius:9px; display:grid; place-items:center; padding:0 3px; border:2px solid #11151B; }
                @media(max-width:480px) { .navBrandSubtitle { display:none; } }

                .heroBanner { position:relative; isolation:isolate; overflow:hidden; padding:26px clamp(20px,3vw,48px) 20px; min-height:180px; display:flex; flex-direction:column; justify-content:flex-end; gap:16px; background:#11151B url('/truck-dusk.png') center 60% / cover no-repeat; }
                .heroBanner::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg,rgba(17,21,27,.92) 0%,rgba(17,21,27,.55) 55%,rgba(17,21,27,.2) 100%); }
                .heroBannerText h1 { margin:0 0 6px; font-size:24px; color:#fff; font-weight:800; }
                .heroBannerText p { margin:0; color:#EBD5DA; font-size:14px; }
                .heroStats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
                .heroStat { display:flex; align-items:center; gap:8px; background:rgba(17,21,27,.55); border:1px solid rgba(255,255,255,.15); border-radius:10px; padding:8px 10px; color:#C5A46D; min-width:0; }
                .heroStat div { display:flex; flex-direction:column; min-width:0; }
                .heroStat strong { font-size:14px; color:#fff; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
                .heroStat span { font-size:10px; color:#D8B7BF; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
                .heroBannerTag { position:absolute; top:20px; right:clamp(20px,3vw,48px); font-family:'Dancing Script',cursive; font-size:22px; color:#EBD5DA; }
                @media(max-width:600px) { .heroStats { grid-template-columns:repeat(2,minmax(0,1fr)); } .heroBannerTag { display:none; } }

                .miniNav { display:flex; align-items:center; gap:6px; padding:14px clamp(20px,3vw,48px); border-bottom:1px solid #E3DADD; background:#fff; }
                .miniNavItem { display:inline-flex; align-items:center; gap:6px; border:0; border-bottom:3px solid transparent; border-radius:0; background:transparent; color:#59616D; font-weight:700; font-size:14px; padding:8px 4px; margin-right:14px; min-height:auto; }
                .miniNavItem.active { color:#8B102A; border-bottom-color:#8B102A; }
                .miniNavItem:hover { background:transparent; color:#8B102A; }
                .pageIntro { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 32px 0 24px; }.eyebrow { color: #8B102A; font-size: 12px; font-weight: 700; letter-spacing: 1.2px; margin: 0 0 10px; }.pageIntro h1 { margin: 0; font-size: clamp(26px, 2.3vw, 36px); line-height: 1.2; letter-spacing: -.8px; color: #11151B; }.pageIntro h1 span { color: #8F4F5B; }.subtitle { color: #59616D; font-size: 16px; margin: 10px 0 0; }
                .panel { min-width: 0; background: #fff; border: 1px solid #E3DADD; border-radius: 12px; box-shadow: 0 3px 14px #11151B04; }.panelHeader { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 22px; }.panelHeader h2 { margin: 0; color: #11151B; font-size: 20px; line-height: 1.3; }.panelHeader p { margin: 6px 0 0; color: #59616D; font-size: 14px; }.textButton { border: 0; background: transparent; color: #8B102A; font-size: 14px; font-weight: 700; padding: 8px; border-radius:8px; transition:background 180ms ease; }.textButton:hover { background: #F5EBED; }
                .alertCount { background: #F5EBED; color: #8B102A; border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
                .bottomGrid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; margin-top: 20px; }.selectButton { border: 1px solid #D6C6CB; color: #59616D; background: white; border-radius: 8px; font-size: 14px; padding: 8px 12px; transition:background 200ms ease, border-color 200ms ease, color 200ms ease, transform 180ms ease; }.selectButton[aria-pressed=true] { background:#C5A46D; border-color:#C5A46D; color:#3A2E14; font-weight:700; }
                @media (max-width: 1200px) { .bottomGrid { grid-template-columns: 1fr; } }
                @media (max-width: 1000px) { .pageIntro { flex-wrap: wrap; } }
                @media (max-width: 760px) { .content { padding: 0 16px 28px; }.pageIntro { align-items: stretch; gap: 20px; flex-direction: column; padding: 24px 0; }.pageIntro h1 { font-size: 28px; }.eyebrow { font-size: 12px; letter-spacing: .7px; }.panelHeader { padding: 18px 16px; } }

                .sectionSpace { margin-top:24px; scroll-margin-top:20px; }
                h2 { color:#11151B; font-size:22px; }.sourceNotice { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:18px; border:1px solid #E3DADD; background:#fff; border-radius:12px; margin-bottom:20px; }.sourceNotice p { margin:4px 0 0; font-size:14px; color:#59616D; }.sourceNotice button { flex-shrink:0; }
                .reviewBanner { display:flex; width:100%; align-items:center; justify-content:space-between; gap:24px; padding:26px; background:#8B102A; color:white; border:0; border-radius:14px; text-align:left; margin-bottom:24px; }.reviewBanner h2 { color:white; margin:8px 0; font-size:26px; }.reviewBanner p { margin:0; color:#F0DEE3; }.reviewBanner .eyebrow { color:#F0DEE3; }.reviewNumber { font-size:48px; font-weight:700; min-width:140px; }.reviewNumber span { display:block; font-size:15px; }
                .filterLabel { display:grid; gap:5px; font-size:14px; color:#59616D; }select,input { font:inherit; min-height:44px; max-width:100%; padding:8px 12px; border:1px solid #D6C6CB; border-radius:8px; background:white; color:#11151B; }select:focus-visible,input:focus-visible,summary:focus-visible { outline:3px solid #A85C6A; outline-offset:3px; }
                .statusGrid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; padding:0 22px 22px; }.statusGrid button { border:1px solid #E3DADD; border-radius:10px; padding:12px; background:#F7F5F3; color:#11151B; transition:background 200ms ease, border-color 200ms ease, transform 180ms ease, box-shadow 200ms ease; }.statusGrid strong { display:block; font-size:26px; }.statusGrid span { font-size:14px; }
                .emptyState { color:#59616D; padding:0 22px 22px; margin:8px 0 0; font-size:15px; }.detailNote { grid-column:1/-1; font-size:14px; color:#59616D; background:#F7F5F3; padding:14px; border-radius:8px; }.financeNote { margin:0 22px 22px; }
                .panelLinkWrap { padding:0 22px 22px; }
                .driverSummary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.driverSummary div { padding:14px; border-radius:10px; background:#F7F5F3; }.driverSummary strong,.driverSummary span { display:block; }.driverSummary strong { font-size:24px; color:#11151B; overflow-wrap:anywhere; }.driverSummary span { font-size:14px; color:#59616D; }.plainList { list-style:none; padding:0 22px 16px; margin:0; }.plainList li { border-top:1px solid #E3DADD; display:flex; justify-content:space-between; gap:12px; padding:16px 0; font-size:15px; }.plainList span { color:#59616D; }.plainList .alertLine { display:grid; gap:5px; }.plainList li button.alertLine { all:unset; display:grid; gap:5px; width:100%; min-height:0; cursor:pointer; }.plainList li button.alertLine:hover strong { color:#8B102A; }.activityScroll { max-height:210px; overflow-y:auto; }.activityScroll .plainList { padding-bottom:4px; }.attentionScroll { max-height:210px; overflow-y:auto; }.attentionScroll .plainList { padding-bottom:4px; }
                .financeGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; padding:0 22px 22px; }.financeGrid>div { border:1px solid #E3DADD; border-radius:10px; padding:18px; }.financeGrid span,.financeGrid strong,.financeGrid small { display:block; }.financeGrid span { color:#59616D; font-size:14px; }.financeGrid strong { font-size:28px; color:#11151B; margin-top:6px; overflow-wrap:anywhere; }.financeGrid small { color:#59616D; margin-top:6px; }.profit { background:#F5EBED; }.quickGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.quickGrid button { text-align:left; min-height:52px; }.integrationNote { padding:0; margin-top:16px; }
                @media(max-width:1200px) { .statusGrid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
                @media(max-width:760px) { .sourceNotice { align-items:stretch; flex-direction:column; }.reviewBanner { align-items:flex-start; flex-direction:column; padding:20px; gap:16px; }.reviewNumber { font-size:38px; }.reviewNumber span { display:inline; margin-left:18px; }.financeGrid,.quickGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }.statusGrid { padding:0 16px 16px; grid-template-columns:repeat(2,minmax(0,1fr)); }.plainList,.driverSummary,.financeGrid,.panelLinkWrap { padding-left:16px; padding-right:16px; }.plainList li { flex-wrap:wrap; }.financeGrid strong { font-size:23px; }.filterLabel { width:100%; }.financeNote { margin:0 16px 16px; } }
                @media(max-width:380px) { .financeGrid,.quickGrid,.driverSummary { grid-template-columns:1fr; }.reviewNumber span { display:block; margin:0; } }

                @keyframes enterPanel { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                .pageIntro, .sourceNotice, .reviewBanner, .bottomGrid, .sectionSpace { animation:enterPanel 420ms ease-out backwards; }
                .sourceNotice { animation-delay:40ms; }.reviewBanner { animation-delay:80ms; }
                button { transition:background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 180ms ease, color 200ms ease; }
                button:active { transform:scale(.985); }
                @media(hover:hover) and (pointer:fine) {
                  .quickGrid button:hover { transform:translateY(-3px) scale(1.03); border-color:#C5A46D; box-shadow:0 10px 24px #11151B18; z-index:1; }
                  .reviewBanner:hover { transform:translateY(-2px) scale(1.01); background:#11151B; box-shadow:0 8px 22px #11151B22; }
                  .heroCta:hover { background:#fff; transform:scale(1.04); }
                  .navItem:hover { transform:scale(1.03); }
                  .statusGrid button:hover { transform:scale(1.05); border-color:#C5A46D; box-shadow:0 6px 16px #11151B14; z-index:1; }
                  .selectButton:hover:not([aria-pressed=true]) { transform:scale(1.05); border-color:#C5A46D; box-shadow:0 6px 14px #11151B12; }
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
                .landingHero { position:relative; isolation:isolate; min-height:100svh; display:flex; align-items:center; padding:0 clamp(24px,6vw,72px); }
                .landingHero::before { content:""; position:absolute; inset:0; z-index:-2; background:url('/truck-dusk.png') center 59% / cover no-repeat; }
                .landingHero::after { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg,rgba(32,13,22,.95) 0%,rgba(40,15,24,.85) 42%,rgba(40,15,24,.25) 75%,rgba(40,15,24,.08) 100%); }
                .landingHeroInner { max-width:640px; animation:enterPanel 520ms ease-out; }
                .landingHeroInner .eyebrow { color:#F1CDD5; }
                .landingHeroInner h1 { color:#fff; font-size:clamp(40px,6vw,72px); font-weight:800; letter-spacing:1px; line-height:1.05; margin:0; }
                .landingHeroInner .heroGreeting { color:white; font-size:20px; margin:18px 0 0; }
                .landingHeroInner .subtitle { color:#F4E9ED; font-size:16px; margin-top:8px; }
                .heroCta { margin-top:32px; border:0; background:#EBD5DA; color:#11151B; padding:14px 26px; border-radius:12px; font-weight:700; font-size:16px; box-shadow:0 8px 24px rgba(0,0,0,.2); transition:background 200ms ease, transform 180ms ease; }
                .heroHint { color:#D8B7BF; font-size:13px; margin-top:18px; }
                @media(max-width:760px) { .landingHero { padding:0 20px 64px; align-items:flex-end; } .landingHero::before { background-position:76% 64%; } .landingHeroInner h1 { font-size:44px; } }
`}</style>
</main></AuthGate>;
}
