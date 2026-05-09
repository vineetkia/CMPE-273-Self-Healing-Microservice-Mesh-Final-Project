import { GATEWAY_URL, jget } from "./config";

export async function fetchHealth() {
  return jget(`${GATEWAY_URL}/services/health`);
}
