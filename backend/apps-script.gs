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
 * 上班打卡存在本試算表的「打卡紀錄」分頁（第一次打卡時自動建立）；基地位置在超級管理員頁設定。
 */
var INVENTORY_ID = '1GaTYKBds0xFtv-ofYkMNryKFjWpA2sU1hYhiTAUxZ2I';
var FINANCE_ID = '1uh2QXVU3uNwI5VTFAQvu71rm89IglIsWTef7B_6JkiI';
// 最低量通知寄給誰（多人用逗號隔開）；留空＝寄給部署這支程式的 Google 帳號
var NOTIFY_TO = '';
// 活動報名系統試算表 ID（超級管理員頁面要管理「後台帳號」名單時用；從報名系統試算表網址 /d/ 和 /edit 中間那段複製）
var ACTIVITY_SHEET_ID = '';
// 超級管理員帳號，和初始密碼（在超級管理員頁改過密碼後，就改用「時薪設定」分頁「超級管理員」列 C 欄的密碼）
var SUPER_USER = 'admin';
var SUPER_PASS_INIT = '';
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
    if (p.rates) return out_({ ok: true, rates: rates_() });
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
    if (d.action == 'myPay') return out_(myPay_(d.name, d.pw));
    if (d.action == 'clock') return out_(clock_(d));
    if (d.action == 'myClock') return out_(myClock_(d));
    if (d.superPw != null) return out_(super_(d));
    if (d.action == 'pwLogin') return out_(pwLogin_(d.user, d.pw));
    if (d.action == 'changePw') return out_(changePw_(d.name, d.pw, d.newPw));
    var who = auth_(d.token);
    if (d.action == 'login') return out_({ ok: true, email: who });
    if (d.action == 'clockList') return out_({ ok: true, rows: clockRows_(d.month), base: base_() });
    if (d.action == 'clockAdd' || d.action == 'clockDel') return out_(clockEdit_(d, who));
    if (d.action == 'rates' || d.action == 'saveRates') return out_({ ok: false, error: '時薪和薪水只有超級管理員看得到', notSuper: true });
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

// ===== 時薪（存在本試算表「時薪設定」分頁：A 姓名、B 時薪；「預設」那列是沒設定的人用的時薪） =====
var RATE_SHEET = '時薪設定';
function rateSheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(RATE_SHEET);
  if (!s) { s = ss.insertSheet(RATE_SHEET); s.getRange(1, 1, 2, 2).setValues([['姓名', '時薪'], ['預設', 196]]); s.getRange('1:1').setFontWeight('bold'); s.setFrozenRows(1); }
  if (s.getRange(1, 3).getDisplayValue() != '查薪水密碼') s.getRange(1, 3).setValue('查薪水密碼').setFontWeight('bold');
  return s;
}
function rateRows_() { return rateSheet_().getRange(1, 1, Math.max(rateSheet_().getLastRow(), 1), 3).getDisplayValues().slice(1); }
function rates_() {
  var o = {};
  rateRows_().forEach(function (r) { var n = String(r[0]).trim(), v = Number(String(r[1]).replace(/[^\d.]/g, '')); if (n && v > 0) o[n] = v; });
  return o;
}
function pws_() {
  var o = {};
  rateRows_().forEach(function (r) { var n = String(r[0]).trim(), p = String(r[2]).trim(); if (n && p) o[n] = p; });
  return o;
}
function saveRates_(rates, pws) {
  var rows = [], names = {};
  Object.keys(rates).concat(Object.keys(pws)).forEach(function (k) { if (String(k).trim()) names[k] = 1; });
  Object.keys(names).forEach(function (k) {
    var v = Number(rates[k]); v = v > 0 && v < 100000 ? v : '';
    var p = String(pws[k] || '').trim().slice(0, 50);
    if (v !== '' || p) rows.push([clean_(k), v, p ? "'" + p.replace(/^'/, '') : '']);
  });
  var s = rateSheet_();
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 3).clearContent();
  if (rows.length) s.getRange(2, 1, rows.length, 3).setValues(rows);
}
// 前台「查我的薪水」：姓名＋密碼對了才回傳這個人的時薪（打錯 5 次鎖 10 分鐘）
// 還沒設自己密碼的人用「預設」那列的密碼，登入後會被要求改成自己的
function checkPw_(name, pw) {
  name = String(name || '').trim(); pw = String(pw || '').trim();
  var cache = CacheService.getScriptCache(), k = 'fail_' + Utilities.base64EncodeWebSafe(name), n = Number(cache.get(k) || 0);
  if (n >= 5) throw new Error('密碼錯太多次，請 10 分鐘後再試');
  var all = pws_(), own = all[name], p = own || all['預設'];
  if (!name || name == '預設' || name == SUPER_NAME || !pw || !p || p !== pw) { cache.put(k, String(n + 1), 600); throw new Error('姓名或密碼不對（忘記密碼請找管理員）'); }
  cache.remove(k);
  return { name: name, usedDefault: !own };
}
function myPay_(name, pw) {
  try { var c = checkPw_(name, pw); } catch (e) { return { ok: false, error: e.message }; }
  var r = rates_();
  return { ok: true, name: c.name, rate: r[c.name] || 0, def: r['預設'] || 196, usedDefault: c.usedDefault };
}
function changePw_(name, pw, newPw) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var c = checkPw_(name, pw);
    newPw = String(newPw || '').trim();
    if (newPw.length < 4 || newPw.length > 50) throw new Error('新密碼要 4 個字以上');
    if (newPw == pws_()['預設']) throw new Error('新密碼不能跟預設密碼一樣');
    var s = rateSheet_(), v = s.getRange(1, 1, s.getLastRow(), 1).getDisplayValues(), row = 0;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() == c.name) { row = i + 1; break; }
    if (!row) { row = s.getLastRow() + 1; s.getRange(row, 1).setValue(clean_(c.name)); }
    s.getRange(row, 3).setNumberFormat('@').setValue(newPw);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; } finally { lock.releaseLock(); }
}

