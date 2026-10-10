import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import 'login_screen.dart';

class ActivityHistoryScreen extends StatefulWidget {
  final String activityId;
  final bool canRestore;

  const ActivityHistoryScreen({
    super.key,
    required this.activityId,
    required this.canRestore,
  });

  @override
  State<ActivityHistoryScreen> createState() => _ActivityHistoryScreenState();
}

class _ActivityHistoryScreenState extends State<ActivityHistoryScreen> {
  bool _loaded = false;
  bool _restoring = false;
  int? _status;
  String? _error;
  List<ActivityHistoryRevision> _revisions = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final result = await planProvider.fetchActivityHistory(
      activityId: widget.activityId,
      token: userProvider.token,
    );
    if (!mounted) return;
    setState(() {
      _loaded = true;
      _status = result.status;
      _error = result.error;
      _revisions = result.revisions;
    });
    if (result.status == 401) {
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

  Future<void> _restore(ActivityHistoryRevision revision) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Restore this version?'),
        content: Text(
          'Restore the ${revision.action} from ${_historyTime(revision.createdAt)}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Restore'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _restoring = true);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.restoreActivityRevision(
      activityId: widget.activityId,
      revisionId: revision.id,
      token: userProvider.token,
    );
    if (!mounted) return;
    setState(() => _restoring = false);
    if (result.status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (result.status == 403) {
      messenger.showSnackBar(
        SnackBar(content: Text(result.error ?? 'Not allowed')),
      );
      return;
    }
    if (result.status != 200) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(result.error ?? 'Could not restore this version'),
        ),
      );
      return;
    }
    navigator.pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('History'),
        backgroundColor: Colors.blue,
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : _status != 200
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  _error ?? 'Could not load history',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 20),
                ),
              ),
            )
          : _revisions.isEmpty
          ? const Center(
              child: Text(
                'No history',
                style: TextStyle(fontSize: 20),
                textAlign: TextAlign.center,
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _revisions.length,
              itemBuilder: (context, index) {
                final revision = _revisions[index];
                final older = index > 0;
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Time: ${_historyTime(revision.createdAt)}'),
                        const SizedBox(height: 4),
                        Text('Person: ${revision.userId}'),
                        const SizedBox(height: 4),
                        Text('Action: ${revision.action}'),
                        if (older && widget.canRestore)
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: _restoring
                                  ? null
                                  : () => _restore(revision),
                              child: const Text('Restore'),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}

String _two(int value) => value.toString().padLeft(2, '0');

String _historyTime(String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return raw;
  final local = parsed.toLocal();
  return '${local.year.toString().padLeft(4, '0')}-'
      '${_two(local.month)}-${_two(local.day)} '
      '${_two(local.hour)}:${_two(local.minute)}';
}
