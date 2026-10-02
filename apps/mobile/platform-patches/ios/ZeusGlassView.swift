import Flutter
import UIKit

final class ZeusGlassViewFactory: NSObject, FlutterPlatformViewFactory {
    func createArgsCodec() -> (any FlutterMessageCodec & NSObjectProtocol)? {
        FlutterStandardMessageCodec.sharedInstance()
    }

    func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
        let values = args as? [String: Any]
        let radius = CGFloat((values?["radius"] as? NSNumber)?.doubleValue ?? 28)
        let interactive = (values?["interactive"] as? Bool) ?? false
        return ZeusGlassPlatformView(frame: frame, radius: radius, interactive: interactive)
    }
}

final class ZeusGlassPlatformView: NSObject, FlutterPlatformView {
    private let root: UIVisualEffectView

    init(frame: CGRect, radius: CGFloat, interactive: Bool) {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = interactive
            glass.tintColor = UIColor.systemBlue.withAlphaComponent(0.035)
            root = UIVisualEffectView(effect: glass)
            root.cornerConfiguration = .corners(radius: radius)
        } else {
            root = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
            root.layer.cornerRadius = radius
            root.layer.cornerCurve = .continuous
            root.clipsToBounds = true
        }
        #else
        root = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        root.layer.cornerRadius = radius
        root.layer.cornerCurve = .continuous
        root.clipsToBounds = true
        #endif
        super.init()
        root.frame = frame
        root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.backgroundColor = .clear
        // Flutter owns gestures; the native view supplies the material only.
        root.isUserInteractionEnabled = false
    }

    func view() -> UIView { root }
}
