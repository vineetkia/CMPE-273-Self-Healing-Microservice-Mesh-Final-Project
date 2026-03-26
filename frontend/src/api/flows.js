import { GATEWAY_URL, jget, jpost } from "./config";

export async function fetchFlows() {
  return jget(`${GATEWAY_URL}/flows`);
}

export async function runScriptedDemo(flow) {
  return jpost(`${GATEWAY_URL}/demo/scripted`, { flow });
}

export async function scriptedDemoStatus() {
  return jget(`${GATEWAY_URL}/demo/status`);
}
