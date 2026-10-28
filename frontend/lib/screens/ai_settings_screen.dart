import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart' as api;
import '../config/constants.dart';
import '../providers/user_provider.dart';

const _providerValues = <String>[
  'xai',
  'openai',
  'anthropic',
  'gemini',
  'none',
];

String _providerLabel(String provider) {
  switch (provider) {
    case 'xai':
      return 'xAI';
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Gemini';
    default:
      return 'None';
  }
}

String _knownProvider(Object? value) {
  if (value is String && _providerValues.contains(value)) return value;
  return 'none';
}

String? _apiMessage(String body, String fallback) {
  try {
    final data = json.decode(body);
    if (data is Map) {
      final message = data['message'] ?? data['msg'];
      if (message is String && message.trim().isNotEmpty) {
        return message.trim();
      }
    }
  } catch (_) {}
  return fallback;
}

class AiSettingsScreen extends StatefulWidget {
  const AiSettingsScreen({super.key});

  @override
  State<AiSettingsScreen> createState() => _AiSettingsScreenState();
}

class _AiSettingsScreenState extends State<AiSettingsScreen> {
  final _keyController = TextEditingController();
  String _provider = 'none';
  String _savedProvider = 'none';
  bool _hasKey = false;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  int _formGeneration = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _keyController.dispose();
    super.dispose();
  }

  String? get _token {
    return Provider.of<UserProvider>(context, listen: false).token;
  }

  void _applyStatus(String provider, bool hasKey) {
    _keyController.clear();
    setState(() {
      _savedProvider = provider;
      _hasKey = hasKey;
      _provider = provider;
      _formGeneration += 1;
      _error = null;
      _loading = false;
      _busy = false;
    });
  }

  Future<void> _load() async {
    final token = _token;
    if (token == null || token.isEmpty) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _busy = false;
        _error = 'Sign in to view AI settings';
      });
      return;
    }
    try {
      final response = await api.get(
        Uri.parse('$backendBaseUrl$apiUserAiSettings'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (!mounted) return;
      if (response.statusCode != 200) {
        setState(() {
          _loading = false;
          _busy = false;
          _error = _apiMessage(response.body, 'Could not load AI settings');
        });
        return;
      }
      final data = json.decode(response.body);
      if (data is! Map || data['hasKey'] is! bool) {
        setState(() {
          _loading = false;
          _busy = false;
          _error = 'Could not load AI settings';
        });
        return;
      }
      _applyStatus(_knownProvider(data['aiProvider']), data['hasKey'] as bool);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _busy = false;
        _error = 'Could not load AI settings';
      });
    }
  }

  Future<void> _save({required bool clear}) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    final token = _token;
    if (token == null || token.isEmpty) {
      setState(() => _error = 'Sign in to save AI settings');
      return;
    }
    final provider = clear ? 'none' : _provider;
    final apiKey = clear || provider == 'none' ? '' : _keyController.text.trim();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await api.put(
        Uri.parse('$backendBaseUrl$apiUserAiSettings'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'aiProvider': provider, 'apiKey': apiKey}),
      );
      if (!mounted) return;
      if (response.statusCode != 200) {
        setState(() {
          _busy = false;
          _error = _apiMessage(response.body, 'Could not save AI settings');
        });
        return;
      }
      await _load();
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(clear ? 'AI key cleared' : 'AI settings saved'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Could not save AI settings';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('Provider: ${_providerLabel(_savedProvider)}'),
                const SizedBox(height: 8),
                Text(_hasKey ? 'A key is saved' : 'No key is saved'),
                const SizedBox(height: 8),
                const Text(
                  'Confirmation paste and place summaries use a saved key. With no saved key, the server key is used.',
                ),
                const SizedBox(height: 24),
                DropdownButtonFormField<String>(
                  key: ValueKey('ai-provider-$_formGeneration'),
                  initialValue: _provider,
                  decoration: const InputDecoration(
                    labelText: 'Provider',
                    border: OutlineInputBorder(),
                  ),
                  items: [
                    for (final value in _providerValues)
                      DropdownMenuItem<String>(
                        value: value,
                        child: Text(_providerLabel(value)),
                      ),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) {
                          if (value == null) return;
                          setState(() => _provider = value);
                        },
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _keyController,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  enabled: !_busy,
                  decoration: const InputDecoration(
                    labelText: 'API key',
                    border: OutlineInputBorder(),
                    helperText: 'Leave blank on Save to clear the saved key',
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    FilledButton(
                      onPressed: _busy ? null : () => _save(clear: false),
                      child: const Text('Save'),
                    ),
                    const SizedBox(width: 12),
                    OutlinedButton(
                      onPressed: _busy ? null : () => _save(clear: true),
                      child: const Text('Clear'),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              ],
            ),
    );
  }
}
