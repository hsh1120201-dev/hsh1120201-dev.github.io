/**
 * 新竹社創基地 後台（班表、倉儲清單、鑰匙清冊、零用金收支 共用）
 *
 * 安裝：
 * 1. 打開「2026社創基地班表」試算表 > 擴充功能 > Apps Script，貼上本檔全部內容、儲存
 * 2. 確認下面 INVENTORY_ID、FINANCE_ID 是正確的試算表 ID（倉儲清單要是 Google 試算表格式，不能是 .xlsx）
 * 3. 登入：用活動報名系統後台的 Google 帳號登入（名單＝報名系統試算表「後台帳號」A 欄），不用另外設密碼
 * 4. 部署 > 新增部署作業 > 類型「網頁應用程式」，執行身分「我」，存取權「所有人」> 部署，第一次會要求授權
 * 5. 把網頁應用程式網址貼到 GitHub 的 backend/config.js（BASE_API）
 *
 * 6. 最低量通知：在編輯器選函式「開啟庫存通知」按執行一次（會要求寄信授權），之後每天 9 點檢查，網頁上改庫存也會馬上檢查
 *
 * 班表存在本試算表的「班表資料」分頁（第一次儲存時自動建立），原本的月份分頁不會被改動。
 */
var INVENTORY_ID = '1GaTYKBds0xFtv-ofYkMNryKFjWpA2sU1hYhiTAUxZ2I';
var FINANCE_ID = '1uh2QXVU3uNwI5VTFAQvu71rm89IglIsWTef7B_6JkiI';
// 最低量通知寄給誰（多人用逗號隔開）；留空＝寄給部署這支程式的 Google 帳號
var NOTIFY_TO = '';
// 活動報名系統的 Apps Script（Google 登入與後台帳號名單沿用這裡）
var ACTIVITY_API = 'https://script.google.com/macros/s/AKfycbyRp9pfZlfnr-UiOJizY5ASMGFyHFLM8pzPBOV4QfUZyQOuaZQ6S-k7HS-63Kvji0Xrlw/exec';

// 各表格：檔案、分頁、可以改的欄（從 1 開始）、用來確認是哪一列的欄
var TABLES = {
  inv: { file: function () { return SpreadsheetApp.openById(INVENTORY_ID); }, sheet: '倉儲清單', cols: [2, 3, 4, 5, 6, 8, 9, 10], key: 3, sum: [7, 5, 6], minCol: 10 },
  key: { file: function () { return SpreadsheetApp.openById(INVENTORY_ID); }, sheet: '鑰匙清冊', cols: [2, 3, 4, 5, 7, 8], key: 2, diff: [6, 4, 5] },
  out: { file: function () { return SpreadsheetApp.openById(FINANCE_ID); }, sheet: '支出', cols: [1, 2, 3, 5], key: 2, text: [1] },
  'in': { file: function () { return SpreadsheetApp.openById(FINANCE_ID); }, sheet: '收入', cols: [1, 2, 3, 4], key: 2, text: [1] }
};

var DATA_SHEET = '班表資料';
var HEAD = ['日期', '早班', '早班備註', '晚班', '晚班備註', '活動', '更新時間', '更新人'];

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clean_(v) { v = String(v == null ? '' : v).trim().slice(0, 300); return /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v; }
function tbl_(t) { var T = TABLES[t]; if (!T) throw new Error('未知的表格'); var s = T.file().getSheetByName(T.sheet); if (!s) throw new Error('找不到分頁 ' + T.sheet); return { T: T, s: s }; }

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.t) { var x = tbl_(p.t); return out_({ ok: true, rows: x.s.getDataRange().getDisplayValues() }); }
    var v = schedSheet_().getDataRange().getDisplayValues().slice(1);
    var month = p.month || '';
    return out_({ ok: true, rows: v.filter(function (r) { return r[0] && (!month || r[0].indexOf(month) == 0); })
      .map(function (r) { return { date: r[0], early: r[1], earlyNote: r[2], late: r[3], lateNote: r[4], event: r[5], updated: r[6], by: r[7] }; }) });
  } catch (err) { return out_({ ok: false, error: err.message }); }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var who = auth_(d.token);
    if (d.action == 'login') return out_({ ok: true, email: who });
    d.by = d.by || who;
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (d.action == 'saveMonth') saveMonth_(d.month, d.days || [], clean_(d.by));
      else if (d.action == 'update') update_(d);
      else if (d.action == 'add') add_(d);
      else if (d.action == 'delete') del_(d);
      else throw new Error('未知的動作');
    } finally { lock.releaseLock(); }
    return out_({ ok: true });
  } catch (err) { return out_({ ok: false, error: err.message }); }
}

