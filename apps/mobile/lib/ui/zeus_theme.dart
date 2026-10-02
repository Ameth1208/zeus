import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

abstract final class ZeusTheme {
  static const _accent = Color(0xFF6AB8FF);

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: _accent,
      brightness: Brightness.dark,
      surface: const Color(0xFF080A0E),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFF050609),
      splashFactory: InkSparkle.splashFactory,
      textTheme: Typography.whiteCupertino,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        },
      ),
      inputDecorationTheme: InputDecorationTheme(
        labelStyle: const TextStyle(color: Colors.white38, fontSize: 14),
        floatingLabelStyle: const TextStyle(
          color: Colors.white70,
          fontSize: 13,
        ),
        filled: true,
        fillColor: Colors.white.withValues(alpha: .07),
        iconColor: Colors.white38,
        border: _glassBorder(Colors.white.withValues(alpha: .10)),
        enabledBorder: _glassBorder(Colors.white.withValues(alpha: .10)),
        focusedBorder: _glassBorder(Colors.white.withValues(alpha: .30)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 16,
        ),
      ),
    );
  }

  static OutlineInputBorder _glassBorder(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: BorderSide(color: color),
  );
}
