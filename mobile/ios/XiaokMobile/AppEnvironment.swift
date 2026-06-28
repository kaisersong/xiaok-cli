import Foundation

@MainActor
enum AppEnvironment {
    static func makeStore() -> XiaokAppStore {
        let processInfo = ProcessInfo.processInfo
        let environment = processInfo.environment
        let isUITest = processInfo.arguments.contains("--xiaok-ui-test")
        let isOfflineUITest = processInfo.arguments.contains("--xiaok-offline")
        let isTestMode = environment["XIAOK_MOBILE_TEST_MODE"] == "1"
        let isXCTest = environment["XCTestConfigurationFilePath"] != nil

        if isOfflineUITest {
            return XiaokAppStore(
                client: OfflineMobileGatewayClient(),
                userDefaults: isolatedTestDefaults()
            )
        }

        if isUITest || isTestMode || isXCTest {
            return XiaokAppStore(
                client: MockMobileGatewayClient(),
                userDefaults: isolatedTestDefaults()
            )
        }

        let relayClient = MobileRelayConfiguration.load().map { RelayMobileGatewayClient(configuration: $0) }
        return XiaokAppStore(
            desktopDiscovery: BonjourDesktopDiscovery(),
            relayClient: relayClient,
            networkMonitor: NWPathMobileNetworkMonitor()
        ) { url in
            HTTPMobileGatewayClient(
                baseURL: url,
                accessToken: UserDefaults.standard.string(forKey: XiaokPreferenceKeys.accessToken)
            )
        }
    }

    static func makeClient() -> any MobileGatewayClient {
        let processInfo = ProcessInfo.processInfo
        let environment = processInfo.environment
        let isUITest = processInfo.arguments.contains("--xiaok-ui-test")
        let isTestMode = environment["XIAOK_MOBILE_TEST_MODE"] == "1"
        let isXCTest = environment["XCTestConfigurationFilePath"] != nil

        if isUITest || isTestMode || isXCTest {
            return MockMobileGatewayClient()
        }

        guard let urlString = environment["XIAOK_MOBILE_GATEWAY_URL"],
              let baseURL = URL(string: urlString) else {
            return OfflineMobileGatewayClient()
        }
        return HTTPMobileGatewayClient(
            baseURL: baseURL,
            accessToken: UserDefaults.standard.string(forKey: XiaokPreferenceKeys.accessToken)
        )
    }

    private static func isolatedTestDefaults() -> UserDefaults {
        UserDefaults(suiteName: "XiaokMobileTests-\(UUID().uuidString)") ?? .standard
    }
}
