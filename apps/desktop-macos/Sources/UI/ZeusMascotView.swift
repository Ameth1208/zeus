import AppKit
import SwiftUI

struct ZeusMascotView: View {
    let status: String
    var size: CGFloat = 112
    @State private var pointer: CGPoint = .zero
    @State private var tapped = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let breathing = 1 + sin(t * 1.9) * 0.012
            let working = status == "working" ? sin(t * 5.5) * 0.006 : 0
            mascotImage
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .scaleEffect(breathing + working + (tapped ? 0.05 : 0))
                .rotationEffect(.degrees(status == "waiting" ? 2.0 : pointer.x * 1.5))
                .offset(x: pointer.x * 2, y: pointer.y)
                .shadow(color: glow.opacity(0.55), radius: status == "waiting" ? 18 : 9)
                .animation(.spring(response: 0.35, dampingFraction: 0.66), value: tapped)
        }
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            switch phase {
            case .active(let p):
                pointer = CGPoint(
                    x: max(-1, min(1, (p.x / size) * 2 - 1)),
                    y: max(-1, min(1, (p.y / size) * 2 - 1))
                )
            case .ended:
                pointer = .zero
            }
        }
        .onTapGesture {
            tapped = true
            Task {
                try? await Task.sleep(for: .milliseconds(240))
                tapped = false
            }
        }
    }

    private var mascotImage: Image {
        if let url = Bundle.main.url(forResource: "zeus-mascot", withExtension: "png"),
           let nsImage = NSImage(contentsOf: url) {
            return Image(nsImage: nsImage)
        }
        return Image(systemName: "pawprint.fill")
    }

    private var glow: Color {
        switch status {
        case "waiting": .orange
        case "failed": .red
        case "completed": .green
        default: .blue
        }
    }
}
