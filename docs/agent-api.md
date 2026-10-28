# Agent API

A logged-in user can create a long-lived API key and hand it to a script or agent. The key follows the same Owner, Collaborator, and Guest rules as the app.

Base URL: `http://localhost:3000`

Send the key on plan and activity requests:

```
Authorization: Bearer wv_live_...
```

The raw key is returned once, from the create call. Listing keys returns the label, the 8-character prefix, and the dates. A revoked or unknown key receives `401` with `{ "message": "Token is not valid" }`.

## Create, list, and revoke keys

These three routes use the login JWT from `POST /api/auth/login`.

`POST /api/users/me/api-keys`

```json
{ "name": "Trip script" }
```

`name` is required text, up to 80 characters. Response `201`:

```json
{
  "id": "...",
  "name": "Trip script",
  "key": "wv_live_...",
  "prefix": "wv_live_",
  "createdAt": "..."
}
```

`GET /api/users/me/api-keys` returns the caller's active keys:

```json
[
  {
    "id": "...",
    "name": "Trip script",
    "prefix": "wv_live_",
    "createdAt": "...",
    "lastUsedAt": null
  }
]
```

`DELETE /api/users/me/api-keys/:id` revokes that caller's key and returns `{ "id", "revokedAt" }`. A missing key, or a key that belongs to someone else, is `404`.

## Plans and activities

A login JWT or an API key can call these routes. Membership still decides what the caller can do.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/plans` | Member. Body `{ "plans": [...] }` |
| GET | `/api/plans/:planId` | Member. Body `{ "plan": ... }` |
| GET | `/api/plans/:planId/itinerary` | Member. Body `{ "msg", "events", "grouped" }` |
| POST | `/api/activities` | Owner or Collaborator |
| PUT | `/api/activities/:id` | Owner or Collaborator |
| DELETE | `/api/activities/:id` | Owner or Collaborator |
| POST | `/api/plans/:planId/suggest` | Owner or Collaborator |

A Guest can read the plan and the itinerary. Creating, updating, or deleting an activity is `403` with `{ "message": "Only Owner or Collaborator can change activities" }`.

### List plans

```bash
curl -s http://localhost:3000/api/plans \
  -H "Authorization: Bearer wv_live_YOUR_KEY"
```

### Create an activity

`name`, `type`, and `planId` are required. `durationMinutes` is optional.

```bash
curl -s -X POST http://localhost:3000/api/activities \
  -H "Authorization: Bearer wv_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"PLAN_ID\",\"name\":\"Louvre\",\"type\":\"tour\",\"durationMinutes\":90}"
```

The response is the saved activity, including `_id`. Update it with `PUT /api/activities/:id` and remove it with `DELETE /api/activities/:id`.

Suggest places with `POST /api/plans/PLAN_ID/suggest` and `{ "query": "museums" }`. The response is an array of places. The server needs `GOOGLE_MAPS_API_KEY` for that call.
