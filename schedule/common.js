// 班表共用程式：前台 index.html 與後台 admin.html 都用
var SHEET_ID="1bNoY0xiXiCuwJMWQ_g6ngQIGWtEgLuJILyS3-9ETBW4";
var DATA_SHEET="班表資料"; // 後台儲存的分頁
var OFF=/^(休館|無晚班|不須值勤|不需要)$/;
var WK="一二三四五六日";
var DEFAULT_NOTES=["※週一至週五值勤時間 9:00-16:30，週六值勤時間 9:00-18:00\n※休息時間為半小時","※晚班值勤時間\nA時段：16:00-20:00\nB時段：16:30-20:00"];

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function pad(n){return ("0"+n).slice(-2)}
function ym(M){return M.y+"-"+pad(M.m)}
function parseCSV(t){var rows=[],row=[],f="",q=false;for(var i=0;i<t.length;i++){var c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){row.push(f);f=""}else if(c=='\n'){row.push(f);rows.push(row);row=[];f=""}else if(c!='\r')f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows}
function gviz(sheet){return fetch("https://docs.google.com/spreadsheets/d/"+SHEET_ID+"/gviz/tq?tqx=out:csv&headers=0&sheet="+encodeURIComponent(sheet)).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.text()}).then(parseCSV)}

// 月份清單：115年分頁叫「1月」～「12月」；116年起分頁叫「116年1月」…（舊格式），之後建議都用後台
function monthList(){var L=[];[115,116,117].forEach(function(yr){for(var i=1;i<=12;i++)L.push({yr:yr,m:i,y:yr+1911,label:i+"月",sheet:yr==115?i+"月":yr+"年"+i+"月",check:yr+"年"+i+"月"})});return L}

// 舊格式：試算表月曆（早班／晚班區塊，可左右或上下排）
function parseGrid(rows,check){
  var g=function(r,c){var v=((rows[r]||[])[c]||"").trim();return /^[＊※*]/.test(v)?"":v};
  var all=rows.map(function(r){return r.join(" ")}).join("\n");
  if(check&&all.replace(/\s/g,"").indexOf(check)<0&&all.indexOf(check.replace("月",""))<0)return null;
  var secs=[];
  for(var r=0;r<rows.length;r++)for(var c=0;c<(rows[r]||[]).length;c++)if(g(r,c)=="一"&&g(r,c+1)=="二"&&g(r,c+2)=="三"){secs.push({r:r,c:c});c+=6}
  if(!secs.length)return null;
  var model={days:{},notes:[]};
  secs.forEach(function(S){
    var title="";for(var i=-1;i<8;i++)title+=g(S.r-1,S.c+i);
    var key=/早班/.test(title)?"early":"late";
    var end=rows.length;secs.forEach(function(T){if(T.c==S.c&&T.r>S.r&&T.r-1<end)end=T.r-1});
    var cell=null;
    for(var r=S.r+1;r<end;r++){
      var cells=[];for(var i=0;i<7;i++)cells.push(g(r,S.c+i));
      if((rows[r]||[]).slice(S.c,S.c+7).some(function(x){return x.indexOf("※")>=0}))break;
      var off=null,ok=true,any=false,parsed=[];
      cells.forEach(function(x,i){if(!x){parsed.push(null);return}any=true;var m=x.match(/^([\s\S]*?)(\d{1,2})$/);if(!m||+m[2]<1||+m[2]>31){ok=false;return}var o=+m[2]-i;if(off===null)off=o;else if(off!==o)ok=false;parsed.push({n:+m[2],ev:m[1].trim()})});
      if(any&&ok){cell=parsed.map(function(p){if(!p)return null;var d=model.days[p.n]||(model.days[p.n]={ev:[],early:[],late:[]});if(p.ev&&d.ev.indexOf(p.ev)<0)d.ev.push(p.ev);return d});continue}
      if(!cell)continue;
      cells.forEach(function(x,i){if(x&&cell[i])cell[i][key].push(x)});
    }
  });
  rows.forEach(function(r){r.forEach(function(x){x=x.trim();if(/^[※＊]/.test(x)&&model.notes.indexOf(x)<0)model.notes.push(x)})});
  return model;
}

