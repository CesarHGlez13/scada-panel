/* Aplica clases de módulos y tema antes de pintar */
(function() {
  try {
    var m = JSON.parse(localStorage.getItem('global_modules_config_v2') || localStorage.getItem('global_modules_config') || '{}');
    var d = document.documentElement;
    if (m.operations === false) d.classList.add('hide-module-operations');
    if (m.cranes === false) d.classList.add('hide-module-cranes');
    if (m.warehouse === false) d.classList.add('hide-module-warehouse');
    if (m.inventory === false) d.classList.add('hide-module-inventory');
  } catch(e) {}
})();
