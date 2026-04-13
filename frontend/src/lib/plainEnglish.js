/* plainEnglish — turn cryptic agent verbs into human-readable explanations.

   Used by IncidentCard (live) and IncidentHistory (closed) so non-engineers
   can read the cards without needing to know what "enable_fallback" means.

   Three exports:
     - explainAction(action, rootCause)  →  {title, why, target, ok, raw}
     - explainIncident(incident)         →  one-paragraph plain summary
     - SERVICE_BLURBS                    →  one-line "what this service does"
*/

/* One-line summary of what each service does in the mesh. Surfaced in every
   incident explanation so non-engineers don't need a glossary. */
export const SERVICE_BLURBS = {
  gateway:        "the public API door — every browser request hits this first",
  order:          "the orchestrator — coordinates checkout, refund, cart-merge across other services",
  auth:           "the login service — issues and validates user tokens",
  inventory:      "the warehouse — tracks stock, reserves/releases units for orders",
  payments:       "the cashier — authorises, captures, and refunds charges",
  fraud:          "the risk scorer — decides whether to approve, review, or deny an order",
  shipping:       "the fulfilment service — produces quotes and shipping labels",
  notification:   "the messenger — sends order updates to the user",
  recommendation: "the suggestion engine — returns personalised SKUs and tracks user activity",
};

/* What each gRPC Control verb actually does, in everyday language.
   Keep these short — they render inside small action rows. */
const ACTION_VERB_PLAIN = {
  clear_failure: {
    short: "Reset",
    long: "told the service to clear its bad state and start serving requests normally again",
  },
  enable_fallback: {
    short: "Switched to backup behaviour",
    long: "told this service to accept new requests with a deferred response when its dependency is unreachable, so end users see success instead of an error",
  },
  disable_fallback: {
    short: "Returned to normal routing",
    long: "told this service to stop using its backup behaviour now that its dependency has recovered",
  },
  mark_degraded: {
    short: "Flagged as degraded",
    long: "marked this service as serving partial responses so other services route around it",
  },
};

/* A friendly noun for each role a service plays in an incident. */
function rolePlain(serviceId, rootCause) {
  if (!serviceId) return "the system";
  if (serviceId === rootCause) return `the root cause (${serviceId})`;
  return `an upstream caller (${serviceId})`;
}

/* Convert one action object into a plain-English row. Used by both cards. */
export function explainAction(action, rootCause) {
  if (!action) return null;
  const verb = ACTION_VERB_PLAIN[action.action] || {
    short: action.action,
    long: action.action,
  };
  const isRoot = action.service === rootCause;
  const blurb = SERVICE_BLURBS[action.service] || "";
  return {
    title: verb.short,
    target: action.service,
    targetBlurb: blurb,
    why: isRoot
      ? `Recover the failing service. The agent ${verb.long}.`
      : `Protect users while ${rootCause || "the failing service"} recovers. The agent ${verb.long}.`,
    ok: action.ok !== false,
    raw: `${action.action} on ${action.service}`,
  };
}

/* Compose a one-paragraph plain-English summary of an incident.
   `incident` is the shape produced by api/agent.js:shapeIncident. */
export function explainIncident(incident) {
  if (!incident) return "";
  const root = incident.rootCause || "an unknown service";
  const rootDesc = SERVICE_BLURBS[root]
    ? `${root} (${SERVICE_BLURBS[root]})`
    : root;
  const suspects = incident.suspects || [];
  const others = suspects.filter((s) => s !== root);
  const actions = incident.actions || [];

  const detectionSource =
    incident.source === "llm"
      ? "the AI agent"
      : "the rule-based safety engine";

  // Detection sentence — name the root cause AND say what it does.
  let detection = `${capitalize(detectionSource)} noticed `;
  if (others.length > 0) {
    detection += `errors across ${others.length + 1} services and traced them back to ${rootDesc}.`;
  } else {
    detection += `${rootDesc} was failing requests, while everything else looked healthy.`;
  }

  // Diagnosis sentence
  const diagnosis = others.length
    ? `Because nothing downstream of ${root} was broken, the agent identified ${root} as the root cause and treated ${others.join(", ")} as collateral damage.`
    : `${capitalize(root)} had no failing dependencies, so it was identified as the root cause.`;

  // Remediation sentence — name each upstream service AND say what it does.
  let remediation = "";
  if (actions.length === 0) {
    remediation = "No remediation was applied yet.";
  } else {
    const rootActions = actions.filter((a) => a.service === root);
    const upstreamActions = actions.filter((a) => a.service !== root);
    const parts = [];
    if (rootActions.length) {
      parts.push(`reset ${root} so it stops returning errors`);
    }
    if (upstreamActions.length) {
      const named = upstreamActions
        .map((a) => SERVICE_BLURBS[a.service]
          ? `${a.service} (${SERVICE_BLURBS[a.service]})`
          : a.service)
        .join(" and ");
      parts.push(`switched ${named} into a graceful-degradation mode so users see deferred-success responses instead of errors during recovery`);
    }
    remediation = `To self-heal, the agent ${parts.join(", and ")}.`;
  }

  return `${detection} ${diagnosis} ${remediation}`;
}

/* Helper: capitalize the first letter of a sentence. */
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Map an action.action verb to its plain title, for short labels. */
export function actionShortTitle(verb) {
  return (ACTION_VERB_PLAIN[verb] || { short: verb }).short;
}
