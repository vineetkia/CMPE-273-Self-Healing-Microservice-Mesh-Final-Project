/* App — top-level router. Picks landing/login/register/dashboard/profile.
   Auth gates the dashboard; landing is the unauthenticated home. */

import React, { useEffect, useMemo, useState } from "react";
import { TopBar } from "./components/TopBar";
import { FlowSelectorBand, FLOW_ORDER } from "./components/FlowSelectorBand";
import { DependencyGraph, computeLayout } from "./components/DependencyGraph";
import { IncidentCard } from "./components/IncidentCard";
import { IncidentHistory } from "./components/IncidentHistory";
import { AgentDecisionsFeed } from "./components/AgentDecisionsFeed";
import { ServiceHealth } from "./components/ServiceHealth";
import { FlowExerciser } from "./components/FlowExerciser";
import { TrafficGenerator } from "./components/TrafficGenerator";
import { ChaosPanel } from "./components/ChaosPanel";
import { ServiceDrillPanel } from "./components/ServiceDrillPanel";
import { ShortcutOverlay } from "./components/ShortcutOverlay";
import { CountUp } from "./components/Primitives";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { ProfilePage } from "./components/ProfilePage";
import { NotificationBell } from "./components/NotificationBell";

import { useFlows } from "./hooks/useFlows";
import { useMeshState } from "./hooks/useMeshState";
import { useTraffic } from "./hooks/useTraffic";
import { useChaos } from "./hooks/useChaos";
import { useFlowExerciser } from "./hooks/useFlowExerciser";
import { useDrillCalls } from "./hooks/useDrillCalls";
import { useAuth } from "./hooks/useAuth";
import { useNotifications } from "./hooks/useNotifications";
import { useRoute } from "./hooks/useRoute";
import { JAEGER_URL, PROM_URL } from "./api/config";

export default function App() {
  const auth = useAuth();
  const { route, navigate } = useRoute();
  const [busy, setBusy] = useState(false);

  // Pick what to render based on route + auth status.
  // Defaults: anon → landing; authed → dashboard.
  const effectiveRoute = useMemo(() => {
    if (auth.status === "loading") return "loading";
    const isAuthed = auth.status === "authed";
    if (!route) return isAuthed ? "dashboard" : "landing";
    if ((route === "dashboard" || route === "profile") && !isAuthed) return "landing";
    if ((route === "login" || route === "register") && isAuthed) return "dashboard";
    return route;
  }, [route, auth.status]);

  // Reflect that effective route in the URL hash without recursion.
  useEffect(() => {
    if (effectiveRoute === "loading") return;
    const want = `#/${effectiveRoute}`;
    if (window.location.hash !== want) window.location.hash = want;
  }, [effectiveRoute]);

  // Loading state — quick splash while we validate any persisted token.
  if (effectiveRoute === "loading") {
    return (
      <div className="boot-splash">
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
          <circle cx="6" cy="6" r="2" fill="var(--fg)" />
          <circle cx="18" cy="6" r="2" fill="var(--fg)" />
          <circle cx="12" cy="12" r="2.4" fill="var(--signal)"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" /></circle>
          <circle cx="6" cy="18" r="2" fill="var(--fg)" />
          <circle cx="18" cy="18" r="2" fill="var(--fg)" />
        </svg>
        <div className="muted">Mesh Control · checking session</div>
      </div>
    );
  }

  if (effectiveRoute === "landing") {
    return (
      <LandingPage
        onLogin={() => navigate("login")}
        onRegister={() => navigate("register")}
      />
    );
  }

  if (effectiveRoute === "login") {
    return (
      <LoginPage
        busy={busy}
        onSwitchRegister={() => navigate("register")}
        onSwitchLanding={() => navigate("landing")}
        onSubmit={async (creds) => {
          setBusy(true);
          try { return await auth.login(creds); }
          finally { setBusy(false); }
        }}
      />
    );
  }

  if (effectiveRoute === "register") {
    return (
      <RegisterPage
        busy={busy}
        onSwitchLogin={() => navigate("login")}
        onSwitchLanding={() => navigate("landing")}
        onSubmit={async (form) => {
          setBusy(true);
          try { return await auth.register(form); }
          finally { setBusy(false); }
        }}
      />
    );
  }

  if (effectiveRoute === "profile") {
    return (
      <ProfilePage
        user={auth.user}
        onBack={() => navigate("dashboard")}
        onLogout={async () => {
          await auth.logout();
          navigate("landing");
        }}
      />
    );
  }

  // Dashboard (authed)
  return <Dashboard auth={auth} navigate={navigate} />;
}

