import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/plan.dart';
import '../models/plan_member.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import 'login_screen.dart';

class PlanPeopleScreen extends StatefulWidget {
  final Plan plan;

  const PlanPeopleScreen({super.key, required this.plan});

  @override
  State<PlanPeopleScreen> createState() => _PlanPeopleScreenState();
}

class _PlanPeopleScreenState extends State<PlanPeopleScreen> {
  bool _loaded = false;
  int? _status;
  final _emailController = TextEditingController();
  String _role = 'Guest';
  String? _error;
  bool _sending = false;
  String? _removingEmail;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final roles = inviteStoredRoles(
      planProvider.viewerStoredRole(widget.plan.id, userProvider.currentUserId),
    );
    if (roles.isNotEmpty) _role = roles.first;
    final status = await planProvider.fetchPlanMembers(
      widget.plan.id,
      userProvider.token,
    );
    if (!mounted) return;
    setState(() {
      _loaded = true;
      _status = status;
    });
    if (status == 401) {
      await _endSession(userProvider, planProvider, navigator);
    }
  }

  Future<void> _endSession(
    UserProvider userProvider,
    PlanProvider planProvider,
    NavigatorState navigator,
  ) async {
    planProvider.clearPlans();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _sendInvite() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Email required');
      return;
    }
    final roles = inviteStoredRoles(
      Provider.of<PlanProvider>(context, listen: false).viewerStoredRole(
        widget.plan.id,
        Provider.of<UserProvider>(context, listen: false).currentUserId,
      ),
    );
    if (roles.isEmpty) return;
    final role = roles.contains(_role) ? _role : roles.first;
    setState(() {
      _sending = true;
      _error = null;
    });
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.inviteToPlan(
      planId: widget.plan.id,
      email: email,
      role: role,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (result.status == 201) {
      _emailController.clear();
      await planProvider.fetchPlanMembers(widget.plan.id, userProvider.token);
      if (!mounted) return;
      setState(() => _sending = false);
      messenger.showSnackBar(
        const SnackBar(content: Text('Invitation sent')),
      );
      return;
    }
    setState(() {
      _sending = false;
      _error = result.error ?? 'Could not send invite';
    });
  }

  Future<void> _removeMember(PlanMember member) async {
    final email = member.email.trim();
    if (email.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove'),
        content: Text(
          'Remove ${member.name.isNotEmpty ? member.name : email} from this plan?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _removingEmail = email);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.removePlanMember(
      planId: widget.plan.id,
      email: email,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (result.status == 200) {
      await planProvider.fetchPlanMembers(widget.plan.id, userProvider.token);
      if (!mounted) return;
      setState(() => _removingEmail = null);
      return;
    }
    setState(() => _removingEmail = null);
    if (result.status == 400 || result.status == 403) {
      messenger.showSnackBar(
        SnackBar(content: Text(result.error ?? 'Could not remove')),
      );
    }
  }

  Widget _memberTile(
    PlanMember member,
    String planType,
    String? callerRole,
  ) {
    final title = member.name.isNotEmpty ? member.name : member.email;
    final canRemove = canRemoveStoredRole(callerRole, member.role);
    final removing = _removingEmail == member.email.trim();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 16)),
                if (member.name.isNotEmpty && member.email.isNotEmpty)
                  Text(member.email),
                Text(planMemberRoleLine(planType, member.role, member.status)),
              ],
            ),
          ),
          if (canRemove)
            TextButton(
              onPressed: removing || _sending
                  ? null
                  : () => _removeMember(member),
              child: const Text('Remove'),
            ),
        ],
      ),
    );
  }

  Widget _inviteForm(String planType, List<String> roles) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Invite',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          enabled: !_sending,
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        const SizedBox(height: 8),
        if (roles.length > 1)
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              for (final stored in roles)
                ButtonSegment(
                  value: stored,
                  label: Text(planRoleLabel(planType, stored)),
                ),
            ],
            selected: {_role},
            onSelectionChanged: _sending
                ? (_) {}
                : (next) {
                    setState(() => _role = next.first);
                  },
          )
        else if (roles.length == 1)
          Text(planRoleLabel(planType, roles.first)),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Colors.red)),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: _sending ? null : _sendInvite,
            child: const Text('Invite'),
          ),
        ),
      ],
    );
  }

  Widget _body({
    required List<PlanMember> members,
    required String planType,
    required List<String> roles,
    required String? callerRole,
  }) {
    if (!_loaded) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_status == 403) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Not allowed to view people',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 20),
          ),
        ),
      );
    }
    if (_status != 200) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Could not load people',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final member in members)
          _memberTile(member, planType, callerRole),
        if (roles.isNotEmpty) ...[
          if (members.isNotEmpty) const SizedBox(height: 8),
          _inviteForm(planType, roles),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final planProvider = Provider.of<PlanProvider>(context);
    final userId = Provider.of<UserProvider>(context, listen: false).currentUserId;
    final storedRole = planProvider.viewerStoredRole(widget.plan.id, userId);
    final roles = inviteStoredRoles(storedRole);
    var planType = widget.plan.type;
    for (final plan in planProvider.plans) {
      if (plan.id == widget.plan.id) {
        planType = plan.type;
        break;
      }
    }
    final members = peopleScreenMembers(planProvider.planMembers);

    return Scaffold(
      appBar: AppBar(
        title: const Text('People'),
        backgroundColor: Colors.blue,
      ),
      body: _body(
        members: members,
        planType: planType,
        roles: roles,
        callerRole: storedRole,
      ),
    );
  }
}
