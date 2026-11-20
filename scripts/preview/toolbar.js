const bar = document.createElement("nav");
bar.setAttribute("aria-label", "Preview controls");
bar.style.cssText =
  "position:fixed;right:16px;top:8px;z-index:1000;display:flex;align-items:center;gap:8px;background:#222;color:#eee;padding:8px 12px;border:1px solid #555;border-radius:8px;font:12px system-ui;max-width:calc(100vw - 32px);flex-wrap:wrap";
bar.innerHTML = `<span>Demo · GitHub checks and automation runs are simulated</span><button data-action="restart">Replay chat</button><button data-action="pause">Pause</button><button data-action="play">Play</button><label>Checks <select aria-label="Preview checks"><option value="saved">Saved scenario</option><option value="pending">Pending</option><option value="success">Passing</option><option value="failure">Failing</option><option value="stale">Previous head</option></select></label><button data-action="hide">Hide controls</button>`;
/** @param {string} chat @param {string} state */
const changeChecks = async (chat, state) => {
  try {
    await fetch(`/__preview/checks?chat=${encodeURIComponent(chat)}&state=${state}`, {
      method: "POST",
    });
  } catch (error) {
    console.error(error);
  }
};
/** @param {string} id */
const loadChecks = async (id) => {
  try {
    const response = await fetch(`/__preview/checks?chat=${encodeURIComponent(id)}`);
    const state = /"state":"([^"]+)"/.exec(await response.text())?.[1] ?? "saved";
    if (window.location.hash.startsWith(`#chats/${id}`)) {
      bar.querySelector("select").value = state;
    }
  } catch (error) {
    console.error(error);
  }
};

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
    const { hash } = window.location;
    const chat = /^#chats\/([^/?]+)(?:\?.*)?$/.exec(hash)?.[1];
    if (chat === undefined || chat === "") return;
    const response = await fetch(
      `/__preview/control?action=${action}&chat=${encodeURIComponent(chat)}`,
      { method: "POST" },
    );
    if (!response.ok) return;
    if (action === "restart" && window.location.hash === hash) {
      window.location.reload();
    }
  }
});
bar.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  const chat = /^#chats\/([^/?]+)(?:\?.*)?$/.exec(window.location.hash)?.[1];
  if (chat === undefined) return;
  void changeChecks(chat, select.value);
});
document.body.append(bar);
if (!window.location.hash) window.location.hash = "chats/completed";

const updateControls = () => {
  const id = /^#chats\/([^/?]+)(?:\?.*)?$/.exec(window.location.hash)?.[1];
  const chat = id !== undefined && id !== "new";
  bar.querySelector("select").disabled = !chat;
  if (chat) void loadChecks(id);

  for (const button of bar.querySelectorAll("button[data-action]:not([data-action=hide])")) {
    button.disabled = !chat;
  }
};
window.addEventListener("hashchange", updateControls);

updateControls();
