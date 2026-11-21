// localStorage 的安全包裝：私密瀏覽、清除資料或預覽環境下 localStorage 可能不可用，一律不拋錯。
const PREFIX = 'lt.';

export function get(key, fallback = null) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* 忽略 */ }
}

export const getToken = () => get('token', '');
export const setToken = (t) => set('token', t);
export const clearToken = () => remove('token');
