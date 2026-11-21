// 建立 DOM 的小工具。所有文字一律走 textContent，不使用 innerHTML（避免外部資料造成 XSS 偷走 token）。

/**
 * h('button', { class: 'primary', onclick: fn }, '文字', childNode)
 * props：class、for、hidden 等走 setAttribute；on* 走事件；dataset 用 data-xxx。
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...children);
}

/** 狀態訊息：kind = ok | warn | bad | 空字串 */
export function setStatus(el, text, kind = '') {
  el.className = `status ${kind}`.trim();
  el.textContent = text;
}

export function placeholder(icon, title, desc) {
  return card(null, h('div', { class: 'placeholder' },
    h('div', { class: 'big', 'aria-hidden': 'true' }, icon),
    h('h2', {}, title),
    h('p', { class: 'muted' }, desc)
  ));
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
