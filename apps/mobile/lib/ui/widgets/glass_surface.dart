import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class GlassSurface extends StatelessWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.borderRadius = 28,
    this.padding = const EdgeInsets.all(16),
    this.interactive = false,
  });

  final Widget child;
  final double borderRadius;
  final EdgeInsets padding;
  final bool interactive;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    return ClipRRect(
      borderRadius: radius,
      child: Stack(
        fit: StackFit.passthrough,
        children: [
          Positioned.fill(
            child: Platform.isIOS
                ? IgnorePointer(
                    child: UiKitView(
                      viewType: 'zeus/liquid-glass',
                      creationParams: {'radius': borderRadius, 'interactive': interactive},
                      creationParamsCodec: const StandardMessageCodec(),
                    ),
                  )
                : BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .065),
                        border: Border.all(color: Colors.white.withValues(alpha: .11)),
                      ),
                    ),
                  ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white.withValues(alpha: .08)),
              borderRadius: radius,
            ),
            child: Padding(padding: padding, child: child),
          ),
        ],
      ),
    );
  }
}
