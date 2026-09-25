# WanderVibe requirements

Source of truth as of 2026-09-23, after the backend repair. `reuirements.md` is the October 5, 2025 snapshot and is not the live spec.

## Product

WanderVibe is a collaborative trip and event planning app. The live API and models use **plan**, not trip: `/api/plans`, `Plan`, and `PlanUser`.

`POST /api/invites/trips/:tripId/invite` still uses the path segment `tripId`. That value is the plan id. It is stored on `Invitation.planId` and `PlanUser.planId`.

## Naming

- A Plan is one collaborative occasion.
- Plan type is `trip` or `event`.
- A `trip` is travel, and `destination` is required, which the schema already enforces.
- An `event` is a conference, wedding weekend, or gathering, and `location` is required. In the live schema the stored enum value is still `plan`; that value means event until a later migration.
- An Activity is one timed row on the itinerary. The live model and routes still use the name Event and `/api/events`.
- An itinerary is the list of activities sorted by `startTime` with day numbers. It is not its own collection.
- Industry wording "the event" means a Plan of type event, not an Activity.

## Roles

`VibeCoordinator` is the single owner, stored as `Plan.ownerId`. `VibePlanner` and `Wanderer` are values of `PlanUser.role`. Roles are per plan.

`POST /api/plans` sets `ownerId` to the creator and inserts a `VibeCoordinator` `PlanUser`. The body requires `type` and `name`. A plan with `type: "trip"` must include `destination`.

`POST /api/plans/:planId/reassign-coordinator` is coordinator-only. The target must already be a `VibePlanner` on that plan. `ownerId` moves to the target, the target becomes `VibeCoordinator`, and the previous coordinator becomes a `VibePlanner`.

The current invite rule allows only a coordinator `PlanUser` to invite. The invite route calls `roleCheck('VibePlanner')`, which checks that plan role. A planner inviting a wanderer is not implemented.

The invite body role is `VibePlanner` or `Wanderer`.

`POST /api/invites/invitations/:invitationId/respond` with `{ "status": "accepted" }` upserts a `PlanUser` for that plan id and role. The invitee must be the user on the invitation.

A wanderer who is a `PlanUser` can read `GET /api/plans/:planId/itinerary`. `GET /api/plans` returns plans whose `ownerId` is the caller, so a wanderer or planner who does not own the plan does not see it in that list. That list gap is recorded below.

`POST /api/plans/:planId/remove-user` refuses to remove the coordinator. A coordinator can remove a planner or a wanderer. The same check also lets any other participant remove a wanderer. Removal limited to coordinators and planners is not what the handler does today.

## Auth

`POST /api/auth/register` requires `firstName`, `lastName`, `email`, and `password`. The user model hashes the password once on save.

`POST /api/auth/login` takes `email` and `password` and returns `{ token, user }`.

`POST /api/auth/forgot-password` and `POST /api/auth/reset-password` are implemented.

Also implemented: `POST /api/auth/verify-token`, `POST /api/auth/logout`, and `PATCH /api/auth/users/:userId`.

The JWT claim is `userId`. Verify-token and the auth middleware accept `id` as an alias when `userId` is absent.

### Logout token blacklist (Redis)

After `POST /api/auth/logout`, that JWT is rejected until it expires. This is an application operation and a security control: revocation after logout.

The blacklist is stored in Redis when Redis is configured, at `localhost:6379` or `REDIS_URL`. MongoDB remains the system of record for users, plans, events, and invitations. Redis is not a second copy of those records.

If Redis is down, the API still serves auth, plans, and invites. Logout revocation is not reliable in that state. That is degraded development mode.

For alpha, Redis should be running so the logout blacklist works. On Windows that process is Memurai.

Jest (`npx jest`) and Newman (`npm run test:postman`) do not require Redis.

Startup uses `REDIS_URL` when that value is a non-empty string, and otherwise `redis://localhost:6379`. The client is stored on `global.redisClient`. Logout still writes the bearer token on that client when Redis is up, with a 24-hour TTL. When Redis is up, `authMiddleware` rejects a blacklisted bearer token with 401 and `{ message: 'Token has been revoked' }`. When Redis is down, the middleware skips the check (degraded mode).

### Logging for support

Logs are for systems administration and support inquiries. The app logger is Winston. File output is structured text with a timestamp, level, `userId`, `event`, message, and `context`. The console transport is a timestamped text line. The default level is `info`, which is the level used in development.

