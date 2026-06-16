# How to Start & Stop — Market Alert Center

A quick operational guide. All commands are for **Windows PowerShell**, run from the project folder:
`C:\Users\Vishwas.Balkundi\OneDrive - AxiCorp\Documents\Notifications`

---

## ▶️ Start the app

### First time only (already done — skip unless you re-clone)
```powershell
cd "C:\Users\Vishwas.Balkundi\OneDrive - AxiCorp\Documents\Notifications"
npm install
```
Also make sure `.env` has your `FMP_API_KEY` and `OPENAI_API_KEY` (it does).

### Every time you want to use it
```powershell
cd "C:\Users\Vishwas.Balkundi\OneDrive - AxiCorp\Documents\Notifications"
npm run dev
```
Wait for the line `✓ Ready in ...`, then open **http://localhost:3000** in your browser.

- Alerts appear immediately from the last cached run.
- Click **↻ Refresh alerts** to pull fresh data and regenerate drafts (~20–40s).
- Optional health check: **http://localhost:3000/api/diagnostics**

> Leave the PowerShell window open while you use the app — closing it stops the server.

---

## ⏹️ Stop the app

**In the same PowerShell window** where it's running: press **`Ctrl + C`** (once or twice).
You'll get the prompt back when it has stopped.

### If you closed the window and it's still running (or the port is stuck)
Run this to find and stop whatever is holding port 3000:
```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```
Or, to stop all Node processes (blunt but effective):
```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3000 is already in use` | Stop the old server (see "If you closed the window" above), then `npm run dev` again. |
| Dashboard empty / errors | Open `/api/diagnostics` to see which feed failed. Usually a network blip or FMP daily limit (250 calls/day). |
| "Send to Teams" button missing | Set `TEAMS_WEBHOOK_URL` in `.env` and restart. See `README.md`. |
| Changed `.env` | Restart the server (`Ctrl + C`, then `npm run dev`) — env vars load at startup. |

---

## Optional: faster "production" mode
Slightly faster than `dev`, but you must rebuild after any code change:
```powershell
npm run build      # compile once
npm start          # serve on http://localhost:3000
```
Stop it the same way (`Ctrl + C`).
