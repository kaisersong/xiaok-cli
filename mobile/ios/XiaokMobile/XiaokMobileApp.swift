import SwiftUI

@main
struct XiaokMobileApp: App {
    @StateObject private var store: XiaokAppStore
    @Environment(\.scenePhase) private var scenePhase

    init() {
        _store = StateObject(wrappedValue: AppEnvironment.makeStore())
    }

    var body: some Scene {
        WindowGroup {
            ContentView(store: store)
                .onOpenURL { url in
                    guard store.applyPairingURL(url) else {
                        return
                    }
                    Task {
                        await store.loadInitialSnapshot()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else {
                        return
                    }
                    Task {
                        await store.loadInitialSnapshot()
                    }
                }
        }
    }
}
