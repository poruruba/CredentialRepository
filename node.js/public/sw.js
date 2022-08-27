var CACHE_NAME = 'pwa-sample-caches';
var urlsToCache = [
  // キャッシュ化したいコンテンツ
];

self.addEventListener('install', function(event) {
  console.log('sw event: install called');
});

self.addEventListener('fetch', function(event) {
  console.log('sw event: fetch called');
});
