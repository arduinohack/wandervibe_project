import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/user_provider.dart';

bool isVerifyEmailLocation(Uri uri) {
  final path = uri.path;
  return path == '/verify-email' || path.endsWith('/verify-email');
}

class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key, this.token});

  final String? token;

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  String? _message;
  bool _ok = false;
  bool _waiting = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _verify());
  }

  Future<void> _verify() async {
    final token = widget.token ?? Uri.base.queryParameters['token'] ?? '';
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final failure = await userProvider.verifyEmail(token);
    if (!mounted) return;
    setState(() {
      _waiting = false;
      _ok = failure == null;
      _message = failure ?? 'Your email is verified.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Verify email')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _waiting
              ? const CircularProgressIndicator()
              : Text(
                  _message ?? '',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    color: _ok ? null : Theme.of(context).colorScheme.error,
                  ),
                ),
        ),
      ),
    );
  }
}
