// ── Public status page ───────────────────────────────────────────────
// WHAT: a no-login, self-serve "is this thing working right now" page,
// so any admin or rider can check reachability/activity themselves
// instead of asking whoever runs this project. Shows only aggregate
// counts (see fetchStatusSummary() in adapters/supabase.ts), never
// real ride names or ids, on purpose, this page has no login gate.

import { bikeTheme } from "./theme/bike/config";
import { fetchStatusSummary } from "./core/adapters/supabase";

const REFRESH_INTERVAL_MS = 30_000;

function applyStyles(): void {
  document.title = `${bikeTheme.eventWordSingular} platform status`;
  const style = document.createElement("style");
  style.textContent = `
    html, body { margin: 0; min-height: 100%; font-family: system-ui, sans-serif; background: linear-gradient(135deg, #ffb347, #ff7e1f); }
    #status-root { max-width: 480px; margin: 48px auto; padding: 0 16px; }
    .card { background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .card h1 { margin-top: 0; font-size: 22px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.08); }
    .row:last-child { border-bottom: none; }
    .row .label { flex: 1; color: #444; }
    .row .value { font-weight: bold; }
    .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .dot.up { background: #2e7d32; }
    .dot.down { background: #c62828; }
    .checked-at { margin-top: 16px; font-size: 12px; color: #777; }
    .hosts { margin-top: 20px; font-size: 13px; color: #555; }
    .hosts a { color: #c65a00; }
  `;
  document.head.appendChild(style);
}

async function refresh(root: HTMLElement): Promise<void> {
  try {
    const summary = await fetchStatusSummary();
    root.innerHTML = `
      <div class="card">
        <h1>${bikeTheme.eventWordSingular[0].toUpperCase()}${bikeTheme.eventWordSingular.slice(1)} platform status</h1>
        <div class="row"><span class="dot up"></span><span class="label">Backend (Supabase)</span><span class="value">Reachable</span></div>
        <div class="row"><span class="label">Active ${bikeTheme.eventWordPlural} right now</span><span class="value">${summary.activeRideCount}</span></div>
        <div class="row"><span class="label">${bikeTheme.participantWord[0].toUpperCase()}${bikeTheme.participantWord.slice(1)}s currently online</span><span class="value">${summary.ridersOnlineCount}</span></div>
        <div class="checked-at">Last checked: ${new Date().toLocaleTimeString()}, refreshes every 30s</div>
      </div>
      <div class="hosts">
        This app is hosted redundantly on two independent providers. If one has an outage, try the other:
        <br />• <a href="https://landonkea-workingtitle.pages.dev/">Cloudflare Pages</a>
        <br />• <a href="https://landonkea.github.io/landonkea-open-navigation-geospatial-platform/">GitHub Pages</a>
      </div>
    `;
  } catch (err) {
    root.innerHTML = `
      <div class="card">
        <h1>${bikeTheme.eventWordSingular[0].toUpperCase()}${bikeTheme.eventWordSingular.slice(1)} platform status</h1>
        <div class="row"><span class="dot down"></span><span class="label">Backend (Supabase)</span><span class="value">Unreachable</span></div>
        <div class="checked-at">Last checked: ${new Date().toLocaleTimeString()}, retrying every 30s. (${err instanceof Error ? err.message : String(err)})</div>
      </div>
    `;
  }
}

function main(): void {
  applyStyles();
  const root = document.getElementById("status-root")!;
  root.innerHTML = `<div class="card"><h1>Checking status...</h1></div>`;
  refresh(root);
  setInterval(() => refresh(root), REFRESH_INTERVAL_MS);
}

main();
