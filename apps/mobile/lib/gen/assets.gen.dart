// dart format width=100

/// GENERATED CODE - DO NOT MODIFY BY HAND
/// *****************************************************
///  FlutterGen
/// *****************************************************

// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: deprecated_member_use,directives_ordering,implicit_dynamic_list_literal,unnecessary_import

import 'package:flutter/widgets.dart';

class $AssetsImagesGen {
  const $AssetsImagesGen();

  /// File path: assets/images/blink.png
  AssetGenImage get blink => const AssetGenImage('assets/images/blink.png');

  /// File path: assets/images/error.png
  AssetGenImage get error => const AssetGenImage('assets/images/error.png');

  /// File path: assets/images/idle.png
  AssetGenImage get idle => const AssetGenImage('assets/images/idle.png');

  /// File path: assets/images/look_left.png
  AssetGenImage get lookLeft => const AssetGenImage('assets/images/look_left.png');

  /// File path: assets/images/look_right.png
  AssetGenImage get lookRight => const AssetGenImage('assets/images/look_right.png');

  /// File path: assets/images/sleep.png
  AssetGenImage get sleep => const AssetGenImage('assets/images/sleep.png');

  /// File path: assets/images/thinking.png
  AssetGenImage get thinking => const AssetGenImage('assets/images/thinking.png');

  /// File path: assets/images/waiting_aproval.png
  AssetGenImage get waitingAproval => const AssetGenImage('assets/images/waiting_aproval.png');

  /// File path: assets/images/working.png
  AssetGenImage get working => const AssetGenImage('assets/images/working.png');

  /// File path: assets/images/zeus-logo.png
  AssetGenImage get zeusLogo => const AssetGenImage('assets/images/zeus-logo.png');

  /// File path: assets/images/zeus_app_icon.png
  AssetGenImage get zeusAppIcon => const AssetGenImage('assets/images/zeus_app_icon.png');

  /// File path: assets/images/zeus_mascot.png
  AssetGenImage get zeusMascot => const AssetGenImage('assets/images/zeus_mascot.png');

  /// List of all assets
  List<AssetGenImage> get values => [
    blink,
    error,
    idle,
    lookLeft,
    lookRight,
    sleep,
    thinking,
    waitingAproval,
    working,
    zeusLogo,
    zeusAppIcon,
    zeusMascot,
  ];
}

class $AssetsRiveGen {
  const $AssetsRiveGen();

  /// File path: assets/rive/README.md
  String get readme => 'assets/rive/README.md';

  /// File path: assets/rive/zeus-base.svg
  String get zeusBase => 'assets/rive/zeus-base.svg';

  /// List of all assets
  List<String> get values => [readme, zeusBase];
}

abstract final class Assets {
  static const $AssetsImagesGen images = $AssetsImagesGen();
  static const $AssetsRiveGen rive = $AssetsRiveGen();
}

class AssetGenImage {
  const AssetGenImage(this._assetName, {this.size, this.flavors = const {}, this.animation});

  final String _assetName;

  final Size? size;
  final Set<String> flavors;
  final AssetGenImageAnimation? animation;

  Image image({
    Key? key,
    AssetBundle? bundle,
    ImageFrameBuilder? frameBuilder,
    ImageErrorWidgetBuilder? errorBuilder,
    String? semanticLabel,
    bool excludeFromSemantics = false,
    double? scale,
    double? width,
    double? height,
    Color? color,
    Animation<double>? opacity,
    BlendMode? colorBlendMode,
    BoxFit? fit,
    AlignmentGeometry alignment = Alignment.center,
    ImageRepeat repeat = ImageRepeat.noRepeat,
    Rect? centerSlice,
    bool matchTextDirection = false,
    bool gaplessPlayback = true,
    bool isAntiAlias = false,
    String? package,
    FilterQuality filterQuality = FilterQuality.medium,
    int? cacheWidth,
    int? cacheHeight,
  }) {
    return Image.asset(
      _assetName,
      key: key,
      bundle: bundle,
      frameBuilder: frameBuilder,
      errorBuilder: errorBuilder,
      semanticLabel: semanticLabel,
      excludeFromSemantics: excludeFromSemantics,
      scale: scale,
      width: width,
      height: height,
      color: color,
      opacity: opacity,
      colorBlendMode: colorBlendMode,
      fit: fit,
      alignment: alignment,
      repeat: repeat,
      centerSlice: centerSlice,
      matchTextDirection: matchTextDirection,
      gaplessPlayback: gaplessPlayback,
      isAntiAlias: isAntiAlias,
      package: package,
      filterQuality: filterQuality,
      cacheWidth: cacheWidth,
      cacheHeight: cacheHeight,
    );
  }

  ImageProvider provider({AssetBundle? bundle, String? package}) {
    return AssetImage(_assetName, bundle: bundle, package: package);
  }

  String get path => _assetName;

  String get keyName => _assetName;
}

class AssetGenImageAnimation {
  const AssetGenImageAnimation({
    required this.isAnimation,
    required this.duration,
    required this.frames,
  });

  final bool isAnimation;
  final Duration duration;
  final int frames;
}
