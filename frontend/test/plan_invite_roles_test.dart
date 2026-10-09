import 'package:flutter_test/flutter_test.dart';
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
}
