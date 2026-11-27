// 打卡頁離線外殼：頁面先抓網路，沒網路才用快取；後台（Google）的請求不經過這裡
var C="clock-v1";
self.addEventListener("install",function(e){self.skipWaiting()});
self.addEventListener("activate",function(e){e.waitUntil(self.clients.claim())});
self.addEventListener("fetch",function(e){
  var u=new URL(e.request.url);
  if(e.request.method!="GET"||u.origin!=location.origin)return;
  e.respondWith(fetch(e.request).then(function(r){if(r.ok){var c=r.clone();caches.open(C).then(function(x){x.put(e.request,c)})}return r},
    function(){return caches.match(e.request)}));
});
