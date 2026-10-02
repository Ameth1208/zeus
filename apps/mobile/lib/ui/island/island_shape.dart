import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// Paints the island body as a single custom path whose top corners are either
/// convex, sharp or concave depending on the sign of [topRadius].
///
///   topRadius > 0 → convex rounded top corners (expanded)
///   topRadius < 0 → concave ear cutouts, |topRadius| = ear radius (compact)
///   topRadius = 0 → sharp top corners (transient while animating)
///
/// The sign is what makes the compact island melt into the top edge of the
/// screen instead of reading as a bar floating in the middle of it.
class IslandShape extends StatelessWidget {
  const IslandShape({
    super.key,
    required this.width,
    required this.height,
    required this.radius,
    required this.topRadius,
    required this.child,
  });

  final double width;
  final double height;
  final double radius;
  final double topRadius;
  final Widget child;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    height: height,
    child: ClipPath(
      clipper: _IslandClipper(radius: radius, topRadius: topRadius),
      child: child,
    ),
  );
}

class _IslandClipper extends CustomClipper<Path> {
  const _IslandClipper({required this.radius, required this.topRadius});

  final double radius;
  final double topRadius;

  @override
  Path getClip(Size size) {
    final w = size.width;
    final h = size.height;
    if (w <= 0 || h <= 0) return Path();
    final path = Path();
    final r = math.min(radius, math.min(w, h) / 2);

    if (topRadius > 0) {
      // ── Convex top corners ──────────────────────────────────────────
      final tr = math.min(topRadius, w / 2);
      path.moveTo(tr, 0);
      path.lineTo(w - tr, 0);
      path.arcToPoint(Offset(w, tr), radius: Radius.circular(tr));
      path.lineTo(w, h - r);
      path.arcToPoint(Offset(w - r, h), radius: Radius.circular(r));
      path.lineTo(r, h);
      path.arcToPoint(Offset(0, h - r), radius: Radius.circular(r));
      path.lineTo(0, tr);
      path.arcToPoint(Offset(tr, 0), radius: Radius.circular(tr));
    } else if (topRadius < 0) {
      // ── Concave ear cutouts ──────────────────────────────────────────
      final er = math.min(-topRadius, w / 2);
      path.moveTo(0, 0);
      path.arcToPoint(Offset(er, er), radius: Radius.circular(er));
      path.lineTo(w - er, er);
      path.arcToPoint(Offset(w, 0), radius: Radius.circular(er));
      path.lineTo(w, h - r);
      path.arcToPoint(Offset(w - r, h), radius: Radius.circular(r));
      path.lineTo(r, h);
      path.arcToPoint(Offset(0, h - r), radius: Radius.circular(r));
      path.close();
    } else {
      // ── Sharp top corners ────────────────────────────────────────────
      path.moveTo(0, 0);
      path.lineTo(w, 0);
      path.lineTo(w, h - r);
      path.arcToPoint(Offset(w - r, h), radius: Radius.circular(r));
      path.lineTo(r, h);
      path.arcToPoint(Offset(0, h - r), radius: Radius.circular(r));
      path.close();
    }
    return path;
  }

  @override
  bool shouldReclip(covariant _IslandClipper old) =>
      old.radius != radius || old.topRadius != topRadius;
}

/// The path on its own, for painting the body behind content that is not
/// clipped (glow, wash).
Path islandBodyPath({
  required double width,
  required double height,
  required double radius,
  required double topRadius,
}) => _IslandClipper(
  radius: radius,
  topRadius: topRadius,
).getClip(Size(width, height));