// ===== 表格（倉儲、鑰匙、支出、收入） =====
function check_(s, T, row, expect) {
  if (!(row >= 1 && row <= s.getLastRow())) throw new Error('列號錯誤');
  var now = String(s.getRange(row, T.key).getDisplayValue()).trim();
  if (now !== String(expect || '').trim()) throw new Error('資料已被別人改過，請重新整理後再試');
}
function write_(s, T, row, values) {
  T.cols.forEach(function (c) {
    if (!(String(c) in values)) return;
    var r = s.getRange(row, c);
    if (T.text && T.text.indexOf(c) >= 0) r.setNumberFormat('@');
    var v = clean_(values[c]);
    if (/^-?\d+(\.\d+)?$/.test(v) && !(T.text && T.text.indexOf(c) >= 0)) v = Number(v);
    r.setValue(v);
  });
  // 總數＝庫存＋使用中；未租借＝數量－租借中（原本是公式就不動）
  if (T.sum) { var g = s.getRange(row, T.sum[0]); if (!g.getFormula()) g.setValue(Number(s.getRange(row, T.sum[1]).getValue() || 0) + Number(s.getRange(row, T.sum[2]).getValue() || 0)); }
  if (T.diff) { var f = s.getRange(row, T.diff[0]); if (!f.getFormula()) f.setValue(Number(s.getRange(row, T.diff[1]).getValue() || 0) - Number(s.getRange(row, T.diff[2]).getValue() || 0)); }
}
function update_(d) { var x = tbl_(d.t); check_(x.s, x.T, d.row, d.check); write_(x.s, x.T, d.row, d.values || {}); afterInv_(x); }
function del_(d) { var x = tbl_(d.t); check_(x.s, x.T, d.row, d.check); x.s.deleteRow(d.row); }
function add_(d) {
  var x = tbl_(d.t), s = x.s, row;
  if (d.after) { // 插在指定列下面（倉儲：同分類最後一項；鑰匙：最後一支）
    if (!(d.after >= 1 && d.after < s.getLastRow())) throw new Error('位置錯誤');
    s.insertRowAfter(d.after); row = d.after + 1;
    s.getRange(d.after, 1, 1, s.getLastColumn()).copyTo(s.getRange(row, 1, 1, s.getLastColumn()), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    // 公式欄照上一列複製
    [x.T.sum, x.T.diff].forEach(function (a) { if (!a) return; var src = s.getRange(d.after, a[0]); if (src.getFormula()) src.copyTo(s.getRange(row, a[0])); });
  } else { // 收支：加在最後
    var v = s.getRange(1, 1, s.getLastRow(), 1).getDisplayValues(), last = 1;
    for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim()) { last = i + 1; break; }
    row = last + 1; if (row > s.getMaxRows()) s.insertRowAfter(last);
  }
  write_(s, x.T, row, d.values || {});
  afterInv_(x);
}
function afterInv_(x) {
  if (!x.T.minCol) return;
  minHead_(x.s, x.T.minCol);
  try { 庫存通知(); } catch (e) {} // 寄信失敗不影響存檔
}

// ===== 班表 =====
function schedSheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(DATA_SHEET);
  if (!s) {
    s = ss.insertSheet(DATA_SHEET);
    s.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    s.getRange('A:A').setNumberFormat('@'); s.setFrozenRows(1);
  }
  return s;
}
function saveMonth_(month, days, by) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式錯誤');
  var s = schedSheet_(), all = s.getDataRange().getDisplayValues().slice(1);
  var keep = all.filter(function (r) { return r[0] && r[0].indexOf(month) != 0; });
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  var add = days.filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date.indexOf(month) == 0; })
    .map(function (x) { return [x.date, clean_(x.early), clean_(x.earlyNote), clean_(x.late), clean_(x.lateNote), clean_(x.event), now, by]; });
  var rows = keep.concat(add).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, HEAD.length).clearContent();
  if (rows.length) { s.getRange(2, 1, rows.length, 1).setNumberFormat('@'); s.getRange(2, 1, rows.length, HEAD.length).setValues(rows); }
}

