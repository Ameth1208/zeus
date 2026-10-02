import 'dart:ui';

import '../../gen/assets.gen.dart';

/// Visual states of the Zeus mascot. Mirrors the state table of the reference
/// app, but each state points at a real frame in `assets/zeus/`.
enum ZeusBotState {
  idle,
  working,
  thinking,
  searching,
  approval,
  question,
  error,
  finished,
  sleeping,
  interrupted,
}

/// How the secondary tasks are laid out next to the mascot. The reference app
/// morphs them between a grid, a pill column and a plain column so they never
/// pop in and out of existence.
enum AgentMode { none, pills, column }

class ZeusStateCfg {
  const ZeusStateCfg({
    required this.image,
    required this.color,
    required this.glow,
    this.tint = 0,
    this.badge = ZeusBadgeKind.none,
    this.bounces = false,
    this.scans = false,
    this.breathes = false,
    this.zz = false,
    this.look,
    this.tilt = 0,
    this.amplitude = 1.0,
  });

  /// Frame shown for this state. `null` falls back to the idle frame.
  final AssetGenImage? image;
  final int color;
  final double glow;
  final double tint;
  final ZeusBadgeKind badge;
  final bool bounces;
  final bool scans;
  final bool breathes;
  final bool zz;
  final Offset? look;
  final double tilt;
  final double amplitude;
}

const _cIdle = 0xFFE6E9EE;
const _cWorking = 0xFF3B9EFF;
const _cThinking = 0xFF8B5CF6;
const _cSearching = 0xFF6366F1;
const _cApproval = 0xFFF5A524;
const _cQuestion = 0xFF22D3EE;
const _cError = 0xFFF4505E;
const _cFinished = 0xFF34D399;
const _cSleeping = 0xFF94A3B8;
const _cInterrupted = 0xFFF472B6;

const _idleBase = ZeusStateCfg(image: null, color: _cIdle, glow: .15);

/// One entry per visual state — adding a state is a single table row.
///
/// Lazy `final` rather than `const` because the generated asset getters are not
/// const-constructible.
final kZeusBotStates = <ZeusBotState, ZeusStateCfg>{
  ZeusBotState.idle: _idleBase,
  ZeusBotState.working: ZeusStateCfg(
    image: Assets.images.working,
    color: _cWorking,
    glow: .65,
    tint: .72,
    badge: ZeusBadgeKind.dots,
  ),
  ZeusBotState.thinking: ZeusStateCfg(
    image: Assets.images.thinking,
    color: _cThinking,
    glow: .65,
    tint: .72,
    badge: ZeusBadgeKind.dots,
    look: const Offset(.55, .55),
  ),
  ZeusBotState.searching: ZeusStateCfg(
    image: Assets.images.lookRight,
    color: _cSearching,
    glow: .65,
    tint: .72,
    badge: ZeusBadgeKind.dots,
    scans: true,
  ),
  ZeusBotState.approval: ZeusStateCfg(
    image: Assets.images.waitingAproval,
    color: _cApproval,
    glow: .65,
    tint: .78,
    badge: ZeusBadgeKind.bang,
    bounces: true,
  ),
  ZeusBotState.question: ZeusStateCfg(
    image: Assets.images.waitingAproval,
    color: _cQuestion,
    glow: .65,
    tint: .75,
    badge: ZeusBadgeKind.question,
    tilt: .17,
  ),
  ZeusBotState.error: ZeusStateCfg(
    image: Assets.images.error,
    color: _cError,
    glow: .65,
    tint: .78,
    badge: ZeusBadgeKind.dot,
    amplitude: .06,
  ),
  ZeusBotState.finished: ZeusStateCfg(
    image: Assets.images.blink,
    color: _cFinished,
    glow: .65,
    tint: .35,
    badge: ZeusBadgeKind.dot,
    amplitude: 1.04,
  ),
  ZeusBotState.sleeping: ZeusStateCfg(
    image: Assets.images.sleep,
    color: _cSleeping,
    glow: .15,
    tint: .32,
    breathes: true,
    zz: true,
    amplitude: .96,
  ),
  ZeusBotState.interrupted: ZeusStateCfg(
    image: Assets.images.error,
    color: _cInterrupted,
    glow: .65,
    tint: .70,
    badge: ZeusBadgeKind.dot,
    amplitude: .05,
  ),
};

enum ZeusBadgeKind { none, dots, bang, question, dot }

/// Frame for a state, resolving the null fallback to the idle frame.
AssetGenImage zeusFrameFor(ZeusBotState state) =>
    kZeusBotStates[state]!.image ?? Assets.images.idle;

/// Maps a raw gateway session status + event type onto a visual state.
///
/// Mirrors `statusForEvent` in `gateway/internal/store.go` so the mascot agrees
/// with whatever the gateway decided the status is, and refines it when the
/// event carries more specific information.
ZeusBotState stateForSession({required String status, String lastEvent = ''}) {
  switch (status) {
    case 'waiting':
      // A pending request is an approval; the tool asking decides which face.
      return lastEvent == 'permission.requested'
          ? ZeusBotState.approval
          : ZeusBotState.question;
    case 'completed':
      return ZeusBotState.finished;
    case 'failed':
      return ZeusBotState.error;
    case 'interrupted':
      return ZeusBotState.interrupted;
    case 'stopped':
      return ZeusBotState.idle;
    case 'working':
      return switch (lastEvent) {
        'thinking' => ZeusBotState.thinking,
        'message' => ZeusBotState.thinking,
        'file.read' => ZeusBotState.searching,
        'tool.failed' => ZeusBotState.error,
        _ => ZeusBotState.working,
      };
    default:
      return ZeusBotState.idle;
  }
}

/// Short human line for the ticker, built from the fields the event carries.
String describeEvent({
  required String lastEvent,
  String? tool,
  String? path,
  String? command,
  String? message,
  String? model,
}) {
  final target = (path != null && path.isNotEmpty)
      ? _basename(path)
      : (command != null && command.isNotEmpty)
      ? command
      : null;
  final toolLabel = (tool != null && tool.isNotEmpty) ? tool : null;

  return switch (lastEvent) {
    'session.started' => 'Session started',
    'thinking' => model == null ? 'Thinking' : 'Thinking · $model',
    'message' => message ?? 'Agent replied',
    'tool.started' =>
      toolLabel == null
          ? 'Using a tool'
          : target == null
          ? toolLabel
          : '$toolLabel · $target',
    'tool.completed' => toolLabel == null ? 'Tool finished' : '$toolLabel done',
    'tool.failed' => toolLabel == null ? 'Tool failed' : '$toolLabel failed',
    'file.read' => target == null ? 'Reading a file' : 'Reading $target',
    'file.changed' => target == null ? 'Editing files' : 'Editing $target',
    'command.started' =>
      target == null ? 'Running a command' : 'Running $target',
    'command.completed' => 'Command finished',
    'permission.requested' => 'Waiting for your approval',
    'permission.resolved' => 'Approval resolved',
    'session.completed' => 'Task completed',
    'session.failed' => message ?? 'Task failed',
    'session.stopped' => 'Task stopped',
    'agent.interrupted' => 'Interrupted',
    'heartbeat' => 'Connected',
    _ => lastEvent,
  };
}

String _basename(String path) {
  final cleaned = path.replaceAll('\\', '/');
  final index = cleaned.lastIndexOf('/');
  return index < 0 ? cleaned : cleaned.substring(index + 1);
}
