// =============================================================================
// GASTROTIME - CONFIGURACIÓN DE BASE DE DATOS EN LA NUBE (FIREBASE FIRESTORE)
// =============================================================================

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDxHcT5BTC82QLDaqNTTmXmxQHjiPPOEvk",
  authDomain: "fichajes-emi.firebaseapp.com",
  projectId: "fichajes-emi",
  storageBucket: "fichajes-emi.firebasestorage.app",
  messagingSenderId: "625754905076",
  appId: "1:625754905076:web:5a618bd8612797d60641a1",
  measurementId: "G-R8PRVP2H80"
};

let firebaseAppInstance = null;
let firestoreDbInstance = null;
let isFirebaseConnected = false;

// Inicializa Firebase SDK automáticamente
function initFirebaseApp() {
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK no cargado todavía.');
    isFirebaseConnected = false;
    return null;
  }

  if (firestoreDbInstance) {
    isFirebaseConnected = true;
    return firestoreDbInstance;
  }

  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebaseAppInstance = firebase.initializeApp(DEFAULT_FIREBASE_CONFIG);
    } else {
      firebaseAppInstance = firebase.apps[0];
    }
    firestoreDbInstance = firebase.firestore();
    isFirebaseConnected = true;
    console.log('✅ Base de datos en la nube conectada con éxito (Proyecto: fichajes-emi)');
    return firestoreDbInstance;
  } catch (error) {
    console.error('❌ Error al inicializar Firebase Firestore:', error);
    isFirebaseConnected = false;
    return null;
  }
}

// Devuelve la instancia de Firestore o la inicializa si aún no lo está
function getFirestoreDb() {
  if (!firestoreDbInstance) {
    initFirebaseApp();
  }
  return firestoreDbInstance;
}

// Comprueba si Firestore está disponible y conectado
function isFirebaseReady() {
  if (typeof firebase === 'undefined') return false;
  if (!firestoreDbInstance) {
    initFirebaseApp();
  }
  return Boolean(firestoreDbInstance);
}

// Intentar inicializar de inmediato al cargar el script
try {
  initFirebaseApp();
} catch (e) {
  console.warn('Inicio diferido de Firebase:', e);
}

// Asegurar inicialización cuando el DOM esté listo
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (!firestoreDbInstance) {
      initFirebaseApp();
    }
  });
}
