import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:wandervibe_frontend/providers/user_provider.dart';
import 'package:wandervibe_frontend/screens/ai_settings_screen.dart';

void main() {
  testWidgets('AI settings shows credit packs and refresh', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider(
          create: (_) => UserProvider(),
          child: const AiSettingsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Buy 100 credits'), findsOneWidget);
    expect(find.text('Buy 500 credits'), findsOneWidget);
    expect(find.text('Upgrade to Plus'), findsOneWidget);
    expect(find.text('Plus active'), findsNothing);
    expect(find.text('Refresh'), findsOneWidget);
    expect(find.text('AI credits'), findsOneWidget);
  });
}
