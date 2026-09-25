# WanderVibe requirements

Source of truth as of 2026-09-23, after the backend repair. `reuirements.md` is the October 5, 2025 snapshot and is not the live spec.

## Product

WanderVibe is a collaborative trip and event planning app. The live API and models use **plan**, not trip: `/api/plans`, `Plan`, and `PlanUser`.

`POST /api/invites/trips/:tripId/invite` still uses the path segment `tripId`. That value is the plan id. It is stored on `Invitation.planId` and `PlanUser.planId`.

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

Startup uses `REDIS_URL` when that value is a non-empty string, and otherwise `redis://localhost:6379`. The client is stored on `global.redisClient`. Logout writes the bearer token on that client when Redis is connected. `authMiddleware` does not read the blacklist, so a later request with that JWT is not rejected yet.

### Logging for support

Logs are for systems administration and support inquiries. The app logger is Winston. File output is structured text with a timestamp, level, `userId`, `event`, message, and `context`. The console transport is a timestamped text line. The default level is `info`, which is the level used in development.

A support log includes a timestamp, a level, an event name, `userId` when it is known, and resource ids such as `planId` or `invitationId` when the event is about those records.

Logs must not include a password, a JWT string, `SENDGRID_API_KEY`, or an `Authorization` header.

Register and login log the email and `userId` only. Password reset logs the email and `userId` and does not log the new JWT. `notifyUsers` logs whether delivery is in override mode or user-email mode. On a SendGrid failure it logs the error message and status, not the API key.

## Events and itinerary

`POST /api/events` accepts `name`, `type`, `planId`, `startTime`, and `endTime`. The route sets `ownerId` from `req.user.userId`.

`originTimeZone` and `destinationTimeZone` are optional strings on an event. Create does not require them. They are the flight zone fields.

`GET /api/plans/:planId/itinerary` returns events sorted by `startTime`. The first event has `dayNumber` 1. A later event increments the day when its start calendar day, in the relevant zone, is after the previous event’s end. Flights use `destinationTimeZone` when that field is set, and `plan.timeZone` otherwise. Every other type uses `plan.timeZone`. Luxon applies daylight-saving rules when the zone is an IANA name.

Event types in the product are the original list plus the Flutter `EventType` values. The extras are current types. The original list is `flight`, `car`, `dining`, `hotel`, `tour`, `attraction`, and `cruise`. The Flutter enum also includes `train`, `carRental`, `carService`, `drive`, `taxi`, `bus`, `walk`, `ferry`, `activity`, `meal`, `transport`, `setup`, `ceremony`, `reception`, `vendor`, and `custom`. The backend stores `type` as a string and does not enforce that enum. `setup`, `ceremony`, `reception`, and `vendor` are in the enum and have no icon entry.

## Notifications

Email is sent through SendGrid. SMS and push are not implemented.

`notifyUsers` loads each user id, skips a user with no email, and skips a user whose `notificationPreferences.email` is `false`. Missing preferences still allow email.

The recipient is chosen in this order:

1. A non-empty `NOTIFY_OVERRIDE_EMAIL` is used for every send.
2. Otherwise, when `NODE_ENV` is `development`, mail goes to `w.ken.allen@gmail.com`.
3. Otherwise each user’s own email is used.

These actions notify today: plan created, invite sent, invite accepted or rejected, user removed, and coordinator reassigned. Creating an event does not notify.

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
