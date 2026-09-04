"use client";

import { useState } from "react";

type Trip = {
	id: string;
	route: string;
	driver: string;
	truck: string;
	status: "En tránsito" | "Cargando" | "Programado";
	eta: string;
};

const navItems = [
	{ label: "Resumen", icon: "▦" },
	{ label: "Despacho", icon: "↗" },
	{ label: "Flota", icon: "▰" },
	{ label: "Mantenimiento", icon: "⌁" },
	{ label: "Finanzas", icon: "$" },
];

const initialTrips: Trip[] = [
	{ id: "TR-2084", route: "Dallas, TX → Phoenix, AZ", driver: "Marcus Johnson", truck: "MK-104 · Volvo VNL", status: "En tránsito", eta: "Hoy, 16:40" },
	{ id: "TR-2083", route: "Houston, TX → Atlanta, GA", driver: "Sarah Williams", truck: "MK-118 · Freightliner", status: "Cargando", eta: "Hoy, 18:15" },
	{ id: "TR-2082", route: "El Paso, TX → Denver, CO", driver: "James Carter", truck: "MK-096 · Kenworth", status: "Programado", eta: "Mañana, 07:30" },
	{ id: "TR-2081", route: "Austin, TX → San Antonio, TX", driver: "Robert Davis", truck: "MK-121 · Peterbilt", status: "En tránsito", eta: "Hoy, 14:05" },
];

const statusStyles = {
	"En tránsito": "statusTransit",
	Cargando: "statusLoading",
	Programado: "statusScheduled",
};

