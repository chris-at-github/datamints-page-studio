// Startseite: Liste der Websites, Formular „Neue URL“, Aktionen je Website, Auftragsstatus.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const dateDe = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

const domainOf = (u) => { try { return new URL(u).host; } catch { return u; } };

function siteRow(s) {
  const neu = s.kind === 'neu';
  const sub = neu
    ? `<span class="muted">Neues Projekt${s.title && s.title !== s.slug ? ' · ' + esc(s.title) : ''}</span>`
    : `<a class="muted site-url" href="${esc(s.url)}" title="${esc(s.url)}" rel="noreferrer noopener" target="_blank">${esc(s.host || domainOf(s.url))}</a>`;
  const menu = neu
    ? `<button type="button" role="menuitem" data-action="package">Paket erstellen</button>
          <button type="button" role="menuitem" data-action="export">Komponenten exportieren</button>`
    : `<button type="button" role="menuitem" data-action="pages">Seiten hinzufügen</button>
          <button type="button" role="menuitem" data-action="recrawl">Neu einlesen</button>${s.components ? `
          <button type="button" role="menuitem" data-action="export">Komponenten exportieren</button>` : ''}`;
  return `<tr data-slug="${esc(s.slug)}">
    <td><strong>${esc(s.slug)}</strong><br>${sub}</td>
    <td class="num">${esc(s.pages ?? '–')}</td>
    <td class="num">${esc(s.steps)}</td>
    <td>${esc(dateDe(neu ? s.created : s.crawledAt))}</td>
    <td>${esc(dateDe(s.lastChange))}</td>
    <td class="actions">
      <a class="btn primary" href="/s/${esc(s.slug)}/">Öffnen</a>
      <span class="menu-wrap">
        <button class="btn menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${esc(s.slug)}" aria-label="Weitere Aktionen für ${esc(s.slug)}">Aktionen <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <span class="menu" id="menu-${esc(s.slug)}" role="menu" hidden>
          ${menu}
          <button type="button" role="menuitem" data-action="report">Report erzeugen</button>
          ${s.hasReport ? `<a role="menuitem" href="/report/${esc(s.slug)}" target="_blank">Report ansehen</a>` : ''}
        </span>
      </span>
    </td>
  </tr>`;
}

