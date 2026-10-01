import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/user_provider.dart'; // For preferences
import '../utils/logger.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _notifications = []; // Mock list of notifications

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  void _loadNotifications() {
    // Mock notifications (later from backend or Firebase)
    _notifications = [
      {
        'id': 'notif1',
        'title': 'New Invite',
        'message': 'Alex invited you as VibePlanner to Paris Adventure',
        'timestamp': DateTime.now()
            .subtract(const Duration(hours: 2))
            .toLocal(),
        'type': 'invite',
      },
      {
        'id': 'notif2',
        'title': 'Activity Added',
        'message': 'New flight added to itinerary',
        'timestamp': DateTime.now()
            .subtract(const Duration(minutes: 30))
            .toLocal(),
        'type': 'activity',
      },
      {
        'id': 'notif3',
        'title': 'Role Reassigned',
        'message': 'You are now VibeCoordinator for Tokyo Getaway',
        'timestamp': DateTime.now().subtract(const Duration(days: 1)).toLocal(),
        'type': 'role',
      },
    ];
    setState(() {}); // Refresh UI
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        backgroundColor: Colors.blue,
      ),
      body: Column(
        children: [
          // Preferences Section
          Card(
            child: Consumer<UserProvider>(
              builder: (context, userProvider, child) {
                if (userProvider.currentUser == null) {
                  return const Padding(
                    padding: EdgeInsets.all(16.0),
                    child: Text('No user logged in—log in to set preferences.'),
                  );
                }
                final prefs = userProvider.currentUser!.notificationPreferences;
                return Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    children: [
                      const Text(
                        'Notification Preferences',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      SwitchListTile(
                        title: const Text('Email Notifications'),
                        value: prefs.email,
                        onChanged: (value) {
                          final updatedUser = userProvider.currentUser!
                              .copyWith(
                                notificationPreferences: prefs.copyWith(
                                  email: value,
                                ),
                              );
                          userProvider.setCurrentUser(updatedUser);
                        },
                      ),
                      SwitchListTile(
                        title: const Text('SMS Notifications'),
                        value: prefs.sms,
                        onChanged: (value) {
                          final updatedUser = userProvider.currentUser!
                              .copyWith(
                                notificationPreferences: prefs.copyWith(
                                  sms: value,
                                ),
                              );
                          userProvider.setCurrentUser(updatedUser);
                        },
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),

          // Notifications List
          Expanded(
            child: _notifications.isEmpty
                ? const Center(child: Text('No notifications yet'))
                : ListView.builder(
                    itemCount: _notifications.length,
                    itemBuilder: (context, index) {
                      final notif = _notifications[index];
                      final isNew =
                          DateTime.now()
                              .difference(notif['timestamp'])
                              .inHours <
                          1; // Highlight recent
                      return Card(
                        color: isNew ? Colors.blue[50] : null, // Highlight new
                        child: ListTile(
                          leading: Icon(
                            _getNotifIcon(notif['type']),
                          ), // Icon based on type
                          title: Text(notif['title']),
                          subtitle: Text(notif['message']),
                          trailing: Text(
                            notif['timestamp']
                                .toLocal()
                                .toString()
                                .split(' ')[1]
                                .substring(0, 5), // Time only
                          ),
                          onTap: () {
                            logger.i('Tapped notification ${notif['id']}');
                          },
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _loadNotifications, // Stub refresh
        child: const Icon(Icons.refresh),
      ),
    );
  }

  // Helper: Icon for notification type
  IconData _getNotifIcon(String type) {
    switch (type) {
      case 'invite':
        return Icons.person_add;
      case 'activity':
        return Icons.event;
      case 'role':
        return Icons.admin_panel_settings;
      default:
        return Icons.notifications;
    }
  }
}
