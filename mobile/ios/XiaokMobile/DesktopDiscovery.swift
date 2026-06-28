import Foundation
import Network

protocol DesktopDiscovery {
    func discoverDesktopGatewayURLs(timeout: TimeInterval) async -> [URL]
}

struct NoopDesktopDiscovery: DesktopDiscovery {
    func discoverDesktopGatewayURLs(timeout: TimeInterval) async -> [URL] {
        []
    }
}

protocol MobileNetworkMonitor {
    func start(onChange: @escaping @Sendable () -> Void)
    func cancel()
}

struct NoopMobileNetworkMonitor: MobileNetworkMonitor {
    func start(onChange: @escaping @Sendable () -> Void) {
    }

    func cancel() {
    }
}

final class NWPathMobileNetworkMonitor: MobileNetworkMonitor {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "xiaok.mobile.network-monitor")

    func start(onChange: @escaping @Sendable () -> Void) {
        monitor.pathUpdateHandler = { path in
            guard path.status == .satisfied else {
                return
            }
            onChange()
        }
        monitor.start(queue: queue)
    }

    func cancel() {
        monitor.cancel()
    }
}

final class BonjourDesktopDiscovery: NSObject, DesktopDiscovery {
    func discoverDesktopGatewayURLs(timeout: TimeInterval) async -> [URL] {
        let session = BonjourDesktopDiscoverySession(timeout: timeout)
        return await session.discover()
    }
}

private final class BonjourDesktopDiscoverySession: NSObject, @unchecked Sendable, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private let timeout: TimeInterval
    private var continuation: CheckedContinuation<[URL], Never>?
    private var services: [NetService] = []
    private var urls: [URL] = []
    private var seenURLs: Set<String> = []
    private var didFinish = false

    init(timeout: TimeInterval) {
        self.timeout = timeout
        super.init()
    }

    func discover() async -> [URL] {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                self.continuation = continuation
                self.browser.delegate = self
                self.browser.searchForServices(ofType: "_xiaok-desktop._tcp.", inDomain: "local.")
                DispatchQueue.main.asyncAfter(deadline: .now() + self.timeout) {
                    self.finish()
                }
            }
        }
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: timeout)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        finish()
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard sender.port > 0,
              let rawHost = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
              !rawHost.isEmpty,
              !rawHost.contains(":") else {
            return
        }

        var components = URLComponents()
        components.scheme = "http"
        components.host = rawHost
        components.port = sender.port
        guard let url = components.url,
              !seenURLs.contains(url.absoluteString) else {
            return
        }

        seenURLs.insert(url.absoluteString)
        urls.append(url)
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    }

    private func finish() {
        guard !didFinish else {
            return
        }

        didFinish = true
        browser.stop()
        services.removeAll()
        let discoveredURLs = urls
        urls.removeAll()
        continuation?.resume(returning: discoveredURLs)
        continuation = nil
    }
}
