# WanderVibe App Requirements (Refreshed as of October 05, 2025)

This refreshed requirements document consolidates the original specifications with all subsequent updates, including:
- Addition of a primary owner (tied to the VibeCoordinator role).
- Support for one or more VibePlanners per trip.
- Restriction that VibePlanners can only be assigned (invited) by the VibeCoordinator.
- No other changes to core features like itinerary Day Numbers, time zones/DST handling, notifications, or schemas.

The app is a collaborative trip planning tool with role-based permissions, time zone-aware itineraries, and multi-channel notifications.

## Requirements

### 1. Role-Based Permissions (Trip-Specific)
Roles are stored in the `trip_users` collection and are specific to each trip. The primary owner of a trip is always the user with the VibeCoordinator role (stored as `ownerId` in the `trips` collection).

| Role            | Permissions |
|-----------------|-------------|
| **VibeCoordinator** (Primary Owner) | - Creates a trip and is automatically assigned this role.<br>- Can invite users to be VibePlanners (exclusive to this role).<br>- Can invite users to be Wanderers.<br>- Can reassign their VibeCoordinator role (and primary ownership) to a single VibePlanner.<br>- Can remove VibePlanners or Wanderers. |
| **VibePlanner** (One or More per Trip) | - Invited only by the VibeCoordinator.<br>- Can invite Wanderers.<br>- Can remove Wanderers. |
| **Wanderer** (Zero or More per Trip) | - Invited by VibeCoordinator or VibePlanners.<br>- Can view trip details and itinerary; no management permissions. |

- **Primary Owner Details**: Each trip has a single primary owner (`ownerId` in `trips`), initially the creator. Ownership transfers when the VibeCoordinator role is reassigned.

### 2. Trip and Itinerary
- A trip has an itinerary: a set of events ordered by `startTime`.
- Each event has a **Day Number**, incrementing if `startTime` is after midnight in the relevant time zone compared to the previous event’s `endTime`.
- **Relevant Time Zone**:
  - `destinationTimeZone` for travel events (type `flight`).
  - Trip’s `timeZone` for non-travel events (e.g., `car`, `dining`, `hotel`, `tour`, `attraction`, `cruise`).

### 3. Event Time Zones
- Travel events (`flight`) require `originTimeZone` and `destinationTimeZone`, accounting for Daylight Savings Time (DST).
- Non-travel events use the trip’s `timeZone`.

### 4. Notifications
- Users receive notifications (email via SendGrid, SMS via Twilio, Firebase push) for:
  - Invitations.
  - Role reassignments.
  - User removals.
  - Event additions.
- Notifications respect user preferences (`notificationPreferences` in `users` collection).
- Trigger notifications to relevant users (e.g., all trip participants for new events).

## Design

### MongoDB Schema

#### trips
- `_id`: string (unique, e.g., UUID).
- `name`, `destination`: string.
- `startDate`, `endDate`: date.
- `budget`: double.
- `planningState`: enum ["initial", "complete"].
- `timeZone`: string (e.g., "America/New_York").
- `notificationSettings`: object (initialFrequency, completeFrequency).
- `ownerId`: string (references `users._id`, required; primary owner/VibeCoordinator).
- Indexes: text on `name`, `destination`; index on `ownerId`.

#### events
- `_id`: string (unique, e.g., UUID).
- `tripId`: string (references `trips._id`).
- `title`, `location`, `details`: string.
- `type`: enum ["flight", "car", "dining", "hotel", "tour", "attraction", "cruise"].
- `cost`: double.
- `costType`: enum ["estimated", "actual"].
- `startTime`, `endTime`: date.
- `originTimeZone`, `destinationTimeZone`: string (required for `flight`, optional otherwise).
- `resourceLinks`: object (e.g., {maps: 'url', uber: 'url', booking: 'url'}).
- `createdAt`: date.
- Indexes: compound on `{ tripId: 1, startTime: 1, endTime: 1 }`; text on `title`, `details`.

#### users
- `_id`: string (unique, e.g., UUID).
- `firstName`, `lastName`, `email`, `phoneNumber`: string.
- `address`: object (street, city, state, country, postalCode).
- `notificationPreferences`: object (email: boolean, sms: boolean).
- `createdAt`: date.
- Indexes: text on `firstName`, `lastName`, `email`.

#### trip_users
- `tripId`: string (references `trips._id`).
- `userId`: string (references `users._id`).
- `role`: enum ["VibeCoordinator", "VibePlanner", "Wanderer"].
- Index: unique compound on `{ tripId: 1, userId: 1 }` (supports multiple VibePlanners per trip).