// 116年1月草稿（照 115年12月模式）
function draftJan(){
  var m={days:{},notes:DEFAULT_NOTES.concat(["※週六早班有活動／場租才排"])};
  for(var d=1;d<=31;d++){var wd=(new Date(2027,0,d).getDay()+6)%7,x={ev:[],early:[],late:[]};
    if(d==1){x.early=["不須值勤","元旦國定假日"];x.late=["不須值勤","元旦國定假日"]}
    else if(wd==6){x.early=["休館"];x.late=["休館"]}
    else if(wd==5){x.early=["待定","有活動才排"];x.late=["無晚班"]}
    else if(wd==4){x.early=["王鈞"];x.late=["吳亮廷","B時段(補)"]}
    else{x.early=["丘建宇"];x.late=["嚴柏安","B時段"]}
    m.days[d]=x}
  return m;
}

// 後台資料（班表資料分頁）→ {"2027-01":{days:{...}}}
var _data=null;
function loadData(force){
  if(_data&&!force)return Promise.resolve(_data);
  return gviz(DATA_SHEET).then(function(rows){
    var out={};
    if(!rows.length||rows[0][0].trim()!="日期"||rows[0][1].trim()!="早班")return _data=out; // 還沒有後台分頁
    rows.slice(1).forEach(function(r){var m=(r[0]||"").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return;
      var k=m[1]+"-"+m[2],d=+m[3],o=out[k]||(out[k]={days:{},notes:DEFAULT_NOTES.slice(),fromData:true});
      var x={ev:[],early:[],late:[]};
      if(r[1])x.early.push(r[1].trim());if(r[2])x.early.push(r[2].trim());
      if(r[3])x.late.push(r[3].trim());if(r[4])x.late.push(r[4].trim());
      if(r[5])x.ev.push(r[5].trim());
      if(!x.early.length&&r[2])x.early=["",r[2]];
      o.days[d]=x});
    return _data=out;
  }).catch(function(){return _data={}});
}

// 讀一個月：後台資料優先 → 舊分頁 → 草稿
function loadMonth(M){
  return loadData().then(function(data){
    if(data[ym(M)]&&Object.keys(data[ym(M)].days).length)return data[ym(M)];
    return gviz(M.sheet).then(function(rows){
      rows=rows.map(function(r){return r.map(function(x){return x})});
      var m=parseGrid(rows,M.check);if(m&&Object.keys(m.days).length){m.fromSheet=true;return m}
      if(M.yr==116&&M.m==1){m=draftJan();m.draft=true;return m}
      return null;
    }).catch(function(){if(M.yr==116&&M.m==1){var m=draftJan();m.draft=true;return m}return null});
  });
}

