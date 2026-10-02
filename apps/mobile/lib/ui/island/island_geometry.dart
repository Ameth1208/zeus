import 'zeus_bot_state.dart';

/// Outer open/close machine of the island. The inner view table below is fully
/// decoupled from it: this decides *whether* the island is showing, the view
/// table decides *what shape* it has once it is.
enum IslandMode { hidden, compact, expanded }

/// Which view fills the island while expanded.
enum IslandView {
  overview,
  empty,
  approval,
  question,
  error,
  interrupted,
  finished,
}

class ViewLayout {
  const ViewLayout({
    required this.height,
    required this.botX,
    required this.botDiameter,
    this.botY,
    this.agentMode = AgentMode.none,
    this.wash,
  });

  final double height;

  /// Mascot centre, relative to the island body. `botY == null` means
  /// auto-centre inside the card.
  final double? botX;
  final double? botY;
  final double botDiameter;
  final AgentMode agentMode;

  /// Radial wash colour from below, per state.
  final int? wash;
}

/// The layout contract: mode + view → (width, height, radii).
class IslandGeometry {
  const IslandGeometry._();

  /// The mascot overhangs its frame, so the island reserves extra room above
  /// and around the body or the ears get clipped.
  static const double mascotOverhang = 46;

  static const double compactHeight = 62;
  static const double compactWidth = 268;
  static const double expandedWidth = 344;

  static const double compactRadius = 30;
  static const double expandedRadius = 32;

  /// Concave ear radius in compact mode, applied as a negative top radius.
  static const double earRadius = 26;

  static const Map<IslandView, ViewLayout> layouts = {
    IslandView.overview: ViewLayout(
      height: 176,
      botX: 62,
      botDiameter: 56,
      agentMode: AgentMode.pills,
    ),
    IslandView.empty: ViewLayout(height: 160, botX: 66, botDiameter: 62),
    IslandView.approval: ViewLayout(
      height: 176,
      botX: 62,
      botDiameter: 56,
      agentMode: AgentMode.column,
      wash: 0x66F5A524,
    ),
    IslandView.question: ViewLayout(
      height: 176,
      botX: 62,
      botDiameter: 56,
      agentMode: AgentMode.column,
      wash: 0x6122D3EE,
    ),
    IslandView.error: ViewLayout(
      height: 176,
      botX: 62,
      botDiameter: 58,
      agentMode: AgentMode.column,
      wash: 0x8CF4505E,
    ),
    IslandView.interrupted: ViewLayout(
      height: 176,
      botX: 66,
      botDiameter: 58,
      agentMode: AgentMode.column,
      wash: 0x8CF472B6,
    ),
    IslandView.finished: ViewLayout(
      height: 176,
      botX: 62,
      botDiameter: 58,
      agentMode: AgentMode.column,
      wash: 0x8034D399,
    ),
  };

  static ViewLayout layoutFor(IslandView view) => layouts[view]!;

  static double widthFor(IslandMode mode) => switch (mode) {
    IslandMode.hidden || IslandMode.compact => compactWidth,
    IslandMode.expanded => expandedWidth,
  };

  static double heightFor(IslandMode mode, IslandView view) => switch (mode) {
    IslandMode.hidden => 0,
    IslandMode.compact => compactHeight,
    IslandMode.expanded => layoutFor(view).height,
  };

  /// Positive when growing, negative when compacting. Drives whether the
  /// height tweens with a spring (overshoot) or a plain curve.
  static int order(IslandMode mode) => switch (mode) {
    IslandMode.hidden => 0,
    IslandMode.compact => 1,
    IslandMode.expanded => 2,
  };

  /// Signed top radius: positive renders convex top corners (expanded),
  /// negative renders concave ear cutouts (compact). The sign is what makes the
  /// body flow into the screen edge instead of reading as a floating bar.
  static double topRadiusFor(IslandMode mode) => switch (mode) {
    IslandMode.hidden => 0,
    IslandMode.compact => -earRadius,
    IslandMode.expanded => expandedRadius,
  };

  static double radiusFor(IslandMode mode) => switch (mode) {
    IslandMode.hidden => 0,
    IslandMode.compact => compactRadius,
    IslandMode.expanded => expandedRadius,
  };
}

/// Picks the view from the focused session and its visual state, mirroring the
/// reference app's rule that an alert forces the matching view.
IslandView viewFor({required ZeusBotState state, required int sessionCount}) {
  if (sessionCount == 0) return IslandView.empty;
  return switch (state) {
    ZeusBotState.approval => IslandView.approval,
    ZeusBotState.question => IslandView.question,
    ZeusBotState.error => IslandView.error,
    ZeusBotState.interrupted => IslandView.interrupted,
    ZeusBotState.finished => IslandView.finished,
    _ => IslandView.overview,
  };
}

/// States that should force the island open and pin it so the auto-collapse
/// timer never fires while the user has to act.
bool isAlerting(ZeusBotState state) =>
    state == ZeusBotState.approval || state == ZeusBotState.question;