A support log includes a timestamp, a level, an event name, `userId` when it is known, and resource ids such as `planId` or `invitationId` when the event is about those records.

Logs must not include a password, a JWT string, `RESEND_API_KEY`, `SENDGRID_API_KEY`, or an `Authorization` header.

Register and login log the email and `userId` only. Password reset logs the email and `userId` and does not log the new JWT. A forgot-password send failure logs the provider name, the error message, and the HTTP status. It does not log the API key or the reset token. `notifyUsers` logs whether delivery is in override mode or user-email mode. On a send failure it logs the provider name, the error message, and the HTTP status. It does not log the API key.

## Events and itinerary

`POST /api/events` accepts `name`, `type`, `planId`, `startTime`, and `endTime`. The route sets `ownerId` from `req.user.userId`.

`originTimeZone` and `destinationTimeZone` are optional strings on an event. Create does not require them. They are the flight zone fields.

`GET /api/plans/:planId/itinerary` returns events sorted by `startTime`. The first event has `dayNumber` 1. A later event increments the day when its start calendar day, in the relevant zone, is after the previous event’s end. Flights use `destinationTimeZone` when that field is set, and `plan.timeZone` otherwise. Every other type uses `plan.timeZone`. Luxon applies daylight-saving rules when the zone is an IANA name.

Event types in the product are the original list plus the Flutter `EventType` values. The extras are current types. The original list is `flight`, `car`, `dining`, `hotel`, `tour`, `attraction`, and `cruise`. The Flutter enum also includes `train`, `carRental`, `carService`, `drive`, `taxi`, `bus`, `walk`, `ferry`, `activity`, `meal`, `transport`, `setup`, `ceremony`, `reception`, `vendor`, and `custom`. The backend stores `type` as a string and does not enforce that enum. `setup`, `ceremony`, `reception`, and `vendor` are in the enum and have no icon entry.

### Breakouts and rooms

- Breakouts share the same Plan and the same itinerary list.
- An Activity may include `room` (a string label) and an optional `parentActivityId` (another Activity on that plan).
- Parallel breakouts are activities with the same or overlapping `startTime` and different `room` values.
- The itinerary remains a flat list sorted by `startTime`. The client may group by room or by parent.
- Do not use a nested `subEvents` array or a child Plan per room.

## Notifications

Email is sent through a provider selected by `EMAIL_PROVIDER`: `resend`, `sendgrid`, or `console`. When `EMAIL_PROVIDER` is unset or empty, the provider is `resend`. SendGrid remains implemented. SMS and push are not implemented.

`EMAIL_FROM` is optional. When it is empty, From is `ken@eratespecialists.com`.

`notifyUsers` loads each user id, skips a user with no email, and skips a user whose `notificationPreferences.email` is `false`. Missing preferences still allow email.

The recipient is chosen in this order:

1. A non-empty `NOTIFY_OVERRIDE_EMAIL` is used for every send.
2. Otherwise, when `NODE_ENV` is `development`, mail goes to `w.ken.allen@gmail.com`.
3. Otherwise each user’s own email is used.

These actions notify today: plan created, invite sent, invite accepted or rejected, user removed, and coordinator reassigned. Creating an event does not notify.

`POST /api/auth/forgot-password` sends through `sendEmail` to the account email. It does not use `NOTIFY_OVERRIDE_EMAIL` or the development address `w.ken.allen@gmail.com`. The account holder must receive the reset link. From is `EMAIL_FROM`, or `ken@eratespecialists.com` when `EMAIL_FROM` is empty. A send failure still returns 500 `{ msg: 'Server error' }`.

## Data model (live MongoDB)

As of 2026-09-25. This is the Mongoose schema the mounted API loads. Model `Plan` comes from `backend/models/Plan.js`. The app loads that file before `backend/models/Event.js`, so the Plan discriminator inside `Event.js` is not registered.

### User

Model `User`, collection `users`.

| Field | Type | Required |
| --- | --- | --- |
| `_id` | string, default UUID | optional on input |
| `firstName`, `lastName` | string | optional |
| `email` | string | optional on the schema |
| `phoneNumber` | string | optional |
| `address` | object: `street`, `city`, `state`, `country`, `postalCode`, each a string | optional |
| `notificationPreferences` | object: `email` boolean default true, `sms` boolean default false | optional |
| `role` | enum `VibeCoordinator`, `VibePlanner`, `Wanderer`, `admin`; default `VibeCoordinator` | optional |
| `password` | string | required |
| `resetToken` | string | optional |
| `resetTokenExpiry` | date | optional |
| `createdAt` | date, default now | optional |

