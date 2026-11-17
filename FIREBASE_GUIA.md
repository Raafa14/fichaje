# 🚀 Guía de Conexión de GastroTime con Google Firebase (Firestore)

Esta guía te explica cómo conectar el sistema de fichaje **GastroTime** a una base de datos gratuita en la nube de **Google Firebase (Cloud Firestore)**.

Al conectarlo, conseguirás:
1. **Registro permanente de la empresa y acceso seguro.**
2. **Base de datos de empleados** sincronizada en tiempo real entre múltiples dispositivos (móviles, tablets, ordenadores).
3. **Registro histórico de horas semanales guardado para siempre**, con cálculo automático de horas de cada trabajador semana a semana y hojas de firma imprimibles para el domingo o inspecciones.

---

## 📋 Paso 1: Crear un proyecto en Google Firebase (100% Gratis)

1. Ve a [console.firebase.google.com](https://console.firebase.google.com/) e inicia sesión con tu cuenta de Google.
2. Pulsa en **"Crear un proyecto"** (o "Añadir proyecto").
3. Escribe el nombre de tu proyecto (por ejemplo: `gastrotime-fichaje`).
4. Google Analytics es opcional (puedes desactivarlo o dejarlo activado) y pulsa **"Crear proyecto"**.

---

## 🗄️ Paso 2: Activar Cloud Firestore (Tu Base de Datos)

1. En el panel izquierdo de Firebase, ve a **Compilación** > **Firestore Database**.
2. Haz clic en el botón **"Crear base de datos"**.
3. En la pantalla de reglas de seguridad, selecciona **"Iniciar en modo de prueba"** (esto permite leer y escribir fichajes).
4. Elige una ubicación cercana para el servidor (por ejemplo, `eur3 (europe-west)` si estás en España/Europa).
5. Pulsa **"Habilitar"**.

---

## 🔑 Paso 3: Obtener tus Credenciales de Firebase

1. En la parte superior izquierda de la consola de Firebase, haz clic en el icono del engranaje **⚙️ (Configuración del proyecto)**.
2. Baja hasta la sección **"Tus apps"**.
3. Haz clic en el icono web **`</>`** (plataforma web).
4. Escribe un apodo para la app (por ejemplo `GastroTime Web`) y pulsa **"Registrar app"**.
5. Verás un bloque de código como este:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBxxxxxx...",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto-id",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:abcdef..."
};
```

---

## ⚙️ Paso 4: Conectar GastroTime

Tienes **2 formas muy sencillas** de conectarlo:

### Opción A (La más cómoda: Directamente desde la web):
1. Abre tu aplicación `index.html` en el navegador.
2. Haz clic en el botón **"Configurar Firebase"** (arriba a la derecha o en la tarjeta de acceso).
3. Pega el bloque de código copiado en la pestaña **"Pegar Configuración"**.
4. Pulsa **"💾 Guardar y Conectar"**. La página se recargará y verás el punto verde **🟢 Firebase Conectado (Nube)**.

### Opción B (En el archivo `firebase-config.js`):
1. Abre el archivo `firebase-config.js` en tu editor de código.
2. Reemplaza los valores de `DEFAULT_FIREBASE_CONFIG` con tus credenciales:
```javascript
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBxxxxxx...",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto-id",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:abcdef..."
};
```
3. Guarda el archivo y listo.

---

## 📂 ¿Cómo se guardan los datos en Firebase?

La base de datos queda organizada de manera profesional en Cloud Firestore:

1. **`restaurants` (Colección de Empresas):**
   - Cada empresa tiene su documento con `name`, `password`, `adminPin` y fecha de creación.
2. **`restaurants/{id}/workers` (Colección de Empleados):**
   - Guarda los trabajadores dados de alta (`name`, `role: 'Terraza' | 'Encargado'`, `active: true`).
3. **`restaurants/{id}/weekly_records` (Colección de Semanas e Historial de Horas):**
   - Cada documento representa una semana completa (ejemplo: documento `2026-11-16` para la semana del 16 al 22 de noviembre).
   - Guarda todos los turnos fichados (Lunes a Domingo) de cada trabajador: `in` y `out`.
   - **Calcula y almacena el total semanal de horas echadas de cada trabajador** (`totalMinutes` y `formattedTotal`: ej. `38h 30m`), así como el acumulado de toda la plantilla.
   - En la sección **"Control Semanal (Admin)"** dispones de un **navegador de semanas** y un **menú desplegable de historial** para consultar e imprimir semanas pasadas en cualquier momento.

---

## 🛡️ Reglas de Seguridad recomendadas para Firestore

En la consola de Firebase > **Firestore Database** > pestaña **Reglas**, puedes asegurar el acceso con esta regla:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

---

## 🖨️ Sistema de Impresión Remota (Desde el Móvil a la Impresora del PC)

GastroTime incluye un sistema de cola de impresión remota en tiempo real mediante Firebase:

### ¿Cómo funciona?
1. **En el PC del restaurante (Caja / Oficina):**
   - Abre la web en el navegador de este ordenador (donde está conectada la impresora por USB o red).
   - Por defecto en ordenadores, el modo **Estación Receptora de Impresión** se activa automáticamente (puedes verificarlo en **Ajustes del Local**).
   - Este PC se conecta a la cola de Firestore y emite una señal de presencia (*heartbeat* cada 25s).
2. **En tu teléfono móvil:**
   - Abre la aplicación e inicia sesión en el local.
   - En la barra superior o en **Control Semanal**, pulsa **«🖨️ Imprimir en PC»** o **«Imprimir / Mandar al PC»**.
   - Verás el estado en tiempo real del ordenador: `🟢 PC del local Conectado y Listo`.
   - Puedes elegir la **Semana actual** o cualquier **Semana anterior guardada en el historial**.
   - Pulsa **«Mandar a la Impresora del PC»**.
3. **Impresión instantánea:**
   - En menos de 1 segundo, el PC recibe la orden por la nube, carga los datos exactos de esa semana y lanza la orden a la impresora predeterminada de Windows.
   - Tu móvil recibe confirmación en directo: `🎉 ¡Impresión completada con éxito en el PC!`.
   - Si el PC estaba en la pantalla de fichajes del personal, **la pantalla no se descoloca ni sale del terminal**; solo se imprime el cuadrante oficial semanal.

### 💡 Truco Pro: Impresión 100% Automática y Silenciosa (Modo Quiosco en Windows)
Si no quieres tener que darle a "Aceptar" ni hacer clic en el PC cada vez que mandes a imprimir desde el móvil, puedes configurar Google Chrome para que imprima directamente:
1. Haz clic derecho en el acceso directo de **Google Chrome** en el escritorio de Windows y pulsa **Propiedades**.
2. En la casilla **Destino**, añade al final un espacio y:
   ```text
   --kiosk-printing
   ```
   *(Ejemplo: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing`)*
3. Pulsa **Aceptar**.
4. ¡Listo! A partir de ese momento, cada orden que envíes desde tu teléfono móvil saldrá por la impresora al instante sin mostrar ninguna ventana de confirmación.

---

¡Todo listo! Tus empresas, empleados, registros semanales de horas y cola de impresión remota funcionan de manera integrada y automática en la nube.
