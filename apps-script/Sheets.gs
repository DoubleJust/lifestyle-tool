/** 試算表：建立、取得工作表、讀取持有卡片 */

/** 各工作表與標題列。之後的步驟會在這裡加新的工作表，setupSheets() 可重複執行，只補缺少的。 */
const SHEETS_ = {
  settings: ['key', 'value', '說明'],
  my_cards: ['card_id', '備註（例如卡片名稱，程式不讀）'],
  log: ['時間', '工作', '結果', '耗時 ms']
};

/**
 * 手動執行一次：建立「Lifestyle Tool 資料」試算表並把 ID 存進指令碼屬性 SHEET_ID。
 * 已存在時只補上缺少的工作表，不會覆蓋資料。執行記錄會印出試算表網址。
 */
function setupSheets() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Lifestyle Tool 資料');
    ss.setSpreadsheetTimeZone(TZ_);
    props.setProperty('SHEET_ID', ss.getId());
  }

  Object.keys(SHEETS_).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      const header = SHEETS_[name];
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const blank = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  console.log('試算表：' + ss.getUrl());
}

function getSpreadsheet_() {
  const id = getProp_('SHEET_ID');
  if (!id) throw new Error('SHEET_ID not set; run setupSheets()');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('missing sheet ' + name + '; run setupSheets()');
  return sh;
}

/** my_cards 第一欄的 card_id（去空白、去重複，最多 100 張） */
function readMyCards_() {
  const sh = getSheet_('my_cards');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const seen = {};
  return sh.getRange(2, 1, last - 1, 1).getValues()
    .map(function (row) { return String(row[0]).trim(); })
    .filter(function (v) {
      if (!v || !/^[A-Za-z0-9_\-]{1,64}$/.test(v) || seen[v]) return false;
      seen[v] = true;
      return true;
    })
    .slice(0, 100);
}
