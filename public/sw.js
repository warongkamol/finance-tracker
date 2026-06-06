const CACHE_NAME = "finance-tracker-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const { title, body, data: payload } = data;

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: payload,
    actions: payload?.actions || [],
    requireInteraction: true,
    tag: payload?.tag || "finance-reminder",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const payload = event.notification.data;
  const action = event.action;

  let url = "/";
  if (action === "record" && payload?.recurringId) {
    url = `/transactions/new?recurringId=${payload.recurringId}`;
  } else if (action === "dismiss") {
    return;
  } else if (payload?.url) {
    url = payload.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});