// ===== 超級管理員（用密碼登入，不用 Google）=====
// 密碼存在「時薪設定」分頁「超級管理員」那一列的 C 欄；第一次請直接在試算表填
var SUPER_NAME = '超級管理員';
function super_(d) {
  try {
    var p = pws_()[SUPER_NAME] || SUPER_PASS_INIT;
    var cache = CacheService.getScriptCache(), n = Number(cache.get('fail_super') || 0);
    if (n >= 5) throw new Error('密碼錯太多次，請 10 分鐘後再試');
    if (!p) throw new Error('還沒設定超級管理員密碼：請在 Apps Script 的 SUPER_PASS_INIT 填初始密碼');
    if (String(d.superUser || '').trim().toLowerCase() !== SUPER_USER.toLowerCase() || String(d.superPw || '') !== p) { cache.put('fail_super', String(n + 1), 600); throw new Error('超級管理員帳號或密碼不對'); }
    cache.remove('fail_super');
    var a = d.action;
    if (a == 'superLogin') return { ok: true };
    if (a == 'getBase') return { ok: true, base: base_() };
    if (a == 'setBase') return { ok: true, base: setBase_(d) };
    if (a == 'rates') { var w = pws_(); delete w[SUPER_NAME]; return { ok: true, rates: rates_(), pws: w }; }
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (a == 'saveRates') { var pw = d.pws || {}; pw[SUPER_NAME] = p; saveRates_(d.rates || {}, pw); return { ok: true }; }
      if (a == 'accounts') return { ok: true, accounts: accounts_() };
      if (a == 'saveAccounts') { saveAccounts_(d.accounts || []); return { ok: true, accounts: accounts_() }; }
      if (a == 'superPw') {
        var np = String(d.newPw || '').trim(); if (np.length < 6) throw new Error('新密碼要 6 個字以上');
        var all = pws_(); all[SUPER_NAME] = np; saveRates_(rates_(), all); return { ok: true };
      }
      if (a == 'admins') return { ok: true, admins: admins_() };
      if (a == 'addAdmin') {
        var em = String(d.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('Email 格式不對');
        if (admins_().indexOf(em) < 0) adminSheet_().appendRow([em]);
        return { ok: true, admins: admins_() };
      }
      if (a == 'delAdmin') {
        var em2 = String(d.email || '').trim().toLowerCase(), list = admins_();
        if (list.length <= 1) throw new Error('至少要留一個後台帳號');
        var sh = adminSheet_(), v = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
        for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]).trim().toLowerCase() == em2) sh.deleteRow(i + 1);
        return { ok: true, admins: admins_() };
      }
    } finally { lock.releaseLock(); }
    throw new Error('未知的動作');
  } catch (e) { return { ok: false, error: e.message }; }
}
// ===== 後台帳號密碼（不用 Google 的登入方式；超級管理員在超級管理員頁管理）=====
var ACC_SHEET = '後台帳號密碼';
function accSheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(ACC_SHEET);
  if (!s) { s = ss.insertSheet(ACC_SHEET); s.getRange(1, 1, 1, 3).setValues([['帳號', '密碼', '備註']]).setFontWeight('bold'); s.getRange('A:B').setNumberFormat('@'); s.setFrozenRows(1); }
  return s;
}
function accounts_() {
  var s = accSheet_(); if (s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, 3).getDisplayValues().filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { user: String(r[0]).trim(), pw: String(r[1]).trim(), note: String(r[2]).trim() }; });
}
function saveAccounts_(list) {
  var seen = {}, rows = [];
  list.forEach(function (a) {
    var u = String(a.user || '').trim().slice(0, 40), p = String(a.pw || '').trim().slice(0, 50);
    if (!u || seen[u.toLowerCase()]) return; if (p.length < 4) throw new Error('「' + u + '」的密碼要 4 個字以上');
    seen[u.toLowerCase()] = 1; rows.push([u, p, String(a.note || '').trim().slice(0, 100)]);
  });
  var s = accSheet_();
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 3).clearContent();
  if (rows.length) s.getRange(2, 1, rows.length, 3).setValues(rows);
}
function secret_() {
  var P = PropertiesService.getScriptProperties(), k = P.getProperty('tokSecret');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('tokSecret', k); }
  return k;
}
function sign_(msg) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, secret_())).replace(/=+$/, ''); }
function pwLogin_(user, pw) {
  user = String(user || '').trim(); pw = String(pw || '').trim();
  var cache = CacheService.getScriptCache(), k = 'fail_acc_' + Utilities.base64EncodeWebSafe(user.toLowerCase()), n = Number(cache.get(k) || 0);
  if (n >= 5) return { ok: false, error: '密碼錯太多次，請 10 分鐘後再試' };
  var a = accounts_().filter(function (x) { return x.user.toLowerCase() == user.toLowerCase(); })[0];
  if (!a || !pw || a.pw !== pw) { cache.put(k, String(n + 1), 600); return { ok: false, error: '帳號或密碼不對' }; }
  cache.remove(k);
  var exp = Date.now() + 12 * 3600 * 1000, u64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(a.user).getBytes());
  return { ok: true, token: 'b.' + exp + '.' + u64 + '.' + sign_(exp + '.' + u64), email: a.user };
}
// 帳號密碼登入的憑證：b.到期時間.帳號.簽章（帳號被刪掉就失效）
function pwAuth_(token) {
  var p = token.split('.');
  if (p.length != 4 || Number(p[1]) < Date.now() || sign_(p[1] + '.' + p[2]) !== p[3]) throw new Error('登入已過期，請重新登入');
  var user = Utilities.newBlob(Utilities.base64DecodeWebSafe(p[2])).getDataAsString();
  if (!accounts_().some(function (x) { return x.user == user; })) throw new Error('登入已過期，請重新登入（帳號已被移除）');
  return user;
}

