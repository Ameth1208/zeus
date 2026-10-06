import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rive/rive.dart' as rive;

import 'ui/home_screen.dart';
import 'ui/zeus_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await rive.RiveNative.init();
  runApp(const ProviderScope(child: ZeusApp()));
}

class ZeusApp extends StatelessWidget {
  const ZeusApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Zeus',
    debugShowCheckedModeBanner: false,
    theme: ZeusTheme.dark(),
    darkTheme: ZeusTheme.dark(),
    themeMode: ThemeMode.dark,
    home: const HomeScreen(),
  );
}