export default function Home() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeItem, setActiveItem] = useState("Resumen");
	const [trips, setTrips] = useState(initialTrips);

	function addTrip() {
		setTrips((currentTrips) => [
			{
				id: "TR-2085",
				route: "Laredo, TX → Nashville, TN",
				driver: "Sin asignar",
				truck: "Pendiente de asignación",
				status: "Programado",
				eta: "Mañana, 10:00",
			},
			...currentTrips,
		]);
	}

	return (
		<main className="shell">
			<a className="skipLink" href="#dashboard">Saltar al contenido</a>
            <aside className="sidebar">
                <button className="menuToggle" aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}><span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span> {menuOpen ? "Cerrar menú" : "Menú"}</button>
				<div className="brand">
					<div className="brandMark">M&A</div>
					<div>
						<strong>M&A King</strong>
						<span>TRUCK SERVICE</span>
					</div>
				</div>

				<div className="workspaceLabel">OPERACIONES</div>
				<nav id="main-navigation" className={`navList ${menuOpen ? "isOpen" : ""}`} aria-label="Navegación principal">
					{navItems.map((item) => (
						<button
							className={`navItem ${activeItem === item.label ? "active" : ""}`}
							key={item.label}
							aria-current={activeItem === item.label ? "page" : undefined}
							onClick={() => { setActiveItem(item.label); setMenuOpen(false); }}
						>
							<span className="navIcon">{item.icon}</span>
							{item.label}
							{item.label === "Mantenimiento" && <span className="navBadge">3</span>}
						</button>
					))}
				</nav>

				<div className="sidebarBottom">
					<div className="supportCard">
						<span className="supportIcon">?</span>
						<div><strong>¿Necesitas ayuda?</strong><span>Habla con soporte</span></div>
					</div>
					<div className="userRow">
						<div className="avatar">AJ</div>
						<div><strong>Adianez Tang Johnson</strong><span>Administrador</span></div>
						<span className="more">•••</span>
					</div>
				</div>
			</aside>

			<section className="content" id="dashboard" tabIndex={-1}>
				<header className="topbar">
					<div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{activeItem}</strong></div>
					<div className="topActions">
						<button className="iconButton" aria-label="Notificaciones">♢<span className="notificationDot" /></button>
						<div className="dateLabel">Viernes, 04 de septiembre de 2026</div>
					</div>
				</header>

				<div className="pageIntro">
					<div>
						<p className="eyebrow">CENTRO DE CONTROL · {activeItem.toUpperCase()}</p>
						<h1>Buenos días, Adianez Tang <span>✦</span></h1>
						<p className="subtitle">Aquí tienes el pulso de tu operación para hoy.</p>
					</div>
					<button className="primaryButton" onClick={addTrip}><span>+</span> Nuevo viaje</button>
				</div>

				<div className="metricsGrid">
					<article className="metricCard accentBlue">
						<div className="metricTop"><span>VIAJES ACTIVOS</span><span className="metricIcon">↗</span></div>
						<strong>24</strong><div className="metricDelta positive">↑ 12.5% <em>vs. mes anterior</em></div>
					</article>
					<article className="metricCard accentOrange">
						<div className="metricTop"><span>EN TRÁNSITO</span><span className="metricIcon">◉</span></div>
						<strong>18</strong><div className="metricDelta positive">↑ 8.2% <em>vs. mes anterior</em></div>
					</article>
					<article className="metricCard accentTeal">
						<div className="metricTop"><span>FLOTA DISPONIBLE</span><span className="metricIcon">▰</span></div>
						<strong>86<span className="smallMetric">/ 94</span></strong><div className="metricDelta neutral">91.5% <em>disponibilidad</em></div>
					</article>
					<article className="metricCard accentRose">
						<div className="metricTop"><span>INGRESOS DEL MES</span><span className="metricIcon">$</span></div>
						<strong>$284.6k</strong><div className="metricDelta positive">↑ 15.8% <em>vs. mes anterior</em></div>
					</article>
				</div>

				<div className="mainGrid">
					<section className="panel tripsPanel">
						<div className="panelHeader"><div><h2>Viajes en curso</h2><p>Seguimiento de la operación en tiempo real</p></div><button className="textButton">Ver todos <span>→</span></button></div>
						<div className="tableWrap">
							<table>
								<thead><tr><th>ID VIAJE</th><th>RUTA</th><th>CONDUCTOR / UNIDAD</th><th>ESTADO</th><th>LLEGADA ESTIMADA</th></tr></thead>
								<tbody>{trips.map((trip) => <tr key={trip.id}><td data-label="ID viaje" className="tripId">{trip.id}</td><td data-label="Ruta"><strong>{trip.route}</strong><span className="cellMuted">Carga completa · 34,200 lb</span></td><td data-label="Conductor / unidad"><strong>{trip.driver}</strong><span className="cellMuted">{trip.truck}</span></td><td data-label="Estado"><span className={`status ${statusStyles[trip.status]}`}><i />{trip.status}</span></td><td data-label="Llegada estimada" className="eta">{trip.eta}</td></tr>)}</tbody>
							</table>
						</div>
					</section>

					<aside className="panel alertPanel">
						<div className="panelHeader"><div><h2>Requiere atención</h2><p>Alertas importantes de tu flota</p></div><span className="alertCount">3</span></div>
						<div className="alerts">
							<div className="alertItem"><span className="alertIcon red">!</span><div><strong>Servicio próximo</strong><p>MK-104 · Cambio de aceite en 320 mi</p><span>Hace 12 min</span></div></div>
							<div className="alertItem"><span className="alertIcon amber">◷</span><div><strong>Documento por vencer</strong><p>Licencia · Robert Davis</p><span>Vence en 4 días</span></div></div>
							<div className="alertItem"><span className="alertIcon blue">$</span><div><strong>Pago pendiente</strong><p>Factura #INV-4821 · $8,450</p><span>Vence mañana</span></div></div>
						</div>
						<button className="outlineButton">Revisar alertas <span>→</span></button>
					</aside>
				</div>

				<section className="bottomGrid">
					<div className="panel chartPanel"><div className="panelHeader"><div><h2>Ingresos</h2><p>Rendimiento de los últimos 6 meses</p></div><button className="selectButton">Últimos 6 meses⌄</button></div><div className="chart"><div className="chartLabels"><span>$300k</span><span>$200k</span><span>$100k</span><span>$0</span></div><div className="chartArea"><div className="gridLine line1" /><div className="gridLine line2" /><div className="gridLine line3" /><svg viewBox="0 0 640 150" preserveAspectRatio="none" aria-label="Gráfica de ingresos"><path d="M0,116 C50,106 65,82 120,92 S190,114 240,69 S310,73 360,57 S430,74 480,35 S550,66 640,14" fill="none" stroke="#6B1F2B" strokeWidth="3" /><path d="M0,116 C50,106 65,82 120,92 S190,114 240,69 S310,73 360,57 S430,74 480,35 S550,66 640,14 V150 H0 Z" fill="url(#chartFill)" opacity=".18" /><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6B1F2B" /><stop offset="1" stopColor="#F5EBED" /></linearGradient></defs></svg><div className="monthLabels"><span>Abr</span><span>May</span><span>Jun</span><span>Jul</span><span>Ago</span><span>Sep</span></div></div></div></div>
					<div className="panel activityPanel"><div className="panelHeader"><div><h2>Actividad reciente</h2><p>Últimas actualizaciones</p></div><button className="textButton">Ver historial <span>→</span></button></div><div className="activityList"><div><span className="activityDot green" /><p><strong>Viaje TR-2084</strong> llegó a Flagstaff, AZ<span>Hace 8 minutos · Sistema</span></p></div><div><span className="activityDot orange" /><p><strong>Nuevo mantenimiento</strong> programado para MK-104<span>Hace 34 minutos · Adianez Tang Johnson</span></p></div><div><span className="activityDot blue" /><p><strong>Factura #INV-4818</strong> marcada como pagada<span>Hace 1 hora · Finanzas</span></p></div></div></div>
				</section>
			</section>

			<style jsx>{`

                :global(*) { box-sizing: border-box; }
                :global(html) { color-scheme: light; }
                :global(body) { margin: 0; background: #F7F5F3; color: #30282A; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; }
                button { font: inherit; cursor: pointer; min-height: 44px; transition: background .15s; }
                button:focus-visible, .skipLink:focus-visible { outline: 3px solid #A85C6A; outline-offset: 4px; }
                .skipLink { position: fixed; top: -100px; left: 16px; z-index: 10; background: white; color: #6B1F2B; padding: 12px; }
                .skipLink:focus { top: 12px; }
                .shell { display: flex; min-height: 100vh; }
                .sidebar { flex: 0 0 248px; background: #4A1420; color: #EBD5DA; padding: 30px 16px 24px; display: flex; flex-direction: column; }
                .brand { display: flex; gap: 12px; align-items: center; padding: 0 8px 40px; color: white; }
                .brandMark { flex: 0 0 44px; height: 44px; background: #6B1F2B; border: 1px solid #A85C6A; border-radius: 12px; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
                .brand strong, .brand span { display: block; }.brand strong { font-size: 20px; }.brand span { font-size: 11px; letter-spacing: 1.5px; color: #EBD5DA; }
                .workspaceLabel { color: #D8B7BF; font-size: 12px; letter-spacing: 1.5px; font-weight: 700; padding: 0 12px 12px; }
                .menuToggle { display: none; }
                .navList { display: grid; gap: 6px; }.navItem { border: 0; background: transparent; color: #EBD5DA; min-height: 48px; border-radius: 8px; text-align: left; padding: 10px 12px; display: flex; align-items: center; gap: 12px; font-size: 15px; }.navItem:hover, .navItem.active { background: #6B1F2B; color: white; }.navItem.active { box-shadow: inset 3px 0 #E5B7C2; }.navIcon { width: 20px; text-align: center; font-size: 20px; }.navBadge { margin-left: auto; color: #4A1420; background: #EBD5DA; border-radius: 20px; padding: 1px 8px; font-size: 12px; }
                .sidebarBottom { margin-top: auto; padding-top: 40px; }.supportCard { background: #602330; border: 1px solid #8F4F5B; border-radius: 10px; padding: 14px 10px; display: flex; gap: 10px; margin-bottom: 24px; }.supportIcon { border: 1px solid #EBD5DA; border-radius: 50%; min-width: 24px; height: 24px; text-align: center; }.supportCard strong, .supportCard span, .userRow strong, .userRow span { display: block; }.supportCard strong, .userRow strong { font-size: 14px; color: white; }.supportCard span:not(.supportIcon), .userRow span { font-size: 13px; color: #EBD5DA; }.userRow { border-top: 1px solid #8F4F5B; padding-top: 20px; display: flex; align-items: center; gap: 10px; }.avatar { background: #EBD5DA; color: #4A1420; flex: 0 0 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; }.more { margin-left: auto; }
                .content { flex: 1; min-width: 0; padding: 0 clamp(20px, 3vw, 48px) 40px; max-width: 1920px; margin: 0 auto; }.topbar { min-height: 80px; border-bottom: 1px solid #E3DADD; display: flex; justify-content: space-between; align-items: center; gap: 16px; }.breadcrumb { color: #6D6064; font-size: 14px; display: flex; gap: 10px; flex-wrap: wrap; }.breadcrumb b { font-weight: 400; }.breadcrumb strong { color: #4A1420; }.topActions { display: flex; align-items: center; gap: 12px; }.dateLabel { font-size: 14px; color: #6D6064; }.iconButton { position: relative; border: 1px solid #E3DADD; border-radius: 12px; background: white; font-size: 26px; color: #6B1F2B; width: 44px; flex-shrink: 0; }.notificationDot { position: absolute; right: 10px; top: 10px; width: 7px; height: 7px; border-radius: 50%; background: #6B1F2B; }
                .pageIntro { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 32px 0 24px; }.eyebrow { color: #6B1F2B; font-size: 12px; font-weight: 700; letter-spacing: 1.2px; margin: 0 0 10px; }.pageIntro h1 { margin: 0; font-size: clamp(26px, 2.3vw, 36px); line-height: 1.2; letter-spacing: -.8px; color: #4A1420; }.pageIntro h1 span { color: #8F4F5B; }.subtitle { color: #6D6064; font-size: 16px; margin: 10px 0 0; }.primaryButton { border: 0; background: #6B1F2B; color: #fff; padding: 12px 20px; min-height: 48px; border-radius: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 4px 12px #4A142014; }.primaryButton:hover { background: #4A1420; }.primaryButton span { font-size: 22px; margin-right: 6px; }
                .metricsGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }.metricCard { background: white; padding: 20px; border: 1px solid #E3DADD; border-top: 3px solid #6B1F2B; border-radius: 12px; min-width: 0; }.metricTop { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #6D6064; font-size: 12px; font-weight: 700; letter-spacing: .5px; }.metricIcon { color: #6B1F2B; font-size: 22px; }.metricCard > strong { display: block; margin: 12px 0 8px; color: #4A1420; font-size: 32px; line-height: 1.2; letter-spacing: -.6px; }.smallMetric { color: #6D6064; font-size: 18px; }.metricDelta { font-size: 14px; font-weight: 700; color: #6B1F2B; }.metricDelta em { display: inline-block; font-style: normal; font-weight: 400; color: #6D6064; }
                .mainGrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; margin-top: 24px; }.panel { min-width: 0; background: #fff; border: 1px solid #E3DADD; border-radius: 12px; box-shadow: 0 3px 14px #4A142004; }.panelHeader { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 22px; }.panelHeader h2 { margin: 0; color: #4A1420; font-size: 20px; line-height: 1.3; }.panelHeader p { margin: 6px 0 0; color: #6D6064; font-size: 14px; }.textButton { border: 0; background: transparent; color: #6B1F2B; font-size: 14px; font-weight: 700; padding: 8px; }.textButton:hover { background: #F5EBED; border-radius: 8px; }.tableWrap { padding: 0 0 8px; }table { border-collapse: collapse; width: 100%; table-layout: fixed; }th { text-align: left; color: #6D6064; font-size: 12px; font-weight: 700; background: #F7F5F3; padding: 12px; border-block: 1px solid #E3DADD; }td { padding: 16px 12px; border-bottom: 1px solid #E3DADD; font-size: 14px; overflow-wrap: anywhere; }th:first-child { width: 12%; }th:nth-child(2), th:nth-child(3) { width: 26%; }tr:last-child td { border-bottom: 0; }.tripId { color: #6B1F2B; font-weight: 700; }.cellMuted { display: block; color: #6D6064; font-size: 13px; margin-top: 5px; }.status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; border-radius: 8px; padding: 5px 8px; }.status i { flex: 0 0 6px; height: 6px; border-radius: 50%; background: currentColor; }.statusTransit { color: #6B1F2B; background: #F5EBED; }.statusLoading { color: #76501E; background: #FAF1E3; }.statusScheduled { color: #554A4E; background: #EEEAE8; }.eta { color: #554A4E; }
                .alertCount { background: #F5EBED; color: #6B1F2B; border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; font-size: 14px; font-weight: 700; }.alerts { padding: 0 22px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }.alertItem { display: flex; gap: 12px; padding: 16px 0; border-top: 1px solid #E3DADD; }.alertIcon { flex: 0 0 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #6B1F2B; background: #F5EBED; }.alertItem strong { font-size: 15px; }.alertItem p { margin: 5px 0; color: #6D6064; font-size: 14px; }.alertItem div span { color: #6D6064; font-size: 13px; }.outlineButton { margin: 8px 22px 22px; width: calc(100% - 44px); background: white; color: #6B1F2B; border: 1px solid #A85C6A; border-radius: 8px; padding: 10px; font-size: 15px; font-weight: 700; }.outlineButton:hover { background: #F5EBED; }
                .bottomGrid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; margin-top: 20px; }.selectButton { border: 1px solid #D6C6CB; color: #554A4E; background: white; border-radius: 8px; font-size: 14px; padding: 8px 12px; }.chart { display: flex; gap: 8px; padding: 8px 22px 22px; height: 220px; }.chartLabels { flex: 0 0 46px; display: flex; flex-direction: column; justify-content: space-between; padding: 0 0 28px; color: #6D6064; font-size: 12px; }.chartArea { position: relative; flex: 1; min-width: 0; }.chartArea svg { position: absolute; inset: 0; width: 100%; height: calc(100% - 28px); overflow: visible; }.gridLine { border-top: 1px dashed #E3DADD; position: absolute; width: 100%; }.line1 { top: 8px; }.line2 { top: 60px; }.line3 { top: 112px; }.monthLabels { position: absolute; display: flex; justify-content: space-between; width: 100%; bottom: 0; color: #6D6064; font-size: 12px; }.activityList { padding: 0 22px 16px; }.activityList > div { display: flex; gap: 12px; padding: 14px 0; border-top: 1px solid #E3DADD; }.activityDot { flex: 0 0 8px; height: 8px; border-radius: 50%; margin-top: 7px; background: #6B1F2B; }.activityList p { margin: 0; color: #554A4E; font-size: 14px; }.activityList strong { color: #4A1420; }.activityList p span { display: block; color: #6D6064; font-size: 13px; margin-top: 5px; }
                @media (min-width: 1600px) { .mainGrid { grid-template-columns: minmax(0, 2.6fr) minmax(300px, 1fr); }.alerts { grid-template-columns: 1fr; gap: 0; } }
                @media (max-width: 1200px) { .metricsGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.bottomGrid { grid-template-columns: 1fr; }.alerts { grid-template-columns: 1fr; gap: 0; }.dateLabel { display: none; } }
                @media (max-width: 1000px) { table, tbody { display: block; }thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; padding: 20px; border-top: 1px solid #E3DADD; }td { display: block; padding: 0; border: 0; font-size: 15px; }td::before { content: attr(data-label); display: block; color: #6D6064; font-size: 12px; font-weight: 400; margin-bottom: 5px; }td:nth-child(2) { grid-column: 1 / -1; }.pageIntro { flex-wrap: wrap; } }
                @media (max-width: 760px) { .shell { flex-direction: column; }.sidebar { flex: none; width: 100%; padding: 16px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 12px; }.brand { grid-row: 1; grid-column: 1; padding: 0; gap: 10px; }.brand strong { font-size: 18px; }.brand span { font-size: 10px; letter-spacing: 1px; }.brandMark { flex-basis: 40px; height: 40px; }.menuToggle { display: flex; align-items: center; justify-content: center; gap: 8px; grid-row: 1; grid-column: 2; border: 1px solid #A85C6A; background: #6B1F2B; color: white; border-radius: 8px; padding: 8px 12px; font-size: 14px; }.workspaceLabel, .sidebarBottom { display: none; }.navList { display: none; grid-column: 1 / -1; padding-top: 16px; }.navList.isOpen { display: grid; }.navItem { font-size: 16px; min-height: 48px; }.content { width: 100%; padding: 0 16px 28px; }.topbar { min-height: 64px; }.pageIntro { align-items: stretch; gap: 20px; flex-direction: column; padding: 24px 0; }.pageIntro h1 { font-size: 28px; }.eyebrow { font-size: 12px; letter-spacing: .7px; }.primaryButton { width: 100%; }.metricsGrid { gap: 12px; }.metricCard { padding: 16px; }.metricTop { letter-spacing: 0; }.metricCard > strong { font-size: 30px; }.metricDelta em { display: block; }.mainGrid { margin-top: 20px; }.panelHeader { padding: 18px 16px; }.alerts { padding: 0 16px; }.outlineButton { margin: 8px 16px 18px; width: calc(100% - 32px); }.chart { padding-left: 16px; padding-right: 16px; }.activityList { padding-left: 16px; padding-right: 16px; }tr { padding: 18px 16px; }.cellMuted { font-size: 14px; }.status { font-size: 14px; } }
                @media (max-width: 380px) { .metricsGrid { grid-template-columns: 1fr; }.metricDelta em { display: inline; margin-left: 4px; }.brandMark { display: none; }tr { grid-template-columns: 1fr; }.menuToggle { padding: 8px; } }

			`}</style>
		</main>
	);
}
