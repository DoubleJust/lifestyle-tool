// 外部 API 健康狀態的文字（純函式，tests/health-ui.test.mjs 測試）。資料來自後端 action health。

const fmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
});

/** 毫秒 → "11/26 06:05"（台北時間）；0 → "—" */
export function fmtTime(ms) {
  if (!ms) return '—';
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export const STATUS_LABEL = { ok: '正常', fail: '異常', stale: '太久沒有檢查', unknown: '尚未檢查' };

/** 抓不到（異常或太久沒更新）而且有網址可以直接去找的來源 */
export function fallbackSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((s) => (s.status === 'fail' || s.status === 'stale') && s.link && s.key !== 'line');
}

/** 有問題的來源 → 一行提示文字；沒問題回空陣列。unknown（還沒檢查過）不算問題。 */
export function healthProblems(sources) {
  return (Array.isArray(sources) ? sources : []).flatMap((s) => {
    if (s.status === 'fail') {
      return [`${s.name}抓不到資料（${fmtTime(s.since)} 起${s.fails > 1 ? `，連續 ${s.fails} 次` : ''}）${s.scrape ? '，網頁可能改版，需要修 tool' : ''}`];
    }
    if (s.status === 'stale') return [`${s.name}超過 2 天沒有更新（最後成功 ${fmtTime(s.lastOk)}，排程可能停了）`];
    return [];
  });
}
