# WanderVibe admin

Static page for the existing API. Open it from a local static server. A `file://` page cannot call the API.

From `backend`:

```
node server.js
```

From `admin-web`:

```
npx --yes serve -l 5500
```

Then open http://localhost:5500. The API allows that origin, `http://127.0.0.1:5500`, and `http://localhost:8080`.

Settings (`#settings`) saves the display time zone in `localStorage` as `wandervibe.admin.timeZone`. An empty value uses the browser time zone. Support-log times are shown in that zone. It also saves `wandervibe.admin.searchDelaySec` for the user-picker wait. A missing or out-of-range value uses 2 seconds. It does not call the API.

Logs and Delete share an email picker. After two characters it calls `GET /api/admin/users?q=` and a chosen row supplies the user id for the log filter and for delete. Delete still uses that id. There is no delete-by-email.
