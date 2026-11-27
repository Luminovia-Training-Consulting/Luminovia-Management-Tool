/** Check for new shell versions on return to the app without background polling or automatic reloads. */
export function watchPwaUpdates(
  registration: ServiceWorkerRegistration,
  offerWaitingUpdate: () => void,
) {
  let lastCheck = -Infinity;
  let checking = false;
  function check() {
    if (!navigator.onLine || document.visibilityState !== "visible") return;
    // A dismissed update can still be waiting when the installed app resumes.
    if (registration.active && registration.waiting) {
      offerWaitingUpdate();
      return;
    }
    if (checking || registration.installing || Date.now() - lastCheck < 60_000)
      return;
    checking = true;
    lastCheck = Date.now();
    void registration
      .update()
      .catch(() => {
        // A healthy page must stay usable even if the update request fails.
      })
      .finally(() => {
        checking = false;
      });
  }
  function restore(event: PageTransitionEvent) {
    if (event.persisted) check();
  }

  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  window.addEventListener("pageshow", restore);
  return () => {
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("online", check);
    window.removeEventListener("pageshow", restore);
  };
}
