/* Carga valores de estadísticas cacheados de sesión de forma segura */
document.addEventListener('DOMContentLoaded', function() {
  try {
    var s = JSON.parse(sessionStorage.getItem('cached_dashboard_stats') || '{}');
    var failEl = document.getElementById('active-failures');
    var avgEl = document.getElementById('avg-resolution-time');
    var resEl = document.getElementById('resolved-today');
    if (failEl && s.failures !== undefined) failEl.textContent = s.failures;
    if (avgEl && s.avg) avgEl.textContent = s.avg;
    if (resEl && s.resolved !== undefined) resEl.textContent = s.resolved;
  } catch(e) {}
});
