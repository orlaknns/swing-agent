# Swing Trading Agent

App de análisis de swing trading con datos reales de Yahoo Finance + análisis de IA (Claude).

## Estructura

```
swing-agent/
├── backend/          ← FastAPI + Python
│   ├── main.py
│   ├── requirements.txt
│   └── Procfile
└── frontend/         ← React + Vite
    ├── src/
    │   ├── App.jsx
    │   ├── StockCard.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── package.json
    ├── vite.config.js
    └── vercel.json
```

---

## Deploy paso a paso

### 1. Subir código a GitHub

```bash
cd swing-agent
git init
git add .
git commit -m "initial commit"
# Crea un repo en github.com y sigue las instrucciones para subir
git remote add origin https://github.com/TU_USUARIO/swing-agent.git
git push -u origin main
```

---

### 2. Deploy del backend en Railway (gratis)

1. Ve a https://railway.app y crea una cuenta con GitHub
2. Click en **New Project → Deploy from GitHub repo**
3. Selecciona tu repo → elige la carpeta `backend`
4. En **Variables**, agrega:
   ```
   ANTHROPIC_API_KEY = sk-ant-...  ← tu API key de Anthropic
   ```
5. Railway detecta el `Procfile` automáticamente y despliega
6. En **Settings → Domains**, genera un dominio público. Cópialo, lo necesitas en el paso siguiente.
   Ejemplo: `https://swing-agent-backend.up.railway.app`

---

### 3. Conectar frontend con el backend

Edita `frontend/vercel.json` y reemplaza la URL:

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://TU-BACKEND-URL.up.railway.app/$1"
    }
  ]
}
```

Haz commit y push del cambio:
```bash
git add frontend/vercel.json
git commit -m "set backend url"
git push
```

---

### 4. Deploy del frontend en Vercel (gratis)

1. Ve a https://vercel.com y crea una cuenta con GitHub
2. Click en **Add New → Project**
3. Importa tu repo de GitHub
4. En **Root Directory** pon: `frontend`
5. Framework: **Vite** (se detecta automáticamente)
6. Click **Deploy**
7. En unos segundos tienes una URL pública. Ejemplo: `https://swing-agent.vercel.app`

---

## Correr localmente

### Backend
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload
# Corre en http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Corre en http://localhost:5173
```

El `vite.config.js` ya tiene el proxy configurado para que `/api/*` apunte al backend local.

---

## API Key de Anthropic

Obtén tu API key en: https://console.anthropic.com/settings/keys

El plan gratuito tiene créditos suficientes para usar el agente con frecuencia moderada.
