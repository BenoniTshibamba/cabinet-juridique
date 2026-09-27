(function () {
  var html = document.documentElement;
  try {
    var theme = localStorage.getItem('cej:theme');
    var dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    html.dataset.theme = 'light';
  }
})();
