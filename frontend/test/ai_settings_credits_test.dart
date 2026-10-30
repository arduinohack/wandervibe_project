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
    expect(find.text('PlanItVibe (Trial)'), findsOneWidget);
    expect(find.text('Plan cap: 2'), findsOneWidget);
    expect(find.text('Upgrade to PlanItVibe'), findsOneWidget);
    expect(find.text('Upgrade to PlanItVibe Plus'), findsOneWidget);
    expect(find.text('Upgrade to PlanItVibe Pro'), findsOneWidget);
    expect(find.text('Refresh'), findsOneWidget);
    expect(find.text('AI credits'), findsOneWidget);
  });

  test('a fractional balance shows one decimal', () {
    expect(creditBalanceText(2), '2');
    expect(creditBalanceText(2.5), '2.5');
    expect(creditBalanceText(0.5), '0.5');
  });
}