// ===== 時數計算 =====
// 規則從當月備註讀（例：周一至周五值勤時間9:00-16:30、A時段：16:00-20:00），讀不到就用預設
function tm(s){var p=s.split(":");return +p[0]+(+p[1])/60}
function rng(text,re,def){var m=text.match(re);return m?[tm(m[1]),tm(m[2])]:def}
function hourRule(model){
  var t=(model.notes||[]).join("\n").replace(/週/g,"周");
  var T="(\\d{1,2}:\\d{2})\\s*[-~～－]\\s*(\\d{1,2}:\\d{2})";
  return {
    wk:rng(t,new RegExp("周一至周五值勤時間\\s*"+T),[9,16.5]),
    sat:rng(t,new RegExp("周六值勤時間\\s*"+T),[9,18]),
    A:rng(t,new RegExp("A時段[：:]\\s*"+T),[16,20]),
    B:rng(t,new RegExp("B時段[：:]\\s*"+T),[16.5,20]),
    brk:0 // 休息時間不扣（H：早班 9:00-16:30 算 7.5 小時）
  };
}
function shiftHours(kind,lines,wd,R){
  var who=lines[0]||"";
  if(!who||OFF.test(who)||/待定|颱風|假/.test(who)||wd==6)return 0;
  var note=lines.slice(1).join(" ");
  var m=note.match(/(\d{1,2}:\d{2})\s*[-~～－到]\s*(\d{1,2}:\d{2})/);
  var r;
  if(m)r=[tm(m[1]),tm(m[2])];
  else if(kind=="late"){r=/A時段/.test(note)?R.A:R.B;var a=note.match(/(\d{1,2}:\d{2})\s*到班/);if(a)r=[tm(a[1]),r[1]]}
  else r=wd==5?R.sat:R.wk;
  var h=r[1]-r[0];
  if(kind=="early"&&h>6)h-=R.brk;
  return Math.max(0,Math.round(h*100)/100);
}
// 回傳 {人名:{e:早班數,l:晚班數,h:總時數}}
function monthHours(model,M){
  var R=hourRule(model),first=(new Date(M.y,M.m-1,1).getDay()+6)%7,last=new Date(M.y,M.m,0).getDate(),cnt={};
  for(var d=1;d<=last;d++){var x=model.days[d];if(!x)continue;var wd=(first+d-1)%7;
    [["early","e"],["late","l"]].forEach(function(k){var h=shiftHours(k[0],x[k[0]],wd,R);var p=x[k[0]][0];if(!h||/^\d+$/.test(p))return;
      var c=cnt[p]||(cnt[p]={e:0,l:0,h:0});c[k[1]]++;c.h=Math.round((c.h+h)*100)/100})}
  return cnt;
}

