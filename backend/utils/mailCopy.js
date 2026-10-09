const { canonicalMembershipRole } = require('../middleware/roleCheck');

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function planKind(planType) {
  return trimmed(planType).toLowerCase() === 'trip' ? 'trip' : 'plan';
}

function personDisplayName(person, emailFallback) {
  const first = trimmed(person && person.firstName);
  const last = trimmed(person && person.lastName);
  if (first && last) return `${first} ${last}`;
  const email = trimmed(person && person.email) || trimmed(emailFallback);
  return email;
}

function mailRoleLabel(planType, storedRole) {
  const trip = planKind(planType) === 'trip';
  const role = canonicalMembershipRole(storedRole);
  if (role === 'Collaborator') return trip ? 'Co-Planner' : 'Planner';
  if (role === 'Guest') return trip ? 'Attendee' : 'Guest';
  if (role === 'Owner') return trip ? 'Organizer' : 'Host';
  return '';
}

function namedPlan(planName, planType) {
  const name = trimmed(planName);
  if (name) return name;
  return `a ${planKind(planType)}`;
}

function inviteeMail({ planName, planType, storedRole, signupUrl }) {
  const role = mailRoleLabel(planType, storedRole);
  const base = `You've been invited to "${namedPlan(planName, planType)}" as ${role} on PlanItVibe!`;
  if (signupUrl) return `${base} ${signupUrl}`;
  return `${base} Check app to accept.`;
}

function inviterMail({ personName, planType, storedRole }) {
  return `Invited ${personName} as ${mailRoleLabel(planType, storedRole)}.`;
}

function acceptedMail({ personName, planType, storedRole }) {
  return `${personName} accepted your invite as ${mailRoleLabel(planType, storedRole)}!`;
}

function welcomeMail({ planType, storedRole }) {
  return `Welcome to the ${planKind(planType)} as ${mailRoleLabel(planType, storedRole)}!`;
}

function rejectedMail({ personName, planName, planType }) {
  return `${personName} rejected your invite to ${namedPlan(planName, planType)}.`;
}

module.exports = {
  personDisplayName,
  planKind,
  mailRoleLabel,
  inviteeMail,
  inviterMail,
  acceptedMail,
  welcomeMail,
  rejectedMail,
};
