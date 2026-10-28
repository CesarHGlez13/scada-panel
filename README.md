# scada-panel (mirror público del frontend SCADA)

Espejo **público** del frontend servido por GitHub Pages:

**https://cesarhglez13.github.io/scada-panel/**

- El frontend se sirve desde Pages; la **API** apunta a la entrada fija del Worker de Cloudflare
  (`https://scada-entry.scada-xiaomi-server.workers.dev`), que proxyea al túnel del teléfono.
- `scada-config.js` detecta `github.io` para no usar el origen de Pages como base de API
  (Pages no expone la API de PocketBase).
- Las credenciales están **reemplazadas por placeholders**: este repo no contiene secretos.
  Las credenciales reales viven en el repo privado y en `.env`.

## Placeholders

| Placeholder | Dónde | Qué es |
|---|---|---|
| `<REPLACE_WITH_ADMIN_HASH>` | `admin.js`, `shift-handover.js` | SHA-256 de `usuario:password:salt` del gate de admin |
| `<REPLACE_WITH_ESP32_TOKEN>` | `firmware/*.ino` | contraseña PocketBase de autenticación de cada nodo ESP32 |
| `<REPLACE_WITH_TV_PASSWORD>` | `andon-tv.js` | contraseña de `andon_tv@scada.local` |

El login de admin **no funciona en la URL de Pages** (el hash es placeholder); para el gate real
hay que usar la URL del Worker, donde PocketBase sirve el frontend del repo privado.

Actualización: `scripts/publish_pages_mirror.sh`.
