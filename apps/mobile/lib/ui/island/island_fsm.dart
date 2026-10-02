import 'dart:async';

import 'package:flutter/foundation.dart';

import 'island_geometry.dart';

/// Outer open/close machine. Pure logic: no widgets, no painting. Communicates
/// only through [onChanged], so the same machine can drive the Flutter island
/// and the Tauri window.
///
/// The two escape hatches exist because the app also drives the island directly
/// (an alert forces it open) and the two would otherwise desync.
class IslandFsm extends ChangeNotifier {
  IslandFsm({
    this.homeToCompactDelay = const Duration(seconds: 15),
    this.compactToHiddenDelay = const Duration(seconds: 60),
    this.finishedHold = const Duration(milliseconds: 5200),
  });

  final Duration homeToCompactDelay;
  final Duration compactToHiddenDelay;
  final Duration finishedHold;

  IslandMode _mode = IslandMode.compact;
  IslandView _view = IslandView.empty;
  bool _pinned = false;
  ZeusOverride _override = ZeusOverride.none;

  final List<Timer> _timers = [];

  IslandMode get mode => _mode;
  IslandView get view => _view;
  bool get pinned => _pinned;

  /// `override` is a Dart annotation, so the escape hatch is exposed under a
  /// non-clashing name.
  ZeusOverride get visualOverride => _override;

  bool get isExpanded => _mode == IslandMode.expanded;
  bool get isHidden => _mode == IslandMode.hidden;

  /// An alert suppresses the auto-collapse entirely — the user has to act, so
  /// the island must not fold away underneath them.
  void setPinned(bool value) {
    if (_pinned == value) return;
    _pinned = value;
    _reschedule();
  }

  void setView(IslandView value) {
    if (_view == value) return;
    _view = value;
    notifyListeners();
  }

  /// Debug/one-shot escape hatch that sits above the focused session's state.
  void setOverride(ZeusOverride value) {
    if (_override == value) return;
    _override = value;
    notifyListeners();
  }

  void expand([IslandView? view]) {
    if (view != null) _view = view;
    _cancelTimers();
    _transitionTo(IslandMode.expanded);
    _scheduleCompact();
  }

  void compact() {
    _cancelTimers();
    _transitionTo(IslandMode.compact);
    _scheduleHide();
  }

  void hide() {
    _cancelTimers();
    _transitionTo(IslandMode.hidden);
  }

  /// The app folded the island itself. Move to compact right away so hover and
  /// tap keep working instead of being swallowed by a machine that still thinks
  /// it is expanded.
  void collapse() {
    if (_mode != IslandMode.expanded) return;
    compact();
  }

  void toggle() => _mode == IslandMode.expanded ? compact() : expand();

  /// The app hid the island on its own (e.g. disconnected). Mirror it without
  /// side effects so the next event peeks again.
  void hiddenExternally() {
    if (_mode != IslandMode.compact) return;
    _cancelTimers();
    _transitionTo(IslandMode.hidden);
  }

  void onNeedsAttention() {
    setPinned(true);
    expand();
  }

  void onFinished() {
    setPinned(false);
    setOverride(ZeusOverride.none);
    expand(_view);
    _cancelTimers();
    _timers.add(
      Timer(finishedHold, () {
        if (!_pinned) compact();
      }),
    );
  }

  void onSessionsCleared() {
    setPinned(false);
    setOverride(ZeusOverride.none);
    setView(IslandView.empty);
  }

  void _transitionTo(IslandMode next) {
    if (_mode == next) return;
    _mode = next;
    notifyListeners();
  }

  void _scheduleCompact() {
    _cancelTimers();
    if (_pinned) return;
    _timers.add(
      Timer(homeToCompactDelay, () {
        if (!_pinned && _mode == IslandMode.expanded) compact();
      }),
    );
  }

  void _scheduleHide() {
    _cancelTimers();
    _timers.add(
      Timer(compactToHiddenDelay, () {
        if (_mode == IslandMode.compact) hide();
      }),
    );
  }

  void _reschedule() {
    if (_mode == IslandMode.expanded) {
      _scheduleCompact();
    }
  }

  void _cancelTimers() {
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
  }

  @override
  void dispose() {
    _cancelTimers();
    super.dispose();
  }
}

/// One-shot visual overrides, independent of any session.
enum ZeusOverride { none, dizzy }
