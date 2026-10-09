const {
  personDisplayName,
  planKind,
  mailRoleLabel,
  inviteeMail,
  inviterMail,
  acceptedMail,
  welcomeMail,
  rejectedMail,
} = require('../utils/mailCopy');

describe('mail copy', () => {
  test('uses first and last name when both are present', () => {
    expect(personDisplayName({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }))
      .toBe('Ada Lovelace');
  });

  test('uses email when either name is missing', () => {
    expect(personDisplayName({ firstName: 'Ada', lastName: '', email: 'ada@example.com' }))
      .toBe('ada@example.com');
    expect(personDisplayName({ firstName: '', lastName: 'Lovelace', email: 'ada@example.com' }))
      .toBe('ada@example.com');
    expect(personDisplayName({ firstName: 'Ada', lastName: 'Lovelace' }, 'fallback@example.com'))
      .toBe('Ada Lovelace');
    expect(personDisplayName(null, 'new.person@example.com')).toBe('new.person@example.com');
  });

  test('says trip only for trip plans', () => {
    expect(planKind('trip')).toBe('trip');
    expect(planKind('plan')).toBe('plan');
    expect(planKind('')).toBe('plan');
    expect(planKind(undefined)).toBe('plan');
  });

  test('trip roles are Co-Planner and Attendee', () => {
    expect(mailRoleLabel('trip', 'Collaborator')).toBe('Co-Planner');
    expect(mailRoleLabel('trip', 'Guest')).toBe('Attendee');
    expect(mailRoleLabel('trip', 'VibePlanner')).toBe('Co-Planner');
    expect(mailRoleLabel('trip', 'Wanderer')).toBe('Attendee');
  });

  test('plan roles are Planner and Guest', () => {
    expect(mailRoleLabel('plan', 'Collaborator')).toBe('Planner');
    expect(mailRoleLabel('plan', 'Guest')).toBe('Guest');
  });

  test('invite, accept, and welcome mail use labels and names', () => {
    const invite = inviteeMail({
      planName: 'Paris',
      planType: 'trip',
      storedRole: 'Guest',
    });
    expect(invite).toContain('as Attendee');
    expect(invite).not.toMatch(/undefined/);
    expect(invite).not.toMatch(/Collaborator/);
    expect(invite).not.toMatch(/\bGuest\b/);

    const invited = inviterMail({
      personName: 'Grace Hopper',
      planType: 'trip',
      storedRole: 'Collaborator',
    });
    expect(invited).toBe('Invited Grace Hopper as Co-Planner.');
    expect(invited).not.toMatch(/Collaborator/);

    const accepted = acceptedMail({
      personName: 'Alan Turing',
      planType: 'plan',
      storedRole: 'Guest',
    });
    expect(accepted).toBe('Alan Turing accepted your invite as Guest!');
    expect(accepted).not.toMatch(/undefined/);
    expect(accepted).not.toMatch(/Collaborator/);

    const welcomeTrip = welcomeMail({ planType: 'trip', storedRole: 'Collaborator' });
    expect(welcomeTrip).toBe('Welcome to the trip as Co-Planner!');
    expect(welcomeTrip).not.toMatch(/undefined/);
    expect(welcomeTrip).not.toMatch(/Collaborator/);
    expect(welcomeTrip).not.toMatch(/\bGuest\b/);

    const welcomePlan = welcomeMail({ planType: 'plan', storedRole: 'Guest' });
    expect(welcomePlan).toBe('Welcome to the plan as Guest!');
    expect(welcomePlan).not.toMatch(/trip/);

    const rejected = rejectedMail({
      personName: 'ada@example.com',
      planName: 'Harbor',
      planType: 'plan',
    });
    expect(rejected).toBe('ada@example.com rejected your invite to Harbor.');
    expect(rejected).not.toMatch(/undefined/);
    expect(rejected).not.toMatch(/trip/);
  });
});
