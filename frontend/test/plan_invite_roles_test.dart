import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/models/plan_member.dart';
import 'package:wandervibe_frontend/models/plan_role_label.dart';

void main() {
  test('Owner can send Collaborator and Guest; Collaborator can send Guest', () {
    expect(inviteStoredRoles('Owner'), ['Collaborator', 'Guest']);
    expect(inviteStoredRoles('Collaborator'), ['Guest']);
    expect(inviteStoredRoles('Guest'), isEmpty);
  });

  test('trip labels stay off the POST body', () {
    expect(planRoleLabel('trip', 'Collaborator'), 'Co-Planner');
    expect(planRoleLabel('trip', 'Guest'), 'Attendee');
  });

  test('plan labels stay off the POST body', () {
    expect(planRoleLabel('plan', 'Collaborator'), 'Planner');
    expect(planRoleLabel('plan', 'Guest'), 'Guest');
  });

  test('a plan does not show Attendee; a trip does not show Guest', () {
    expect(planRoleLabel('plan', 'Guest'), 'Guest');
    expect(planRoleLabel('plan', 'Collaborator'), 'Planner');
    expect(planRoleLabel('trip', 'Guest'), 'Attendee');
    expect(planRoleLabel('trip', 'Collaborator'), 'Co-Planner');
  });

  test('trip people list uses trip labels and Pending', () {
    expect(planMemberRoleLine('trip', 'Owner', 'accepted'), 'Organizer');
    expect(planMemberRoleLine('trip', 'Collaborator', 'accepted'), 'Co-Planner');
    expect(planMemberRoleLine('trip', 'Guest', 'accepted'), 'Attendee');
    expect(planMemberRoleLine('trip', 'Collaborator', 'pending'), 'Co-Planner Pending');
    expect(planMemberRoleLine('trip', 'Guest', 'pending'), 'Attendee Pending');
  });

  test('plan people list uses plan labels and Pending', () {
    expect(planMemberRoleLine('plan', 'Owner', 'accepted'), 'Host');
    expect(planMemberRoleLine('plan', 'Collaborator', 'accepted'), 'Planner');
    expect(planMemberRoleLine('plan', 'Guest', 'accepted'), 'Guest');
    expect(planMemberRoleLine('plan', 'Collaborator', 'pending'), 'Planner Pending');
    expect(planMemberRoleLine('plan', 'Guest', 'pending'), 'Guest Pending');
  });

  test('Owner may remove Collaborator or Guest; Collaborator may remove Guest', () {
    expect(canRemoveStoredRole('Owner', 'Collaborator'), isTrue);
    expect(canRemoveStoredRole('Owner', 'Guest'), isTrue);
    expect(canRemoveStoredRole('Owner', 'Owner'), isFalse);
    expect(canRemoveStoredRole('Collaborator', 'Guest'), isTrue);
    expect(canRemoveStoredRole('Collaborator', 'Collaborator'), isFalse);
    expect(canRemoveStoredRole('Collaborator', 'Owner'), isFalse);
    expect(canRemoveStoredRole('Guest', 'Guest'), isFalse);
    expect(canRemoveStoredRole('Guest', 'Collaborator'), isFalse);
  });

  test('people screen lists the Owner once at the top', () {
    const extraOwner = PlanMember(
      name: 'Other',
      email: 'other@example.com',
      role: 'Owner',
      status: 'accepted',
    );
    const owner = PlanMember(
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Owner',
      status: 'accepted',
    );
    const collaborator = PlanMember(
      name: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'Collaborator',
      status: 'accepted',
    );
    const pendingGuest = PlanMember(
      name: '',
      email: 'new.person@example.com',
      role: 'Guest',
      status: 'pending',
    );
    final listed = peopleScreenMembers([
      collaborator,
      extraOwner,
      pendingGuest,
      owner,
    ]);
    expect(listed, [extraOwner, collaborator, pendingGuest]);
    expect(listed.first.role, 'Owner');
    expect(listed.where((row) => row.role == 'Owner'), hasLength(1));
  });
}
