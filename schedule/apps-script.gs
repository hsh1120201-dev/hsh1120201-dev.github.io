/**
 * 新竹社創基地 班表後台（貼在「2026社創基地班表」試算表的 擴充功能 > Apps Script）
 * 1. 貼上本檔全部內容、儲存
 * 2. 左側齒輪「專案設定」> 指令碼屬性 > 新增 ADMIN_PASS = 後台密碼
 * 3. 部署 > 新增部署作業 > 類型「網頁應用程式」：執行身分「我」、存取權「所有人」> 部署
 * 4. 把網址貼到 schedule/config.js 的 SCHEDULE_API
 * 資料存在「班表資料」分頁（第一次儲存時自動建立），舊的月份分頁不會被改動。
 */
var DATA_SHEET = '班表資料';
var HEAD = ['日期', '早班', '早班備註', '晚班', '晚班備註', '活動', '更新時間', '更新人'];

function sheet_() {
  var ss = SpreadsheetApp.getActive();
  var s = ss.getSheetByName(DATA_SHEET);
  if (!s) {
    s = ss.insertSheet(DATA_SHEET);
    s.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    s.getRange('A:A').setNumberFormat('@');
    s.setFrozenRows(1);
  }
  return s;
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function clean_(v) {
  v = String(v == null ? '' : v).trim().slice(0, 100);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function doGet(e) {
  var month = (e && e.parameter && e.parameter.month) || '';
  var v = sheet_().getDataRange().getDisplayValues().slice(1);
  var rows = v.filter(function (r) { return r[0] && (!month || r[0].indexOf(month) == 0); })
    .map(function (r) { return { date: r[0], early: r[1], earlyNote: r[2], late: r[3], lateNote: r[4], event: r[5], updated: r[6], by: r[7] }; });
  return out_({ ok: true, rows: rows });
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var pass = PropertiesService.getScriptProperties().getProperty('ADMIN_PASS');
    if (!pass) throw new Error('還沒設定後台密碼（指令碼屬性 ADMIN_PASS）');
    if (d.pass !== pass) throw new Error('密碼錯誤');
    if (d.action == 'login') return out_({ ok: true });
    if (d.action == 'saveMonth') {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { saveMonth_(d.month, d.days || [], clean_(d.by)); } finally { lock.releaseLock(); }
      return out_({ ok: true });
    }
    throw new Error('未知的動作');
  } catch (err) {
    return out_({ ok: false, error: err.message });
  }
}

function saveMonth_(month, days, by) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式錯誤');
  var s = sheet_();
  var all = s.getDataRange().getDisplayValues().slice(1);
  var keep = all.filter(function (r) { return r[0] && r[0].indexOf(month) != 0; });
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  var add = days.filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date.indexOf(month) == 0; })
    .map(function (x) { return [x.date, clean_(x.early), clean_(x.earlyNote), clean_(x.late), clean_(x.lateNote), clean_(x.event), now, by]; });
  var rows = keep.concat(add).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, HEAD.length).clearContent();
  if (rows.length) {
    s.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    s.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
  }
}