// ===== 國定假日（含補假）：依《紀念日及節日實施條例》規則每年自動算 =====
function holidays(Y){
  var out={},lf=new Intl.DateTimeFormat("zh-TW-u-ca-chinese",{month:"numeric",day:"numeric"});
  function key(d){return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2)}
  function D(y,m,d){return new Date(y,m-1,d)}
  function add(d,n){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n)}
  function lunar(d){var p=lf.formatToParts(d),m="",dd="";p.forEach(function(x){if(x.type=="month")m=x.value;if(x.type=="day")dd=x.value});return{m:m,d:+dd}}
  // 找農曆日期（在國曆範圍內搜尋）
  // 2026–2040 農曆節日直接查表（瀏覽器內建農曆偶爾差一天），之後的年份才用瀏覽器換算
  var T={cny:"2026-02-17 2027-02-06 2028-01-26 2029-02-13 2030-02-03 2031-01-23 2032-02-11 2033-01-31 2034-02-19 2035-02-08 2036-01-28 2037-02-15 2038-02-04 2039-01-24 2040-02-12",
    dw:"2026-06-19 2027-06-09 2028-05-28 2029-06-16 2030-06-05 2031-06-24 2032-06-12 2033-06-01 2034-06-20 2035-06-10 2036-05-30 2037-06-18 2038-06-07 2039-05-27 2040-06-14",
    zq:"2026-09-25 2027-09-15 2028-10-03 2029-09-22 2030-09-12 2031-10-01 2032-09-19 2033-09-08 2034-09-27 2035-09-16 2036-10-04 2037-09-24 2038-09-13 2039-10-02 2040-09-20"};
  function tab(k,y){var m=T[k].match(new RegExp(y+"-(\\d\\d)-(\\d\\d)"));return m?D(y,+m[1],+m[2]):null}
  function findLunar(y,lm,ld,from,to){var t=lm==1?tab("cny",y):lm==5?tab("dw",y):tab("zq",y);if(t)return t;for(var d=from;d<=to;d=add(d,1)){var l=lunar(d);if(l.m===String(lm)&&l.d===ld)return d}return null}
  var base={},list=[];
  function fixed(y){
    var r=[[D(y,1,1),"元旦"],[D(y,2,28),"和平紀念日"],[D(y,4,4),"兒童節"],[D(y,5,1),"勞動節"],[D(y,9,28),"教師節"],[D(y,10,10),"國慶日"],[D(y,10,25),"光復節"],[D(y,12,25),"行憲紀念日"]];
    var yy=y%100,q=Math.floor(yy*0.2422+4.81)-Math.floor(yy/4);r.push([D(y,4,q),"清明節"]);
    var dw=findLunar(y,5,5,D(y,5,20),D(y,6,30));if(dw)r.push([dw,"端午節"]);
    var zq=findLunar(y,8,15,D(y,9,1),D(y,10,10));if(zq)r.push([zq,"中秋節"]);
    return r;
  }
  function cny(y){ // 回傳 [小年夜,除夕,初一,初二,初三]
    var c1=findLunar(y,1,1,D(y,1,20),D(y,2,21));if(!c1)return[];
    return [[add(c1,-2),"春節（小年夜）"],[add(c1,-1),"春節（除夕）"],[c1,"春節（初一）"],[add(c1,1),"春節（初二）"],[add(c1,2),"春節（初三）"]];
  }
  [Y,Y+1].forEach(function(y){
    var used={};
    function mark(d,n){var k=key(d);if(!used[k]){used[k]=n;if(d.getFullYear()==Y)out[k]=n}}
    var c=cny(y);c.forEach(function(x){mark(x[0],x[1])});
    var f=fixed(y);f.forEach(function(x){if(!used[key(x[0])])mark(x[0],x[1]);else mark(x[0],used[key(x[0])])});
    // 補假
    if(c.length){var last=c[4][0];c.forEach(function(x){var w=x[0].getDay();if(w==0||w==6){do{last=add(last,1)}while(last.getDay()==0||last.getDay()==6||used[key(last)]);mark(last,x[1].replace(/（.*）/,"")+"補假")}})}
    f.forEach(function(x){var d=x[0],w=d.getDay(),n=x[1];
      // 兒童節與清明同一天：前一天放假，但遇星期四改後一天
      if(n=="兒童節"&&f.filter(function(z){return key(z[0])==key(d)}).length>1){var alt=w==4?add(d,1):add(d,-1);if(alt.getDay()==0)alt=add(alt,1);if(alt.getDay()==6)alt=add(alt,-1);mark(alt,"兒童節補假");return}
      if(w==6){var p=add(d,-1);while(used[key(p)]&&used[key(p)].indexOf("補假")<0&&p.getDay()!=6)p=add(p,-1);mark(p,n+"補假")}
      else if(w==0){var p=add(d,1);while(p.getDay()==0||p.getDay()==6||used[key(p)])p=add(p,1);mark(p,n+"補假")}
    });
  });
  return out;
}
var _hol={};
// 連假裡的週六（前一天週五放假，或後天週一放假）也算休館，例如元旦 1/1 週五放假 → 1/2 週六一起休
function holidayName(y,m,d){
  function h(dt){var Y=dt.getFullYear();if(!_hol[Y])_hol[Y]=holidays(Y);return _hol[Y][Y+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate())]||""}
  var dt=new Date(y,m-1,d),n=h(dt);if(n)return n;
  if(dt.getDay()==6){var f=h(new Date(y,m-1,d-1))||h(new Date(y,m-1,d+2));if(f)return f.replace(/（.*）|補假/g,"")+"連假"}
  if(dt.getDay()==0){var f2=h(new Date(y,m-1,d-2))||h(new Date(y,m-1,d+1));if(f2)return f2.replace(/（.*）|補假/g,"")+"連假"}
  return "";
}

// ===== 薪水 =====
// 法定最低工資時薪（每年 9 月左右公告，隔年 1/1 生效；新年度公告後在這裡加一筆）
var MINWAGE={2025:190,2026:196,2027:205};
function minWage(y){var b=0,yy=0;Object.keys(MINWAGE).forEach(function(k){if(+k<=y&&+k>yy){yy=+k;b=MINWAGE[k]}});return b}
// 時薪＝個人時薪（沒設用預設 196），但不低於該年度最低工資
function payRate(R,k,y){var r=R[k]>0?R[k]:(R["預設"]>0?R["預設"]:196);return Math.max(r,minWage(y))}
function loadRates(){if(typeof BASE_API=="undefined"||!BASE_API)return Promise.resolve({});
  return fetch(BASE_API+"?rates=1").then(function(r){return r.json()}).then(function(j){return j.ok&&j.rates?j.rates:{}}).catch(function(){return {}})}