// ===== 登入驗證：把報名系統發的登入憑證拿回報名系統確認（同一份後台帳號名單） =====
function auth_(token) {
  token = String(token || '');
  var parts = token.split('.');
  if (parts.length != 3 || Number(parts[0]) < Date.now()) throw new Error('登入已過期，請重新用 Google 帳號登入');
  var email = '';
  try { email = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString(); } catch (e) {}
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return email;
  var res = UrlFetchApp.fetch(ACTIVITY_API, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify({ action: 'boardAdmin', token: token }), muteHttpExceptions: true, followRedirects: true });
  var j = {};
  try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (!j.ok) throw new Error('登入已過期或沒有後台權限，請重新用 Google 帳號登入');
  cache.put(key, '1', 600);
  return email;
}

// 第一次部署前在編輯器執行一次這個函式，讓 Google 授權「連到外部網址」
function 授權() { UrlFetchApp.fetch(ACTIVITY_API + '?action=loginConfig', { muteHttpExceptions: true }); }

// ===== 最低量通知 =====
// 倉儲清單 J 欄＝最低量（庫存 ≤ 最低量就要採購）；J 欄沒填時，沿用備註裡「剩 N 箱時採購」的 N。
function minHead_(s, col) {
  var v = s.getRange(1, 3, Math.min(s.getLastRow(), 15), 1).getDisplayValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] == '品項名稱') {
    var h = s.getRange(i + 1, col);
    if (!h.getDisplayValue()) { h.setValue('最低量'); s.getRange(i + 1, col - 1).copyTo(h, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); }
    return;
  }
}
function lowItems_() {
  var s = tbl_('inv').s, v = s.getDataRange().getDisplayValues(), out = [], cat = '';
  v.forEach(function (r) {
    if (/^\d+$/.test(r[1]) && r[2]) {
      var stock = parseFloat(String(r[4]).replace(/[^\d.\-]/g, '')) || 0, min = String(r[9] || '').trim(), m;
      if (min !== '' && !isNaN(parseFloat(min))) min = parseFloat(min);
      else if (/採購/.test(r[8]) && (m = String(r[8]).match(/剩\s*(\d+)\s*\S?\s*時/))) min = +m[1];
      else return;
      if (stock <= min) out.push({ key: r[2], text: (cat ? '【' + cat + '】' : '') + r[2] + '：庫存 ' + stock + ' ' + r[3] + '（最低量 ' + min + '）' + (r[7] ? '・' + r[7] : '') });
    } else if (r[0] && !r[1] && !/照片|品項總數|＊|新竹社創|管理清單/.test(r[0])) cat = String(r[0]).replace(/（.*?）/g, '').trim();
  });
  return out;
}
// 有品項「新」掉到最低量以下才寄信（同一品項補貨回來前不會重複寄）
function 庫存通知() {
  var low = lowItems_(), P = PropertiesService.getScriptProperties();
  var before = JSON.parse(P.getProperty('lowSent') || '[]');
  var fresh = low.filter(function (i) { return before.indexOf(i.key) < 0; });
  P.setProperty('lowSent', JSON.stringify(low.map(function (i) { return i.key; })));
  if (!fresh.length) return 0;
  var to = NOTIFY_TO || Session.getEffectiveUser().getEmail();
  var body = '以下品項已到最低量，要採購：\n\n' + fresh.map(function (i) { return '・' + i.text; }).join('\n') +
    (low.length > fresh.length ? '\n\n其他還沒補貨的：\n' + low.filter(function (i) { return fresh.indexOf(i) < 0; }).map(function (i) { return '・' + i.text; }).join('\n') : '') +
    '\n\n倉儲清單：https://hsh1120201-dev.github.io/inventory/';
  MailApp.sendEmail(to, '【社創基地】' + fresh.length + ' 項物品到最低量要採購', body);
  return fresh.length;
}
// 在編輯器執行一次：每天早上 9 點檢查（直接改試算表也會被抓到），並完成寄信授權
function 開啟庫存通知() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() == '庫存通知') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('庫存通知').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Taipei').create();
  minHead_(tbl_('inv').s, TABLES.inv.minCol);
  庫存通知();
}
