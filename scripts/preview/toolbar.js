const bar = document.createElement("nav");
bar.setAttribute("aria-label", "Preview controls");
bar.style.cssText =
  "position:fixed;right:16px;top:8px;z-index:1000;display:flex;align-items:center;gap:8px;background:#222;color:#eee;padding:8px 12px;border:1px solid #555;border-radius:8px;font:12px system-ui;max-width:calc(100vw - 32px);flex-wrap:wrap";
bar.innerHTML = `<strong>Preview · OpenCode 1.2.27</strong><span>Read-only fixtures</span><button data-action="restart">Replay working chat</button><button data-action="pause">Pause</button><button data-action="play">Play</button><button data-action="hide">Hide controls</button>`;
bar.addEventListener("click", (event) => {
  // oxlint-disable-next-line promise/prefer-await-to-then -- DOM event callbacks cannot return promises.
  void handle().catch(console.error);
  async function handle() {
    const action = event.target instanceof HTMLElement ? event.target.dataset.action : undefined;
    if (action === undefined || action === "") return;
    if (action === "hide") {
      bar.remove();
      return;
    }
    const response = await fetch(`/__preview/control?action=${action}`, { method: "POST" });
    if (!response.ok) return;
    if (action === "restart") {
      window.location.hash = "chats/working";
      window.location.reload();
    }
  }
});
document.body.append(bar);
if (!window.location.hash) window.location.hash = "chats/completed";
