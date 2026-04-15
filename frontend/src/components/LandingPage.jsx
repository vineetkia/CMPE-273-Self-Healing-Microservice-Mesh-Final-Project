/* LandingPage — unauthenticated entry point. Hero + feature pillars +
   CTAs to sign in / register. Uses the same design tokens as the
   dashboard for visual continuity. */

import React from "react";
import { CheckGlyph } from "./Primitives";

export function LandingPage({ onLogin, onRegister }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
            <circle cx="6" cy="6" r="2" fill="var(--fg)" />
            <circle cx="18" cy="6" r="2" fill="var(--fg)" />
            <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
            <circle cx="6" cy="18" r="2" fill="var(--fg)" />
            <circle cx="18" cy="18" r="2" fill="var(--fg)" />
            <path d="M6 6 L12 12 L18 6 M6 18 L12 12 L18 18" stroke="var(--hairline-3)" strokeWidth="1" />
          </svg>
          <div className="name">Mesh<span>Control</span></div>
        </div>
        <div className="landing-nav-actions">
          <button className="btn ghost" onClick={onLogin}>Sign in</button>
          <button className="btn primary" onClick={onRegister}>Create account</button>
        </div>
      </header>

      <main className="landing-main">
        <section className="hero">
          <div className="eyebrow">CMPE-273 · Spring 2026</div>
          <h1>The microservice mesh that heals itself.</h1>
          <p className="subhead">
            An autonomous SRE for your service graph. Detects failures via
            statistical consensus, identifies root causes by walking the
            dependency DAG, and applies bounded remediation in under ten
            seconds — with an LLM driving reasoning and a deterministic
            rule engine guaranteeing safety.
          </p>
          <div className="cta-row">
            <button className="btn primary lg" onClick={onRegister}>Get started</button>
            <button className="btn ghost lg" onClick={onLogin}>I already have an account</button>
          </div>
          <div className="trust-row">
            <span><CheckGlyph size={11} /> 8 gRPC services</span>
            <span><CheckGlyph size={11} /> 6 e-commerce flows</span>
            <span><CheckGlyph size={11} /> 16 containers</span>
            <span><CheckGlyph size={11} /> Open-source, MIT</span>
          </div>
        </section>

        <section className="pillars">
          <div className="pillar">
            <div className="pillar-icon">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="8" stroke="var(--signal)" strokeWidth="1.4" />
                <path d="M11 6 L11 11 L14 13" stroke="var(--signal)" strokeWidth="1.4" />
              </svg>
            </div>
            <h3>Sub-10s recovery</h3>
            <p>2-of-3 statistical consensus on error rate, p95 latency, and
            health. Identifies the deepest failing service in the call graph,
            applies remediation, and verifies recovery.</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 11 L8 16 L19 5" stroke="var(--signal)" strokeWidth="1.4" />
              </svg>
            </div>
            <h3>LLM with safety boundaries</h3>
            <p>Azure GPT-5.3 reasons over telemetry; an action allowlist plus
            a 12-second cooldown plus a deterministic rule fallback mean the
            agent cannot crash the system or block recovery.</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 17 L7 11 L11 14 L17 5" stroke="var(--signal)" strokeWidth="1.4" />
                <circle cx="7" cy="11" r="1.6" fill="var(--signal)" />
                <circle cx="11" cy="14" r="1.6" fill="var(--signal)" />
                <circle cx="17" cy="5" r="1.6" fill="var(--signal)" />
              </svg>
            </div>
            <h3>Full observability stack</h3>
            <p>OpenTelemetry → Jaeger for traces, Prometheus for metrics,
            NATS for the event stream, Pydantic Logfire for LLM telemetry,
            and a custom dashboard for synthesis.</p>
          </div>
        </section>

        <section className="flows-strip">
          <div className="label">Six real e-commerce flows</div>
          <div className="flows-grid">
            <div className="flow"><code>POST /checkout</code><span>order → fraud → pay → ship</span></div>
            <div className="flow"><code>POST /refund</code><span>payments → inventory → notify</span></div>
            <div className="flow"><code>POST /cart/merge</code><span>guest → user with stock check</span></div>
            <div className="flow"><code>POST /inventory/restock</code><span>SKU + recommendation refresh</span></div>
            <div className="flow"><code>POST /fraud/review</code><span>re-score, hold or release</span></div>
            <div className="flow"><code>GET /recommendations/&#123;user&#125;</code><span>personalised + stock-aware</span></div>
          </div>
        </section>

        <footer className="landing-foot">
          <span>Vineet Kumar · Samved Sandeep Joshi · Girith Choudhary</span>
          <span style={{ color: "var(--fg-4)" }}>SJSU · Department of Computer Engineering</span>
        </footer>
      </main>
    </div>
  );
}
