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