#### invitations
- `_id`: string (unique, e.g., UUID).
- `tripId`: string (references `trips._id`).
- `userId`: string (references `users._id`).
- `invitedBy`: string (references `users._id`).
- `role`: enum ["VibePlanner", "Wanderer"].
- `status`: enum ["pending", "accepted", "rejected"].
- `createdAt`: date.
- Index: `{ tripId: 1, userId: 1, status: 1 }`.

### Node.js Backend
- **Framework**: Express.js, Mongoose for MongoDB, Luxon for time zone/DST handling.
- **Authentication**: JWT-based (via `jsonwebtoken`); assume `req.user.id` from middleware.
- **Key Endpoints**:
  - `POST /api/trips`: Create trip, assign creator as VibeCoordinator and `ownerId`.
  - `POST /api/trips/:tripId/invite`: Invite users (VibeCoordinator only for VibePlanners; VibeCoordinator/VibePlanners for Wanderers).
  - `POST /api/trips/:tripId/remove-user`: Remove users per role permissions.
  - `POST /api/trips/:tripId/reassign-coordinator`: Reassign VibeCoordinator role and update `ownerId`.
  - `GET /api/trips/:tripId/itinerary`: Fetch events sorted by `startTime`, compute Day Numbers with time zone logic.
  - `POST /api/events`: Create events; validate time zones for flights.
  - `POST /api/invitations/:invitationId/respond`: Accept/reject invitations (adds to `trip_users` on accept).
  - `GET /api/trips/:tripId/users`: List all trip users with roles (supports displaying multiple VibePlanners).
- **Notifications**: `notifyUsers` function integrates SendGrid (email), Twilio (SMS), Firebase (push) based on preferences.
- **Real-Time**: Socket.IO for updates (e.g., new event, invitation).
- **Dependencies**: `express`, `mongoose`, `cors`, `axios`, `jsonwebtoken`, `@sendgrid/mail`, `twilio`, `firebase-admin`, `socket.io`, `node-cron`, `googleapis`, `uuid`, `luxon`.
- **Security**: Validate inputs, role checks in middleware; use `.env` for credentials.

### Flutter Frontend
- **Framework**: Flutter with Provider for state management, SQLite for local caching, Socket.IO for real-time.
- **Models**:
  - `Trip`: id, name, destination, startDate, endDate, budget, planningState, timeZone, ownerId.
  - `Event`: id, tripId, title, type, cost, costType, location, details, resourceLinks, startTime, endTime, originTimeZone, destinationTimeZone, dayNumber (computed).
  - `User`, `Address`, `Invitation`, `TripUser`: For users, addresses, invitations, and trip roles.
- **Providers**:
  - `TripProvider`: Manages trips, events, users; handles fetch/create/invite with role checks.
  - `UserProvider`: Manages user data, roles, invitations.
- **Screens**:
  - `TripDetailScreen`: Displays itinerary (grouped by Day Number), trip users (VibeCoordinator, multiple VibePlanners, Wanderers), role-based actions (e.g., invite VibePlanner only for VibeCoordinator).
  - `AddEventScreen`: Event creation form; time zone pickers for flights (via `flutter_timezone`).
  - `InvitationsScreen`: List/respond to invitations.
  - Placeholders: `HomeScreen`, `CoordinatorDashboardScreen`, `ChatScreen`, `NotificationsScreen`, `UserProfileScreen`.
- **Dependencies**: `provider`, `http`, `flutter_secure_storage`, `sqflite`, `socket_io_client`, `intl`, `flutter_timezone`.
- **Integration**: API calls with JWT; local SQLite sync; real-time Socket.IO listeners.

## Implementation Phases (High-Level)
- **Phase 1: Planning & Setup**: Git init, dependencies, schemas, `server.js` skeleton.
- **Phase 2: Backend Development**: Endpoints, auth, notifications.
- **Phase 3: Frontend Development**: Models, providers, screens.
- **Phase 4: Integration & Testing**: E2E tests for roles, time zones.
- **Phase 5: Deployment & Iteration**: Production deploy, enhancements.

## Notes
- **Security**: Use `flutter_secure_storage` for tokens; validate all inputs.
- **Testing**: Focus on role permissions (e.g., VibeCoordinator-only VibePlanner invites), DST/time zone Day Numbers, notifications.
- **Future Enhancements**: User search for invites, advanced date pickers, improved UI for multiple VibePlanners.