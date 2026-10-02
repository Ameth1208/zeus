import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:sf_symbols/sf_symbols.dart';

/// Renders real SF Symbols on Apple platforms and falls back to the closest
/// CupertinoIcons glyph elsewhere, so the same call site works cross-platform.
class ZeusIcon extends StatelessWidget {
  const ZeusIcon(
    this.name, {
    super.key,
    required this.fallback,
    this.size = 22,
    this.color,
    this.weight = FontWeight.w600,
    this.semanticLabel,
  });

  final String name;
  final IconData fallback;
  final double size;
  final Color? color;
  final FontWeight weight;
  final String? semanticLabel;

  bool get _native => Platform.isIOS || Platform.isMacOS;

  @override
  Widget build(BuildContext context) {
    final resolved =
        color ?? IconTheme.of(context).color ?? CupertinoColors.white;
    if (!_native) return Icon(fallback, size: size, color: resolved);
    return SfSymbol(
      name: name,
      size: size,
      color: resolved,
      weight: weight,
      semanticLabel: semanticLabel,
    );
  }
}
