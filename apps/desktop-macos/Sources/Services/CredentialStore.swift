import Foundation
import Security

struct ZeusCredentials: Codable { var gateway: String; var token: String }

enum CredentialStore {
    private static let service = "ai.zeus.agent.desktop"
    private static let account = "gateway"

    static func load() -> ZeusCredentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(ZeusCredentials.self, from: data)
    }

    static func save(_ value: ZeusCredentials) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(key as CFDictionary)
        var add = key
        add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }

    static func clear() {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(key as CFDictionary)
    }
}