`password` is hashed in a pre-save hook with bcrypt, 12 rounds. The hash must not be logged. There is no push field on `notificationPreferences`. `role` on this document is separate from the per-plan role on `PlanUser`.

Index: unique index on `email` from `unique: true`. No other indexes are declared. The schema does not set `timestamps`, so there is no `updatedAt`.

### Plan

Model `Plan`, collection `plans`. `timestamps` adds `createdAt` and `updatedAt` dates.

| Field | Type | Required |
| --- | --- | --- |
| `_id` | string, no schema default | required |
| `type` | enum `trip`, `plan` | required |
| `name` | string | required |
| `destination` | string | required when `type` is `trip` |
| `location` | string | required when `type` is `plan` |
| `startDate`, `endDate` | date | optional |
| `autoCalculateStartDate`, `autoCalculateEndDate` | boolean, default false | optional |
| `budget` | number, default 0 | optional |
| `planningState` | enum `initial`, `reviewing`, `complete`; default `initial` | optional |
| `timeZone` | string | optional |
| `ownerId` | string, ref `User` | required |
| `participants` | array of `{ userId, role }` | optional array |
| `participants.userId` | ObjectId, ref `User` | required on a participant entry |
| `participants.role` | enum `VibePlanner`, `Wanderer` | required on a participant entry |
| `activityIds` | array of strings, ref `Event` | optional |

`ownerId` points at `User._id`. `participants.userId` is declared as an ObjectId while `User._id` is a string. Per-plan membership used by invites and role checks is the `PlanUser` collection.

Indexes: text index on `name` and `destination`; index on `ownerId`.

### PlanUser

Model `PlanUser`, collection `planusers`. `timestamps` adds `createdAt` and `updatedAt`. `_id` is the default ObjectId. The schema does not declare `_id`.

| Field | Type | Required |
| --- | --- | --- |
| `planId` | string, ref `Plan` | required |
| `userId` | string, ref `User` | required |
| `role` | enum `VibeCoordinator`, `VibePlanner`, `Wanderer` | required |

`planId` points at `Plan._id`. `userId` points at `User._id`.

Index: unique compound `{ planId: 1, userId: 1 }`.

### Invitation

Model `Invitation`, collection `invitations`. `timestamps` adds `createdAt` and `updatedAt`.

| Field | Type | Required |
| --- | --- | --- |
| `_id` | string, no schema default | required |
| `planId` | string | required |
| `userId` | string | required |
| `invitedBy` | string | required |
| `role` | enum `VibePlanner`, `Wanderer` | required |
| `status` | enum `pending`, `accepted`, `rejected`; default `pending` | optional |

`planId` points at `Plan._id`. `userId` is the invitee's user id. `invitedBy` is the inviter's user id. The schema does not set `ref` on those three strings.

Index: `{ planId: 1, userId: 1, status: 1 }`, not unique.

### Event

Model `Event`, collection `events`. `timestamps` adds `createdAt` and `updatedAt`. A virtual `id` returns `_id`, and JSON output includes virtuals.

| Field | Type | Required |
| --- | --- | --- |
| `_id` | string, default UUID | optional on input |
| `name` | string | required |
| `location` | string, default `''` | optional |
| `type` | string | required |
| `cost` | number, default 0 | optional |
| `startTime`, `endTime` | date | optional |
| `timeZone` | string, default `''` | optional |
| `originTimeZone`, `destinationTimeZone` | string | optional |
| `duration` | number, default 0 | optional |
| `planId` | string | required |
| `details` | string, default `''` | optional |
| `customType` | string, default `''` | optional |
| `costType` | enum `estimated`, `actual`; default `estimated` | optional |
| `eventNum` | number, default 0, minimum 0 | optional |
| `status` | enum `draft`, `complete`; default `draft` | optional |
| `missingFields` | array of strings | optional |
| `serviceProvider`, `bookingReference` | string | optional |
| `urlLinks` | array of `{ linkName` string default `''`, `linkUrl` string required `}` | optional array |
| `subEvents` | written as `[this]` in the schema literal | not a nested Event schema |
| `extras` | mixed | optional |
| `ownerId` | string | required |
| `gate`, `baggageClaim`, `roomNumber` | string | optional |

