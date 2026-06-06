import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export interface PushPayload {
  title: string;
  body: string;
  data?: {
    url?: string;
    recurringId?: string;
    tag?: string;
    actions?: Array<{ action: string; title: string }>;
  };
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    // 410 Gone = subscription expired, caller should delete it
    return { success: false, expired: status === 410 };
  }
}
