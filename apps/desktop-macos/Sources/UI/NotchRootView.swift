import SwiftUI

struct NotchRootView: View {
    @Environment(GatewayClient.self) private var gateway
    @State private var expanded = false
    @State private var showPair = false

    private var focus: ZeusSession? {
        gateway.sessions.first(where: { $0.needsAttention }) ?? gateway.sessions.first(where: { $0.isWorking }) ?? gateway.sessions.first
    }

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { expanded.toggle() } } label: {
                HStack(spacing: 9) {
                    ZeusMascotView(status: focus?.status ?? "idle", size: expanded ? 58 : 36)
                    if expanded {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(focus?.project ?? "Zeus").font(.headline)
                            Text(focus.map { "\($0.runtime) · \($0.status)" } ?? "Watching your agents")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    Circle().fill(focus?.needsAttention == true ? .orange : (focus?.isWorking == true ? .blue : .secondary))
                        .frame(width: 8, height: 8)
                }
                .padding(.horizontal, expanded ? 16 : 10).padding(.vertical, expanded ? 10 : 7)
            }
            .buttonStyle(.plain)

            if expanded {
                Divider().opacity(0.25)
                if gateway.credentials == nil {
                    Button("Pair desktop") { showPair = true }.padding(18)
                } else if gateway.sessions.isEmpty {
                    Text("No active sessions").foregroundStyle(.secondary).padding(22)
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(gateway.sessions.prefix(6)) { session in SessionRow(session: session) }
                        }.padding(10)
                    }.frame(maxHeight: 340)
                }
            }
        }
        .frame(width: expanded ? 390 : nil)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: expanded ? 30 : 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: expanded ? 30 : 24).stroke(.white.opacity(0.12)))
        .sheet(isPresented: $showPair) { PairView() }
    }
}

private struct SessionRow: View {
    @Environment(GatewayClient.self) private var gateway
    let session: ZeusSession
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.project ?? session.runtime).fontWeight(.semibold)
                    Text([session.runtime, session.machineName].compactMap{$0}.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Text(session.status.uppercased()).font(.caption2).foregroundStyle(session.needsAttention ? .orange : .secondary)
            }
            if let message = session.message, !message.isEmpty { Text(message).font(.caption).lineLimit(2).foregroundStyle(.secondary) }
            if session.needsAttention {
                HStack {
                    Button("Deny") { Task { try? await gateway.send("deny", session: session) } }
                    Spacer()
                    Button("Allow") { Task { try? await gateway.send("approve", session: session) } }.buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(12)
        .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
    }
}

private struct PairView: View {
    @Environment(GatewayClient.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    @State private var url = "https://zeus.example.com"
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pair Zeus").font(.title2.bold())
            TextField("Gateway URL", text: $url).textFieldStyle(.roundedBorder)
            TextField("Pairing code", text: $code).textFieldStyle(.roundedBorder)
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
            HStack { Spacer(); Button("Cancel") { dismiss() }; Button("Pair") { pair() }.buttonStyle(.borderedProminent).disabled(busy || code.isEmpty) }
        }.padding(24).frame(width: 420)
    }
    private func pair() {
        busy = true; error = nil
        Task {
            do { try await gateway.pair(gateway: url, code: code); dismiss() }
            catch { self.error = "Could not pair with this Gateway." }
            busy = false
        }
    }
}