/* The dashboard surface: extracted so its hooks only run when the user is
   actually authenticated. Mounting it unconditionally would fire /flows,
   /services/health, /state polls before the user logs in — wasteful and
   could trigger CORS noise on the landing page. */
function Dashboard({ auth, navigate }) {
  const flows = useFlows("checkout");
  const mesh = useMeshState(1500);
  const traffic = useTraffic();
  const chaos = useChaos();
  const exer = useFlowExerciser();
  const drillCalls = useDrillCalls(mesh.decisions);
  const notif = useNotifications(auth.token);

  const [drill, setDrill] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // 1Hz tick so relTime() updates.
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const flow = flows.flows[flows.activeFlow] || flows.flows.checkout;
  const flowServices = useMemo(
    () => mesh.services.filter(x => flow.services.includes(x.id)),
    [flow.services, mesh.services],
  );
  const flowEdges = flow.edges;
  const layout = useMemo(
    () => computeLayout(flowServices, flowEdges),
    [flows.activeFlow, flowServices.length, flowEdges.length],
  );
  const faulty = mesh.incident ? mesh.incident.rootCause : null;

  const focusOnGraph = (id) => setDrill(id === drill ? null : id);
  const closeDrill = () => setDrill(null);
  const jumpToChaos = (svc) => {
    chaos.setService(svc);
    document.getElementById("chaos-panel")?.scrollIntoView?.({ block: "nearest" });
  };

  // Keyboard shortcuts
  useEffect(() => {
    let lastG = 0;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShortcutsOpen(o => !o); return; }
      if (e.key === "Escape") {
        setShortcutsOpen(false);
        if (drill) closeDrill();
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const id = FLOW_ORDER[idx];
        if (id && flows.flows[id]) flows.setActiveFlow(id);
        return;
      }
      if (e.key === "g") { lastG = Date.now(); return; }
      if (e.key === "j" && Date.now() - lastG < 800) { window.open(JAEGER_URL, "_blank"); return; }
      if (e.key === "p" && Date.now() - lastG < 800) { window.open(PROM_URL,   "_blank"); return; }
      if (e.key === "c") { chaos.clearAll(); return; }
      if (e.key === "t") { traffic.setRunning(!traffic.traffic.running); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, traffic.traffic.running, flows.flows]);

  const flowP95 = flowServices.length
    ? flowServices.reduce((a, sv) => a + (mesh.health[sv.id]?.p95 || 0), 0) / flowServices.length
    : 0;

  const notifBell = (
    <NotificationBell
      unread={notif.unread}
      items={notif.items}
      onMarkRead={notif.markRead}
      onMarkAllRead={notif.markAllRead}
    />
  );

  return (
    <div className="app">
      <TopBar
        rps={mesh.rps}
        pulse={mesh.pulse}
        lastIncidentAt={mesh.lastIncidentAt}
        bootedAt={mesh.bootedAt}
        onHelp={() => setShortcutsOpen(true)}
        user={auth.user}
        onProfile={() => navigate("profile")}
        notifSlot={notifBell}
      />

      <FlowSelectorBand
        flows={flows.flows}
        activeFlow={flows.activeFlow}
        onSelect={flows.setActiveFlow}
        onScripted={flows.runScripted}
        scriptedRunning={flows.scriptedRunning}
      />

      <div className="shell">
        <div className="card hero">
          <div className="hero-strip">
            <div className="hero-overlay">
              <span className="label">Topology</span>
              <span style={{ color: "var(--fg-5)" }}>·</span>
              <div className="crumbs">
                <span style={{ color: "var(--fg)" }}>{flow.title}</span>
                <span className="sep">/</span>
                <span className="ep">{flow.endpoint}</span>
                <span className="sep">/</span>
                <span>{flow.services.length} services</span>
              </div>
            </div>
            <div className="hero-stats">
              <div className="stat">
                <div className="v"><CountUp value={mesh.rps} /></div>
                <div className="l">requests / sec</div>
              </div>
              <div className="stat">
                <div className="v"><CountUp value={flowP95} decimals={0} suffix="ms" /></div>
                <div className="l">flow p95</div>
              </div>
              <div className="stat">
                <div className="v" style={{ color: faulty ? "var(--crit)" : "var(--signal)" }}>{faulty ? "1" : "0"}</div>
                <div className="l">active incidents</div>
              </div>
            </div>
          </div>

          <div className="hero-graph-region">
            <DependencyGraph
              services={flowServices}
              edges={flowEdges}
              layout={layout}
              health={mesh.health}
              focused={drill}
              faulty={faulty}
              traffic={traffic.traffic.running}
              onFocus={focusOnGraph}
              onBgClick={closeDrill}
            />
          </div>

          <div className="hero-strip bottom">
            <div className="hero-legend">
              <div className="item"><span className="swatch flow"></span><span>Healthy traffic</span></div>
              <div className="item"><span className="swatch warn"></span><span>Failing edge</span></div>
              <div className="item"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--signal)" }}></span><span>Service nominal</span></div>
              <div className="item"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--crit)" }}></span><span>Service unreachable</span></div>
            </div>
            <span className="label" style={{ color: "var(--fg-4)" }}>scroll to zoom · drag to pan</span>
          </div>
        </div>

        <div className="action-strip">
          <TrafficGenerator
            traffic={traffic.traffic}
            orders={traffic.orders}
            onToggle={traffic.setRunning}
            onRps={traffic.setRps}
            onBurst={traffic.burst}
          />
          <ChaosPanel
            services={mesh.services}
            flowServices={flow.services}
            chaos={chaos.chaos}
            activeChaos={chaos.activeChaos}
            onMode={chaos.setMode}
            onService={chaos.setService}
            onErrorRate={chaos.setErrorRate}
            onLatency={chaos.setLatency}
            onDuration={chaos.setDuration}
            onInject={chaos.inject}
            onClear={chaos.clear}
            onClearAll={chaos.clearAll}
          />
        </div>

        <div className="grid">
          <div className="col">
            <IncidentCard
              incident={mesh.incident}
              services={flowServices}
              edges={flowEdges}
              layout={layout}
              actions={mesh.actions}
              onMarkResolved={chaos.clear}
            />
            <IncidentHistory incidents={mesh.incidents} />
            <AgentDecisionsFeed decisions={mesh.decisions} lastTickAt={mesh.lastTickAt} />
          </div>

          <div className="col">
            <ServiceHealth
              services={mesh.services}
              flowServices={flow.services}
              health={mesh.health}
              sparks={mesh.sparks}
              focused={drill}
              onFocus={focusOnGraph}
            />
            <FlowExerciser
              activeFlow={flows.activeFlow}
              flows={flows.flows}
              lastResponse={exer.lastResponses[flows.activeFlow]}
              recentOrders={traffic.orders}
              onSubmit={exer.exercise}
            />
          </div>
        </div>
      </div>

      {drill && (
        <ServiceDrillPanel
          svc={drill}
          services={mesh.services}
          health={mesh.health}
          sparks={mesh.sparks}
          calls={drillCalls}
          onClose={closeDrill}
          onJumpToChaos={jumpToChaos}
        />
      )}

      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
