import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/config.dart'; // For AppConfig

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  int _timeoutSeconds = 30;
  int _defaultDuration = 60;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    _timeoutSeconds = await AppConfig.timeoutSeconds;
    _defaultDuration = await AppConfig.defaultDurationMinutes;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            // Timeout slider
            Row(
              children: [
                const Text('Network Timeout (seconds):'),
                Expanded(
                  child: Slider(
                    value: _timeoutSeconds.toDouble(),
                    min: 10.0,
                    max: 120.0,
                    divisions: 11,
                    onChanged: (value) async {
                      final newValue = value.round();
                      setState(() => _timeoutSeconds = newValue);
                      await AppConfig.setTimeoutSeconds(newValue);
                    },
                  ),
                ),
                Text('$_timeoutSeconds'),
              ],
            ),
            const SizedBox(height: 16),
            // Duration slider
            Row(
              children: [
                const Text('Default Event Duration (minutes):'),
                Expanded(
                  child: Slider(
                    value: _defaultDuration.toDouble(),
                    min: 30.0,
                    max: 480.0,
                    divisions: 15,
                    onChanged: (value) async {
                      final newValue = value.round();
                      setState(() => _defaultDuration = newValue);
                      await AppConfig.setDefaultDurationMinutes(newValue);
                    },
                  ),
                ),
                Text('$_defaultDuration'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
