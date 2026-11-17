// =============================================================================
// GASTROTIME - AUTENTICACIÓN, SESIONES Y ACCESO
// =============================================================================

// Guarda la sesión en localStorage manteniendo la fecha de inicio o creándola si es nuevo login
function saveActiveSession(restaurantObj, isNewLogin = false) {
  let loginTimestamp = Date.now();
  if (!isNewLogin) {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed && parsed.loginTimestamp) {
          loginTimestamp = parsed.loginTimestamp;
        }
      } catch (_) {}
    }
  }
  const sessionData = {
    ...restaurantObj,
    loginTimestamp
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
}

// Cambia entre las pestañas de Iniciar Sesión y Registro
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('register-form').classList.toggle('hidden', isLogin);
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('register-error').classList.add('hidden');
}

// Registro de nueva empresa
async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const pass = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-password-confirm').value;
  const errorEl = document.getElementById('register-error');

  if (pass !== confirm) {
    errorEl.textContent = 'Las contraseñas no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    errorEl.classList.add('hidden');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registrando empresa...';

    const restaurant = await dbRegisterRestaurant(name, pass);
    activeRestaurant = restaurant;
    currentWorkers = await dbLoadWorkers(activeRestaurant.id);
    const currentMonday = getMondayOfDate(new Date());
    currentWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, currentMonday, currentWorkers);

    saveActiveSession(activeRestaurant, true);
    openAppView(activeRestaurant);
    setupFirestoreListeners(activeRestaurant.id);

    showToast(`Empresa "${name}" registrada con éxito.`);
  } catch (err) {
    errorEl.textContent = err.message || 'Error al registrar el restaurante.';
    errorEl.classList.remove('hidden');
  } finally {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Registrar y Abrir Local';
    }
  }
}

// Inicio de sesión de empresa existente
async function handleLogin(e) {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    errorEl.classList.add('hidden');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Iniciando sesión...';

    const restaurant = await dbLoginRestaurant(name, pass);
    activeRestaurant = restaurant;
    currentWorkers = await dbLoadWorkers(activeRestaurant.id);
    const currentMonday = getMondayOfDate(new Date());
    currentWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, currentMonday, currentWorkers);

    saveActiveSession(activeRestaurant, true);
    openAppView(activeRestaurant);
    setupFirestoreListeners(activeRestaurant.id);

    showToast(`Bienvenido al terminal de ${activeRestaurant.name}`);
  } catch (err) {
    errorEl.textContent = err.message || 'Error al iniciar sesión.';
    errorEl.classList.remove('hidden');
  } finally {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar al Terminal';
    }
  }
}

// Cierre de sesión
function logoutRestaurant() {
  teardownFirestoreListeners();
  localStorage.removeItem(SESSION_KEY);
  activeRestaurant = null;
  currentWorkers = [];
  currentWeekRecord = null;
  selectedWeekRecord = null;

  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('login-password').value = '';
}

// Abre la vista principal de la app y sincroniza cabeceras
function openAppView(restaurant) {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('header-restaurant-name').textContent = restaurant.name;
  document.getElementById('print-restaurant-title').textContent = restaurant.name;
  showTerminalView();
}
