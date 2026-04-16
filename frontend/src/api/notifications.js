import { GATEWAY_URL, jpost } from "./config";

export async function listNotifications(token) {
  return jpost(`${GATEWAY_URL}/notifications`, { token });
}

export async function markNotificationRead(token, notification_id) {
  return jpost(`${GATEWAY_URL}/notifications/mark-read`, { token, notification_id });
}

export async function markAllNotificationsRead(token) {
  return jpost(`${GATEWAY_URL}/notifications/mark-all-read`, { token });
}