`type` is a string. The product type list is in Events and itinerary. The schema does not enum-enforce it. `planId` points at `Plan._id`. `ownerId` points at `User._id`. The schema does not set `ref` on either string.

The pre-save hook returns immediately when `status` is `draft`. The type-specific checks under that are comments, so the hook does not require `gate` or the other optional strings.

No indexes are declared besides `_id`.

### Present in code but not the live product path

These files are not the collections the mounted plan, event, and invite routes use.

**Trip** (`backend/models/Trip.js`), model `Trip`, would use collection `trips` if loaded. No mounted route requires it. Fields: `_id` string required; `name` string required; `destination` string required; `startDate` and `endDate` dates required; `budget` number default 0; `planningState` enum `initial`, `complete`, default `initial`; `timeZone` string required; `notificationSettings` object with `initialFrequency` string default `daily` and `completeFrequency` string default `weekly`; `ownerId` string required. `timestamps` adds `createdAt` and `updatedAt`. Indexes: text on `name` and `destination`; index on `ownerId`.

**TripUser** (`backend/models/TripUser.js`), model `TripUser`, would use collection `tripusers` if loaded. The only require is `backend/routes/users.js`, and that router is not mounted. Fields: `planId` string ref `Plan` required; `userId` string ref `User` required; `role` enum `VibeCoordinator`, `VibePlanner`, `Wanderer` required. `timestamps` adds `createdAt` and `updatedAt`. The unique index is declared on `{ tripId: 1, userId: 1 }`. The schema path is `planId`, not `tripId`.

**Plan discriminator inside `Event.js`.** The file builds a second schema with `budget` number default 0, `destination` string default `''`, `planningState` string default `''`, and `planType` enum `trip`, `plan`, default `trip`, and would call `Event.discriminator('Plan', ...)`. On startup, `models/Plan.js` has already registered the model name `Plan`, and this line keeps that model. The live plan documents are the `plans` collection from `Plan.js`, not plan documents stored on `events`.

### Difference from reuirements.md (Oct 2025)

- `trips` is `plans`, `trip_users` is `PlanUser`, and `tripId` is `planId`.
- The live invite URL is still `POST /api/invites/trips/:tripId`. That path value is the plan id.
- Event types are the expanded product list. The backend stores `type` as a string and does not enum-enforce it.
- Notifications are email-only through `EMAIL_PROVIDER`. SMS and push are not Mongo collections.
- Redis holds the logout blacklist. It is not a Mongo collection.

### Open model questions

- [ ] Q1. `User.email` is optional on the schema while register requires an email.
- [ ] Q2. `User.role` is a global enum on the user document, separate from the per-plan `PlanUser.role`.
- [ ] Q3. `Plan.participants` and `PlanUser` both describe membership, and which one is the source of truth is open.
- [ ] Q4. `Event.subEvents` is written as `[this]`, so it is not an array of nested Event documents.
- [ ] Q5. `Trip`, `TripUser`, and the Plan discriminator in `Event.js` are present in code and are not on the live product path.
- [ ] Q6. `TripUser` declares a unique index on `tripId` while the schema path is `planId`.
- [ ] Q7. `Plan.participants.userId` is an ObjectId while `User._id` is a string.
- [ ] Q8. `Event.type` is an unconstrained string while the product type list is documented separately.
- [ ] Q9. `Invitation` does not set `ref` on `planId`, `userId`, or `invitedBy`.
- [ ] Q10. Migrate the `Plan.type` enum value `plan` to `event`, and optionally rename Event to Activity in code.
- [ ] Q11. Add `parentActivityId` and `room` on the Event schema and API; grouping is a client concern.

## Tests

From `backend`, `npx jest` runs the in-memory suite. It does not use Atlas.

`npm run test:postman` runs the Newman collection against `http://localhost:3000`. The server must already be running. That command does not require Redis.

## Known gaps

These are not implemented:

- A planner inviting a wanderer.
- Plan-role checks on event create and update.
- A GET that lists the caller’s invitations.
- A Socket.IO server. The Flutter chat screen has a client. SQLite caching is not implemented. `sqflite` is unused under `frontend/lib`.
- Flutter day numbers. `PlanProvider._computeDayNumbers` uses the device-local `DateTime.day`, not the destination time zone or the plan time zone.
- The Flutter rewrite that makes `Plan` a subclass of `Event`. It is parked in git stash as `WIP Flutter Plan-in-event.dart rewrite (does not compile)` and is not on the working tree.
