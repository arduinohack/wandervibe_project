import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/user_provider.dart'; // For login
import 'home_screen.dart'; // Navigate to home on success
import 'signup_screen.dart'; // For sign up navigation
import 'forgot_password_screen.dart'; // For forgot password navigation

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>(); // For validation
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false; // For loading spinner

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (_formKey.currentState!.validate()) {
      setState(() => _isLoading = true);
      final userProvider = Provider.of<UserProvider>(context, listen: false);
      try {
        await userProvider.login(
          _emailController.text,
          _passwordController.text,
        ); // Calls provider
        if (userProvider.token != null) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (context) => const HomeScreen()),
          );
        } else {
          _showError('Login failed—try again');
        }
      } catch (e) {
        _showError(
          e.toString(),
        ); // Fixed: Shows backend message (e.g., "Invalid email or password")
      } finally {
        setState(() => _isLoading = false);
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  // Helper: Compute onPressed based on fields (enable/disable logic)
  VoidCallback? _getOnPressed() {
    final emailValid = _emailController.text.trim().isNotEmpty;
    final passwordValid = _passwordController.text.trim().isNotEmpty;
    final condition = emailValid && passwordValid && !_isLoading;
    //print(
    //  'Condition: $condition (email: $emailValid, password: $passwordValid, loading: $_isLoading)',
    //); // Debug optional
    return condition ? _login : null; // Return _login if true, null if false
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Login to WanderVibe'),
        backgroundColor: Colors.blue,
      ),
      body: Builder(
        builder: (context) {
          return Padding(
            padding: const EdgeInsets.all(16.0),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.travel_explore,
                    size: 80,
                    color: Colors.blue,
                  ),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _emailController,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.email),
                    ),
                    keyboardType: TextInputType.emailAddress,
                    validator: (value) {
                      if (value == null || value.isEmpty)
                        return 'Email required';
                      if (!RegExp(
                        r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$',
                      ).hasMatch(value)) {
                        return 'Invalid email';
                      }
                      return null;
                    },
                    onChanged: (value) {
                      setState(() {}); // Rebuild to re-check condition
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.lock),
                    ),
                    obscureText: true,
                    validator: (value) {
                      final trimmedValue = value?.trim();
                      if (trimmedValue == null || trimmedValue.isEmpty) {
                        return 'Password required';
                      }
                      if (trimmedValue.length < 6) {
                        return 'Password must be at least 6 characters';
                      }
                      return null;
                    },
                    onChanged: (value) {
                      setState(() {}); // Rebuild to re-check condition
                    },
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed:
                          _getOnPressed(), // Fixed: Calls the helper (evaluates condition outside)
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.blue,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      child: _isLoading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  Colors.white,
                                ),
                              ),
                            )
                          : const Text('Login', style: TextStyle(fontSize: 18)),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    // Added: Sign Up link
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => const SignupScreen(),
                        ),
                      );
                    },
                    child: const Text('Don\'t have an account? Sign up'),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    // Added: Forgot Password link
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => const ForgotPasswordScreen(),
                        ),
                      );
                    },
                    child: const Text('Forgot Password?'),
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
