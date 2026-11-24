/** 排程：觸發器設定、共用的 runJob_、每週清理 */

// 本工具管理的觸發器。setupTriggers 只刪這些，不會動到專案裡其他觸發器。
const MANAGED_ = ['weeklyEventsJob', 'dailyFlightMailJob', 'cleanupJob'];

/** 手動執行一次（可重複執行）：重建本工具的觸發器。機票的 dailyFlightMailJob 等步驟 6 再加。 */
function setupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return MANAGED_.indexOf(t.getHandlerFunction()) >= 0; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyEventsJob').timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).inTimezone(TZ_).create();
  ScriptApp.newTrigger('cleanupJob').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone(TZ_).create();
  const names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  writeLog_('setupTriggers', 'OK ' + names.join(','), 0);
  console.log('目前的觸發器：' + names.join(', '));
}

/** 下週一～下週日 { startDate, endDateExclusive }（台北時間，半開區間） */
function nextWeekRange_() {
  return evNextWeekFrom_(ymd_(new Date()));
}

/**
 * 排程工作共用：KILL_SWITCH、上鎖、記錄、失敗時推 LINE 通知（通知失敗不再拋出，訊息經過遮罩）。
 * fn 可回傳一段摘要字串，會寫進 log。手動查詢（doPost）不使用這個鎖。
 */
function runJob_(name, fn) {
  if (getProp_('KILL_SWITCH') === '1') { console.log('KILL_SWITCH=1，略過 ' + name); return; }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { writeLog_(name, 'SKIPPED_LOCK', 0); return; }
  const t0 = Date.now();
  try {
    const summary = fn();
    writeLog_(name, 'OK' + (summary ? ' ' + summary : ''), Date.now() - t0);
    console.log(name + ' OK ' + (summary || ''));
  } catch (e) {
    const msg = sanitize_(String(e && e.message || e)).slice(0, 300);
    writeLog_(name, 'ERROR ' + msg, Date.now() - t0);
    console.log(name + ' ERROR ' + msg);
    try {
      pushLine_('⚠️ ' + name + ' 失敗（' + ymd_(new Date()) + '），詳見試算表 log', 'error:' + name + ':' + ymd_(new Date()));
    } catch (e2) {
      writeLog_(name, 'NOTIFY_FAIL ' + sanitize_(String(e2 && e2.message || e2)).slice(0, 200), 0);
    }
  } finally {
    lock.releaseLock();
  }
}

/** 排程：每週日 3 點。log 只留 90 天、push_log 留 400 天，並把本地推播計數和 LINE 官方計數比對。 */
function cleanupJob() {
  runJob_('cleanupJob', function () {
    const now = new Date();
    const removedLog = pruneOlderThan_(getSheet_('log'), addDays_(ymd_(now), -90));
    const removedPush = pruneOlderThan_(getSheet_('push_log'), addDays_(ymd_(now), -400));

    const month = ymd_(now).slice(0, 7);
    const local = readPushLog_(getSheet_('push_log'))
      .filter(function (r) { return r.ymd.slice(0, 7) === month && (r.status === 'sent' || r.status === 'pending'); }).length;
    const official = lineOfficialUsage_();
    let note = 'log-' + removedLog + ' push_log-' + removedPush + ' local=' + local + ' official=' + official.used;
    if (official.used !== null && Math.abs(official.used - local) > 3) note += ' WARN 本地與 LINE 計數不一致';
    if (official.used !== null && official.used >= LINE_LIMITS_.monthly) note += ' WARN 本月已達 ' + official.used + ' 則';
    return note;
  });
}

/** 刪除 A 欄日期早於 cutoffYmd 的列（工作表依時間追加，所以舊資料都在上面） */
function pruneOlderThan_(sh, cutoffYmd) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const dates = sh.getRange(2, 1, last - 1, 1).getValues();
  let n = 0;
  while (n < dates.length) {
    const d = dates[n][0] instanceof Date ? dates[n][0] : new Date(dates[n][0]);
    if (isNaN(d.getTime()) || ymd_(d) >= cutoffYmd) break;
    n++;
  }
  if (n > 0) sh.deleteRows(2, n);
  return n;
}
