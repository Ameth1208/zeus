import Foundation
import Observation

@MainActor @Observable
final class GatewayClient {
    var sessions: [ZeusSession] = []
    var credentials: ZeusCredentials?
    var lastError: String?
    private var streamTask: Task<Void, Never>?

    init() {
        credentials = CredentialStore.load()
        if credentials != nil { connect() }
    }

    deinit { streamTask?.cancel() }

    func pair(gateway: String, code: String, deviceName: String = Host.current().localizedName ?? "Zeus Mac") async throws {
        let base = gateway.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + "/v1/pair/complete") else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "device_name": deviceName])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 201 else { throw URLError(.userAuthenticationRequired) }
        let decoded = try JSONDecoder().decode(PairResult.self, from: data)
        let creds = ZeusCredentials(gateway: base, token: decoded.token)
        credentials = creds
        CredentialStore.save(creds)
        connect()
    }

    func disconnect() {
        streamTask?.cancel()
        sessions = []
        credentials = nil
        CredentialStore.clear()
    }

    func connect() {
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    try await refresh()
                    try await streamEvents()
                } catch {
                    lastError = error.localizedDescription
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    func refresh() async throws {
        guard let creds = credentials,
              let url = URL(string: creds.gateway + "/v1/sessions") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        sessions = try decoder.decode(SessionsEnvelope.self, from: data).sessions
    }

    func send(_ kind: String, session: ZeusSession) async throws {
        guard let creds = credentials,
              let url = URL(string: creds.gateway + "/v1/actions") else { return }
        var payload: [String: String]? = nil
        if ["approve", "deny"].contains(kind), let request = session.pendingRequestId, !request.isEmpty {
            payload = ["request_id": request]
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(ZeusAction(sessionId: session.id, agentId: session.agentId, kind: kind, payload: payload))
        let (_, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 202 else { throw URLError(.cannotParseResponse) }
    }

    private func streamEvents() async throws {
        guard let creds = credentials,
              let url = URL(string: creds.gateway + "/v1/events/stream") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.hasPrefix("data:") && line != "data: {}" { try await refresh() }
        }
    }
}
