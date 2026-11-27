// 倉儲、零用金頁的編輯功能（需要 /backend/config.js 的 BASE_API）
var Admin=(function(){
  var css='.adm-bar{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin:-.4em 0 .8em;font-size:.9em;flex-wrap:wrap}'+
  '.adm-bar button,.adm-f button{font:inherit;cursor:pointer;border-radius:10px;border:0;padding:.45em 1em;font-weight:700}'+
  '.adm-pri{background:#EC5415;color:#fff}.adm-sec{background:#fff;border:2px solid #F9B72F!important}.adm-del{background:#fff;color:#b3261e;border:1px solid #e3b3ad!important}'+
  '.adm-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;z-index:50;padding:5vh 12px;overflow:auto}'+
  '.adm-f{background:#fff;border-radius:16px;padding:18px;width:100%;max-width:460px;box-shadow:0 10px 30px rgba(0,0,0,.2)}'+
  '.adm-f h3{margin:0 0 .8em}.adm-f label{display:block;font-size:.85em;color:#666;margin:.5em 0 .2em}'+
  '.adm-f input,.adm-f textarea,.adm-f select{font:inherit;width:100%;padding:.5em .7em;border-radius:10px;border:1px solid #ccc;box-sizing:border-box}'+
  '.adm-f textarea{min-height:4.5em}.adm-row{display:flex;gap:8px}.adm-row>div{flex:1}'+
  '.adm-act{display:flex;gap:8px;margin-top:1em}.adm-act .sp{flex:1}.adm-msg{color:#c0392b;font-size:.88em;min-height:1.2em;margin:.5em 0 0}'+
  '.adm-edit{font:inherit;font-size:.8em;border:1px solid #ccd;border-radius:8px;background:#fff;color:#0070BA;padding:2px 8px;cursor:pointer;margin-left:4px}';
  var st=document.createElement("style");st.textContent=css;document.head.appendChild(st);
  var ACT="https://script.google.com/macros/s/AKfycbyRp9pfZlfnr-UiOJizY5ASMGFyHFLM8pzPBOV4QfUZyQOuaZQ6S-k7HS-63Kvji0Xrlw/exec";
  // 跟工作人員入口、報名後台共用同一個 Google 登入憑證
  // Google 登入（跟報名後台共用 must-admin），或帳號密碼登入（base-admin，只用在基地後台）
  function pass(){try{var t=sessionStorage.getItem("must-admin")||"";var p=t.split(".");if(p.length==3&&+p[0]>Date.now()&&p[1])return t;
    var b=sessionStorage.getItem("base-admin")||"",q=b.split(".");if(q.length==4&&q[0]=="b"&&+q[1]>Date.now())return b}catch(e){}return ""}
  function email(){try{return (sessionStorage.getItem("must-admin")?sessionStorage.getItem("must-admin-email"):sessionStorage.getItem("base-admin-user"))||""}catch(e){return ""}}
  function logout(){try{["must-admin","must-admin-email","base-admin","base-admin-user"].forEach(function(k){sessionStorage.removeItem(k)})}catch(e){}}
  function act(a,d){return fetch(ACT,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(Object.assign({action:a},d||{}))}).then(function(r){return r.json()},function(){throw new Error("連不上登入伺服器")}).then(function(j){if(!j.ok)throw new Error(j.error||"登入失敗");return j})}
  // 跳出 Google 登入視窗，成功後呼叫 done(email)
  function login(done){
    var m=document.createElement("div");m.className="adm-mask";
    m.innerHTML='<div class="adm-f" style="text-align:center"><h3>登入後台</h3><p style="color:#666;font-size:.9em">用 Google 帳號（跟報名後台同一份名單）</p><div id="adm-gsi" style="display:flex;justify-content:center;min-height:44px"></div><p style="color:#999;font-size:.85em;margin:.8em 0 .3em">或用帳號密碼</p><form class="adm-pw" style="text-align:left"><input name="u" placeholder="帳號" autocomplete="username" style="margin-bottom:6px"><input name="p" type="password" placeholder="密碼" autocomplete="current-password"><button type="submit" class="adm-pri" style="width:100%;margin-top:8px">登入</button></form><p class="adm-msg"></p><div class="adm-act"><span class="sp"></span><button type="button" class="adm-sec" data-x="cancel">取消</button></div></div>';
    document.body.appendChild(m);var msg=m.querySelector(".adm-msg");
    m.addEventListener("click",function(e){if(e.target==m||e.target.dataset.x=="cancel")m.remove()});
    m.querySelector(".adm-pw").onsubmit=function(e){e.preventDefault();var u=this.u.value.trim(),p=this.p.value;if(!u||!p){msg.textContent="請輸入帳號和密碼";return}
      msg.style.color="#666";msg.textContent="驗證中…";
      fetch(BASE_API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"pwLogin",user:u,pw:p})}).then(function(r){return r.json()},function(){throw new Error("連不上後台")})
        .then(function(k){if(!k.ok)throw new Error(k.error||"登入失敗");try{sessionStorage.setItem("base-admin",k.token);sessionStorage.setItem("base-admin-user",k.email)}catch(e){}m.remove();done(k.email)})
        .catch(function(e){msg.style.color="";msg.textContent=e.message})};
    act("loginConfig").then(function(j){
      if(!j.clientId)throw new Error("報名系統尚未設定 Google 登入");
      function go(){google.accounts.id.initialize({client_id:j.clientId,ux_mode:"popup",auto_select:false,callback:function(r){
        msg.style.color="#666";msg.textContent="驗證中…";
        act("googleLogin",{credential:r.credential}).then(function(k){
          try{sessionStorage.setItem("must-admin",k.token);sessionStorage.setItem("must-admin-email",k.email||"")}catch(e){}
          m.remove();done(k.email);
        }).catch(function(e){msg.style.color="";msg.textContent=e.message})}});
        google.accounts.id.renderButton(m.querySelector("#adm-gsi"),{theme:"outline",size:"large",text:"signin_with",shape:"pill",locale:"zh-TW",width:260})}
      if(window.google&&google.accounts)go();else{var sc=document.createElement("script");sc.src="https://accounts.google.com/gsi/client";sc.async=true;sc.onload=go;document.head.appendChild(sc)}
    }).catch(function(e){msg.textContent=e.message});
  }
  function on(){return !!(typeof BASE_API!="undefined"&&BASE_API&&pass())}
  function api(body){
    body.token=pass();
    return fetch(BASE_API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(body)})
      .then(function(r){return r.json()},function(){throw new Error("連不上後台，請稍後再試")})
      .then(function(j){if(!j.ok){if(/登入/.test(j.error||""))logout();throw new Error(j.error||"失敗")}return j});
  }
  function read(t){return fetch(BASE_API+"?t="+t).then(function(r){return r.json()}).then(function(j){if(!j.ok)throw new Error(j.error);return j.rows.map(function(r,i){r=r.map(function(x){return String(x).trim()});r._row=i+1;return r})})}
  function bar(el,onChange){
    if(typeof BASE_API=="undefined"||!BASE_API){el.innerHTML="";return}
    el.className="adm-bar";
    if(on()){el.innerHTML='<span>✏️ 編輯模式'+(email()?'（'+email()+'）':'')+'</span><button type="button" class="adm-sec" data-a="out">登出</button>'}
    else el.innerHTML='<button type="button" class="adm-sec" data-a="in">登入編輯</button>';
    el.onclick=function(e){var a=e.target.dataset.a;if(!a)return;
      if(a=="out"){logout();bar(el,onChange);onChange();return}
      login(function(){bar(el,onChange);onChange()});
    };
  }
  // fields: [{k,label,type,value,options,half}]
  function form(o){
    var m=document.createElement("div");m.className="adm-mask";
    var h='<form class="adm-f"><h3>'+o.title+'</h3>',i=0;
    while(i<o.fields.length){var f=o.fields[i];
      if(f.half&&o.fields[i+1]&&o.fields[i+1].half){h+='<div class="adm-row"><div>'+fld(f)+'</div><div>'+fld(o.fields[i+1])+'</div></div>';i+=2}
      else{h+=fld(f);i++}}
    h+='<p class="adm-msg"></p><div class="adm-act">'+(o.del?'<button type="button" class="adm-del" data-x="del">刪除</button>':'')+'<span class="sp"></span><button type="button" class="adm-sec" data-x="cancel">取消</button><button type="submit" class="adm-pri">'+(o.ok||"儲存")+'</button></div></form>';
    m.innerHTML=h;document.body.appendChild(m);
    var fm=m.querySelector("form"),msg=m.querySelector(".adm-msg"),first=fm.querySelector("input,textarea,select");if(first)first.focus();
    function close(){m.remove()}
    function busy(p){var b=fm.querySelector("[type=submit]");b.disabled=true;msg.style.color="#666";msg.textContent="處理中…";
      return p.then(close,function(e){b.disabled=false;msg.style.color="";msg.textContent=e.message})}
    m.addEventListener("click",function(e){if(e.target==m||e.target.dataset.x=="cancel")close();
      if(e.target.dataset.x=="del"&&confirm("確定刪除這一筆？（試算表裡的這一列也會被刪掉）"))busy(o.del())});
    fm.onsubmit=function(e){e.preventDefault();var v={};fm.querySelectorAll("[name]").forEach(function(x){v[x.name]=x.value});busy(Promise.resolve().then(function(){return o.submit(v)}))};
  }
  function fld(f){var v=f.value==null?"":String(f.value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
    var inp=f.type=="textarea"?'<textarea name="'+f.k+'">'+v+'</textarea>':f.options?'<select name="'+f.k+'">'+f.options.map(function(x){return '<option'+(x==f.value?' selected':'')+'>'+x+'</option>'}).join("")+'</select>':'<input name="'+f.k+'" type="'+(f.type||"text")+'" value="'+v+'"'+(f.type=="number"?' inputmode="decimal" step="any"':'')+(f.list?' list="'+f.list+'"':'')+'>';
    return '<label>'+f.label+'</label>'+inp}
  return {on:on,api:api,read:read,bar:bar,form:form,login:login,logout:logout,email:email,token:pass};
})();