export function renderStartPage({ sites, token }) {
  const rows = sites.length
    ? sites.map(siteRow).join('')
    : '<tr><td colspan="6" class="muted">Noch keine Websites. Lege oben die erste an.</td></tr>';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>datamints Page Studio</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  @font-face { font-family:"dps-sora"; font-weight:400; font-display:swap; src:url(/__dps/fonts/Sora-Regular.ttf) format("truetype"); }
  @font-face { font-family:"dps-sora"; font-weight:500; font-display:swap; src:url(/__dps/fonts/Sora-Medium.ttf) format("truetype"); }
  @font-face { font-family:"dps-sora"; font-weight:600; font-display:swap; src:url(/__dps/fonts/Sora-SemiBold.ttf) format("truetype"); }
  @font-face { font-family:"dps-sora"; font-weight:700; font-display:swap; src:url(/__dps/fonts/Sora-Bold.ttf) format("truetype"); }
  /* CI datamints (Quelle: auftrags-sonar.de) */
  :root { --fg:#252624; --muted:#5b5b56; --line:#e1ded8; --line-strong:#cfcbc3; --bg:#f2f1ed; --surface:#faf9f6; --petrol:#0f5446; --petrol-tint:#e4f3ee; --spring:#55d98a; --mint:#12c1a6; --btn:#123740; --btn-hover:#15414d; --accent:var(--petrol); --err:#a82d1c; --ok:#508223; --warn:#974c00; --leaf:16px 0 16px 16px; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 "dps-sora", system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--fg); background:var(--bg); }
  header { background:#fff; border-bottom:1px solid var(--line); padding:18px 32px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { margin:0; font-size:20px; font-weight:600; display:flex; align-items:center; gap:14px; }
  header h1 .logo { display:block; height:24px; width:auto; }
  header h1 .sep { width:1px; height:24px; background:var(--line-strong); }
  header h1 .name { color:var(--petrol); }
  main { max-width:1200px; margin:0 auto; padding:24px 32px 64px; }
  section { background:#fff; border:1px solid var(--line); border-radius:var(--leaf); padding:20px 24px; margin-bottom:24px; }
  h2 { font-size:17px; font-weight:600; margin:0 0 12px; }
  label { display:block; font-weight:600; margin:10px 0 4px; }
  input[type=url], input[type=text], textarea { width:100%; padding:8px 10px; border:1px solid var(--line-strong); border-radius:8px; font:inherit; }
  textarea { min-height:90px; font-family: ui-monospace, monospace; font-size:13px; }
  .row { display:grid; grid-template-columns: 2fr 1fr; gap:16px; }
  .btn { display:inline-block; padding:6px 12px; border:1px solid var(--line-strong); border-radius:8px; background:#fff; color:var(--fg); font:inherit; font-size:14px; cursor:pointer; text-decoration:none; margin:2px 0; }
  .btn:hover { background:var(--bg); }
  .btn.primary { background:var(--btn); border-color:var(--btn); color:#fff; font-weight:500; }
  .btn.primary:hover { background:var(--btn-hover); border-color:var(--btn-hover); }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  :focus-visible { outline:3px solid var(--petrol); outline-offset:2px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:13px; color:var(--muted); font-weight:600; }
  td.actions { white-space:nowrap; text-align:right; }
  th.actions { text-align:right; }
  .menu-wrap { position:relative; display:inline-block; }
  .menu-btn { display:inline-flex; align-items:center; gap:4px; }
  .menu { position:absolute; right:0; top:calc(100% + 4px); z-index:10; min-width:190px; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 24px rgba(15,44,51,.14); padding:4px; display:flex; flex-direction:column; text-align:left; }
  .menu[hidden] { display:none; }
  .menu > * { display:block; width:100%; text-align:left; padding:7px 10px; border:0; border-radius:5px; background:none; font:inherit; font-size:14px; color:var(--fg); text-decoration:none; cursor:pointer; }
  .menu > *:hover, .menu > *:focus-visible { background:var(--petrol-tint); outline:none; }
  .menu > *:focus-visible { box-shadow:inset 0 0 0 2px var(--petrol); }
  .muted.site-url { word-break:normal; }
  .muted { color:var(--muted); font-size:13px; word-break:break-all; }
  #msg { min-height:1.5em; margin-top:10px; }
  .err { color:var(--err); } .ok { color:var(--ok); }
  #jobs td { font-size:14px; }
  #jobs td.when { white-space:nowrap; }
  #jobs .err { font-size:13px; }
  .st { display:inline-block; min-width:110px; font-weight:600; }
  .st-pending { color:var(--muted); } .st-running { color:var(--accent); } .st-review { color:var(--warn); }
  .st-done { color:var(--ok); } .st-failed { color:var(--err); }
  dialog { border:1px solid var(--line); border-radius:var(--leaf); padding:20px 24px; width:min(640px, calc(100vw - 32px)); box-shadow:0 12px 40px rgba(0,0,0,.25); }
  dialog::backdrop { background:rgba(15,44,51,.45); }
  dialog h2 { margin-bottom:4px; }
  dialog p.muted { word-break:normal; overflow-wrap:anywhere; }
  dialog .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
  details { margin:14px 0 6px; }
  details summary { cursor:pointer; color:var(--muted); list-style:none; display:inline-flex; align-items:center; gap:6px; }
  details summary::-webkit-details-marker { display:none; }
  details summary .chev { transition:transform .15s ease; }
  details[open] summary .chev { transform:rotate(90deg); }
  details[open] summary { margin-bottom:4px; }
  @media (prefers-reduced-motion:reduce) { details summary .chev { transition:none; } }
  label.inline { display:flex; gap:8px; align-items:center; font-weight:400; font-size:14px; margin:0 0 8px; }
  label.inline.below { margin:12px 0 0; }
</style>
</head>
<body>
<header><h1><svg class="logo" role="img" aria-label="datamints" viewBox="0 0 873 135" xmlns="http://www.w3.org/2000/svg"><path d="M84.6914 132.286H70.627V115.622C70.163 116.631 69.6594 117.598 69.1143 118.523C65.8879 124.17 61.7035 128.354 56.5615 131.076C51.4197 133.697 45.774 135.009 39.624 135.009C33.7763 135.009 28.4323 133.949 23.5928 131.832C18.8541 129.715 14.6697 126.74 11.04 122.909C7.51135 119.078 4.78864 114.642 2.87305 109.601C0.957504 104.56 0 99.0646 0 93.1162V90.2432C0 84.3954 0.907834 78.9503 2.72266 73.9092C4.63828 68.7673 7.30941 64.2804 10.7373 60.4492C14.1652 56.618 18.2487 53.6437 22.9873 51.5264C27.8268 49.3083 33.1708 48.1992 39.0186 48.1992C45.2696 48.1992 50.8653 49.561 55.8057 52.2832C60.3585 54.6507 64.089 58.2105 66.9971 62.9629V21.8848H84.6914V132.286ZM662.652 48.3506C672.331 48.3506 680.145 50.5182 686.094 54.8535C692.042 59.088 695.118 65.3392 695.319 73.6064H679.137C678.935 70.4812 677.473 67.8603 674.751 65.7432C672.029 63.6259 667.996 62.5664 662.652 62.5664C657.611 62.5664 653.729 63.5753 651.007 65.5918C648.386 67.6082 647.075 70.1793 647.075 73.3047C647.075 76.1276 648.083 78.3459 650.1 79.959C652.116 81.5721 655.393 82.6306 659.93 83.1348L667.945 83.8906C677.12 84.8989 684.38 87.4698 689.724 91.6035C695.168 95.6364 697.89 101.283 697.89 108.542C697.89 113.785 696.428 118.373 693.504 122.305C690.58 126.237 686.497 129.312 681.254 131.53C676.112 133.647 670.113 134.706 663.257 134.706C652.267 134.706 643.697 132.387 637.547 127.749C631.498 123.111 628.322 116.709 628.02 108.542H644.353C644.554 111.567 646.117 114.34 649.041 116.86C651.965 119.381 656.754 120.641 663.408 120.641C669.054 120.641 673.49 119.532 676.717 117.313C679.943 115.095 681.557 112.323 681.557 108.996C681.557 105.971 680.347 103.602 677.927 101.888C675.608 100.073 671.625 98.8627 665.979 98.2578L657.964 97.502C649.596 96.5945 642.941 94.1246 638.001 90.0918C633.161 86.0589 630.741 80.6138 630.741 73.7578C630.741 68.3135 632.103 63.7265 634.825 59.9961C637.547 56.2656 641.278 53.3915 646.017 51.375C650.856 49.3586 656.401 48.3506 662.652 48.3506ZM128.147 49.7119C136.415 49.712 143.271 50.7705 148.715 52.8877C154.159 55.005 158.192 58.3827 160.813 63.0205C163.536 67.5576 164.897 73.6577 164.897 81.3203V132.286H150.832V116.618C150.157 118.746 149.302 120.693 148.262 122.456C146.044 126.287 142.918 129.262 138.885 131.379C134.953 133.395 130.113 134.403 124.366 134.403C118.418 134.403 113.225 133.395 108.789 131.379C104.353 129.262 100.925 126.237 98.5049 122.305C96.0851 118.272 94.875 113.483 94.875 107.938C94.875 102.09 96.2368 97.2502 98.959 93.4189C101.782 89.5877 105.764 86.7135 110.906 84.7979C116.048 82.8823 122.198 81.9248 129.356 81.9248H147.959V80.4121C147.959 75.3711 146.648 71.5403 144.026 68.9189C141.405 66.2976 137.524 64.9864 132.382 64.9863C129.559 64.9863 126.433 65.0369 123.005 65.1377C119.577 65.2385 116.199 65.3902 112.872 65.5918C109.646 65.6926 106.772 65.8433 104.252 66.0449V50.7705C106.47 50.5689 108.89 50.4172 111.511 50.3164C114.233 50.1148 117.006 49.9641 119.829 49.8633C122.753 49.7625 125.526 49.7119 128.147 49.7119ZM262.415 49.7119C270.683 49.7119 277.539 50.7704 282.983 52.8877C288.428 55.005 292.461 58.3827 295.082 63.0205C297.804 67.5576 299.166 73.6577 299.166 81.3203V132.286H285.101V116.617C284.426 118.746 283.569 120.693 282.529 122.456C280.311 126.287 277.186 129.262 273.153 131.379C269.221 133.395 264.382 134.403 258.635 134.403C252.686 134.403 247.494 133.395 243.058 131.379C238.621 129.262 235.193 126.237 232.773 122.305C230.354 118.272 229.144 113.483 229.144 107.938C229.144 102.09 230.505 97.2502 233.228 93.4189C236.051 89.5877 240.033 86.7135 245.175 84.7979C250.317 82.8823 256.467 81.9248 263.625 81.9248H282.228V80.4121C282.227 75.3712 280.916 71.5403 278.295 68.9189C275.674 66.2976 271.792 64.9864 266.65 64.9863C263.827 64.9863 260.701 65.0369 257.273 65.1377C253.845 65.2385 250.468 65.3902 247.141 65.5918C243.914 65.6926 241.041 65.8433 238.521 66.0449V50.7705C240.738 50.5689 243.158 50.4172 245.779 50.3164C248.502 50.1148 251.275 49.9641 254.098 49.8633C257.021 49.7625 259.794 49.7119 262.415 49.7119ZM199.538 50.7705H226.155V63.9277H199.538V104.61C199.538 108.845 200.647 112.122 202.865 114.44C205.184 116.659 208.411 117.768 212.545 117.768H216.993L225.899 133.193H213.905C207.15 133.193 201.454 132.286 196.816 130.472C192.179 128.657 188.649 125.531 186.229 121.095C183.911 116.659 182.751 110.659 182.751 103.098V63.9277H169.291V50.7705H182.751V27.0264H199.538V50.7705ZM598.799 27.0264V50.7705H625.417V63.9277H598.799V104.61C598.799 108.845 599.908 112.122 602.126 114.44C604.445 116.659 607.672 117.768 611.806 117.768H616.617L625.417 133.009V133.193H613.166C606.411 133.193 600.715 132.286 596.077 130.472C591.439 128.657 587.91 125.531 585.49 121.095C583.171 116.659 582.012 110.659 582.012 103.098V63.9277H568.552V50.7705H582.012V27.0264H598.799ZM356.038 48.3506C362.39 48.3506 367.633 49.8125 371.767 52.7363C376.001 55.6602 379.127 59.8951 381.144 65.4404C381.413 66.1453 381.664 66.8706 381.899 67.6162C382.134 66.8706 382.386 66.1453 382.655 65.4404C384.773 59.8951 387.949 55.6602 392.184 52.7363C396.418 49.8125 401.661 48.3506 407.912 48.3506H408.668C415.02 48.3506 420.313 49.8125 424.548 52.7363C428.782 55.6602 431.958 59.8951 434.075 65.4404C436.192 70.9857 437.252 77.7916 437.252 85.8574V132.286H419.557V83.2861C419.557 77.3376 418.045 72.6992 415.021 69.3721C412.097 66.0449 408.012 64.3818 402.77 64.3818C397.325 64.3819 392.99 66.1461 389.764 69.6748C386.537 73.1028 384.924 77.8919 384.924 84.042V132.286H367.078V83.2861C367.078 77.3375 365.616 72.6992 362.692 69.3721C359.769 66.0451 355.685 64.3818 350.442 64.3818C344.998 64.3819 340.612 66.146 337.285 69.6748C334.059 73.1028 332.445 77.8918 332.445 84.042V132.286H314.751V50.7705H328.816V69.9961C329.203 68.3934 329.655 66.8745 330.177 65.4404C332.294 59.8951 335.42 55.6602 339.554 52.7363C343.788 49.8125 349.031 48.3506 355.282 48.3506H356.038ZM474.403 132.286H456.709V64.3818H444.762V50.7705H474.403V132.286ZM534.502 48.3506C544.584 48.3506 552.096 51.5271 557.036 57.8789C561.976 64.2308 564.446 73.5067 564.446 85.7061V132.286H546.752V83.2861C546.752 77.64 545.138 73.1028 541.912 69.6748C538.686 66.146 534.25 64.3818 528.604 64.3818C522.857 64.3818 518.218 66.1965 514.689 69.8262C511.161 73.3549 509.397 78.0936 509.396 84.042V132.286H491.702V50.7705H505.767V70.1758C506.19 68.4506 506.694 66.8217 507.279 65.2891C509.497 59.7438 512.825 55.5594 517.261 52.7363C521.697 49.8125 527.192 48.3506 533.745 48.3506H534.502ZM128.903 93.5703C123.56 93.5703 119.476 94.8807 116.653 97.502C113.83 100.022 112.419 103.35 112.419 107.483C112.419 111.617 113.83 114.944 116.653 117.465C119.476 119.885 123.56 121.095 128.903 121.095C132.029 121.095 135.003 120.541 137.826 119.432C140.649 118.222 142.968 116.255 144.783 113.533C146.699 110.811 147.757 106.979 147.959 102.039V93.5703H128.903ZM263.172 93.5703C257.828 93.5703 253.745 94.8807 250.922 97.502C248.099 100.022 246.687 103.35 246.687 107.483C246.687 111.617 248.099 114.944 250.922 117.465C253.745 119.885 257.828 121.095 263.172 121.095C266.297 121.095 269.272 120.541 272.095 119.432C274.918 118.222 277.237 116.255 279.052 113.533C280.967 110.811 282.026 106.979 282.228 102.039V93.5703H263.172ZM42.7998 63.3232C37.8597 63.3232 33.4737 64.5326 29.6426 66.9521C25.9121 69.2711 22.9874 72.5486 20.8701 76.7832C18.753 81.0176 17.6944 85.9577 17.6943 91.6035C17.6943 97.3504 18.7529 102.342 20.8701 106.576C23.0882 110.811 26.1132 114.087 29.9443 116.406C33.7756 118.624 38.1116 119.733 42.9512 119.733C47.4881 119.733 51.5716 118.725 55.2012 116.709C58.9315 114.693 61.906 111.769 64.124 107.938C66.443 104.005 67.6025 99.4176 67.6025 94.1748V87.6719C67.6025 82.5301 66.4428 78.1442 64.124 74.5146C61.8051 70.885 58.7802 68.1119 55.0498 66.1963C51.3194 64.2807 47.2359 63.3233 42.7998 63.3232ZM462.456 18.8594C466.186 18.8594 468.909 19.8683 470.623 21.8848C472.438 23.8003 473.345 26.22 473.345 29.1436C473.345 32.1682 472.438 34.639 470.623 36.5547C468.909 38.4703 466.186 39.4277 462.456 39.4277C458.827 39.4277 456.104 38.4702 454.289 36.5547C452.575 34.639 451.718 32.1683 451.718 29.1436C451.718 26.2199 452.575 23.8003 454.289 21.8848C456.104 19.8683 458.826 18.8594 462.456 18.8594Z" fill="#252624"/><path d="M749.647 134.869C749.647 108.606 749.647 95.4749 753.938 85.1166C759.658 71.306 770.631 60.3333 784.442 54.613C794.8 50.3223 807.932 50.3223 834.194 50.3223H872.944C872.944 76.5845 872.944 89.7159 868.653 100.074C862.933 113.885 851.96 124.858 838.15 130.578C827.792 134.869 814.66 134.869 788.398 134.869H749.647Z" fill="#8CE86B"/><path fill-rule="evenodd" clip-rule="evenodd" d="M749.647 134.869C749.647 108.606 749.647 95.4749 753.938 85.1173C759.658 71.3059 770.631 60.3333 784.442 54.613C794.8 50.3223 807.932 50.3223 834.194 50.3223H835.749C836.278 63.4431 832.206 76.3999 824.148 86.9019C817.322 95.7969 805.95 102.363 783.206 115.493L749.647 134.869Z" fill="#55D98A"/><path fill-rule="evenodd" clip-rule="evenodd" d="M749.646 134.868C736.514 112.124 729.949 100.752 728.485 89.636C726.534 74.8157 730.551 59.8264 739.651 47.9666C746.476 39.0724 757.848 32.5066 780.592 19.3752L814.15 0C827.282 22.7444 833.848 34.1158 835.311 45.2316C835.534 46.9281 835.679 48.6261 835.748 50.3213H834.192C807.93 50.3213 794.798 50.3213 784.44 54.612C770.629 60.3322 759.657 71.3049 753.936 85.1163C749.646 95.4739 749.646 108.605 749.646 134.868Z" fill="#8CE86B"/><path fill-rule="evenodd" clip-rule="evenodd" d="M835.749 50.3223H872.944C872.944 76.5852 872.944 89.7159 868.653 100.074C862.933 113.885 851.96 124.858 838.15 130.578C827.792 134.869 814.66 134.869 788.398 134.869H749.647L783.206 115.493C805.95 102.363 817.322 95.7969 824.148 86.9019C832.206 76.3992 836.278 63.4431 835.749 50.3223Z" fill="#12C1A6"/></svg><span class="sep" aria-hidden="true"></span><span class="name">Page Studio</span></h1><span class="muted">Websites lokal optimieren per Element-Annotation und Claude Code</span></header>
<main>
  <section>
    <h2>Neue Website</h2>
    <form id="new-site">
      <div class="row">
        <div><label for="url">URL der Startseite</label><input id="url" name="url" type="url" required placeholder="https://www.example.de/"></div>
        <div><label for="slug">Kurzname (optional)</label><input id="slug" name="slug" type="text" pattern="[a-z0-9][a-z0-9-]{0,62}" placeholder="aus der URL"></div>
      </div>
      <details><summary><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>Weitere Seiten abziehen (optional)</summary>
        <label for="urls">Seitenliste, eine URL pro Zeile</label>
        <textarea id="urls" name="urls" placeholder="https://www.example.de/leistungen/&#10;https://www.example.de/kontakt/"></textarea>
      </details>
      <p><button class="btn primary" type="submit">Abzug erstellen</button></p>
      <div id="msg" role="status" aria-live="polite"></div>
    </form>
  </section>
  <section>
    <h2>Neues Projekt (ohne Website)</h2>
    <p class="muted">Für neue Designs ohne bestehende Website. Page Studio legt ein Projekt ohne Seiten an. Danach „Öffnen“ und unten in der Leiste über „Seiten › Seite importieren …“ HTML-Seiten aus Claude Chat einspielen und nachbearbeiten. Regeln, Hintergrund und Tokens pflegst du in <code>sites/&lt;kurzname&gt;/design/</code> (notes.md, projekt.md, tokens-quelle.css), „Paket erstellen“ bereitet sie für ein Projekt in claude.ai auf.</p>
    <form id="new-project">
      <div class="row">
        <div><label for="p-title">Titel</label><input id="p-title" name="title" type="text" maxlength="80" required placeholder="z. B. Relaunch Musterfirma"></div>
        <div><label for="p-slug">Kurzname</label><input id="p-slug" name="slug" type="text" required pattern="[a-z0-9][a-z0-9-]{0,62}" placeholder="musterfirma-neu"></div>
      </div>
      <p><button class="btn primary" type="submit">Projekt anlegen</button></p>
      <div id="p-msg" role="status" aria-live="polite"></div>
    </form>
  </section>
  <section>
    <h2>Websites und Projekte</h2>
    <table>
      <thead><tr><th>Website</th><th class="num">Seiten</th><th class="num">Schritte</th><th>Abzug</th><th>Letzte Änderung</th><th class="actions">Aktionen</th></tr></thead>
      <tbody id="sites">${rows}</tbody>
    </table>
    <label class="inline below"><input type="checkbox" id="keep-design" checked> Beim Neu einlesen Design-Vorgaben (Tokens und Regeln) behalten</label>
  </section>
  <section>
    <h2>Aufträge</h2>
    <table>
      <thead><tr><th>Status</th><th>Auftrag</th><th>Website</th><th>Erstellt</th><th>Details</th></tr></thead>
      <tbody id="jobs"><tr><td colspan="5" class="muted">Lade …</td></tr></tbody>
    </table>
  </section>
</main>
<dialog id="pages-dialog" aria-labelledby="pages-title">
  <form id="pages-form" method="dialog">
    <h2 id="pages-title">Seiten hinzufügen</h2>
    <p class="muted" id="pages-site"></p>
    <label for="pages-urls">Weitere Seiten derselben Website, eine URL pro Zeile</label>
    <textarea id="pages-urls" required></textarea>
    <p class="muted">Bisherige Schritte und Design-Vorgaben bleiben erhalten. Neue Seiten kommen im Originalzustand dazu, die Regeln aus overrides.css und die Tokens gelten auch für sie. Direkte HTML-Änderungen früherer Schritte (z. B. am Header) haben die neuen Seiten noch nicht.</p>
    <div id="pages-msg" class="err" role="alert"></div>
    <div class="actions">
      <button class="btn" type="button" id="pages-cancel">Abbrechen</button>
      <button class="btn primary" type="submit">Seiten laden</button>
    </div>
  </form>
</dialog>
<script>
(() => {
  const TOKEN = ${JSON.stringify(token).replace(/</g, '\\u003c')};
  const LABEL = { 'project-new': 'Neues Projekt', 'project-package': 'Paket', 'project-export': 'Export', 'site-new': 'Neue Website', 'site-recrawl': 'Neu einlesen', annotate: 'Annotation', decision: 'Entscheidung', rollback: 'Rücksprung', report: 'Report', 'design-save': 'Design-Vorgaben', 'tokens-propose': 'Token-Vorschläge', 'pages-add': 'Seiten hinzufügen', 'page-import': 'Seite importieren', 'page-delete': 'Seite löschen', 'component-delete': 'Komponente löschen', 'component-sync': 'Kopien angleichen', 'component-rename': 'Komponente umbenennen', 'component-merge': 'Komponenten zusammenführen', 'areas-sync': 'Bereiche angleichen', 'local-commit': 'Lokale Änderungen', 'inspect-apply': 'Inspektor-Änderung' };
  const STATUS = { pending: 'wartet', running: 'läuft', review: 'Prüfung nötig', done: 'fertig', failed: 'fehlgeschlagen' };
  const msg = document.getElementById('msg');
  const jobsEl = document.getElementById('jobs');
  const jobs = new Map();

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'X-DPS-Token': TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  function say(text, cls) { msg.textContent = text; msg.className = cls || ''; }

  document.getElementById('new-site').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const urls = f.urls.value.split(/\\s+/).map((s) => s.trim()).filter(Boolean);
    try {
      const { job } = await api('/api/sites', { method: 'POST', body: JSON.stringify({ url: f.url.value.trim(), slug: f.slug.value.trim() || undefined, urls }) });
      say('Abzug für ' + job.slug + ' wird erstellt …', 'ok');
      upsert(job);
      f.reset();
    } catch (err) { say(err.message, 'err'); }
  });

  document.getElementById('new-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const pm = document.getElementById('p-msg');
    try {
      const { job } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ slug: f.slug.value.trim(), title: f.title.value.trim() }) });
      pm.textContent = 'Projekt ' + job.slug + ' wird angelegt …'; pm.className = 'ok';
      upsert(job);
      f.reset();
    } catch (err) { pm.textContent = err.message; pm.className = 'err'; }
  });

  // Aktionsmenü je Website
  let openMenu = null;
  function closeMenu(focusBtn) {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) openMenu.btn.focus();
    openMenu = null;
  }
  function showMenu(btn, focusFirst) {
    closeMenu();
    const menu = document.getElementById(btn.getAttribute('aria-controls'));
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openMenu = { btn, menu };
    if (focusFirst) menu.querySelector('[role=menuitem]').focus();
  }
  document.getElementById('sites').addEventListener('click', (e) => {
    const mb = e.target.closest('.menu-btn');
    if (!mb) return;
    if (openMenu && openMenu.btn === mb) closeMenu(); else showMenu(mb, e.detail === 0);
  });
  document.addEventListener('click', (e) => { if (openMenu && !e.target.closest('.menu-wrap')) closeMenu(); });
  document.addEventListener('keydown', (e) => {
    const mb = e.target.closest && e.target.closest('.menu-btn');
    if (mb && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showMenu(mb, true); return; }
    if (!openMenu) return;
    const items = [...openMenu.menu.querySelectorAll('[role=menuitem]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') closeMenu();
  });

  document.getElementById('sites').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const slug = btn.closest('tr').dataset.slug;
    const action = btn.dataset.action;
    closeMenu();
    if (action === 'pages') { openPages(slug); return; }
    const keepDesign = document.getElementById('keep-design').checked;
    if (action === 'recrawl' && !confirm('Website „' + slug + '“ neu einlesen?\\n\\nDer bisherige Stand wird mit Report archiviert, alle Änderungen sind danach nicht mehr aktiv.\\n' +
      (keepDesign ? 'Tokens und Regeln werden übernommen.' : 'Tokens und Regeln werden NICHT übernommen.'))) return;
    btn.disabled = true;
    try {
      const opts = { method: 'POST' };
      if (action === 'recrawl') opts.body = JSON.stringify({ keepDesign });
      const { job } = await api('/api/sites/' + slug + '/' + action, opts);
      upsert(job);
    }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; }
  });

  // Seiten hinzufügen
  const pagesDialog = document.getElementById('pages-dialog');
  const pagesForm = document.getElementById('pages-form');
  const pagesUrls = document.getElementById('pages-urls');
  const pagesMsg = document.getElementById('pages-msg');
  let pagesSlug = null;
  function openPages(slug) {
    pagesSlug = slug;
    const row = document.querySelector('tr[data-slug="' + CSS.escape(slug) + '"] a.site-url');
    document.getElementById('pages-site').textContent = slug + (row ? ' · ' + row.href : '');
    pagesUrls.placeholder = row ? new URL('weitere-seite/', row.href).href + '\\n' + new URL('kontakt/', row.href).href : '';
    pagesMsg.textContent = '';
    pagesDialog.showModal();
    pagesUrls.focus();
  }
  document.getElementById('pages-cancel').addEventListener('click', () => pagesDialog.close());
  pagesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = pagesUrls.value.split(/\\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) { pagesMsg.textContent = 'Bitte mindestens eine URL eintragen.'; return; }
    const btn = pagesForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { job } = await api('/api/sites/' + pagesSlug + '/pages', { method: 'POST', body: JSON.stringify({ urls }) });
      upsert(job);
      pagesUrls.value = '';
      pagesDialog.close();
    } catch (err) { pagesMsg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  function pagesDetails(r) {
    const parts = [];
    if (r.added?.length) parts.push(r.added.length + ' Seite(n) neu');
    if (r.present?.length) parts.push(r.present.length + ' schon im Abzug');
    if (r.duplicate?.length) parts.push(r.duplicate.length + ' schon in der Liste');
    if (r.failed?.length) parts.push('nicht geladen: ' + r.failed.join(', '));
    if (r.rejected?.length) parts.push('andere Website, ignoriert: ' + r.rejected.join(', '));
    if (r.areas?.changed?.length) parts.push('übernommen: ' + [...new Set(r.areas.changed.flatMap((c) => c.areas))].join(', '));
    if (r.areas?.unclear?.length) parts.push('nicht übernommen (Seiten uneinheitlich): ' + r.areas.unclear.join(', '));
    return parts.join(' · ') || 'keine neuen Seiten';
  }

  const MAX_JOBS = 10;
  function cell(text, cls) { const td = document.createElement('td'); if (cls) td.className = cls; if (text != null) td.textContent = text; return td; }
  function render() {
    const list = [...jobs.values()].sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_JOBS);
    jobsEl.textContent = '';
    if (!list.length) { const tr = document.createElement('tr'); const td = cell('Keine Aufträge.', 'muted'); td.colSpan = 5; tr.append(td); jobsEl.append(tr); return; }
    for (const j of list) {
      const tr = document.createElement('tr');
      const status = cell();
      const st = document.createElement('span');
      st.className = 'st st-' + j.status; st.textContent = STATUS[j.status] || j.status;
      status.append(st);
      const details = cell();
      if (j.type === 'annotate' && j.params?.prompt) details.append('„' + j.params.prompt.slice(0, 80) + (j.params.prompt.length > 80 ? '…' : '') + '“');
      if (j.type === 'pages-add' && j.status === 'done' && j.result) details.append(pagesDetails(j.result));
      if ((j.type === 'local-commit' || j.type === 'inspect-apply') && j.status === 'done' && j.result) details.append(j.result.status === 'nochange' ? 'keine Änderungen' : 'übernommen als ' + (j.result.annotationId || ''));
      if ((j.type === 'local-commit' || j.type === 'inspect-apply') && j.status === 'review') details.append('Prüfung nötig – im Overlay entscheiden');
      if (j.type === 'areas-sync' && j.status === 'done' && j.result) details.append((j.result.areas || []).join(', ') + ': ' + ((j.result.changed || []).length ? (j.result.changed || []).length + ' Seite(n) angeglichen' : 'schon gleich'));
      if (j.type === 'project-new' && j.status === 'done' && j.result) details.append('Öffnen und über „Seiten › Seite importieren …“ die erste Seite einspielen');
      if (j.type === 'page-import' && j.result?.page) details.append(j.result.page + (j.result.replaced ? ' ersetzt' : ' importiert'));
      if (j.type === 'page-delete' && j.params?.page) details.append(j.params.page + ' gelöscht');
      if (j.type === 'component-delete' && j.params?.name) details.append('mx-' + j.params.name + (j.params.variant ? ', Variante ' + j.params.variant : '') + ' gelöscht');
      if (j.type === 'component-sync' && j.params?.name) details.append('mx-' + j.params.name + (j.result?.synced !== undefined ? ': ' + j.result.synced + ' Kopie(n) angeglichen' : ''));
      if ((j.type === 'project-package' || j.type === 'project-export') && j.status === 'done' && j.result) {
        details.append((j.type === 'project-package' ? 'Paket: ' : (j.result.components || []).length + ' Komponente(n): ') + j.result.dir);
        for (const w of j.result.warnings || []) { const d = document.createElement('div'); d.className = 'muted'; d.textContent = '⚠ ' + w; details.append(d); }
      }
      if (j.type === 'report' && j.status === 'done') { const a = document.createElement('a'); a.href = '/report/' + j.slug; a.target = '_blank'; a.textContent = 'Report ansehen'; details.append(a); }
      if (j.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = j.error; details.append(e); }
      const when = new Date(j.created).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
      tr.append(status, cell(LABEL[j.type] || j.type), cell(j.slug), cell(when, 'when'), details);
      jobsEl.append(tr);
    }
  }
  function upsert(job) { jobs.set(job.id, job); render(); }

  api('/api/jobs').then((d) => { d.jobs.forEach((j) => jobs.set(j.id, j)); render(); }).catch((e) => { jobsEl.textContent = e.message; });
  const es = new EventSource('/api/events?token=' + encodeURIComponent(TOKEN));
  es.addEventListener('job', (e) => upsert(JSON.parse(e.data)));
  // Liste neu laden, aber keine laufende Eingabe verwerfen
  es.addEventListener('sites', () => { if (!document.getElementById('url').value && !document.getElementById('urls').value && !document.getElementById('p-slug').value && !document.getElementById('p-title').value && !pagesDialog.open) location.reload(); });
})();
</script>
</body>
</html>`;
}
