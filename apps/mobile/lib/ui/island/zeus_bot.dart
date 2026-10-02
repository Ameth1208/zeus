import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'zeus_bot_state.dart';

/// The mascot. Renders one of the frames in `assets/zeus/` and layers the
/// per-state motion on top: breathing, gaze, tilt, bounce, scan and the halo.
///
/// Every animated property is exponential smoothing toward a target with the
/// constant derived from dt, so the result is frame-rate independent.
class ZeusBot extends StatefulWidget {
  const ZeusBot({
    super.key,
    required this.state,
    required this.size,
    this.badgeAnchor,
    this.interactive = true,
  });

  final ZeusBotState state;
  final double size;
  final Offset? badgeAnchor;
  final bool interactive;

  @override
  State<ZeusBot> createState() => _ZeusBotState();
}

class _ZeusBotState extends State<ZeusBot> with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  late final ValueNotifier<double> _time;

  double _t = 0;
  double _lastTickMs = 0;

  // Smoothed properties — each one eases toward a target derived per frame.
  double _lookX = 0;
  double _lookY = 0;
  double _scale = 1;
  double _offsetY = 0;
  double _rotate = 0;
  double _glowOpacity = .15;
  Color _glowColor = const Color(0xFFE6E9EE);

  bool _hasPointer = false;
  bool _blinkHold = false;

  @override
  void initState() {
    super.initState();
    _time = ValueNotifier(0);
    _ticker = createTicker(_onTick)..start();
    _lastTickMs = DateTime.now().millisecondsSinceEpoch.toDouble();
    final cfg = kZeusBotStates[widget.state]!;
    _glowColor = Color(cfg.color);
    _glowOpacity = cfg.glow;
  }

  @override
  void dispose() {
    _ticker.dispose();
    _time.dispose();
    super.dispose();
  }

  void _onTick(Duration elapsed) {
    final nowMs = elapsed.inMicroseconds / 1000;
    final dt = ((nowMs - _lastTickMs) / 1000).clamp(0.0, 0.05);
    _lastTickMs = nowMs;
    _t += dt;

    final cfg = kZeusBotStates[widget.state]!;

    // Exponential smoothing. Base 0.0008 for general, 0.0025 for gaze (slower,
    // so the eyes lag behind the body the way a real gaze does).
    final kGen = 1 - math.pow(0.0008, dt).toDouble();
    final kLook = 1 - math.pow(0.0025, dt).toDouble();

    // ── Gaze ───────────────────────────────────────────────────────────
    double targetLookX;
    double targetLookY;
    if (cfg.scans) {
      targetLookX = math.sin(_t * 2.6) * .6;
      targetLookY = -.06;
    } else if (cfg.look != null) {
      targetLookX = _hasPointer ? _lookX * .35 : cfg.look!.dx * .55;
      targetLookY = _hasPointer ? _lookY * .3 : cfg.look!.dy * .5;
    } else if (widget.state == ZeusBotState.sleeping) {
      targetLookX = 0;
      targetLookY = -.14;
    } else if (widget.state == ZeusBotState.interrupted) {
      targetLookX = math.sin(_t * 9) * .25;
      targetLookY = 0;
    } else if (_hasPointer) {
      targetLookX = _lookX * .62;
      targetLookY = _lookY * .5;
    } else {
      targetLookX = 0;
      targetLookY = 0;
    }

    _lookX += (targetLookX - _lookX) * kLook;
    _lookY += (targetLookY - _lookY) * kLook;

    // ── Body ───────────────────────────────────────────────────────────
    double targetScale = cfg.amplitude;
    double targetOffsetY = 0;
    double targetRotate = cfg.tilt + _lookX * .018;

    if (cfg.breathes) {
      targetScale *= 1 + math.sin(_t * 1.6) * .035;
    }
    if (cfg.bounces) {
      targetOffsetY = -math.sin(_t * 5.2).abs() * .07 * widget.size;
    }
    if (widget.state == ZeusBotState.error ||
        widget.state == ZeusBotState.interrupted) {
      // Four-keyframe shake on entry, then rest.
      if (_t < .28) {
        targetRotate += math.sin(_t * 42) * cfg.amplitude;
      }
    }

    _scale += (targetScale - _scale) * kGen;
    _offsetY += (targetOffsetY - _offsetY) * kGen;
    _rotate += (targetRotate - _rotate) * kGen;

    // ── Glow ───────────────────────────────────────────────────────────
    final targetGlow = _blinkHold ? .15 : cfg.glow;
    final targetColor = Color(cfg.color);
    final kColor = 1 - math.pow(0.002, dt).toDouble();
    _glowOpacity += (targetGlow - _glowOpacity) * kColor;
    _glowColor = Color.lerp(_glowColor, targetColor, kColor) ?? targetColor;

    if (mounted) setState(() {});
    _time.value = _t;
  }

  void _handlePointer(PointerEvent event) {
    if (!widget.interactive) return;
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final p = box.globalToLocal(event.position);
    final dx = ((p.dx / box.size.width) * 2 - 1).clamp(-1.0, 1.0);
    final dy = ((p.dy / box.size.height) * 2 - 1).clamp(-1.0, 1.0);
    setState(() {
      _hasPointer = true;
      _lookX = dx;
      _lookY = dy;
    });
  }

  @override
  Widget build(BuildContext context) {
    final cfg = kZeusBotStates[widget.state]!;
    final frame = zeusFrameFor(widget.state);
    final size = widget.size;

    return MouseRegion(
      onHover: _handlePointer,
      onExit: (_) => setState(() => _hasPointer = false),
      child: Listener(
        onPointerMove: _handlePointer,
        onPointerSignal: (e) {
          if (e is PointerScrollEvent && widget.interactive) {
            setState(() => _blinkHold = !_blinkHold);
          }
        },
        child: Transform.translate(
          offset: Offset(_lookX * size * .04, _offsetY + _lookY * size * .03),
          child: Transform.rotate(
            angle: _rotate,
            child: Transform.scale(
              scale: _scale,
              child: SizedBox(
                width: size,
                height: size,
                child: Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.center,
                  children: [
                    // State-coloured halo. The only real glow in the design.
                    Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: RadialGradient(
                            colors: [
                              _glowColor.withValues(alpha: _glowOpacity),
                              _glowColor.withValues(alpha: 0),
                            ],
                            stops: const [.38, 1],
                          ),
                        ),
                      ),
                    ),
                    frame.image(
                      width: size,
                      height: size,
                      fit: BoxFit.contain,
                      color: cfg.tint > 0
                          ? Color(cfg.color).withValues(alpha: cfg.tint * .38)
                          : null,
                      colorBlendMode: cfg.tint > 0
                          ? BlendMode.srcATop
                          : BlendMode.dst,
                    ),
                    if (cfg.badge != ZeusBadgeKind.none)
                      Positioned(
                        right: size * .04,
                        top: size * .06,
                        child: _Badge(kind: cfg.badge, color: Color(cfg.color)),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.kind, required this.color});

  final ZeusBadgeKind kind;
  final Color color;

  @override
  Widget build(BuildContext context) {
    switch (kind) {
      case ZeusBadgeKind.none:
        return const SizedBox.shrink();
      case ZeusBadgeKind.dots:
        return _Bouncing(
          color: color,
          child: Text(
            '•••',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: color,
              height: 1,
            ),
          ),
        );
      case ZeusBadgeKind.bang:
        return _BadgeCircle(
          color: color,
          child: Text(
            '!',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              color: color,
              height: 1,
            ),
          ),
        );
      case ZeusBadgeKind.question:
        return _BadgeCircle(
          color: color,
          child: Text(
            '?',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              color: color,
              height: 1,
            ),
          ),
        );
      case ZeusBadgeKind.dot:
        return _BadgeCircle(color: color, child: SizedBox(width: 6, height: 6));
    }
  }
}

