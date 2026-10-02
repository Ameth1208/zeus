import Foundation

struct ZeusSession: Codable, Identifiable, Hashable {
    let id: String
    let agentId: String
    let runtime: String
    let provider: String?
    let model: String?
    let project: String?
    let machineId: String?
    let machineName: String?
    let status: String
    let lastEvent: String
    let updatedAt: Date
    let message: String?
    let capabilities: [String]
    let pendingRequestId: String?

    enum CodingKeys: String, CodingKey {
        case id, runtime, provider, model, project, status, message, capabilities
        case agentId = "agent_id"
        case machineId = "machine_id"
        case machineName = "machine_name"
        case lastEvent = "last_event"
        case updatedAt = "updated_at"
        case pendingRequestId = "pending_request_id"
    }

    var needsAttention: Bool { status == "waiting" }
    var isWorking: Bool { status == "working" }
}

struct SessionsEnvelope: Codable { let sessions: [ZeusSession] }

struct PairResult: Codable {
    let deviceId: String
    let token: String
    enum CodingKeys: String, CodingKey { case deviceId = "device_id", token }
}

struct ZeusAction: Encodable {
    let sessionId: String
    let agentId: String
    let kind: String
    let payload: [String: String]?
    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id", agentId = "agent_id", kind, payload
    }
}
