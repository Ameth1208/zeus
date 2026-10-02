import AppKit
import SwiftUI

@MainActor
final class NotchPanelController {
    private let panel: NSPanel

    init(root: some View) {
        let host = NSHostingView(rootView: root)
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = host
        panel.isMovableByWindowBackground = false
        position()
        panel.orderFrontRegardless()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.position() }
    }

    private func position() {
        guard let screen = NSScreen.main else { return }
        let width: CGFloat = 430, height: CGFloat = 430
        let x = screen.frame.midX - width / 2
        let y = screen.frame.maxY - height + 10
        panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true)
    }
}