class _BadgeCircle extends StatelessWidget {
  const _BadgeCircle({required this.child, required this.color});

  final Widget child;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: 20,
    height: 20,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: color.withValues(alpha: .18),
      border: Border.all(color: color.withValues(alpha: .55), width: 1),
    ),
    alignment: Alignment.center,
    child: child,
  );
}

/// Animated three-dot badge. Owns a ticker only while visible.
class _Bouncing extends StatefulWidget {
  const _Bouncing({required this.child, required this.color});

  final Widget child;
  final Color color;

  @override
  State<_Bouncing> createState() => _BouncingState();
}

class _BouncingState extends State<_Bouncing>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  double _t = 0;
  Duration _last = Duration.zero;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((e) {
      final dt = (e - _last).inMicroseconds / 1e6;
      _last = e;
      _t += dt;
      if (mounted) setState(() {});
    })..start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: List.generate(3, (i) {
      final phase = (_t * 3.2) - i * .28;
      final bounce = phase <= 0 ? 0.0 : math.sin(phase * math.pi);
      final lift = bounce <= 0 ? 0.0 : -bounce.clamp(0.0, 1.0) * 3.0;
      return Transform.translate(
        offset: Offset(0, lift),
        child: Text(
          '•',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w900,
            color: widget.color,
            height: 1,
          ),
        ),
      );
    }),
  );
}
