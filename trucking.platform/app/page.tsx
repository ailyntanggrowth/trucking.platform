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
			<aside className="sidebar">
				<div className="brand">
					<div className="brandMark">M&A</div>
					<div>
						<strong>M&A King</strong>
						<span>TRUCK SERVICE</span>
					</div>
				</div>

				<div className="workspaceLabel">OPERACIONES</div>
				<nav className="navList" aria-label="Navegación principal">
					{navItems.map((item) => (
						<button
							className={`navItem ${activeItem === item.label ? "active" : ""}`}
							key={item.label}
							onClick={() => setActiveItem(item.label)}
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

			<section className="content">
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
								<tbody>{trips.map((trip) => <tr key={trip.id}><td className="tripId">{trip.id}</td><td><strong>{trip.route}</strong><span className="cellMuted">Carga completa · 34,200 lb</span></td><td><strong>{trip.driver}</strong><span className="cellMuted">{trip.truck}</span></td><td><span className={`status ${statusStyles[trip.status]}`}><i />{trip.status}</span></td><td className="eta">{trip.eta}</td></tr>)}</tbody>
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
					<div className="panel chartPanel"><div className="panelHeader"><div><h2>Ingresos</h2><p>Rendimiento de los últimos 6 meses</p></div><button className="selectButton">Últimos 6 meses⌄</button></div><div className="chart"><div className="chartLabels"><span>$300k</span><span>$200k</span><span>$100k</span><span>$0</span></div><div className="chartArea"><div className="gridLine line1" /><div className="gridLine line2" /><div className="gridLine line3" /><svg viewBox="0 0 640 150" preserveAspectRatio="none" aria-label="Gráfica de ingresos"><path d="M0,116 C50,106 65,82 120,92 S190,114 240,69 S310,73 360,57 S430,74 480,35 S550,66 640,14" fill="none" stroke="#ef6c47" strokeWidth="3" /><path d="M0,116 C50,106 65,82 120,92 S190,114 240,69 S310,73 360,57 S430,74 480,35 S550,66 640,14 V150 H0 Z" fill="url(#chartFill)" opacity=".18" /><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#ef6c47" /><stop offset="1" stopColor="#fff5ef" /></linearGradient></defs></svg><div className="monthLabels"><span>Abr</span><span>May</span><span>Jun</span><span>Jul</span><span>Ago</span><span>Sep</span></div></div></div></div>
					<div className="panel activityPanel"><div className="panelHeader"><div><h2>Actividad reciente</h2><p>Últimas actualizaciones</p></div><button className="textButton">Ver historial <span>→</span></button></div><div className="activityList"><div><span className="activityDot green" /><p><strong>Viaje TR-2084</strong> llegó a Flagstaff, AZ<span>Hace 8 minutos · Sistema</span></p></div><div><span className="activityDot orange" /><p><strong>Nuevo mantenimiento</strong> programado para MK-104<span>Hace 34 minutos · Adianez Tang Johnson</span></p></div><div><span className="activityDot blue" /><p><strong>Factura #INV-4818</strong> marcada como pagada<span>Hace 1 hora · Finanzas</span></p></div></div></div>
				</section>
			</section>

			<style jsx>{`
				@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
				:global(*) { box-sizing: border-box; }
				:global(body) { margin: 0; background: #f7f8f7; color: #1c2b2b; font-family: 'DM Sans', sans-serif; }
				button { font: inherit; cursor: pointer; }
				.shell { display: flex; min-height: 100vh; background: #f7f8f7; }
				.sidebar { width: 244px; background: #123b3b; color: #d9e8e4; padding: 30px 16px 18px; display: flex; flex-direction: column; }
				.brand { display: flex; gap: 11px; align-items: center; padding: 0 13px 47px; color: white; }
				.brandMark { width: 39px; height: 39px; background: #e9754e; color: white; border-radius: 9px; display: grid; place-items: center; font: 700 12px 'Space Grotesk'; transform: rotate(-5deg); }
				.brand strong, .brand span { display: block; line-height: 1.1; }.brand strong { font: 700 16px 'Space Grotesk'; letter-spacing: -.5px; }.brand span { font-size: 8px; letter-spacing: 2px; color: #8db0a8; margin-top: 4px; }
				.workspaceLabel { color: #71978f; font-size: 10px; letter-spacing: 1.7px; font-weight: 700; padding: 0 14px 13px; }
				.navList { display: grid; gap: 4px; }.navItem { border: 0; background: transparent; color: #a7c5bf; height: 44px; border-radius: 7px; text-align: left; padding: 0 13px; display: flex; align-items: center; gap: 13px; font-size: 13px; transition: .2s; }.navItem:hover, .navItem.active { background: #275653; color: white; }.navIcon { width: 17px; text-align: center; color: #8eb9af; font-size: 18px; }.navItem.active .navIcon { color: #f18a60; }.navBadge { margin-left: auto; color: #ffc4a9; background: #794431; border-radius: 20px; padding: 2px 7px; font-size: 10px; }
				.sidebarBottom { margin-top: auto; }.supportCard { background: #1b4b49; border: 1px solid #2c615d; border-radius: 8px; padding: 13px 11px; display: flex; gap: 9px; margin: 0 3px 21px; }.supportIcon { border: 1px solid #7ba69d; border-radius: 50%; min-width: 19px; height: 19px; text-align: center; font-size: 12px; }.supportCard strong, .supportCard span, .userRow strong, .userRow span { display: block; }.supportCard strong { font-size: 11px; color: white; }.supportCard span:not(.supportIcon) { font-size: 10px; color: #8db0a8; margin-top: 3px; }.userRow { border-top: 1px solid #2a5755; padding: 18px 7px 0; display: flex; align-items: center; gap: 9px; }.avatar { background: #d8a07f; color: #58372a; width: 31px; height: 31px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 700; }.userRow strong { color: white; font-size: 11px; }.userRow span { font-size: 10px; color: #8db0a8; margin-top: 3px; }.more { margin-left: auto; letter-spacing: 2px; }
				.content { flex: 1; min-width: 0; padding: 0 40px 46px; }.topbar { height: 79px; border-bottom: 1px solid #e3e8e5; display: flex; justify-content: space-between; align-items: center; }.breadcrumb { color: #98a6a2; font-size: 12px; display: flex; gap: 10px; }.breadcrumb b { color: #c7cecb; font-weight: 400; }.breadcrumb strong { color: #405250; font-weight: 600; }.topActions { display: flex; align-items: center; gap: 21px; }.dateLabel { font-size: 11px; color: #7c8a86; }.iconButton { position: relative; border: 0; background: transparent; font-size: 24px; color: #71827d; transform: rotate(45deg); }.notificationDot { position: absolute; right: 1px; top: 2px; width: 6px; height: 6px; border-radius: 50%; background: #ec7653; border: 1px solid #f7f8f7; }
				.pageIntro { display: flex; justify-content: space-between; align-items: end; padding: 38px 0 28px; }.eyebrow { color: #e4744e; font-size: 10px; font-weight: 700; letter-spacing: 1.6px; margin: 0 0 10px; }.pageIntro h1 { margin: 0; font: 700 28px 'Space Grotesk', sans-serif; letter-spacing: -1.2px; color: #193d3b; }.pageIntro h1 span { color: #e87550; font-size: 20px; vertical-align: 4px; }.subtitle { color: #81908c; font-size: 13px; margin: 7px 0 0; }.primaryButton { border: 0; background: #e9754e; color: #fff; padding: 11px 17px; border-radius: 6px; font-weight: 600; font-size: 12px; box-shadow: 0 4px 10px #e9754e2b; }.primaryButton span { font-size: 19px; line-height: 8px; vertical-align: -2px; margin-right: 7px; }
				.metricsGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 13px; }.metricCard { background: white; padding: 18px 20px 16px; border: 1px solid #e5ebe8; border-top: 3px solid; border-radius: 5px; min-width: 0; }.accentBlue { border-top-color: #77aeb5; }.accentOrange { border-top-color: #e9754e; }.accentTeal { border-top-color: #5a9b80; }.accentRose { border-top-color: #c98270; }.metricTop { display: flex; justify-content: space-between; align-items: center; color: #85938f; font-size: 9px; font-weight: 700; letter-spacing: 1.2px; }.metricIcon { color: #92aaa4; font-size: 18px; font-weight: 400; }.metricCard > strong { display: block; margin: 15px 0 8px; color: #1f4744; font: 700 26px 'Space Grotesk'; }.smallMetric { color: #83948e; font-size: 14px; }.metricDelta { font-size: 10px; font-weight: 700; }.metricDelta em { font-style: normal; font-weight: 400; color: #98a49f; margin-left: 3px; }.positive { color: #4b9d78; }.neutral { color: #6c8980; }
				.mainGrid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr); gap: 14px; margin-top: 24px; }.panel { background: #fff; border: 1px solid #e5ebe8; border-radius: 5px; }.panelHeader { display: flex; justify-content: space-between; align-items: flex-start; padding: 21px 22px 17px; }.panelHeader h2 { margin: 0; color: #254946; font: 600 15px 'Space Grotesk'; }.panelHeader p { margin: 5px 0 0; color: #9aa6a2; font-size: 11px; }.textButton { border: 0; background: transparent; color: #d76d4b; font-size: 11px; font-weight: 700; padding: 2px 0; }.textButton span, .outlineButton span { font-size: 16px; padding-left: 5px; }.tableWrap { overflow-x: auto; }table { border-collapse: collapse; width: 100%; min-width: 690px; }th { text-align: left; color: #a1aca8; font-size: 9px; letter-spacing: .8px; font-weight: 700; background: #fbfcfb; padding: 10px 21px; border-top: 1px solid #eef1ef; border-bottom: 1px solid #eef1ef; }td { padding: 14px 21px; border-bottom: 1px solid #eff2f0; color: #385250; font-size: 11px; white-space: nowrap; }tr:last-child td { border-bottom: 0; }.tripId { color: #e4744e; font-weight: 700; }.cellMuted { display: block; color: #9ca9a5; font-size: 10px; margin-top: 4px; }.status { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; }.status i { display: block; width: 6px; height: 6px; border-radius: 50%; }.statusTransit { color: #559775; }.statusTransit i { background: #59a77d; }.statusLoading { color: #d48645; }.statusLoading i { background: #e2a354; }.statusScheduled { color: #77919a; }.statusScheduled i { background: #8facb4; }.eta { color: #5c6e69; }
				.alertCount { background: #fae9e3; color: #db6d4a; border-radius: 50%; width: 22px; height: 22px; display: grid; place-items: center; font-size: 10px; font-weight: 700; }.alerts { padding: 0 22px; }.alertItem { display: flex; gap: 11px; padding: 14px 0; border-top: 1px solid #edf1ef; }.alertIcon { min-width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; }.alertIcon.red { color: #df7559; background: #fcedea; }.alertIcon.amber { color: #ce9242; background: #fff6e8; }.alertIcon.blue { color: #6699a5; background: #eaf5f5; }.alertItem strong { font-size: 11px; color: #385350; }.alertItem p { margin: 3px 0 4px; color: #7f8d89; font-size: 10px; }.alertItem div span { color: #b0bab7; font-size: 9px; }.outlineButton { margin: 8px 22px 20px; width: calc(100% - 44px); background: white; color: #d76d4b; border: 1px solid #ebc3b6; border-radius: 4px; padding: 9px; font-size: 10px; font-weight: 700; }
				.bottomGrid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, .8fr); gap: 14px; margin-top: 14px; }.selectButton { border: 1px solid #e2e9e6; color: #73837e; background: white; border-radius: 3px; font-size: 10px; padding: 7px 10px; }.chart { display: flex; padding: 4px 22px 16px; height: 180px; }.chartLabels { width: 38px; display: flex; flex-direction: column; justify-content: space-between; padding: 4px 0 25px; color: #a5afab; font-size: 9px; }.chartArea { position: relative; flex: 1; height: 145px; }.chartArea svg { position: absolute; left: 0; right: 0; top: 0; width: 100%; height: 120px; overflow: visible; }.gridLine { border-top: 1px dashed #e7ece9; position: absolute; width: 100%; }.line1 { top: 8px; }.line2 { top: 50px; }.line3 { top: 91px; }.monthLabels { position: absolute; display: flex; justify-content: space-between; width: 100%; bottom: 0; color: #a5afab; font-size: 9px; }.activityList { padding: 0 22px 10px; }.activityList > div { display: flex; gap: 10px; padding: 11px 0; border-top: 1px solid #edf1ef; }.activityDot { width: 7px; height: 7px; min-width: 7px; border-radius: 50%; margin-top: 4px; }.activityDot.green { background: #63a482; }.activityDot.orange { background: #e98b56; }.activityDot.blue { background: #78aab3; }.activityList p { margin: 0; color: #7e8d88; font-size: 10px; line-height: 1.4; }.activityList strong { color: #45605a; font-weight: 700; }.activityList p span { display: block; color: #adb7b3; font-size: 9px; margin-top: 4px; }
				@media (max-width: 1100px) { .content { padding: 0 24px 35px; }.sidebar { width: 210px; }.metricsGrid { grid-template-columns: repeat(2, 1fr); }.bottomGrid { grid-template-columns: 1fr; } }
				@media (max-width: 760px) { .sidebar { width: 62px; padding: 20px 8px; }.brand { padding: 0 3px 38px; }.brand > div:last-child, .workspaceLabel, .navItem:not(.active)::after, .navItem { font-size: 0; }.navItem { justify-content: center; padding: 0; }.navIcon { font-size: 18px; }.navBadge { position: absolute; margin: -21px -22px 0 0; }.supportCard, .userRow > div:not(.avatar), .more { display: none; }.userRow { justify-content: center; padding-left: 0; padding-right: 0; }.content { padding: 0 15px 25px; }.topbar { height: 64px; }.dateLabel { display: none; }.pageIntro { align-items: flex-start; gap: 14px; flex-direction: column; padding: 28px 0 21px; }.primaryButton { align-self: stretch; }.metricsGrid { gap: 8px; }.metricCard { padding: 14px 13px; }.metricTop { font-size: 8px; }.metricCard > strong { font-size: 22px; }.mainGrid { grid-template-columns: 1fr; margin-top: 14px; }.panelHeader { padding: 17px 15px 14px; }.alerts { padding: 0 15px; }.outlineButton { margin-left: 15px; width: calc(100% - 30px); }.chart { padding-left: 15px; padding-right: 15px; } }
			`}</style>
		</main>
	);
}
