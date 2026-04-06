// =============================================
// WEGWIJZER — Base path detectie
// Werkt op localhost EN GitHub Pages
// =============================================

var BASE_PATH = (function () {
  // Detecteer of we op GitHub Pages draaien
  var path = window.location.pathname;
  // Als de URL /wegwijzer-app/ bevat, gebruik dat als base
  var match = path.match(/^(\/[^/]+\/)/);
  // Op localhost is path gewoon /, op GH Pages /wegwijzer-app/
  if (match && match[1] !== '/' && !path.startsWith('/index.html')) {
    return match[1];
  }
  return '/';
})();

function appUrl(page) {
  return BASE_PATH + page;
}

// Onderdruk Chrome PWA installatiebanner permanent
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
});
