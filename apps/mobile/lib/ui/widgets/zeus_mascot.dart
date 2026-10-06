import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../gen/assets.gen.dart';

class ZeusMascot extends StatefulWidget {
  const ZeusMascot({
    super.key,
    this.status = 'idle',
    this.size = 190,
    this.interactive = true,
  });

  final String status;
  final double size;
  final bool interactive;

  @override
  State<ZeusMascot> createState() => _ZeusMascotState();
}

class _ZeusMascotState extends State<ZeusMascot> with TickerProviderStateMixin {
  late final AnimationController _breathing;
  late final AnimationController _reaction;
  Offset _gaze = Offset.zero;

  @override
  void initState() {
    super.initState();
    _breathing = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3200),
    )..repeat(reverse: true);
    _reaction = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
    );
  }

  void _handleTap() {
    if (!widget.interactive) return;
    _reaction.forward(from: 0);
  }

  void _handlePointer(PointerEvent event) {
    if (!widget.interactive) return;
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final p = box.globalToLocal(event.position);
    final dx = ((p.dx / box.size.width) * 2 - 1).clamp(-1.0, 1.0);
    final dy = ((p.dy / box.size.height) * 2 - 1).clamp(-1.0, 1.0);
    setState(() => _gaze = Offset(dx, dy));
  }

  @override
  void dispose() {
    _breathing.dispose();
    _reaction.dispose();
    super.dispose();
  }

  AssetGenImage _statusImage() {
    switch (widget.status) {
      case 'working':
        return Assets.images.working;
      case 'waiting':
      case 'waiting_approval':
        return Assets.images.waitingAproval;
      case 'failed':
      case 'error':
        return Assets.images.error;
      case 'sleeping':
        return Assets.images.sleep;
      case 'thinking':
        return Assets.images.thinking;
      case 'blink':
        return Assets.images.blink;
      case 'look_left':
        return Assets.images.lookLeft;
      case 'look_right':
        return Assets.images.lookRight;
      default:
        return Assets.images.idle;
    }
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onHover: _handlePointer,
      onExit: (_) => setState(() => _gaze = Offset.zero),
      child: Listener(
        onPointerMove: _handlePointer,
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: _handleTap,
          child: AnimatedBuilder(
            animation: Listenable.merge([_breathing, _reaction]),
            builder: (context, child) {
              final breath = math.sin(_breathing.value * math.pi) * .018;
              final working = widget.status == 'working' ? .008 : 0.0;
              final tap = math.sin(_reaction.value * math.pi) * .055;
              final waitingTilt = widget.status == 'waiting' ? .02 : 0.0;
              return Transform.translate(
                offset: Offset(_gaze.dx * 2.5, _gaze.dy * 1.5 - tap * 18),
                child: Transform.rotate(
                  angle: waitingTilt + (_gaze.dx * .018),
                  child: Transform.scale(
                    scale: 1 + breath + working + tap,
                    child: SizedBox(
                      width: widget.size,
                      height: widget.size,
                      child: _statusImage().image(fit: BoxFit.contain),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