function adminSheet_() {
  if (!ACTIVITY_SHEET_ID) throw new Error('還沒填 ACTIVITY_SHEET_ID（報名系統試算表 ID），請在 Apps Script 第 20 行左右填好再部署');
  var sh = SpreadsheetApp.openById(ACTIVITY_SHEET_ID).getSheetByName('後台帳號');
  if (!sh) throw new Error('報名系統試算表找不到「後台帳號」分頁');
  return sh;
}
function admins_() {
  var sh = adminSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }).filter(function (v) { return v.indexOf('@') > 0; });
}

// ===== 登入驗證：把報名系統發的登入憑證拿回報名系統確認（同一份後台帳號名單） =====
function auth_(token) {
  token = String(token || '');
  if (token.indexOf('b.') == 0) return pwAuth_(token);
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
      if (min > 0 && stock <= min) out.push({ key: r[2], text: (cat ? '【' + cat + '】' : '') + r[2] + '：庫存 ' + stock + ' ' + r[3] + '（最低量 ' + min + '）' + (r[7] ? '・' + r[7] : '') });
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

// ===== 上班打卡 =====
// 員工用「姓名＋查薪水密碼」登入打卡；有設基地位置時，要在半徑內才能打（時間以伺服器為準）
var CLOCK_SHEET = '打卡紀錄';
var CLOCK_HEAD = ['時間', '日期', '姓名', '類型', '距離基地(公尺)', '緯度', '經度', '定位誤差(公尺)', '備註', '登記人'];
function clockSheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(CLOCK_SHEET);
  if (!s) {
    s = ss.insertSheet(CLOCK_SHEET);
    s.getRange(1, 1, 1, CLOCK_HEAD.length).setValues([CLOCK_HEAD]).setFontWeight('bold');
    s.getRange('A:C').setNumberFormat('@'); s.setFrozenRows(1);
  }
  return s;
}
function base_() {
  var P = PropertiesService.getScriptProperties(), lat = parseFloat(P.getProperty('clockLat')), lng = parseFloat(P.getProperty('clockLng'));
  var r = Number(P.getProperty('clockRadius')) || 200, ok = isFinite(lat) && isFinite(lng);
  return { set: ok, lat: ok ? lat : null, lng: ok ? lng : null, radius: r };
}
function setBase_(d) {
  var P = PropertiesService.getScriptProperties();
  if (d.clear) { P.deleteProperty('clockLat'); P.deleteProperty('clockLng'); }
  else if (d.lat != null) {
    var lat = Number(d.lat), lng = Number(d.lng);
    if (!(isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error('位置格式不對');
    P.setProperty('clockLat', String(lat)); P.setProperty('clockLng', String(lng));
  }
  var r = Number(d.radius);
  if (r) { if (!(r >= 30 && r <= 5000)) throw new Error('範圍要在 30～5000 公尺之間'); P.setProperty('clockRadius', String(Math.round(r))); }
  return base_();
}
function dist_(a, b, c, e) {
  var R = 6371000, t = Math.PI / 180, x = (c - a) * t, y = (e - b) * t;
  var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * t) * Math.cos(c * t) * Math.sin(y / 2) * Math.sin(y / 2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// 可以打卡的人：「時薪設定」裡的人，或班表（任何月份分頁、班表資料）上出現的名字
function staffNames_() {
  var cache = CacheService.getScriptCache(), c = cache.get('staffNames');
  if (c) return JSON.parse(c);
  var o = {}, skip = [CLOCK_SHEET, RATE_SHEET, ACC_SHEET];
  rateRows_().forEach(function (r) { var n = String(r[0]).trim(); if (n && n != '預設' && n != SUPER_NAME) o[n] = 1; });
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    if (skip.indexOf(sh.getName()) >= 0 || sh.getLastRow() < 1) return;
    sh.getDataRange().getDisplayValues().forEach(function (r) { r.forEach(function (v) { v = String(v).trim(); if (v.length >= 2 && v.length <= 6 && !/\d|[：:※＊*（(]/.test(v)) o[v] = 1; }); });
  });
  delete o[SUPER_NAME]; delete o['預設'];
  try { cache.put('staffNames', JSON.stringify(o), 600); } catch (e) {}
  return o;
}
function clockRows_(month, name) {
  var s = clockSheet_(); if (s.getLastRow() < 2) return [];
  var v = s.getRange(2, 1, s.getLastRow() - 1, CLOCK_HEAD.length).getDisplayValues(), out = [];
  v.forEach(function (r, i) {
    if (!r[0] || (month && r[1].indexOf(month) != 0) || (name && r[2] != name)) return;
    out.push({ row: i + 2, time: r[0], date: r[1], name: r[2], type: r[3], dist: r[4], acc: r[7], note: r[8], by: r[9] });
  });
  return out;
}
function now_(f) { return Utilities.formatDate(new Date(), 'Asia/Taipei', f); }
function clockLogin_(d) {
  var c = checkPw_(d.name, d.pw);
  if (!staffNames_()[c.name]) throw new Error('「' + c.name + '」不在班表或人員名單上，請找管理員加到「時薪設定」');
  return c.name;
}
function myClock_(d) {
  try {
    var name = clockLogin_(d), month = /^\d{4}-\d{2}$/.test(d.month || '') ? d.month : now_('yyyy-MM');
    var rt = rates_();
    return { ok: true, name: name, rows: clockRows_(month, name), base: base_(), now: now_('yyyy/MM/dd HH:mm:ss'), rate: rt[name] || 0, def: rt['預設'] || 196 };
  } catch (e) { return { ok: false, error: e.message }; }
}
function clock_(d) {
  try {
    var name = clockLogin_(d), type = d.type == 'out' ? '下班' : '上班', b = base_(), dist = '', lat = '', lng = '', acc = '';
    if (d.lat != null && d.lng != null && isFinite(Number(d.lat)) && isFinite(Number(d.lng))) {
      lat = Number(d.lat); lng = Number(d.lng); acc = Math.round(Number(d.acc) || 0);
      if (b.set) dist = dist_(b.lat, b.lng, lat, lng);
    }
    if (b.set) {
      if (lat === '') throw new Error('要開啟手機定位才能打卡');
      if (dist - Math.min(acc || 0, 100) > b.radius) throw new Error('你現在離基地約 ' + dist + ' 公尺，要在 ' + b.radius + ' 公尺內才能打卡');
    }
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var today = now_('yyyy-MM-dd'), mine = clockRows_(today, name), last = mine[mine.length - 1];
      var t = now_('yyyy/MM/dd HH:mm:ss');
      // 一分鐘內重複按同一個鈕就不再記一次
      if (last && last.type == type && (new Date(t.replace(/\//g, '-').replace(' ', 'T') + '+08:00') - new Date(last.time.replace(/\//g, '-').replace(' ', 'T') + '+08:00')) < 60000)
        return { ok: true, dup: true, type: type, time: last.time, dist: dist, rows: mine };
      var s = clockSheet_(), row = s.getLastRow() + 1;
      s.getRange(row, 1, 1, 3).setNumberFormat('@');
      s.getRange(row, 1, 1, CLOCK_HEAD.length).setValues([[t, today, clean_(name), type, dist, lat, lng, acc, clean_(String(d.note || '').slice(0, 100)), '本人']]);
      return { ok: true, type: type, time: t, dist: dist, rows: clockRows_(today, name) };
    } finally { lock.releaseLock(); }
  } catch (e) { return { ok: false, error: e.message }; }
}
// 後台補登／刪除打卡（忘記打卡、打錯）
function clockEdit_(d, who) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = clockSheet_();
    if (d.action == 'clockDel') {
      if (!(d.row >= 2 && d.row <= s.getLastRow())) throw new Error('列號錯誤');
      var r = s.getRange(d.row, 1, 1, 3).getDisplayValues()[0];
      if (r[0] != d.time || r[2] != d.name) throw new Error('資料已被別人改過，請重新整理後再試');
      s.deleteRow(d.row);
    } else {
      var name = String(d.name || '').trim(), date = String(d.date || ''), tm = String(d.time || '');
      if (!name) throw new Error('請填姓名');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(tm)) throw new Error('日期或時間格式不對');
      if (tm.length == 4) tm = '0' + tm;
      var row = s.getLastRow() + 1;
      s.getRange(row, 1, 1, 3).setNumberFormat('@');
      s.getRange(row, 1, 1, CLOCK_HEAD.length).setValues([[date.replace(/-/g, '/') + ' ' + tm + ':00', date, clean_(name), d.type == 'out' ? '下班' : '上班', '', '', '', '', clean_('補登' + (d.note ? '：' + String(d.note).slice(0, 100) : '')), clean_(who)]]);
    }
    return { ok: true, rows: clockRows_(d.month) };
  } catch (e) { return { ok: false, error: e.message }; } finally { lock.releaseLock(); }
}
