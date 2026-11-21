// App 進入點：hash 路由、分頁切換、service worker 註冊。
import { initServiceWorker } from './sw-client.js';

const ROUTES = {
  cards:    { title: '信用卡推薦', load: () => import('./pages/cards.js') },
  flights:  { title: '機票',       load: () => import('./pages/flights.js') },
  events:   { title: '台北／桃園活動', load: () => import('./pages/events.js') },
  places:   { title: '附近店家',   load: () => import('./pages/places.js') },
  settings: { title: '設定',       load: () => import('./pages/settings.js') }
};
const DEFAULT_ROUTE = 'cards';

const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
let current = null;     // 目前頁面模組（可有 unmount）
let renderSeq = 0;      // 快速連點分頁時，只讓最後一次生效

async function render() {
  const seq = ++renderSeq;
  let name = location.hash.slice(1);
  if (!Object.prototype.hasOwnProperty.call(ROUTES, name)) {
    name = DEFAULT_ROUTE;
    history.replaceState(null, '', `#${name}`);
  }
  const route = ROUTES[name];

  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  titleEl.textContent = route.title;
  document.title = `${route.title}｜生活工具箱`;

  try { current?.unmount?.(); } catch (e) { console.error(e); }
  current = null;
  view.replaceChildren();

  try {
    const mod = await route.load();
    if (seq !== renderSeq) return;
    current = mod;
    await mod.mount(view);
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    const p = document.createElement('p');
    p.className = 'status bad';
    p.textContent = '頁面載入失敗，請檢查網路後重新整理。';
    view.replaceChildren(p);
  }
  if (seq === renderSeq) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
initServiceWorker();

// 請瀏覽器盡量不要清除本機資料（Safari 17+ 支援）；失敗也不影響使用
navigator.storage?.persist?.().catch(() => {});
